import type { PromptMark, RaceSeries, StarMap } from '@shared/types'
import { addDays, startOfDay, startOfMonth, startOfWeek, tokensOf, type CostedEntry } from './aggregate'
import { costByPrompt } from './prompts'
import { lowerBound } from './rate'

const HOUR = 3600_000

/** the step boundaries of a period: hourly through a week, daily through a month */
function steps(kind: RaceSeries['kind'], start: number, end: number): number[] {
  const out: number[] = []
  if (kind === 'week') for (let t = start; t < end; t += HOUR) out.push(t)
  else for (let t = start; t < end; t = addDays(t, 1)) out.push(t)
  out.push(end)
  return out
}

/** cumulative tokens and cost at the end of each step, up to `until` */
function cumulative(entries: CostedEntry[], edges: number[], until: number): RaceSeries['cur'] {
  const out: RaceSeries['cur'] = []
  let i = lowerBound(entries, edges[0])
  let tokens = 0
  let cost = 0
  for (let k = 1; k < edges.length; k++) {
    const end = Math.min(edges[k], until)
    while (i < entries.length && entries[i].ts < end) {
      tokens += tokensOf(entries[i])
      cost += entries[i].cost.total
      i++
    }
    out.push({ tokens, cost })
    if (edges[k] >= until) break
  }
  return out
}

/**
 * This calendar week (from Monday) or month against the one before, as
 * running totals step by step since each began, so "where last week stood at
 * this moment" can be read off the same step. Entries sorted by time.
 */
export function raceSeries(entries: CostedEntry[], kind: RaceSeries['kind'], now: number): RaceSeries {
  const start = kind === 'week' ? startOfWeek(now) : startOfMonth(now)
  const end = kind === 'week' ? addDays(start, 7) : startOfMonth(addDays(start, 32))
  const prevStart = kind === 'week' ? addDays(start, -7) : startOfMonth(addDays(start, -1))
  const cur = steps(kind, start, end)
  const prev = steps(kind, prevStart, start)
  return {
    kind,
    start,
    end,
    prevStart,
    steps: cur.length - 1,
    prevSteps: prev.length - 1,
    cur: cumulative(entries, cur, now),
    prev: cumulative(entries, prev, start)
  }
}

/** prompts drawn on the star map are cut to this many characters */
const TEXT_MAX = 160
/** the star map never narrows to fewer days than this */
const MIN_SPAN = 3

/**
 * Every prompt of the last `days` days with what it cost, and the sessions
 * they belong to (the star map's constellations). When the records begin
 * inside that span the map starts on their first day (at least MIN_SPAN days
 * wide), so the stars aren't squeezed against the right edge. Entries sorted
 * by time.
 */
export function starMap(entries: CostedEntry[], index: Map<string, PromptMark[]>, days: number, now: number, modelLabel?: (m: string) => string): StarMap {
  const today = startOfDay(now)
  const asked = addDays(today, -(days - 1))
  const { list, unattributed } = costByPrompt(entries, index, asked, now + 1, modelLabel)
  const since = entries.length ? entries[0].ts : Infinity
  let span = days
  while (span > MIN_SPAN && addDays(today, -(span - 2)) <= since) span--
  const from = addDays(today, -(span - 1))
  const prompts = list
    .filter((p) => p.ts >= from)
    .sort((a, b) => a.ts - b.ts)
    .map((p) => ({ ...p, text: p.text.length > TEXT_MAX ? `${p.text.slice(0, TEXT_MAX - 1)}…` : p.text }))
  const by = new Map<string, StarMap['sessions'][number]>()
  for (const p of prompts) {
    const s = by.get(p.sessionId)
    if (s) {
      s.last = p.ts
      s.cost += p.cost
      s.tokens += p.tokens
      s.prompts++
    } else by.set(p.sessionId, { id: p.sessionId, project: p.project, source: p.source, first: p.ts, last: p.ts, cost: p.cost, tokens: p.tokens, prompts: 1 })
  }
  // what each model took over the span (the planets)
  const models = new Map<string, StarMap['models'][number]>()
  for (let i = lowerBound(entries, from); i < entries.length && entries[i].ts <= now; i++) {
    const e = entries[i]
    const name = modelLabel ? modelLabel(e.model) : e.model
    const m = models.get(name)
    if (m) {
      m.cost += e.cost.total
      m.tokens += tokensOf(e)
      m.requests++
    } else models.set(name, { name, source: e.source ?? 'claude', cost: e.cost.total, tokens: tokensOf(e), requests: 1 })
  }
  return {
    from,
    to: now,
    days: span,
    asked: days,
    since: Number.isFinite(since) ? since : null,
    prompts,
    sessions: [...by.values()],
    models: [...models.values()].filter((m) => m.tokens > 0).sort((a, b) => b.cost - a.cost || b.tokens - a.tokens),
    unattributedCost: unattributed
  }
}
