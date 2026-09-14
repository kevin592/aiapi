import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Badge, Button, ErrorText, Input } from '../components/ui'
import { fmtMoney, fmtTime } from '../lib/format'

interface OrderRow {
  id: string
  order_no: string
  amount: number
  credits: number
  pay_type: string | null
  status: string
  trade_no: string | null
  created_at: string
  paid_at: string | null
}

const PRESETS = [10, 50, 100, 500]

export default function Recharge() {
  const { refreshProfile } = useAuth()
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [amount, setAmount] = useState<number>(50)
  const [customAmount, setCustomAmount] = useState('')
  const [payType, setPayType] = useState<'alipay' | 'wxpay'>('alipay')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadOrders = useCallback(async () => {
    const { data } = await supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(30)
    setOrders((data ?? []) as OrderRow[])
    return (data ?? []) as OrderRow[]
  }, [])

  useEffect(() => {
    void loadOrders()
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [loadOrders])

  // 轮询最新一笔 pending 订单，支付成功后刷新余额
  function startPolling(orderNo: string) {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      const { data } = await supabase.from('orders').select('status').eq('order_no', orderNo).maybeSingle()
      if (data?.status === 'paid') {
        if (pollRef.current) clearInterval(pollRef.current)
        setNotice('充值成功，余额已到账 ✓')
        await refreshProfile()
        await loadOrders()
      }
    }, 3000)
    // 10 分钟后停止轮询
    setTimeout(() => {
      if (pollRef.current) clearInterval(pollRef.current)
    }, 600_000)
  }

  async function onPay() {
    setError('')
    setNotice('')
    const finalAmount = customAmount ? Number(customAmount) : amount
    if (!Number.isFinite(finalAmount) || finalAmount <= 0) {
      setError('请输入正确的金额')
      return
    }
    setCreating(true)
    try {
      const session = (await supabase.auth.getSession()).data.session
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pay-create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ amount: finalAmount, pay_type: payType }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? `创建订单失败（${res.status}）`)
        return
      }
      await loadOrders()
      startPolling(body.order_no)
      // 新窗口打开支付页（扫码/跳转），当前页面轮询订单状态
      window.open(body.pay_url, '_blank')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  const statusBadge = (s: string) => {
    if (s === 'paid') return <Badge tone="green">已支付</Badge>
    if (s === 'pending') return <Badge tone="amber">待支付</Badge>
    return <Badge tone="slate">{s === 'expired' ? '已过期' : s}</Badge>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold text-slate-800">充值</h1>
        <p className="mt-0.5 text-xs text-slate-400">支持微信 / 支付宝扫码支付，支付成功后余额自动到账</p>
      </div>

      {notice && <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-sm font-semibold text-slate-700">充值金额</div>
        <div className="mt-3 grid grid-cols-4 gap-3">
          {PRESETS.map((v) => (
            <button
              key={v}
              onClick={() => {
                setAmount(v)
                setCustomAmount('')
              }}
              className={`rounded-xl border-2 py-3 text-center transition-colors ${
                !customAmount && amount === v
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-600'
                  : 'border-slate-200 text-slate-600 hover:border-indigo-200'
              }`}
            >
              <div className="text-lg font-bold">¥{v}</div>
            </button>
          ))}
        </div>
        <div className="mt-3">
          <Input
            type="number"
            min={1}
            placeholder="自定义金额（元）"
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
          />
        </div>

        <div className="mt-6 text-sm font-semibold text-slate-700">支付方式</div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <button
            onClick={() => setPayType('alipay')}
            className={`flex items-center justify-center gap-2 rounded-xl border-2 py-3 text-sm font-medium transition-colors ${
              payType === 'alipay' ? 'border-blue-500 bg-blue-50 text-blue-600' : 'border-slate-200 text-slate-600 hover:border-blue-200'
            }`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect width="24" height="24" rx="12" fill="#1677ff" /><path d="M9.2 12.7c-.9-.3-1.6-.6-2.1-1 .5-1.1.8-2.4.9-3.7h2v-1H8c0-.6 0-1.2-.1-1.7H6.8c.1.5.1 1.1.1 1.7H4.5v1h2.5c-.2 2.2-.9 4.2-2.2 5.5.3.3.7.7.9 1 .8-.9 1.4-2 1.8-3.3.5.4 1.2.8 2 1.1-.1.2-.2.3-.3.5 1.1 1.2 2.8 1.9 5 2l.3-1c-1.8 0-3.2-.5-4.3-1.1zm4.4-1.3h-1.6l2.2-6.1h1.8l2.2 6.1h-1.6l-.5-1.4h-2l-.5 1.4zm1.5-4.5-.7 2.2h1.4l-.7-2.2z" fill="#fff" /></svg>
            支付宝
          </button>
          <button
            onClick={() => setPayType('wxpay')}
            className={`flex items-center justify-center gap-2 rounded-xl border-2 py-3 text-sm font-medium transition-colors ${
              payType === 'wxpay' ? 'border-emerald-500 bg-emerald-50 text-emerald-600' : 'border-slate-200 text-slate-600 hover:border-emerald-200'
            }`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#07c160" /><path d="M9.5 8.5c-2 0-3.5 1.3-3.5 3 0 1 .5 1.8 1.4 2.3l-.4 1.3 1.5-.8c.3.1.7.1 1 .1h.3c-.1-.3-.2-.6-.2-1 0-1.7 1.6-3 3.5-3h.2c-.3-1.1-1.8-1.9-3.8-1.9zm-1.2 1.5c.3 0 .5.2.5.5s-.2.5-.5.5-.5-.2-.5-.5.2-.5.5-.5zm2.9 1c-.3 0-.5-.2-.5-.5s.2-.5.5-.5.5.2.5.5-.2.5-.5.5zm4.3 1.5c0-1.5-1.5-2.7-3.2-2.7s-3.2 1.2-3.2 2.7 1.5 2.7 3.2 2.7c.3 0 .7 0 1-.1l1.3.7-.3-1.1c.7-.5 1.2-1.3 1.2-2.2zm-4.2-.5c-.2 0-.4-.2-.4-.4s.2-.4.4-.4.4.2.4.4-.2.4-.4.4zm2 0c-.2 0-.4-.2-.4-.4s.2-.4.4-.4.4.2.4.4-.2.4-.4.4z" fill="#fff" /></svg>
            微信支付
          </button>
        </div>

        <ErrorText>{error}</ErrorText>

        <Button className="mt-6 w-full" disabled={creating} onClick={() => void onPay()}>
          {creating ? '创建订单中…' : `立即充值 ¥${customAmount || amount}`}
        </Button>
        <p className="mt-2 text-center text-xs text-slate-400">
          支付遇到问题？可联系管理员在「用户管理」中手动调整余额
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-3.5 text-sm font-semibold text-slate-700">充值记录</div>
        {orders.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">暂无充值记录</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs text-slate-400">
                  <th className="px-5 py-3 font-medium">订单号</th>
                  <th className="px-5 py-3 font-medium">金额</th>
                  <th className="px-5 py-3 font-medium">到账额度</th>
                  <th className="px-5 py-3 font-medium">方式</th>
                  <th className="px-5 py-3 font-medium">状态</th>
                  <th className="px-5 py-3 font-medium">时间</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{o.order_no}</td>
                    <td className="px-5 py-2.5 text-xs text-slate-700">{fmtMoney(o.amount)}</td>
                    <td className="px-5 py-2.5 text-xs font-medium text-emerald-600">{fmtMoney(o.credits)}</td>
                    <td className="px-5 py-2.5 text-xs text-slate-500">
                      {o.pay_type === 'wxpay' ? '微信' : o.pay_type === 'alipay' ? '支付宝' : '-'}
                    </td>
                    <td className="px-5 py-2.5">{statusBadge(o.status)}</td>
                    <td className="px-5 py-2.5 text-xs text-slate-500">{fmtTime(o.paid_at ?? o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
