import type { QuotaCycle } from '@shared/types'
import { tokensOf, type CostedEntry } from './aggregate'

const HOUR = 3_600_000
export const CYCLE_MS = { '5h': 5 * HOUR, '7d': 7 * 24 * HOUR } as const

/** a window the provider reported */
export interface KnownWindow {
  start: number
  end: number
  /** the highest reading, percent */
  pct: number | null
  hitAt: number | null
}

interface Span {
  start: number
  end: number
  pct: number | null
  hitAt: number | null
  estimated: boolean
}

function lowerBound(list: CostedEntry[], t: number): number {
  let lo = 0
  let hi = list.length
  while (hi - lo > 0) {
    const mid = (lo + hi) >> 1
    if (list[mid].ts < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** readings of one window: its reset time wobbles by seconds to minutes between readings */
const SAME_MS = 10 * 60_000

/**
 * The known windows in order. Two readings of one window become one (the
 * later reading knows its reset best, the peak stays the highest); a window
 * that a new one starts inside of was reset early and ends there; a gap of
 * a few minutes between two windows is the wobble of their reset times.
 */
function tidy(known: KnownWindow[], current: KnownWindow | null): Span[] {
  const all = [...known, ...(current ? [current] : [])].filter((w) => w.end > w.start).sort((a, b) => a.start - b.start)
  const out: Span[] = []
  for (const w of all) {
    const span: Span = { start: w.start, end: w.end, pct: w.pct, hitAt: w.hitAt, estimated: false }
    const prev = out[out.length - 1]
    if (prev && Math.abs(w.start - prev.start) < SAME_MS) {
      out[out.length - 1] = { ...span, pct: w.pct === null ? prev.pct : Math.max(w.pct, prev.pct ?? 0), hitAt: prev.hitAt ?? w.hitAt }
      continue
    }
    if (prev && w.start < prev.end + SAME_MS) prev.end = w.start
    out.push(span)
  }
  return out
}

/**
 * The quota windows of one length over a tool's usage, oldest first. Where
 * the provider reported a window it is used as reported; the rest are worked
 * out the way the provider opens them: at the first response after the
 * previous window closed, rounded down to the hour. Weekly windows follow
 * each other back to back, so before the first known week (and between known
 * weeks) they are stepped out from it. Windows with no usage are left out,
 * unless the provider says something was used in them or one is open now.
 */
export function buildCycles(o: {
  kind: '5h' | '7d'
  /** the tool's usage, oldest first */
  entries: CostedEntry[]
  known: KnownWindow[]
  /** the open window as the provider reports it now */
  current: KnownWindow | null
  from: number
  now: number
  label: (model: string) => string
}): QuotaCycle[] {
  const len = CYCLE_MS[o.kind]
  let spans = tidy(o.known, o.current)
  if (o.kind === '7d' && spans.length) {
    const stepped: Span[] = []
    for (let s = spans[0].start - len; s + len > o.from; s -= len) stepped.push({ start: s, end: s + len, pct: null, hitAt: null, estimated: true })
    for (let i = 1; i < spans.length; i++) {
      for (let s = spans[i - 1].end; s < spans[i].start; s += len) stepped.push({ start: s, end: Math.min(s + len, spans[i].start), pct: null, hitAt: null, estimated: true })
    }
    spans = [...spans, ...stepped].sort((a, b) => a.start - b.start)
  }
  // usage outside every known window opens windows of its own
  const inferred: Span[] = []
  let k = 0
  let open: Span | null = null
  for (let i = lowerBound(o.entries, o.from - len); i < o.entries.length && o.entries[i].ts <= o.now; i++) {
    const ts = o.entries[i].ts
    while (k < spans.length && spans[k].end <= ts) k++
    if (k < spans.length && spans[k].start <= ts) continue
    if (open && ts < open.end) continue
    const before = k > 0 ? spans[k - 1].end : -Infinity
    const next = k < spans.length ? spans[k].start : Infinity
    const start = Math.max(Math.floor(ts / HOUR) * HOUR, before, open?.end ?? -Infinity)
    open = { start, end: Math.min(start + len, next), pct: null, hitAt: null, estimated: true }
    inferred.push(open)
  }
  const out: QuotaCycle[] = []
  for (const w of [...spans, ...inferred].sort((a, b) => a.start - b.start)) {
    if (w.end <= o.from || w.start > o.now) continue
    const c: QuotaCycle = {
      kind: o.kind,
      start: w.start,
      end: w.end,
      tokens: 0,
      cost: 0,
      messages: 0,
      sessions: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      pct: w.pct,
      hitAt: w.hitAt,
      current: w.start <= o.now && o.now < w.end,
      estimated: w.estimated,
      models: []
    }
    const sessions = new Set<string>()
    const models = new Map<string, { cost: number; tokens: number }>()
    for (let i = lowerBound(o.entries, w.start); i < o.entries.length && o.entries[i].ts < w.end; i++) {
      const e = o.entries[i]
      const t = tokensOf(e)
      c.tokens += t
      c.cost += e.cost.total
      c.messages++
      c.input += e.input
      c.output += e.output
      c.cacheRead += e.cacheRead
      c.cacheWrite += e.cacheWrite5m + e.cacheWrite1h
      sessions.add(e.sessionId)
      const name = o.label(e.model)
      const m = models.get(name) ?? { cost: 0, tokens: 0 }
      m.cost += e.cost.total
      m.tokens += t
      models.set(name, m)
    }
    c.sessions = sessions.size
    c.models = [...models.entries()]
      .map(([name, m]) => ({ name, ...m }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 3)
    if (c.messages || c.current || (c.pct ?? 0) >= 1) out.push(c)
  }
  return out
}
