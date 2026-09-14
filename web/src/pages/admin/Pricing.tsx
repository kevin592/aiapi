import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Button, EmptyState, ErrorText, Field, Input, Modal } from '../../components/ui'
import { fmtTime } from '../../lib/format'

interface PricingRow {
  model: string
  input_price: number
  output_price: number
  description: string | null
  updated_at: string
}

export default function Pricing() {
  const [rows, setRows] = useState<PricingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editIndex, setEditIndex] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // 新增
  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState({ model: '', input_price: '0', output_price: '0', description: '' })

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('model_pricing').select('*').order('model')
    setRows((data ?? []) as PricingRow[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function updateLocal(index: number, patch: Partial<PricingRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  async function save(index: number) {
    setSaving(true)
    setError('')
    const row = rows[index]
    const { error: upErr } = await supabase
      .from('model_pricing')
      .update({
        input_price: Number(row.input_price) || 0,
        output_price: Number(row.output_price) || 0,
        description: row.description ?? '',
        updated_at: new Date().toISOString(),
      })
      .eq('model', row.model)
    setSaving(false)
    if (upErr) {
      setError(upErr.message)
      return
    }
    setEditIndex(null)
    await load()
  }

  async function remove(row: PricingRow) {
    if (!confirm(`确定删除模型「${row.model}」的定价？删除后该模型调用将按 0 元计费。`)) return
    await supabase.from('model_pricing').delete().eq('model', row.model)
    await load()
  }

  async function onAdd() {
    setError('')
    if (!addForm.model.trim()) {
      setError('模型名不能为空')
      return
    }
    setSaving(true)
    const { error: inErr } = await supabase.from('model_pricing').upsert({
      model: addForm.model.trim(),
      input_price: Number(addForm.input_price) || 0,
      output_price: Number(addForm.output_price) || 0,
      description: addForm.description,
    })
    setSaving(false)
    if (inErr) {
      setError(inErr.message)
      return
    }
    setAddOpen(false)
    setAddForm({ model: '', input_price: '0', output_price: '0', description: '' })
    await load()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-800">模型定价</h1>
          <p className="mt-0.5 text-xs text-slate-400">计费单价：元 / 百万 tokens。未配置的模型按 0 元计费</p>
        </div>
        <Button onClick={() => setAddOpen(true)}>+ 添加模型</Button>
      </div>

      <ErrorText>{error}</ErrorText>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="py-16 text-center text-sm text-slate-400">加载中…</div>
        ) : rows.length === 0 ? (
          <EmptyState text="暂无定价配置" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs text-slate-400">
                  <th className="px-5 py-3 font-medium">模型</th>
                  <th className="px-5 py-3 font-medium">输入价（元/1M）</th>
                  <th className="px-5 py-3 font-medium">输出价（元/1M）</th>
                  <th className="px-5 py-3 font-medium">备注</th>
                  <th className="px-5 py-3 font-medium">更新时间</th>
                  <th className="px-5 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.model} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-2.5 font-mono text-xs font-medium text-slate-700">{row.model}</td>
                    {editIndex === i ? (
                      <>
                        <td className="px-5 py-2.5">
                          <Input type="number" step="0.0001" className="w-28" value={row.input_price} onChange={(e) => updateLocal(i, { input_price: Number(e.target.value) })} />
                        </td>
                        <td className="px-5 py-2.5">
                          <Input type="number" step="0.0001" className="w-28" value={row.output_price} onChange={(e) => updateLocal(i, { output_price: Number(e.target.value) })} />
                        </td>
                        <td className="px-5 py-2.5">
                          <Input className="w-44" value={row.description ?? ''} onChange={(e) => updateLocal(i, { description: e.target.value })} />
                        </td>
                        <td className="px-5 py-2.5" />
                        <td className="px-5 py-2.5 text-right">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" disabled={saving} onClick={() => void save(i)}>保存</Button>
                            <Button size="sm" variant="secondary" onClick={() => setEditIndex(null)}>取消</Button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-5 py-2.5 text-xs text-slate-600">{row.input_price}</td>
                        <td className="px-5 py-2.5 text-xs text-slate-600">{row.output_price}</td>
                        <td className="px-5 py-2.5 text-xs text-slate-400">{row.description}</td>
                        <td className="px-5 py-2.5 text-xs text-slate-400">{fmtTime(row.updated_at)}</td>
                        <td className="px-5 py-2.5 text-right">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="secondary" onClick={() => setEditIndex(i)}>编辑</Button>
                            <Button size="sm" variant="danger" onClick={() => void remove(row)}>删除</Button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="添加模型定价">
        <div className="space-y-4">
          <Field label="模型名" hint="需与渠道中配置的模型名完全一致">
            <Input placeholder="gpt-4o" value={addForm.model} onChange={(e) => setAddForm({ ...addForm, model: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="输入价（元/1M tokens）">
              <Input type="number" step="0.0001" value={addForm.input_price} onChange={(e) => setAddForm({ ...addForm, input_price: e.target.value })} />
            </Field>
            <Field label="输出价（元/1M tokens）">
              <Input type="number" step="0.0001" value={addForm.output_price} onChange={(e) => setAddForm({ ...addForm, output_price: e.target.value })} />
            </Field>
          </div>
          <Field label="备注（可选）">
            <Input placeholder="官方价 $2.5/$10" value={addForm.description} onChange={(e) => setAddForm({ ...addForm, description: e.target.value })} />
          </Field>
          <ErrorText>{error}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAddOpen(false)}>取消</Button>
            <Button onClick={() => void onAdd()} disabled={saving}>{saving ? '保存中…' : '添加'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
