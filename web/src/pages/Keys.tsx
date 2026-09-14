import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Badge, Button, CopyButton, EmptyState, ErrorText, Field, Input, Modal } from '../components/ui'
import { fmtTime } from '../lib/format'

interface KeyRow {
  id: string
  name: string
  key_prefix: string
  status: string
  created_at: string
  last_used_at: string | null
}

/** 生成 sk- 开头的随机令牌 */
function generateKey(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const arr = crypto.getRandomValues(new Uint32Array(48))
  return 'sk-' + Array.from(arr, (n) => chars[n % chars.length]).join('')
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export default function Keys() {
  const [rows, setRows] = useState<KeyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [createdKey, setCreatedKey] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('api_keys').select('*').order('created_at', { ascending: false })
    setRows((data ?? []) as KeyRow[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function onCreate() {
    setError('')
    setCreating(true)
    try {
      const uid = (await supabase.auth.getSession()).data.session?.user.id
      if (!uid) throw new Error('未登录')
      const key = generateKey()
      const hash = await sha256Hex(key)
      const { error: insertErr } = await supabase.from('api_keys').insert({
        user_id: uid,
        name: name.trim() || '默认令牌',
        key_prefix: key.slice(0, 10),
        key_hash: hash,
      })
      if (insertErr) throw insertErr
      setCreateOpen(false)
      setCreatedKey(key)
      setName('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  async function toggleStatus(row: KeyRow) {
    await supabase
      .from('api_keys')
      .update({ status: row.status === 'active' ? 'disabled' : 'active' })
      .eq('id', row.id)
    await load()
  }

  async function remove(row: KeyRow) {
    if (!confirm(`确定删除令牌「${row.name}」吗？删除后使用该令牌的客户端将立即失效。`)) return
    await supabase.from('api_keys').delete().eq('id', row.id)
    await load()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-800">API 令牌</h1>
          <p className="mt-0.5 text-xs text-slate-400">令牌只在创建时展示一次，服务端只保存哈希，请妥善保管</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>+ 创建令牌</Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="py-16 text-center text-sm text-slate-400">加载中…</div>
        ) : rows.length === 0 ? (
          <EmptyState text="还没有令牌，点击右上角创建" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs text-slate-400">
                  <th className="px-5 py-3 font-medium">名称</th>
                  <th className="px-5 py-3 font-medium">令牌</th>
                  <th className="px-5 py-3 font-medium">状态</th>
                  <th className="px-5 py-3 font-medium">创建时间</th>
                  <th className="px-5 py-3 font-medium">最近使用</th>
                  <th className="px-5 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-3 font-medium text-slate-700">{row.name}</td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-500">{row.key_prefix}…</td>
                    <td className="px-5 py-3">
                      {row.status === 'active' ? <Badge tone="green">启用</Badge> : <Badge tone="slate">已禁用</Badge>}
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500">{fmtTime(row.created_at)}</td>
                    <td className="px-5 py-3 text-xs text-slate-500">{fmtTime(row.last_used_at)}</td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="secondary" onClick={() => void toggleStatus(row)}>
                          {row.status === 'active' ? '禁用' : '启用'}
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => void remove(row)}>
                          删除
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

      {/* 创建弹窗 */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="创建 API 令牌">
        <div className="space-y-4">
          <Field label="令牌名称" hint="便于区分用途，如「生产环境」「张三的笔记本」">
            <Input placeholder="默认令牌" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <ErrorText>{error}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button onClick={() => void onCreate()} disabled={creating}>{creating ? '创建中…' : '创建'}</Button>
          </div>
        </div>
      </Modal>

      {/* 创建成功，展示一次完整令牌 */}
      <Modal open={!!createdKey} onClose={() => setCreatedKey('')} title="令牌创建成功">
        <div className="space-y-4">
          <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
            完整令牌只显示这一次，请立即复制保存：
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-slate-900 px-3 py-2.5 font-mono text-xs text-emerald-300">
              {createdKey}
            </code>
            <CopyButton text={createdKey} />
          </div>
          <div className="flex justify-end">
            <Button onClick={() => setCreatedKey('')}>我已保存</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
