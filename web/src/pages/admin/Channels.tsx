import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Badge, Button, EmptyState, ErrorText, Field, Input, Modal, Select } from '../../components/ui'
import { fmtTime } from '../../lib/format'

interface ChannelRow {
  id: string
  name: string
  type: string
  base_url: string
  api_key: string
  models: string[]
  priority: number
  weight: number
  status: string
  remark: string | null
  created_at: string
}

const emptyForm = {
  name: '',
  type: 'openai',
  base_url: '',
  api_key: '',
  models: '',
  priority: 0,
  weight: 1,
  status: 'enabled',
  remark: '',
}

const BASE_URL_HINTS: Record<string, string> = {
  openai: '官方 https://api.openai.com ｜ DeepSeek https://api.deepseek.com ｜ 硅基流动 https://api.siliconflow.cn/v1 ｜ Anthropic(OpenAI兼容) https://api.anthropic.com/openai',
  anthropic: '官方 https://api.anthropic.com（Claude 原生 /v1/messages 协议）',
}

export default function Channels() {
  const [rows, setRows] = useState<ChannelRow[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ChannelRow | null>(null)
  const [form, setForm] = useState({ ...emptyForm })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('channels').select('*').order('created_at', { ascending: false })
    setRows((data ?? []) as ChannelRow[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function openCreate() {
    setEditing(null)
    setForm({ ...emptyForm })
    setError('')
    setOpen(true)
  }

  function openEdit(row: ChannelRow) {
    setEditing(row)
    setForm({
      name: row.name,
      type: row.type,
      base_url: row.base_url,
      api_key: row.api_key,
      models: (row.models ?? []).join(', '),
      priority: row.priority,
      weight: row.weight,
      status: row.status,
      remark: row.remark ?? '',
    })
    setError('')
    setOpen(true)
  }

  async function onSave() {
    setError('')
    if (!form.name.trim() || !form.base_url.trim() || !form.api_key.trim()) {
      setError('名称、Base URL、API Key 均不能为空')
      return
    }
    const models = form.models.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean)
    if (models.length === 0) {
      setError('至少填写一个模型')
      return
    }
    setSaving(true)
    const payload = {
      name: form.name.trim(),
      type: form.type,
      base_url: form.base_url.trim(),
      api_key: form.api_key.trim(),
      models,
      priority: Number(form.priority) || 0,
      weight: Number(form.weight) || 1,
      status: form.status,
      remark: form.remark,
      updated_at: new Date().toISOString(),
    }
    const { error: upErr } = editing
      ? await supabase.from('channels').update(payload).eq('id', editing.id)
      : await supabase.from('channels').insert(payload)
    setSaving(false)
    if (upErr) {
      setError(upErr.message)
      return
    }
    setOpen(false)
    await load()
  }

  async function toggle(row: ChannelRow) {
    await supabase.from('channels').update({ status: row.status === 'enabled' ? 'disabled' : 'enabled' }).eq('id', row.id)
    await load()
  }

  async function remove(row: ChannelRow) {
    if (!confirm(`确定删除渠道「${row.name}」？`)) return
    await supabase.from('channels').delete().eq('id', row.id)
    await load()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-800">渠道管理</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            上游 API 渠道。同优先级按权重分流，高优先级渠道故障时自动切换低优先级
          </p>
        </div>
        <Button onClick={openCreate}>+ 添加渠道</Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="py-16 text-center text-sm text-slate-400">加载中…</div>
        ) : rows.length === 0 ? (
          <EmptyState text="还没有渠道，点击右上角添加（如 DeepSeek、OpenAI、硅基流动等）" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs text-slate-400">
                  <th className="px-5 py-3 font-medium">名称</th>
                  <th className="px-5 py-3 font-medium">类型</th>
                  <th className="px-5 py-3 font-medium">Base URL</th>
                  <th className="px-5 py-3 font-medium">模型</th>
                  <th className="px-5 py-3 text-center font-medium">优先级/权重</th>
                  <th className="px-5 py-3 font-medium">状态</th>
                  <th className="px-5 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-3 font-medium text-slate-700">{row.name}</td>
                    <td className="px-5 py-3"><Badge tone={row.type === 'anthropic' ? 'indigo' : 'slate'}>{row.type}</Badge></td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-500">{row.base_url}</td>
                    <td className="max-w-56 px-5 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(row.models ?? []).slice(0, 3).map((m) => (
                          <span key={m} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">{m}</span>
                        ))}
                        {(row.models ?? []).length > 3 && (
                          <span className="text-[10px] text-slate-400">+{row.models.length - 3}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-center text-xs text-slate-500">{row.priority} / {row.weight}</td>
                    <td className="px-5 py-3">
                      {row.status === 'enabled' ? <Badge tone="green">启用</Badge> : <Badge tone="slate">停用</Badge>}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="secondary" onClick={() => void toggle(row)}>
                          {row.status === 'enabled' ? '停用' : '启用'}
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => openEdit(row)}>编辑</Button>
                        <Button size="sm" variant="danger" onClick={() => void remove(row)}>删除</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? '编辑渠道' : '添加渠道'} width="max-w-lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="渠道名称">
              <Input placeholder="如 DeepSeek 官方" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="协议类型">
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="openai">openai（OpenAI 兼容）</option>
                <option value="anthropic">anthropic（Claude 原生）</option>
              </Select>
            </Field>
          </div>
          <Field label="Base URL" hint={BASE_URL_HINTS[form.type]}>
            <Input placeholder="https://api.deepseek.com" value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} />
          </Field>
          <Field label="上游 API Key">
            <Input type="password" placeholder="sk-..." value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} />
          </Field>
          <Field label="支持的模型" hint="逗号或换行分隔，如 deepseek-chat, deepseek-reasoner">
            <textarea
              className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              rows={3}
              placeholder={'gpt-4o\ngpt-4o-mini'}
              value={form.models}
              onChange={(e) => setForm({ ...form, models: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="优先级" hint="大者优先">
              <Input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} />
            </Field>
            <Field label="权重" hint="同优先级分流">
              <Input type="number" min={1} value={form.weight} onChange={(e) => setForm({ ...form, weight: Number(e.target.value) })} />
            </Field>
            <Field label="状态">
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="enabled">启用</option>
                <option value="disabled">停用</option>
              </Select>
            </Field>
          </div>
          <Field label="备注（可选）">
            <Input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} />
          </Field>
          <ErrorText>{error}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={() => void onSave()} disabled={saving}>{saving ? '保存中…' : '保存'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
