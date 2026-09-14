import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { Badge, Button, EmptyState, ErrorText, Field, Input, Modal } from '../../components/ui'
import { fmtMoney, fmtTime } from '../../lib/format'

interface UserRow {
  id: string
  email: string | null
  display_name: string | null
  role: string
  balance: number
  status: string
  created_at: string
}

export default function Users() {
  const { profile: me } = useAuth()
  const [rows, setRows] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // 调整余额弹窗
  const [adjusting, setAdjusting] = useState<UserRow | null>(null)
  const [delta, setDelta] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false })
    setRows((data ?? []) as UserRow[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function rpc(name: string, params: Record<string, unknown>) {
    const { error } = await supabase.rpc(name, params)
    if (error) {
      alert(`操作失败：${error.message}`)
      return false
    }
    await load()
    return true
  }

  async function onAdjust() {
    if (!adjusting) return
    const v = Number(delta)
    if (!Number.isFinite(v) || v === 0) {
      setError('请输入非零数字（正数充值，负数扣减）')
      return
    }
    setSaving(true)
    setError('')
    const ok = await rpc('admin_adjust_balance', { p_user_id: adjusting.id, p_delta: v })
    setSaving(false)
    if (ok) {
      setAdjusting(null)
      setDelta('')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold text-slate-800">用户管理</h1>
        <p className="mt-0.5 text-xs text-slate-400">团队成员列表，可调整余额、设置管理员、封禁账号</p>
      </div>

      {error && !adjusting && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="py-16 text-center text-sm text-slate-400">加载中…</div>
        ) : rows.length === 0 ? (
          <EmptyState text="暂无用户" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs text-slate-400">
                  <th className="px-5 py-3 font-medium">用户</th>
                  <th className="px-5 py-3 font-medium">角色</th>
                  <th className="px-5 py-3 font-medium">余额</th>
                  <th className="px-5 py-3 font-medium">状态</th>
                  <th className="px-5 py-3 font-medium">注册时间</th>
                  <th className="px-5 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-3">
                      <div className="font-medium text-slate-700">{row.display_name || '未命名'}</div>
                      <div className="text-xs text-slate-400">{row.email}</div>
                    </td>
                    <td className="px-5 py-3">
                      {row.role === 'admin' ? <Badge tone="indigo">管理员</Badge> : <Badge tone="slate">成员</Badge>}
                    </td>
                    <td className="px-5 py-3 font-semibold text-slate-700">{fmtMoney(row.balance)}</td>
                    <td className="px-5 py-3">
                      {row.status === 'active' ? <Badge tone="green">正常</Badge> : <Badge tone="red">已封禁</Badge>}
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500">{fmtTime(row.created_at)}</td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button size="sm" variant="secondary" onClick={() => { setAdjusting(row); setDelta(''); setError('') }}>
                          调余额
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={row.id === me?.id}
                          onClick={() => void rpc('admin_set_role', { p_user_id: row.id, p_role: row.role === 'admin' ? 'user' : 'admin' })}
                        >
                          {row.role === 'admin' ? '取消管理员' : '设为管理员'}
                        </Button>
                        <Button
                          size="sm"
                          variant={row.status === 'active' ? 'danger' : 'primary'}
                          disabled={row.id === me?.id}
                          onClick={() => void rpc('admin_set_status', { p_user_id: row.id, p_status: row.status === 'active' ? 'banned' : 'active' })}
                        >
                          {row.status === 'active' ? '封禁' : '解封'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={!!adjusting} onClose={() => setAdjusting(null)} title={`调整余额 — ${adjusting?.display_name || adjusting?.email}`}>
        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm">
            当前余额：<span className="font-semibold text-slate-700">{fmtMoney(adjusting?.balance ?? 0)}</span>
          </div>
          <Field label="调整金额（元）" hint="正数充值，负数扣减，如 100 或 -50">
            <Input type="number" step="0.01" placeholder="100" value={delta} onChange={(e) => setDelta(e.target.value)} />
          </Field>
          <div className="grid grid-cols-4 gap-2">
            {[10, 50, 100, 500].map((v) => (
              <Button key={v} size="sm" variant="secondary" onClick={() => setDelta(String(v))}>+{v}</Button>
            ))}
          </div>
          <ErrorText>{error}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAdjusting(null)}>取消</Button>
            <Button onClick={() => void onAdjust()} disabled={saving}>{saving ? '处理中…' : '确认调整'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
