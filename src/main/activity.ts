import type { ActionKind, ActionStats, PersonalRecords, PromptCost, PromptMark, ToolAction, UsageSource } from '@shared/types'
import { addDays, startOfDay, tokensOf, type CostedEntry } from './aggregate'

/** Two overview cards: what the AI did with its tools, and your personal records */

const HOUR = 3_600_000
const KINDS: ActionKind[] = ['run', 'read', 'edit', 'web', 'agent', 'mcp', 'other']

/** files are named by their path; Windows paths ignore case and slash direction */
const fileKey = (p: string) => p.replace(/\\/g, '/').toLowerCase()
const baseName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p

/** the tool calls between `from` and `to` */
export function actionStats(actions: Iterable<ToolAction>, from: number, to: number, prompts: number): ActionStats {
  const kinds = new Map<ActionKind, number>()
  const tools = new Map<string, { name: string; kind: ActionKind; source: UsageSource; count: number }>()
  const files = new Map<string, ActionStats['topFiles'][number]>()
  let total = 0
  let added = 0
  let removed = 0
  let since: number | null = null
  for (const a of actions) {
    if (since === null || a.ts < since) since = a.ts
    if (a.ts < from || a.ts >= to) continue
    total++
    kinds.set(a.kind, (kinds.get(a.kind) ?? 0) + 1)
    const tk = `${a.source}:${a.name}`
    const t = tools.get(tk) ?? { name: a.name, kind: a.kind, source: a.source, count: 0 }
    t.count++
    tools.set(tk, t)
    added += a.added ?? 0
    removed += a.removed ?? 0
    for (const f of a.files ?? []) {
      const k = fileKey(f.path)
      const row = files.get(k) ?? { path: f.path, name: baseName(f.path), project: a.project, edits: 0, added: 0, removed: 0 }
      row.edits++
      row.added += f.added
      row.removed += f.removed
      files.set(k, row)
    }
  }
  return {
    total,
    kinds: KINDS.map((kind) => ({ kind, count: kinds.get(kind) ?? 0 })),
    tools: [...tools.values()].sort((a, b) => b.count - a.count).slice(0, 10),
    added,
    removed,
    files: files.size,
    topFiles: [...files.values()].sort((a, b) => b.edits - a.edits || b.added + b.removed - (a.added + a.removed)).slice(0, 6),
    prompts,
    since
  }
}

const median = (v: number[]) => {
  if (!v.length) return 0
  const s = [...v].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Bests over everything in the logs, plus today's numbers to set against
 * them and a few averages. `entries` are sorted by time.
 */
export function personalRecords(entries: CostedEntry[], marks: PromptMark[], costs: PromptCost[], actions: Iterable<ToolAction>, now: number): PersonalRecords {
  const today = startOfDay(now)
  const days = new Map<number, { tokens: number; cost: number }>()
  const hours = new Map<number, number>()
  const sessions = new Map<string, { id: string; project: string; source: UsageSource; start: number; end: number; tokens: number; cost: number }>()
  let tokens = 0
  let cost = 0
  for (const e of entries) {
    const tk = tokensOf(e)
    tokens += tk
    cost += e.cost.total
    const d = startOfDay(e.ts)
    const day = days.get(d) ?? { tokens: 0, cost: 0 }
    day.tokens += tk
    day.cost += e.cost.total
    days.set(d, day)
    const h = Math.floor(e.ts / HOUR) * HOUR
    hours.set(h, (hours.get(h) ?? 0) + tk)
    if (!e.sessionId) continue
    const s = sessions.get(e.sessionId) ?? { id: e.sessionId, project: e.project, source: e.source ?? 'claude', start: e.ts, end: e.ts, tokens: 0, cost: 0 }
    s.end = Math.max(s.end, e.ts)
    s.tokens += tk
    s.cost += e.cost.total
    sessions.set(e.sessionId, s)
  }

  const used = [...days.entries()].filter(([, d]) => d.tokens > 0).sort((a, b) => a[0] - b[0])
  const max = <T>(list: Iterable<T>, v: (x: T) => number): T | null => {
    let best: T | null = null
    for (const x of list) if (v(x) > 0 && (best === null || v(x) > v(best))) best = x
    return best
  }

  // days in a row with use
  let streak: PersonalRecords['streak'] = null
  let runDays = 0
  let runFrom = 0
  let runTo = 0
  for (const [d] of used) {
    if (runDays && addDays(runTo, 1) === d) runDays++
    else {
      runDays = 1
      runFrom = d
    }
    runTo = d
    if (!streak || runDays > streak.days) streak = { days: runDays, from: runFrom, to: runTo }
  }
  // the run is still going if it reached today or yesterday
  const current = runDays && (runTo === today || runTo === addDays(today, -1)) ? runDays : 0

  const bestDay = max(used, ([, d]) => d.tokens)
  const costDay = max(used, ([, d]) => d.cost)
  const bestHour = max(hours.entries(), ([, v]) => v)
  const big = max(sessions.values(), (s) => s.tokens)

  const promptDays = new Map<number, number>()
  for (const p of marks) promptDays.set(startOfDay(p.ts), (promptDays.get(startOfDay(p.ts)) ?? 0) + 1)
  const promptDay = max(promptDays.entries(), ([, n]) => n)
  const costPrompt = max(costs, (p) => p.cost)

  const codeDays = new Map<number, { added: number; removed: number }>()
  for (const a of actions) {
    if (!a.added && !a.removed) continue
    const d = startOfDay(a.ts)
    const c = codeDays.get(d) ?? { added: 0, removed: 0 }
    c.added += a.added ?? 0
    c.removed += a.removed ?? 0
    codeDays.set(d, c)
  }
  const codeDay = max(codeDays.entries(), ([, c]) => c.added)

  const promptTotal = costs.reduce((n, p) => n + p.cost, 0)
  const promptTokens = costs.reduce((n, p) => n + p.tokens, 0)
  const durations = [...sessions.values()].map((s) => s.end - s.start).filter((ms) => ms > 0)
  const n = used.length || 1
  return {
    bestDay: bestDay && { t: bestDay[0], tokens: bestDay[1].tokens },
    costDay: costDay && { t: costDay[0], cost: costDay[1].cost },
    streak,
    current,
    bestHour: bestHour && { t: bestHour[0], tokens: bestHour[1] },
    bigSession: big && { id: big.id, project: big.project, source: big.source, start: big.start, tokens: big.tokens, cost: big.cost },
    promptDay: promptDay && { t: promptDay[0], prompts: promptDay[1] },
    costPrompt: costPrompt && { ts: costPrompt.ts, cost: costPrompt.cost, text: costPrompt.text, sessionId: costPrompt.sessionId },
    codeDay: codeDay && { t: codeDay[0], added: codeDay[1].added, removed: codeDay[1].removed },
    today: {
      tokens: days.get(today)?.tokens ?? 0,
      cost: days.get(today)?.cost ?? 0,
      prompts: promptDays.get(today) ?? 0,
      added: codeDays.get(today)?.added ?? 0,
      hour: hours.get(Math.floor(now / HOUR) * HOUR) ?? 0
    },
    avg: {
      dayTokens: tokens / n,
      dayCost: cost / n,
      promptCost: costs.length ? promptTotal / costs.length : 0,
      promptTokens: costs.length ? promptTokens / costs.length : 0,
      promptsPerDay: marks.length / n,
      sessionMinutes: median(durations) / 60_000
    },
    days: used.length,
    since: used[0]?.[0] ?? null
  }
}
