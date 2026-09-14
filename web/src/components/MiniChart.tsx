import { fmtTokens } from '../lib/format'

/** 轻量柱状图（无第三方依赖），用于近 14 天 token 用量 */
export function MiniChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div className="flex h-36 items-end gap-1.5">
      {data.map((d) => (
        <div key={d.label} className="group flex h-full flex-1 flex-col items-center justify-end gap-1.5">
          <div className="text-[10px] font-medium text-slate-500 opacity-0 transition-opacity group-hover:opacity-100">
            {d.value > 0 ? fmtTokens(d.value) : ''}
          </div>
          <div
            title={`${d.label}：${fmtTokens(d.value)} tokens`}
            className="w-full rounded-t bg-indigo-500/75 transition-colors group-hover:bg-indigo-500"
            style={{ height: `${Math.max(d.value > 0 ? 4 : 1, (d.value / max) * 100)}%`, minHeight: '2px' }}
          />
          <span className="text-[10px] whitespace-nowrap text-slate-400">{d.label}</span>
        </div>
      ))}
    </div>
  )
}
