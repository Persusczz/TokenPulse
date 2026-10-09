import type { PromptCost, SourceView, TarotDeck, UsageSource } from '@shared/types'
import { addDays, startOfDay, tokensOf, type CostedEntry } from './aggregate'
import { lowerBound } from './rate'

/**
 * The 22 Major Arcana, each drawing one piece of your usage in its own
 * picture (the Sun's rays are today's hours, the Moon's phase is the week's
 * quota…). This gathers what the cards draw.
 */

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export interface DeckInput {
  now: number
  view: SourceView
  /** the tools on view, sorted by time */
  entries: CostedEntry[]
  label: (model: string) => string
  /** whose quota the quota cards draw (Claude in 全部) */
  tool: UsageSource
  five: { pct: number; end: number } | null
  seven: { pct: number; start: number; end: number } | null
  guardAt: number | null
  /** 5-hour windows of `tool`, closed ones with their peak */
  windows: { start: number; end: number; peak: number }[]
  /** today's questions and what each cost */
  prompts: PromptCost[]
  tasks: { prompt: string; status: string; finishedAt: number | null; startedAt: number | null }[]
  tpm: number
  /** WorkBuddy's account credits, which its quota cards draw */
  credits?: TarotDeck['credits']
}

const median = (xs: number[]) => {
  const s = xs.filter((x) => x > 0).sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

export function buildDeck(x: DeckInput): TarotDeck {
  const { now, entries } = x
  const today = startOfDay(now)
  // the last 60 days, day by day
  const first = entries.length ? startOfDay(entries[0].ts) : null
  const from = addDays(today, -59)
  const days = Array.from({ length: 60 }, (_, i) => ({ day: addDays(from, i), tokens: 0, output: 0, cost: 0 }))
  const dayIndex = (t: number) => Math.round((startOfDay(t) - from) / DAY)
  const t = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, hours: Array<number>(24).fill(0) }
  const minutes = new Map<number, number>()
  const usual = Array<number>(24).fill(0)
  const oldMinutes = new Map<number, number>()
  let nightTokens = 0
  let weekTokens = 0
  let weekCost = 0
  let prevCost = 0
  const projects = new Map<string, number>()
  const models = new Map<string, number>()
  const tools: Record<UsageSource, number> = { claude: 0, codex: 0, workbuddy: 0 }
  const sessions = new Map<string, { project: string; tokens: number; end: number }>()
  for (let i = lowerBound(entries, from); i < entries.length && entries[i].ts <= now; i++) {
    const e = entries[i]
    const tk = tokensOf(e)
    const d = days[dayIndex(e.ts)]
    if (d) {
      d.tokens += tk
      d.output += e.output
      d.cost += e.cost.total
    }
    const h = new Date(e.ts).getHours()
    const m = Math.floor(e.ts / MIN) * MIN
    if (e.ts >= today) {
      t.input += e.input
      t.output += e.output
      t.cacheWrite += e.cacheWrite5m + e.cacheWrite1h
      t.cacheRead += e.cacheRead
      t.hours[h] += tk
      minutes.set(m, (minutes.get(m) ?? 0) + tk)
      if (e.sessionId) {
        const s = sessions.get(e.sessionId) ?? { project: e.project, tokens: 0, end: e.ts }
        s.tokens += tk
        s.end = e.ts
        sessions.set(e.sessionId, s)
      }
    } else if (e.ts >= today - 14 * DAY) {
      usual[h] += tk / 14
      oldMinutes.set(m, (oldMinutes.get(m) ?? 0) + tk)
    }
    if (e.ts > now - 7 * DAY) {
      weekTokens += tk
      weekCost += e.cost.total
      if (h >= 22 || h < 5) nightTokens += tk
      projects.set(e.project, (projects.get(e.project) ?? 0) + tk)
      const name = x.label(e.model)
      models.set(name, (models.get(name) ?? 0) + tk)
      tools[e.source ?? 'claude'] += tk
    } else if (e.ts > now - 14 * DAY) prevCost += e.cost.total
  }
  const record = Math.max(0, ...oldMinutes.values())
  let peak: { tokens: number; at: number } | null = null
  for (const [at, tokens] of minutes) if (!peak || tokens > peak.tokens) peak = { tokens, at }

  // days in a row with usage, up to today (or yesterday while today is still empty)
  const used = (i: number) => (days[i]?.tokens ?? 0) > 0
  let streak = 0
  for (let i = used(59) ? 59 : 58; i >= 0 && used(i); i--) streak++
  let best = 0
  let run = 0
  for (let i = 0; i < 60; i++) {
    run = used(i) ? run + 1 : 0
    best = Math.max(best, run)
  }

  const ranked = [...models.entries()].sort((a, b) => b[1] - a[1])
  const lovers =
    x.view === 'all'
      ? { a: { name: 'Claude', tokens: tools.claude }, b: { name: 'Codex', tokens: tools.codex } }
      : ranked.length
        ? { a: { name: ranked[0][0], tokens: ranked[0][1] }, b: ranked[1] ? { name: ranked[1][0], tokens: ranked[1][1] } : null }
        : null

  // the week's 5-hour windows, and how much of the week a full one takes
  const wk = x.seven
  const costIn = (a: number, b: number) => {
    let c = 0
    for (let i = lowerBound(entries, a); i < entries.length && entries[i].ts < b; i++) if ((entries[i].source ?? 'claude') === x.tool) c += entries[i].cost.total
    return c
  }
  const wheel = wk
    ? [
        ...x.windows.filter((w) => w.end > wk.start && w.end <= now).map((w) => ({ start: w.start, end: w.end, peak: w.peak, current: false })),
        ...(x.five ? [{ start: x.five.end - 5 * HOUR, end: x.five.end, peak: x.five.pct, current: true }] : [])
      ].slice(-40)
    : []
  let full: number | null = null
  if (wk && wk.pct > 0) {
    const spent = costIn(wk.start, now)
    const per5 = median(x.windows.filter((w) => w.end <= now && w.peak >= 15).map((w) => w.peak / Math.max(1e-9, costIn(w.start, w.end))))
    if (spent > 0 && per5 > 0) full = (100 / per5) * (wk.pct / spent)
  }
  const closed = x.windows.filter((w) => w.end <= now && w.end > now - 7 * DAY)
  const unused = closed.length ? { avg: closed.reduce((a, w) => a + Math.max(0, 100 - w.peak), 0) / closed.length, n: closed.length } : null

  const ended = [...sessions.values()].filter((s) => now - s.end > 30 * MIN).sort((a, b) => b.end - a.end)
  const costs = x.prompts.filter((p) => p.cost > 0)
  const avg = costs.length ? costs.reduce((a, p) => a + p.cost, 0) / costs.length : 0
  const top = costs.reduce<PromptCost | null>((a, p) => (!a || p.cost > a.cost ? p : a), null)

  return {
    source: x.view,
    tool: x.tool,
    at: now,
    firstDay: first,
    days,
    today: { ...t, peak },
    usualHours: usual,
    record,
    tpm: x.tpm,
    lovers,
    streak,
    bestStreak: best,
    night: { tokens: nightTokens, share: weekTokens ? nightTokens / weekTokens : 0 },
    five: x.five,
    seven: x.seven,
    guardAt: x.guardAt,
    wheel,
    week: { now: weekCost, prev: prevCost },
    unused,
    ended: ended.slice(0, 12).map((s) => ({ project: s.project, tokens: s.tokens, end: s.end })),
    endedCount: ended.length,
    devil: top ? { text: top.text, cost: top.cost, avg, over3: costs.filter((p) => p.cost >= 3 * avg).length } : null,
    full,
    projects: [...projects.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, tokens]) => ({ name, tokens })),
    tasks: x.tasks
      .filter((k) => k.status === 'running' || k.status === 'queued' || (k.finishedAt ?? 0) > now - 7 * DAY)
      .sort((a, b) => (b.finishedAt ?? b.startedAt ?? now) - (a.finishedAt ?? a.startedAt ?? now))
      .slice(0, 6)
      .map((k) => ({ title: k.prompt.replace(/\s+/g, ' ').slice(0, 40), status: k.status, at: k.finishedAt ?? k.startedAt ?? now })),
    credits: x.credits ?? null
  }
}
