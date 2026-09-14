import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Badge, Card, CopyButton, Stat } from '../components/ui'
import { MiniChart } from '../components/MiniChart'
import { fmtLatency, fmtMoney, fmtTime, fmtTokens } from '../lib/format'

interface LogRow {
  model: string
  prompt_tokens: number
  completion_tokens: number
  cost: number
  latency_ms: number | null
  status: number | null
  created_at: string
}

export default function Overview() {
  const { profile } = useAuth()
  const [logs, setLogs] = useState<LogRow[]>([])
  const [apiBase, setApiBase] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const since = new Date(Date.now() - 14 * 86400_000).toISOString()
      const [{ data: logData }, { data: site }] = await Promise.all([
        supabase
          .from('usage_logs')
          .select('model, prompt_tokens, completion_tokens, cost, latency_ms, status, created_at')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(3000),
        supabase.from('settings').select('value').eq('key', 'site').maybeSingle(),
      ])
      setLogs((logData ?? []) as LogRow[])
      const siteValue = (site?.value ?? {}) as Record<string, string>
      setApiBase(siteValue.api_base ?? '')
      setLoading(false)
    }
    void load()
  }, [])

  // 统计
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const todayLogs = logs.filter((l) => new Date(l.created_at).getTime() >= todayStart)
  const monthLogs = logs.filter((l) => new Date(l.created_at).getTime() >= monthStart)

  const todayTokens = todayLogs.reduce((s, l) => s + l.prompt_tokens + l.completion_tokens, 0)
  const monthCost = monthLogs.reduce((s, l) => s + Number(l.cost), 0)
  const totalRequests = logs.length

  // 近 14 天图表
  const chart: { label: string; value: number }[] = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000)
    const key = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const dayEnd = dayStart + 86400_000
    const value = logs
      .filter((l) => {
        const t = new Date(l.created_at).getTime()
        return t >= dayStart && t < dayEnd
      })
      .reduce((s, l) => s + l.prompt_tokens + l.completion_tokens, 0)
    chart.push({ label: key, value })
  }

  const recent = logs.slice(0, 8)
  const base = apiBase || '（管理员尚未在「系统设置」中配置 API 地址）'

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="账户余额" value={fmtMoney(profile?.balance ?? 0)} sub={<Link to="/recharge" className="text-indigo-500 hover:underline">去充值 →</Link>} />
        <Stat label="今日请求" value={fmtTokens(todayLogs.length)} sub="近 14 天数据" />
        <Stat label="今日 Tokens" value={fmtTokens(todayTokens)} />
        <Stat label="本月消费" value={fmtMoney(monthCost)} sub={`近 14 天共 ${totalRequests} 次调用`} />
      </div>

      <Card title="API 接入信息" actions={
        <Link to="/keys" className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500">
          前往创建令牌
        </Link>
      }>
        <div className="space-y-3 text-sm">
          <div>
            <div className="mb-1 text-xs font-medium text-slate-400">Base URL（OpenAI 兼容客户端使用）</div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">{base}</code>
              {apiBase && <CopyButton text={apiBase} />}
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-slate-400">快速测试（替换 sk-xxx 为你的令牌）</div>
            <pre className="overflow-x-auto rounded-lg bg-slate-900 px-4 py-3 text-xs leading-relaxed text-slate-200">
{`curl ${apiBase || '<API_BASE>'}/chat/completions \\
  -H "Authorization: Bearer sk-xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "你好"}]
  }'`}
            </pre>
          </div>
        </div>
      </Card>

      <Card title="近 14 天 Token 用量">
        {loading ? (
          <div className="py-10 text-center text-sm text-slate-400">加载中…</div>
        ) : (
          <MiniChart data={chart} />
        )}
      </Card>

      <Card title="最近调用">
        {recent.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-400">
            还没有调用记录。创建
            <Link to="/keys" className="mx-1 text-indigo-500 hover:underline">API 令牌</Link>
            后即可开始使用。
          </div>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                  <th className="px-5 py-2 font-medium">时间</th>
                  <th className="px-5 py-2 font-medium">模型</th>
                  <th className="px-5 py-2 text-right font-medium">输入</th>
                  <th className="px-5 py-2 text-right font-medium">输出</th>
                  <th className="px-5 py-2 text-right font-medium">费用</th>
                  <th className="px-5 py-2 text-right font-medium">耗时</th>
                  <th className="px-5 py-2 text-right font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((l, i) => (
                  <tr key={i} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-2.5 text-xs text-slate-500">{fmtTime(l.created_at)}</td>
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-700">{l.model}</td>
                    <td className="px-5 py-2.5 text-right text-xs text-slate-500">{fmtTokens(l.prompt_tokens)}</td>
                    <td className="px-5 py-2.5 text-right text-xs text-slate-500">{fmtTokens(l.completion_tokens)}</td>
                    <td className="px-5 py-2.5 text-right text-xs text-slate-700">{fmtMoney(l.cost)}</td>
                    <td className="px-5 py-2.5 text-right text-xs text-slate-500">{fmtLatency(l.latency_ms)}</td>
                    <td className="px-5 py-2.5 text-right">
                      {l.status && l.status < 300 ? <Badge tone="green">成功</Badge> : <Badge tone="red">{l.status ?? '错误'}</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
