import type { TaskCompactAt } from './types'

/** a share of the model's window, and a token count, that make sense as a compaction point */
export const COMPACT_PCT = { min: 10, max: 95 }
export const COMPACT_TOKENS = { min: 20_000, max: 2_000_000 }

/** A compaction point from untrusted input, or null (the CLI's own point) */
export function cleanCompactAt(v: unknown): TaskCompactAt | null {
  if (!v || typeof v !== 'object') return null
  const { unit, value } = v as { unit?: unknown; value?: unknown }
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (unit === 'pct') return { unit, value: Math.round(Math.min(COMPACT_PCT.max, Math.max(COMPACT_PCT.min, value))) }
  if (unit === 'tokens') return { unit, value: Math.round(Math.min(COMPACT_TOKENS.max, Math.max(COMPACT_TOKENS.min, value)) / 1000) * 1000 }
  return null
}

/** "60%", "300K", or the CLI's default */
export function compactText(c: TaskCompactAt | null | undefined): string {
  if (!c) return '快满时'
  if (c.unit === 'pct') return `${c.value}%`
  return c.value >= 1e6 ? `${+(c.value / 1e6).toFixed(2)}M` : `${Math.round(c.value / 1000)}K`
}
