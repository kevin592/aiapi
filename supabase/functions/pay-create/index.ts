// ============================================================
// 创建支付订单（易支付协议，支持微信 wxpay / 支付宝 alipay）
// 部署：supabase functions deploy pay-create
// 需登录后携带平台 JWT 调用
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

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  })
}

/** 易支付 MD5 签名：参数名 ASCII 升序排列，跳过 sign/sign_type/空值，k=v& 连接后拼上商户密钥 */
function md5Sign(params: Record<string, string>, key: string): string {
  const str = Object.keys(params)
    .filter((k) => params[k] !== '' && k !== 'sign' && k !== 'sign_type')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&') + key
  return CryptoJS.MD5(str).toString()
}

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

    // 读取支付配置
    const { data: cfgRow } = await admin.from('settings').select('value').eq('key', 'payment').maybeSingle()
    const cfg = (cfgRow?.value ?? {}) as Record<string, unknown>
    const epayUrl = String(cfg.epay_url ?? '')
    const epayPid = String(cfg.epay_pid ?? '')
    const epayKey = String(cfg.epay_key ?? '')
    const minAmount = Number(cfg.recharge_min ?? 10)
    const rate = Number(cfg.credits_rate ?? 1)

    if (!epayUrl || !epayPid || !epayKey) {
      return json(400, { error: '支付尚未配置，请联系管理员在「管理后台 -> 设置」中填写易支付信息，或由管理员手动加余额。' })
    }

    // 校验参数
    const body = await req.json().catch(() => ({}))
    const amount = Number(body?.amount)
    const payType = String(body?.pay_type ?? '')
    if (!Number.isFinite(amount) || amount < minAmount) {
      return json(400, { error: `充值金额不能低于 ${minAmount} 元` })
    }
    if (!['alipay', 'wxpay'].includes(payType)) {
      return json(400, { error: 'pay_type 必须为 alipay 或 wxpay' })
    }

    // 创建订单
    const orderNo = `PAY${Date.now()}${Math.floor(Math.random() * 9000 + 1000)}`
    const credits = +(amount * rate).toFixed(4)
    const { error: insertErr } = await admin.from('orders').insert({
      order_no: orderNo,
      user_id: user.id,
      amount: +amount.toFixed(2),
      credits,
      provider: 'epay',
      pay_type: payType,
      status: 'pending',
    })
    if (insertErr) return json(500, { error: `创建订单失败：${insertErr.message}` })

    // 拼装易支付跳转 URL
    const { data: siteRow } = await admin.from('settings').select('value').eq('key', 'site').maybeSingle()
    const site = (siteRow?.value ?? {}) as Record<string, unknown>
    const siteUrl = String(site.site_url ?? '') || (req.headers.get('origin') ?? '')
    const notifyUrl = `${SUPABASE_URL}/functions/v1/pay-notify`
    const returnUrl = `${siteUrl}/#/recharge`

    const params: Record<string, string> = {
      pid: epayPid,
      type: payType,
      out_trade_no: orderNo,
      notify_url: notifyUrl,
      return_url: returnUrl,
      name: `AI-API充值${orderNo.slice(-6)}`,
      money: amount.toFixed(2),
    }
    const sign = md5Sign(params, epayKey)
    const qs = new URLSearchParams({ ...params, sign, sign_type: 'MD5' }).toString()
    const payUrl = `${epayUrl}${epayUrl.includes('?') ? '&' : '?'}${qs}`

    return json(200, { pay_url: payUrl, order_no: orderNo, credits, amount: +amount.toFixed(2) })
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) })
  }
})
