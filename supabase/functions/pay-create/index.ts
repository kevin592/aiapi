// ============================================================
// 创建支付订单 — 多通道
//   alipay : 支付宝官方「当面付」扫码（RSA2 签名，资金直达商户账户）
//   wechat : 微信支付官方「Native 扫码」（APIv3 RSA + AES-GCM）
//   epay   : 易支付协议（兼容聚合平台，备用）
// 部署：supabase functions deploy pay-create
// ============================================================

import { createClient } from 'jsr:@supabase/supabase-js@2'
import CryptoJS from 'npm:crypto-js@4.2.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface PayCfg {
  enabled: string[]
  recharge_min: number
  credits_rate: number
  epay?: { url: string; pid: string; key: string }
  alipay?: { app_id: string; private_key: string; alipay_public_key: string }
  wechat?: { mchid: string; appid: string; api_v3_key: string; serial_no: string; private_key: string }
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  })
}

// ---------------- 通用工具 ----------------

function b64encode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s.replace(/\s/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** PEM 或裸 base64 密钥字符串 -> DER 字节 */
function keyToDer(key: string): Uint8Array {
  const cleaned = key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  return b64decode(cleaned)
}

async function importRsaKey(der: Uint8Array, isPrivate: boolean, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    isPrivate ? 'pkcs8' : 'spki',
    der as unknown as BufferSource,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    usage,
  )
}

async function rsaSignSha256(privateKeyPem: string, message: string): Promise<string> {
  const key = await importRsaKey(keyToDer(privateKeyPem), true, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(message))
  return b64encode(sig)
}

async function rsaVerifySha256(publicKeyPem: string, message: string, signB64: string): Promise<boolean> {
  try {
    const key = await importRsaKey(keyToDer(publicKeyPem), false, ['verify'])
    return await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', key, b64decode(signB64) as unknown as BufferSource,
      new TextEncoder().encode(message),
    )
  } catch {
    return false
  }
}

function randomStr(n: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const arr = crypto.getRandomValues(new Uint8Array(n))
  return Array.from(arr, (b) => alphabet[b % alphabet.length]).join('')
}

// ---------------- 支付宝官方「当面付」 ----------------

async function alipayPrecreate(
  cfg: NonNullable<PayCfg['alipay']>,
  orderNo: string,
  amountYuan: string,
  notifyUrl: string,
): Promise<string> {
  // 支付宝时间戳：北京时间 yyyy-MM-dd HH:mm:ss
  const ts = new Date(Date.now() + 8 * 3600_000).toISOString().replace('T', ' ').slice(0, 19)
  const params: Record<string, string> = {
    app_id: cfg.app_id,
    method: 'alipay.trade.precreate',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: ts,
    version: '1.0',
    notify_url: notifyUrl,
    biz_content: JSON.stringify({
      out_trade_no: orderNo,
      total_amount: amountYuan,
      subject: `AI-API充值${orderNo.slice(-6)}`,
    }),
  }
  // 签名：参数名 ASCII 升序，跳过 sign/sign_type，k=v& 拼接
  const signStr = Object.keys(params)
    .filter((k) => params[k] !== '' && k !== 'sign' && k !== 'sign_type')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
  params.sign = await rsaSignSha256(cfg.private_key, signStr)

  const res = await fetch('https://openapi.alipay.com/gateway.do', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  })
  const body = await res.json()
  const r = body?.alipay_trade_precreate_response
  if (!r || r.code !== '10000' || !r.qr_code) {
    throw new Error(`支付宝下单失败: ${r?.sub_msg || r?.msg || JSON.stringify(body).slice(0, 200)}`)
  }
  return r.qr_code as string
}

// ---------------- 微信支付官方「Native 扫码」 ----------------

async function wechatV3SignedFetch(
  cfg: NonNullable<PayCfg['wechat']>,
  method: string,
  path: string,
  body?: string,
): Promise<Record<string, unknown>> {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = randomStr(32)
  const message = `${method}\n${path}\n${timestamp}\n${nonce}\n${body ?? ''}\n`
  const signature = await rsaSignSha256(cfg.private_key, message)
  const auth = `WECHATPAY2-SHA256-RSA2048 mchid="${cfg.mchid}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${cfg.serial_no}"`

  const res = await fetch(`https://api.mch.weixin.qq.com${path}`, {
    method,
    headers: {
      'Authorization': auth,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'aiapi-gateway',
    },
    body,
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(`微信支付请求失败: ${data?.message || JSON.stringify(data).slice(0, 200)}`)
  }
  return data
}

async function wechatNativeOrder(
  cfg: NonNullable<PayCfg['wechat']>,
  orderNo: string,
  amountFen: number,
  notifyUrl: string,
): Promise<string> {
  const body = JSON.stringify({
    appid: cfg.appid,
    mchid: cfg.mchid,
    description: `AI-API充值${orderNo.slice(-6)}`,
    out_trade_no: orderNo,
    notify_url: notifyUrl,
    amount: { total: amountFen },
  })
  const data = await wechatV3SignedFetch(cfg, 'POST', '/v3/pay/transactions/native', body)
  const codeUrl = data?.code_url as string | undefined
  if (!codeUrl) throw new Error('微信支付下单失败: 未返回 code_url')
  return codeUrl
}

// ---------------- 易支付（备用通道） ----------------

function md5Sign(params: Record<string, string>, key: string): string {
  const str = Object.keys(params)
    .filter((k) => params[k] !== '' && k !== 'sign' && k !== 'sign_type')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&') + key
  return CryptoJS.MD5(str).toString()
}

function buildEpayUrl(
  cfg: NonNullable<PayCfg['epay']>,
  orderNo: string,
  amountYuan: string,
  payType: 'alipay' | 'wxpay',
  notifyUrl: string,
  returnUrl: string,
): string {
  const params: Record<string, string> = {
    pid: cfg.pid,
    type: payType,
    out_trade_no: orderNo,
    notify_url: notifyUrl,
    return_url: returnUrl,
    name: `AI-API充值${orderNo.slice(-6)}`,
    money: amountYuan,
  }
  const sign = md5Sign(params, cfg.key)
  const qs = new URLSearchParams({ ...params, sign, sign_type: 'MD5' }).toString()
  return `${cfg.url}${cfg.url.includes('?') ? '&' : '?'}${qs}`
}

// ---------------- 主入口 ----------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })

  try {
    // 校验登录用户
    const authHeader = req.headers.get('authorization') ?? ''
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json(401, { error: '请先登录' })

    const body = await req.json().catch(() => ({}))
    const amount = Number(body?.amount)
    const channel = String(body?.pay_type ?? '') // 用户选择: alipay / wxpay
    if (!['alipay', 'wxpay'].includes(channel)) {
      return json(400, { error: 'pay_type 必须为 alipay 或 wxpay' })
    }

    // 读取支付配置
    const { data: cfgRow } = await admin.from('settings').select('value').eq('key', 'payment').maybeSingle()
    const cfg = (cfgRow?.value ?? {}) as unknown as PayCfg
    const minAmount = Number(cfg.recharge_min ?? 10)
    const rate = Number(cfg.credits_rate ?? 1)
    if (!Number.isFinite(amount) || amount < minAmount) {
      return json(400, { error: `充值金额不能低于 ${minAmount} 元` })
    }

    // 按用户选择的通道挑选支付方式：
    // 支付宝 -> 优先官方 alipay；微信 -> 优先官方 wechat；否则回退易支付
    let provider: string
    if (channel === 'alipay') {
      provider = cfg.alipay?.app_id && cfg.alipay.private_key && cfg.alipay.alipay_public_key ? 'alipay' : 'epay'
    } else {
      provider = cfg.wechat?.mchid && cfg.wechat.api_v3_key && cfg.wechat.serial_no && cfg.wechat.private_key ? 'wechat' : 'epay'
    }
    if (provider === 'epay' && !(cfg.epay?.url && cfg.epay.pid && cfg.epay.key)) {
      return json(400, { error: '支付尚未配置，请联系管理员在「系统设置」中完成支付通道配置' })
    }
    if (cfg.enabled && cfg.enabled.length > 0 && !cfg.enabled.includes(provider)) {
      return json(400, { error: `支付方式 ${provider} 未启用` })
    }

    // 创建订单
    const orderNo = `PAY${Date.now()}${Math.floor(Math.random() * 9000 + 1000)}`
    const credits = +(amount * rate).toFixed(4)
    const { error: insertErr } = await admin.from('orders').insert({
      order_no: orderNo,
      user_id: user.id,
      amount: +amount.toFixed(2),
      credits,
      provider,
      pay_type: channel,
      status: 'pending',
    })
    if (insertErr) return json(500, { error: `创建订单失败：${insertErr.message}` })

    const notifyUrl = `${SUPABASE_URL}/functions/v1/pay-notify`
    const amountYuan = amount.toFixed(2)

    // 生成支付凭据
    if (provider === 'alipay') {
      const qr = await alipayPrecreate(cfg.alipay!, orderNo, amountYuan, notifyUrl)
      return json(200, { type: 'qr', provider, qr, order_no: orderNo, credits, amount: +amountYuan })
    }

    if (provider === 'wechat') {
      const qr = await wechatNativeOrder(cfg.wechat!, orderNo, Math.round(amount * 100), notifyUrl)
      return json(200, { type: 'qr', provider, qr, order_no: orderNo, credits, amount: +amountYuan })
    }

    // 易支付：跳转链接
    const { data: siteRow } = await admin.from('settings').select('value').eq('key', 'site').maybeSingle()
    const site = (siteRow?.value ?? {}) as Record<string, string>
    const siteUrl = site.site_url || (req.headers.get('origin') ?? '')
    const payUrl = buildEpayUrl(cfg.epay!, orderNo, amountYuan, channel, notifyUrl, `${siteUrl}/#/recharge`)
    return json(200, { type: 'url', provider, url: payUrl, order_no: orderNo, credits, amount: +amountYuan })
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) })
  }
})
