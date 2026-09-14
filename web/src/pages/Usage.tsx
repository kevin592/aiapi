import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Badge, Button, EmptyState, Input, Select } from '../components/ui'
import { fmtLatency, fmtMoney, fmtTime, fmtTokens } from '../lib/format'

interface LogRow {
  id: number
  model: string
  key_id: string | null
  prompt_tokens: number
  completion_tokens: number
  cost: number
  latency_ms: number | null
  status: number | null
  created_at: string
}

const PAGE_SIZE = 20

export default function Usage() {
  const [rows, setRows] = useState<LogRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [keyOptions, setKeyOptions] = useState<{ id: string; name: string }[]>([])
  // 筛选
  const [keyId, setKeyId] = useState('')
  const [model, setModel] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    supabase.from('api_keys').select('id, name').then(({ data }) => {
      setKeyOptions((data ?? []) as { id: string; name: string }[])
    })
  }, [])

  const buildQuery = useCallback(() => {
    let q = supabase.from('usage_logs').select('*', { count: 'exact' }).order('created_at', { ascending: false })
    if (keyId) q = q.eq('key_id', keyId)
    if (model.trim()) q = q.ilike('model', `%${model.trim()}%`)
    if (dateFrom) q = q.gte('created_at', `${dateFrom}T00:00:00`)
    if (dateTo) q = q.lte('created_at', `${dateTo}T23:59:59`)
    return q
  }, [keyId, model, dateFrom, dateTo])

  const load = useCallback(async () => {
    setLoading(true)
    const { data, count } = await buildQuery().range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    setRows((data ?? []) as LogRow[])
    setTotal(count ?? 0)
    setLoading(false)
  }, [buildQuery, page])

  useEffect(() => {
    void load()
  }, [load])

  function search() {
    setPage(0)
    void load()
  }

  const keyNameMap = new Map(keyOptions.map((k) => [k.id, k.name]))
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageCost = rows.reduce((s, r) => s + Number(r.cost), 0)
  const pageTokens = rows.reduce((s, r) => s + r.prompt_tokens + r.completion_tokens, 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold text-slate-800">用量明细</h1>
        <p className="mt-0.5 text-xs text-slate-400">
          共 {total} 条记录 · 本页合计 {fmtTokens(pageTokens)} tokens / {fmtMoney(pageCost)}
        </p>
      </div>

      {/* 筛选 */}
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-5">
        <Select value={keyId} onChange={(e) => setKeyId(e.target.value)}>
          <option value="">全部令牌</option>
          {keyOptions.map((k) => (
            <option key={k.id} value={k.id}>{k.name}</option>
          ))}
        </Select>
        <Input placeholder="模型名称" value={model} onChange={(e) => setModel(e.target.value)} />
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        <div className="flex gap-2">
          <Button className="flex-1" onClick={search}>查询</Button>
          <Button
            variant="secondary"
            onClick={() => {
              setKeyId('')
              setModel('')
              setDateFrom('')
              setDateTo('')
              setPage(0)
            }}
          >
            重置
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="py-16 text-center text-sm text-slate-400">加载中…</div>
        ) : rows.length === 0 ? (
          <EmptyState text="没有符合条件的记录" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs text-slate-400">
                  <th className="px-5 py-3 font-medium">时间</th>
                  <th className="px-5 py-3 font-medium">模型</th>
                  <th className="px-5 py-3 font-medium">令牌</th>
                  <th className="px-5 py-3 text-right font-medium">输入</th>
                  <th className="px-5 py-3 text-right font-medium">输出</th>
                  <th className="px-5 py-3 text-right font-medium">费用</th>
                  <th className="px-5 py-3 text-right font-medium">耗时</th>
                  <th className="px-5 py-3 text-right font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-2.5 text-xs whitespace-nowrap text-slate-500">{fmtTime(r.created_at)}</td>
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-700">{r.model}</td>
                    <td className="px-5 py-2.5 text-xs text-slate-500">{r.key_id ? keyNameMap.get(r.key_id) ?? '-' : '-'}</td>
                    <td className="px-5 py-2.5 text-right text-xs text-slate-500">{fmtTokens(r.prompt_tokens)}</td>
                    <td className="px-5 py-2.5 text-right text-xs text-slate-500">{fmtTokens(r.completion_tokens)}</td>
                    <td className="px-5 py-2.5 text-right text-xs whitespace-nowrap text-slate-700">{fmtMoney(r.cost)}</td>
                    <td className="px-5 py-2.5 text-right text-xs text-slate-500">{fmtLatency(r.latency_ms)}</td>
                    <td className="px-5 py-2.5 text-right">
                      {r.status && r.status < 300 ? <Badge tone="green">成功</Badge> : <Badge tone="red">{r.status ?? '错误'}</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {/* 分页 */}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
            <span>
              第 {page + 1} / {totalPages} 页
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                上一页
              </Button>
              <Button size="sm" variant="secondary" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
                下一页
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
