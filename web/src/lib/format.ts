export function fmtMoney(n: number | string | null | undefined): string {
  const v = Number(n ?? 0)
  return `¥${v.toFixed(2)}`
}

export function fmtNum(n: number | string | null | undefined): string {
  return Number(n ?? 0).toLocaleString('zh-CN')
}

/** token 数量缩写：12345 -> 12.3k */
export function fmtTokens(n: number | string | null | undefined): string {
  const v = Number(n ?? 0)
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`
  return String(v)
}

export function fmtTime(t: string | null | undefined): string {
  if (!t) return '-'
  const d = new Date(t)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fmtDate(t: string | null | undefined): string {
  if (!t) return '-'
  const d = new Date(t)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function fmtLatency(ms: number | null | undefined): string {
  if (ms == null) return '-'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
