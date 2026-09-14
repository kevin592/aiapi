// ============================================================
// 支付异步回调 — 多通道验签后自动入账（幂等）
//   alipay : 支付宝官方异步通知（POST form，RSA2 验签）
//   wechat : 微信支付 APIv3 回调（JSON + AES-GCM 解密 + 平台证书验签）
//   epay   : 易支付协议（GET/POST，MD5 验签）
// 部署：supabase functions deploy pay-notify --no-verify-jwt
// ============================================================

import { createClient } from 'jsr:@supabase/supabase-js@2'
import CryptoJS from 'npm:crypto-js@4.2.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const CORS_HEADERS: Record<string, string> = { 'Access-Control-Allow-Origin': '*' }

interface AlipayCfg { app_id: string; private_key: string; alipay_public_key: string }
interface WechatCfg { mchid: string; appid: string; api_v3_key: string; serial_no: string; private_key: string }

// ---------------- 工具 ----------------

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

function keyToDer(key: string): Uint8Array {
  return b64decode(key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''))
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
  return b64encode(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(message)))
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

/** AES-256-GCM 解密（微信 APIv3 密钥 / 平台证书解密通用） */
async function aesGcmDecrypt(apiV3Key: string, nonceB64: string, ciphertextB64: string, associatedData: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(apiV3Key) as unknown as BufferSource, 'AES-GCM', false, ['decrypt'])
  const plain = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: b64decode(nonceB64) as unknown as BufferSource,
      additionalData: enc.encode(associatedData) as unknown as BufferSource,
    },
    key,
    b64decode(ciphertextB64) as unknown as BufferSource,
  )
  return new TextDecoder().decode(plain)
}

async function loadPayCfg(): Promise<{ alipay?: AlipayCfg; wechat?: WechatCfg; epay?: { url: string; pid: string; key: string } }> {
  const { data } = await admin.from('settings').select('value').eq('key', 'payment').maybeSingle()
  return (data?.value ?? {}) as never
}

async function markPaid(orderNo: string, tradeNo: string | null): Promise<boolean> {
  const { error } = await admin.rpc('mark_order_paid', { p_order_no: orderNo, p_trade_no: tradeNo })
  if (error) {
    console.error('mark_order_paid failed:', error.message)
    return false
  }
  console.log('订单已入账:', orderNo)
  return true
}

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS_HEADERS } })
}

// ---------------- 支付宝官方回调 ----------------

async function handleAlipay(p: Record<string, string>, cfg: AlipayCfg): Promise<Response> {
  const sign = String(p.sign ?? '')
  const signType = String(p.sign_type ?? 'RSA2')
  if (signType !== 'RSA2' || !sign) return text(400, 'fail')

  // 验签：参数名 ASCII 升序，跳过 sign/sign_type，k=v& 拼接（原始值不 urlencode）
  const signStr = Object.keys(p)
    .filter((k) => p[k] !== '' && k !== 'sign' && k !== 'sign_type')
    .sort()
    .map((k) => `${k}=${p[k]}`)
    .join('&')
  const ok = await rsaVerifySha256(cfg.alipay_public_key, signStr, sign)
  if (!ok) {
    console.warn('alipay notify: 验签失败', p.out_trade_no)
    return text(400, 'fail')
  }
  if (p.trade_status === 'TRADE_SUCCESS' || p.trade_status === 'TRADE_FINISHED') {
    const ok2 = await markPaid(String(p.out_trade_no ?? ''), p.trade_no ? String(p.trade_no) : null)
    if (!ok2) return text(500, 'fail')
  }
  return text(200, 'success') // 支付宝要求返回纯文本 success
}

// ---------------- 微信支付 APIv3 回调 ----------------

// 平台证书公钥缓存（serial -> CryptoKey），同实例内复用
const platformCertCache = new Map<string, CryptoKey>()

async function getWechatPlatformKey(cfg: WechatCfg, serial: string): Promise<CryptoKey | null> {
  const cached = platformCertCache.get(serial)
  if (cached) return cached
  try {
    // 拉取平台证书列表并解密（用商户私钥签名的 v3 请求）
    const timestamp = String(Math.floor(Date.now() / 1000))
    const nonce = String(Math.random().toString(36).slice(2, 34))
    const path = '/v3/certificates'
    const message = `GET\n${path}\n${timestamp}\n${nonce}\n\n`
    const signature = await rsaSignSha256(cfg.private_key, message)
    const auth = `WECHATPAY2-SHA256-RSA2048 mchid="${cfg.mchid}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${cfg.serial_no}"`
    const res = await fetch(`https://api.mch.weixin.qq.com${path}`, {
      headers: { 'Authorization': auth, 'Accept': 'application/json', 'User-Agent': 'aiapi-gateway' },
    })
    const body = await res.json()
    for (const cert of body?.data ?? []) {
      const enc = cert.encrypt_certificate
      const pem = await aesGcmDecrypt(cfg.api_v3_key, enc.nonce, enc.ciphertext, enc.associated_data || 'certificate')
      const der = keyToDer(pem)
      const key = await importRsaKey(der, false, ['verify'])
      platformCertCache.set(cert.serial_no, key)
    }
    return platformCertCache.get(serial) ?? null
  } catch (e) {
    console.error('获取微信平台证书失败:', e)
    return null
  }
}

async function handleWechat(req: Request, rawBody: string, cfg: WechatCfg): Promise<Response> {
  const wxResponse = (code: number, msg: string) =>
    new Response(JSON.stringify({ code, message: msg }), {
      status: code === 'SUCCESS' ? 200 : code,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    })

  // 1. 验证回调签名（时间戳\n随机串\n正文）
  const timestamp = req.headers.get('wechatpay-timestamp') ?? ''
  const nonce = req.headers.get('wechatpay-nonce') ?? ''
  const signature = req.headers.get('wechatpay-signature') ?? ''
  const serial = req.headers.get('wechatpay-serial') ?? ''
  if (!timestamp || !nonce || !signature || !serial) return wxResponse(401, '失败')

  const platformKey = await getWechatPlatformKey(cfg, serial)
  if (!platformKey) return wxResponse(500, '失败：无法获取平台证书')

  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', platformKey, b64decode(signature) as unknown as BufferSource,
    new TextEncoder().encode(`${timestamp}\n${nonce}\n${rawBody}\n`),
  )
  if (!ok) {
    console.warn('wechat notify: 验签失败')
    return wxResponse(401, '失败')
  }

  // 2. 解密订单数据
  const body = JSON.parse(rawBody)
  const resource = body?.resource
  if (!resource?.ciphertext) return wxResponse(400, '失败')
  const transaction = JSON.parse(
    await aesGcmDecrypt(cfg.api_v3_key, resource.nonce, resource.ciphertext, resource.associated_data || 'transaction'),
  )

  // 3. 支付成功则入账
  if (transaction.trade_state === 'SUCCESS') {
    const ok2 = await markPaid(String(transaction.out_trade_no ?? ''), transaction.transaction_id ?? null)
    if (!ok2) return wxResponse(500, '失败')
  }
  return wxResponse(200, 'SUCCESS') // 微信要求 200 + {"code":"SUCCESS"}
}

// ---------------- 易支付回调 ----------------

async function handleEpay(p: Record<string, string>, epayKey: string): Promise<Response> {
  const str = Object.keys(p)
    .filter((k) => p[k] !== '' && k !== 'sign' && k !== 'sign_type')
    .sort()
    .map((k) => `${k}=${p[k]}`)
    .join('&') + epayKey
  if (!p.sign || CryptoJS.MD5(str).toString() !== String(p.sign)) {
    console.warn('epay notify: 验签失败', p.out_trade_no)
    return text(401, 'fail')
  }
  if (p.trade_status === 'TRADE_SUCCESS') {
    const ok = await markPaid(String(p.out_trade_no ?? ''), p.trade_no ? String(p.trade_no) : null)
    if (!ok) return text(500, 'fail')
  }
  return text(200, 'success')
}

// ---------------- 主入口 ----------------

Deno.serve(async (req) => {
  try {
    const cfg = await loadPayCfg()

    // 微信 v3：JSON 正文 + Wechatpay-* 请求头
    const wxHeaders = req.headers.get('wechatpay-signature')
    if (req.method === 'POST' && wxHeaders) {
      if (!cfg.wechat?.api_v3_key) return text(500, 'fail')
      return await handleWechat(req, await req.text(), cfg.wechat)
    }

    // 支付宝 / 易支付：form 或 query 参数
    let p: Record<string, string>
    if (req.method === 'GET') {
      p = Object.fromEntries(new URL(req.url).searchParams)
    } else if (req.method === 'POST') {
      const ct = req.headers.get('content-type') ?? ''
      if (ct.includes('application/json')) {
        p = await req.json()
      } else {
        const form = await req.formData()
        p = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]))
      }
    } else {
      return text(405, 'fail')
    }

    // 通过 sign_type 区分：RSA2 = 支付宝官方，MD5 = 易支付
    if (p.sign_type === 'RSA2') {
      if (!cfg.alipay?.alipay_public_key) return text(500, 'fail')
      return await handleAlipay(p, cfg.alipay)
    }
    if (!cfg.epay?.key) return text(500, 'fail')
    return await handleEpay(p, cfg.epay.key)
  } catch (e) {
    console.error('pay-notify error:', e)
    return text(400, 'fail')
  }
})
