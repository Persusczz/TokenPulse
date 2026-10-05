import type { PriceRow } from '@shared/types'

/** "Claude Opus 5.5" -> "claude-opus-5-5" */
export function nameToId(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .trim()
    .replace(/[\s.]+/g, '-')
}

/**
 * Canonical id for a model string from logs or a price list:
 * strips provider prefixes, date/version suffixes and context tags, and maps
 * legacy "claude-3-5-haiku" ordering to "claude-haiku-3-5".
 */
export function normalizeModelId(raw: string): string {
  let s = raw.toLowerCase().trim()
  s = s.replace(/\[[^\]]*\]$/, '')
  s = s.replace(/^.*\//, '')
  s = s.replace(/^(?:[a-z]{2,6}\.)?anthropic\./, '')
  s = s.replace(/@.*$/, '')
  s = s.replace(/-v\d+(?::\d+)?$/, '')
  s = s.replace(/-\d{8}$/, '')
  s = s.replace(/-latest$/, '')
  const legacy = s.match(/^claude-(\d+(?:-\d+)?)-(opus|sonnet|haiku)$/)
  if (legacy) s = `claude-${legacy[2]}-${legacy[1]}`
  return s
}

const FAMILY = /^claude-([a-z]+)-(\d+(?:-\d+)*)$/

function version(id: string): number[] | null {
  const m = id.match(FAMILY)
  return m ? m[2].split('-').map(Number) : null
}

function cmpVersion(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d) return d
  }
  return 0
}

/** "gpt-5.1-codex" -> [5, 1] */
const gptVersion = (id: string) => id.match(/^gpt-(\d+(?:\.\d+)*)/)?.[1].split('.').map(Number) ?? null
/** variants priced unlike the main line */
const GPT_SPECIAL = /pro|audio|realtime|image|search|transcribe|tts|oss|instruct|vision|preview|turbo|chat|nano|mini/

/**
 * An unknown GPT model (Codex names new ones often): the newest GPT row of the
 * same size class, flagged as an estimate.
 */
function gptFallback(id: string, rows: Map<string, PriceRow>): Resolved | null {
  const tier = /nano/.test(id) ? 'nano' : /mini/.test(id) ? 'mini' : null
  let best: PriceRow | null = null
  let bestV: number[] = []
  for (const row of rows.values()) {
    const v = gptVersion(row.id)
    if (!v) continue
    const rest = row.id.replace(/^gpt-[\d.]+/, '')
    const fits = tier ? rest.includes(tier) && !/pro|audio|realtime|image|search/.test(rest) : !GPT_SPECIAL.test(rest)
    if (fits && (!best || cmpVersion(v, bestV) > 0)) {
      best = row
      bestV = v
    }
  }
  return best ? { row: best, estimated: true } : null
}

export interface Resolved {
  row: PriceRow
  estimated: boolean
}

/**
 * Exact id match; then the id with trailing non-numeric tags removed; then the
 * newest model of the same family (flagged as an estimate).
 */
export function resolvePrice(model: string, rows: Map<string, PriceRow>): Resolved | null {
  let id = normalizeModelId(model)
  const exact = rows.get(id)
  if (exact) return { row: exact, estimated: false }
  while (/-[a-z][a-z0-9]*$/.test(id) && id.split('-').length > 3) {
    id = id.replace(/-[a-z][a-z0-9]*$/, '')
    const r = rows.get(id)
    if (r) return { row: r, estimated: false }
  }
  if (id.startsWith('gpt-')) return gptFallback(id, rows)
  const fam = id.match(/^claude-(opus|sonnet|haiku|fable|mythos)\b/)?.[1]
  if (!fam) return null
  let best: PriceRow | null = null
  let bestV: number[] = []
  for (const row of rows.values()) {
    if (!row.id.startsWith(`claude-${fam}-`)) continue
    const v = version(row.id)
    if (v && (!best || cmpVersion(v, bestV) > 0)) {
      best = row
      bestV = v
    }
  }
  return best ? { row: best, estimated: true } : null
}
