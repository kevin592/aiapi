import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Badge, EmptyState } from '../../components/ui'
import { fmtMoney, fmtTime } from '../../lib/format'

interface OrderRow {
  id: string
  order_no: string
  user_id: string
  amount: number
  credits: number
  provider: string
  pay_type: string | null
  status: string
  trade_no: string | null
  created_at: string
  paid_at: string | null
}

export default function Orders() {
  const [rows, setRows] = useState<OrderRow[]>([])
  const [profiles, setProfiles] = useState<Map<string, { email: string | null; display_name: string | null }>>(new Map())
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: orderData }, { data: profileData }] = await Promise.all([
      supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('profiles').select('id, email, display_name'),
    ])
    setRows((orderData ?? []) as OrderRow[])
    setProfiles(new Map((profileData ?? []).map((p: { id: string; email: string | null; display_name: string | null }) => [p.id, p])))
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const statusBadge = (s: string) => {
    if (s === 'paid') return <Badge tone="green">已支付</Badge>
    if (s === 'pending') return <Badge tone="amber">待支付</Badge>
    return <Badge tone="slate">{s === 'expired' ? '已过期' : s}</Badge>
  }

  const totalPaid = rows.filter((r) => r.status === 'paid').reduce((s, r) => s + Number(r.amount), 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold text-slate-800">订单管理</h1>
        <p className="mt-0.5 text-xs text-slate-400">最近 200 笔订单 · 已支付合计 {fmtMoney(totalPaid)}</p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="py-16 text-center text-sm text-slate-400">加载中…</div>
        ) : rows.length === 0 ? (
          <EmptyState text="暂无订单" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs text-slate-400">
                  <th className="px-5 py-3 font-medium">订单号</th>
                  <th className="px-5 py-3 font-medium">用户</th>
                  <th className="px-5 py-3 font-medium">金额</th>
                  <th className="px-5 py-3 font-medium">到账额度</th>
                  <th className="px-5 py-3 font-medium">方式</th>
                  <th className="px-5 py-3 font-medium">状态</th>
                  <th className="px-5 py-3 font-medium">支付时间</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const u = profiles.get(o.user_id)
                  return (
                    <tr key={o.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{o.order_no}</td>
                      <td className="px-5 py-2.5 text-xs text-slate-600">{u?.display_name || u?.email || o.user_id.slice(0, 8)}</td>
                      <td className="px-5 py-2.5 text-xs text-slate-700">{fmtMoney(o.amount)}</td>
                      <td className="px-5 py-2.5 text-xs text-emerald-600">{fmtMoney(o.credits)}</td>
                      <td className="px-5 py-2.5 text-xs text-slate-500">
                        {o.pay_type === 'wxpay' ? '微信' : o.pay_type === 'alipay' ? '支付宝' : o.provider}
                      </td>
                      <td className="px-5 py-2.5">{statusBadge(o.status)}</td>
                      <td className="px-5 py-2.5 text-xs text-slate-500">{fmtTime(o.paid_at ?? o.created_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
