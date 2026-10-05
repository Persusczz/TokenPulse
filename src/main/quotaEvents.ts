export interface WindowReading {
  pct: number
  /** epoch ms */
  resetsAt: number | null
}
export interface QuotaSnapshot {
  five: WindowReading | null
  week: WindowReading | null
}
export interface QuotaEvent {
  kind: 'cross' | 'reset'
  window: 'five' | 'week'
  pct: number
  /** the threshold crossed */
  mark?: number
  resetsAt: number | null
  /** stable per window and threshold, for de-duplication across restarts */
  key: string
}

export const QUOTA_PUSH_MARKS = { five: [75, 90, 100], week: [75, 90] }

/**
 * Threshold crossings and resets between two readings. The first reading is a
 * baseline (no events); a reset counts only when the window was at least half
 * used, so quiet windows rolling over stay silent.
 */
export function quotaEvents(prev: QuotaSnapshot | null, cur: QuotaSnapshot, marks = QUOTA_PUSH_MARKS): QuotaEvent[] {
  if (!prev) return []
  const out: QuotaEvent[] = []
  for (const w of ['five', 'week'] as const) {
    const a = prev[w]
    const b = cur[w]
    if (!a || !b) continue
    const sameWindow = a.resetsAt === b.resetsAt || a.resetsAt === null || b.resetsAt === null
    if (!sameWindow && a.pct >= 50 && b.pct < a.pct) {
      out.push({ kind: 'reset', window: w, pct: b.pct, resetsAt: b.resetsAt, key: `${w}:reset:${a.resetsAt}` })
    }
    const from = sameWindow ? a.pct : 0
    const crossed = marks[w].filter((m) => from < m && b.pct >= m)
    const top = crossed[crossed.length - 1]
    if (top !== undefined) out.push({ kind: 'cross', window: w, pct: b.pct, mark: top, resetsAt: b.resetsAt, key: `${w}:${b.resetsAt}:${top}` })
  }
  return out
}
