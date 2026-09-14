// ============================================================
// 支付异步回调（易支付协议）
// 部署：supabase functions deploy pay-notify --no-verify-jwt
// 由支付平台服务器调用（GET 或 POST form），使用 MD5 签名校验，
// 校验通过后自动给订单对应的用户加余额（幂等）
// ============================================================

import { createClient } from 'jsr:@supabase/supabase-js@2'
import CryptoJS from 'npm:crypto-js@4.2.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
}

/** 易支付 MD5 签名校验（与 pay-create 保持一致） */
function md5Sign(params: Record<string, string>, key: string): string {
  const str = Object.keys(params)
    .filter((k) => params[k] !== '' && k !== 'sign' && k !== 'sign_type')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&') + key
  return CryptoJS.MD5(str).toString()
}

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS_HEADERS } })
}

Deno.serve(async (req) => {
  try {
    // 易支付回调可能是 GET（query）或 POST（form）
    let p: Record<string, string>
    if (req.method === 'GET') {
      p = Object.fromEntries(new URL(req.url).searchParams)
    } else if (req.method === 'POST') {
      const form = await req.formData()
      p = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]))
    } else {
      return text(405, 'fail')
    }

    const { data: cfgRow } = await admin.from('settings').select('value').eq('key', 'payment').maybeSingle()
    const epayKey = String((cfgRow?.value as Record<string, unknown>)?.epay_key ?? '')
    if (!epayKey) return text(500, 'fail')

    // 签名校验
    const receivedSign = String(p.sign ?? '')
    if (!receivedSign || md5Sign(p, epayKey) !== receivedSign) {
      console.warn('pay-notify: 签名校验失败', p.out_trade_no)
      return text(401, 'fail')
    }

    // 只有支付成功才入账
    if (p.trade_status === 'TRADE_SUCCESS') {
      const { error } = await admin.rpc('mark_order_paid', {
        p_order_no: String(p.out_trade_no ?? ''),
        p_trade_no: p.trade_no ? String(p.trade_no) : null,
      })
      if (error) {
        console.error('mark_order_paid failed:', error.message)
        return text(500, 'fail')
      }
      console.log('pay-notify: 订单已入账', p.out_trade_no)
    }

    // 易支付协议要求返回纯文本 success
    return text(200, 'success')
  } catch (e) {
    console.error('pay-notify error:', e)
    return text(400, 'fail')
  }
})
