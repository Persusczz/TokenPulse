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

/** A 7-day reading with the 5-hour window open when it was taken; one entry while nothing changes */
export interface QuotaReading {
  /** first and last time it was seen */
  t0: number
  t1: number
  /** the end of the 5-hour window open then; null with none open (nothing used for 5 hours) */
  five: number | null
  /** the 7-day reading, percent, and when that week resets */
  pct: number
  end: number
}

/** a reading this close to its window's end counts as the window's last */
const NEAR_MS = 10 * 60_000
const sameWeek = (a: { end: number }, b: { end: number }) => Math.abs(a.end - b.end) < HOUR

function firstFrom(rs: QuotaReading[], t: number): number {
  let lo = 0
  let hi = rs.length
  while (hi - lo > 0) {
    const mid = (lo + hi) >> 1
    if (rs[mid].t0 < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * What a 5-hour window took of the 7-day quota, measured: the 7-day reading
 * when it closed minus the one when it opened. Readings are in time order.
 * The opening reading is the last one before the window's first, when nothing
 * can have been used in between: taken with no window open, near the end of
 * the window before, or (perResponse: the source logs a reading with every
 * response, like Codex) any time; else a reading in the window's first
 * minutes. The closing one is the window's last, when taken near its end
 * (or after every response), or one taken in the quiet after it. A week that
 * turns over inside the window adds the old week's part to the new one's.
 * Null when the readings don't pin it down.
 */
export function measureWeekShare(c: Pick<QuotaCycle, 'start' | 'end' | 'current'>, rs: QuotaReading[], perResponse: boolean): number | null {
  let i0 = -1
  let i1 = -1
  for (let i = firstFrom(rs, c.start - SAME_MS); i < rs.length && rs[i].t0 <= c.end + SAME_MS; i++) {
    const f = rs[i].five
    if (f !== null && Math.abs(f - c.end) < SAME_MS) {
      if (i0 < 0) i0 = i
      i1 = i
    }
  }
  if (i0 < 0) return null
  const first = rs[i0]
  const last = rs[i1]
  let base: number | null = null
  const prev = rs[i0 - 1]
  if (prev && (prev.five === null || perResponse || prev.five - prev.t1 <= NEAR_MS)) {
    if (sameWeek(prev, first)) base = prev.pct
    // the week turned over before the window opened, with nothing used since
    else if (prev.end < first.end) base = 0
  }
  if (base === null && first.t0 - c.start <= NEAR_MS) base = first.pct
  if (base === null) return null
  let close = last
  if (!c.current) {
    const next = rs[i1 + 1]
    if (next && next.five === null && sameWeek(next, last)) close = next
    else if (!perResponse && c.end - last.t1 > NEAR_MS) return null
  }
  let share = close.pct - base
  if (!sameWeek(close, first)) {
    let a = first
    for (let i = i0; i <= i1; i++) if (sameWeek(rs[i], first)) a = rs[i]
    share = a.pct - base + close.pct
  }
  return share >= -0.5 ? Math.max(0, share) : null
}

/**
 * What each 5-hour window took of its 7-day window, percent (sets weekPct).
 * Measured where the readings allow it (weekMeasured); the rest share out
 * what their week's reading leaves over by what each response cost, so the
 * windows of a week still add up to its reading. A week without a usable
 * reading (none yet, or under 3% while open) borrows the rate of the nearest
 * week that has one (weekEst).
 */
export function weekShares(five: QuotaCycle[], seven: QuotaCycle[], entries: CostedEntry[], measured: (c: QuotaCycle) => number | null = () => null): void {
  const m = five.map(measured)
  const usable = (w: QuotaCycle) => w.pct !== null && w.pct >= (w.current ? 3 : 1) && w.cost > 0
  // per week: what its measured windows took, and the spend left to share the rest over
  const took = seven.map(() => 0)
  const left = seven.map((w) => w.cost)
  five.forEach((c, i) => {
    const k = seven.findIndex((w) => w.start <= c.start && c.start < w.end)
    if (m[i] === null || k < 0) return
    took[k] += m[i]!
    left[k] -= c.cost
  })
  const own = seven.map((w, k) => (!usable(w) ? null : left[k] > 1e-9 ? Math.max(0, w.pct! - took[k]) / left[k] : 0))
  const known = seven.flatMap((w) => (usable(w) ? [{ mid: (w.start + w.end) / 2, rate: w.pct! / w.cost }] : []))
  const borrow = (t: number) => (known.length ? known.reduce((a, b) => (Math.abs(b.mid - t) < Math.abs(a.mid - t) ? b : a)).rate : null)
  let k = 0
  five.forEach((c, n) => {
    if (m[n] !== null) {
      c.weekPct = m[n]
      c.weekMeasured = true
      c.weekEst = false
      return
    }
    let share = 0
    let est = false
    let priced = false
    for (let i = lowerBound(entries, c.start); i < entries.length && entries[i].ts < c.end; i++) {
      const e = entries[i]
      while (k < seven.length && seven[k].end <= e.ts) k++
      let rate = k < seven.length && seven[k].start <= e.ts ? own[k] : null
      if (rate === null && e.cost.total > 0) {
        rate = borrow(e.ts)
        est = rate !== null
      }
      if (rate === null) continue
      share += e.cost.total * rate
      priced = true
    }
    c.weekPct = priced ? share : c.messages ? null : 0
    c.weekMeasured = false
    c.weekEst = est
  })
}
