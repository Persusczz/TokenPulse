import type { CalendarDay, ModelRow, PromptCost, SessionSpan, UsageSource } from '@shared/types'
import { addDays, startOfDay, startOfWeek, tokensOf, type CostedEntry } from './aggregate'
import { lowerBound } from './rate'

/** Data for three overview cards: the calendar, today's sessions and the model table */

const MIN = 60_000
const BIN = 10 * MIN

const top = <T extends { v: number }>(m: Map<string, T>, n: number) => [...m.entries()].sort((a, b) => b[1].v - a[1].v).slice(0, n)

/** the last `weeks` weeks, Monday first, day by day (days after today are left out) */
export function calendarDays(entries: CostedEntry[], now: number, label: (m: string) => string, weeks = 12): CalendarDay[] {
  const from = startOfWeek(addDays(startOfDay(now), -(weeks - 1) * 7))
  const days: (CalendarDay & { m: Map<string, { v: number }>; p: Map<string, { v: number }>; s: Set<string>; h: number[] })[] = []
  for (let t = from; t <= now; t = addDays(t, 1)) {
    days.push({ t, tokens: 0, cost: 0, messages: 0, sessions: 0, models: [], projects: [], first: null, last: null, busiest: null, m: new Map(), p: new Map(), s: new Set(), h: Array(24).fill(0) })
  }
  const at = (t: number) => days[Math.round((startOfDay(t) - from) / 86_400_000)]
  for (let i = lowerBound(entries, from); i < entries.length && entries[i].ts <= now; i++) {
    const e = entries[i]
    const d = at(e.ts)
    if (!d) continue
    const tk = tokensOf(e)
    d.tokens += tk
    d.cost += e.cost.total
    d.messages++
    if (e.sessionId) d.s.add(e.sessionId)
    const name = label(e.model)
    const mm = d.m.get(name) ?? { v: 0 }
    mm.v += e.cost.total || tk / 1e9
    d.m.set(name, mm)
    const pp = d.p.get(e.project) ?? { v: 0 }
    pp.v += tk
    d.p.set(e.project, pp)
    d.h[new Date(e.ts).getHours()] += tk
    d.first ??= e.ts
    d.last = e.ts
  }
  return days.map(({ m, p, s, h, ...d }) => {
    const busiest = h.some((v) => v > 0) ? h.indexOf(Math.max(...h)) : null
    return { ...d, sessions: s.size, models: top(m, 3).map(([name, x]) => ({ name, cost: x.v })), projects: top(p, 3).map(([name, x]) => ({ name, tokens: x.v })), busiest }
  })
}

/** today's sessions, each with its use in 10-minute steps from its start */
export function todaySessions(entries: CostedEntry[], now: number, label: (m: string) => string): SessionSpan[] {
  const from = startOfDay(now)
  const by = new Map<string, SessionSpan & { mc: Map<string, number> }>()
  for (let i = lowerBound(entries, from); i < entries.length && entries[i].ts <= now; i++) {
    const e = entries[i]
    if (!e.sessionId) continue
    let s = by.get(e.sessionId)
    if (!s) {
      s = { id: e.sessionId, project: e.project, source: (e.source ?? 'claude') as UsageSource, model: '', start: e.ts, end: e.ts, tokens: 0, cost: 0, messages: 0, bins: [], mc: new Map() }
      by.set(e.sessionId, s)
    }
    const tk = tokensOf(e)
    s.end = e.ts
    s.tokens += tk
    s.cost += e.cost.total
    s.messages++
    const b = Math.floor((e.ts - s.start) / BIN)
    while (s.bins.length <= b) s.bins.push(0)
    s.bins[b] += tk
    const name = label(e.model)
    s.mc.set(name, (s.mc.get(name) ?? 0) + (e.cost.total || tk / 1e9))
  }
  return [...by.values()]
    .map(({ mc, ...s }) => ({ ...s, model: [...mc.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '' }))
    .sort((a, b) => a.start - b.start)
}

/** each model over a range: use, spend, and what one question on it cost on average */
export function modelRows(entries: CostedEntry[], from: number, to: number, label: (m: string) => string, prompts: PromptCost[]): ModelRow[] {
  const rows = new Map<string, ModelRow>()
  for (let i = lowerBound(entries, from); i < entries.length && entries[i].ts < to; i++) {
    const e = entries[i]
    const name = label(e.model)
    const r = rows.get(name) ?? { name, source: (e.source ?? 'claude') as UsageSource, tokens: 0, cost: 0, messages: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, prompts: 0, promptCost: 0 }
    r.tokens += tokensOf(e)
    r.cost += e.cost.total
    r.messages++
    r.input += e.input
    r.output += e.output
    r.cacheRead += e.cacheRead
    r.cacheWrite += e.cacheWrite5m + e.cacheWrite1h
    rows.set(name, r)
  }
  // a question counts for the model it was first answered by
  for (const p of prompts) {
    const r = p.models[0] ? rows.get(p.models[0]) : undefined
    if (!r) continue
    r.prompts++
    r.promptCost += p.cost
  }
  return [...rows.values()].filter((r) => r.tokens > 0).sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
}
