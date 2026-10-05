import type {
  Bucket,
  CostParts,
  GroupStat,
  HeatCell,
  Intensity,
  LiveStats,
  RangeKey,
  RangeOverview,
  RangeSummary,
  SessionRow,
  TokenTotals,
  UsageEntry
} from '@shared/types'

export interface CostedEntry extends UsageEntry {
  cost: CostParts
}

const MIN = 60_000
const HOUR = 60 * MIN

export const tokensOf = (e: UsageEntry): number =>
  e.input + e.output + e.cacheWrite5m + e.cacheWrite1h + e.cacheRead

export function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Calendar-day arithmetic in local time (DST safe) */
export function addDays(t: number, n: number): number {
  const d = new Date(t)
  d.setDate(d.getDate() + n)
  return d.getTime()
}

export function startOfMonth(t: number): number {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}

/** Monday-based week start */
export function startOfWeek(t: number): number {
  const d = new Date(startOfDay(t))
  return addDays(d.getTime(), -((d.getDay() + 6) % 7))
}

export function dayKey(t: number): string {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export interface Bounds {
  start: number
  end: number
  unit: 'hour' | 'day' | 'week'
  prev: [number, number] | null
}

export function rangeBounds(range: RangeKey, now: number, firstTs: number | null): Bounds {
  const today = startOfDay(now)
  const tomorrow = addDays(today, 1)
  switch (range) {
    case 'today':
      return { start: today, end: tomorrow, unit: 'hour', prev: [addDays(today, -1), addDays(today, -1) + (now - today)] }
    case '7d':
    case '30d': {
      const n = range === '7d' ? 7 : 30
      const start = addDays(today, -(n - 1))
      return { start, end: tomorrow, unit: 'day', prev: [addDays(start, -n), start] }
    }
    case 'month': {
      const start = startOfMonth(now)
      const d = new Date(start)
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
      const pStart = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime()
      return { start, end, unit: 'day', prev: [pStart, Math.min(pStart + (now - start), start)] }
    }
    case 'all': {
      let start = firstTs !== null ? startOfDay(Math.min(firstTs, now)) : today
      const days = Math.round((tomorrow - start) / (24 * HOUR))
      if (days > 120) {
        start = startOfWeek(start)
        return { start, end: tomorrow, unit: 'week', prev: null }
      }
      return { start, end: tomorrow, unit: 'day', prev: null }
    }
  }
}

export function bucketStarts(b: Bounds): number[] {
  const out: number[] = []
  if (b.unit === 'hour') {
    const d = new Date(b.start)
    for (let h = 0; h < 24; h++) out.push(new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).getTime())
    return out
  }
  const step = b.unit === 'week' ? 7 : 1
  for (let t = b.start; t < b.end; t = addDays(t, step)) out.push(t)
  return out
}

/** Index of the last start <= t */
function findBucket(starts: number[], t: number): number {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

function emptyBucket(t: number): Bucket {
  return {
    t,
    input: 0,
    output: 0,
    cacheWrite: 0,
    cacheRead: 0,
    tokens: 0,
    cost: 0,
    costInput: 0,
    costOutput: 0,
    costCacheWrite: 0,
    costCacheRead: 0
  }
}

function group(map: Map<string, GroupStat>, name: string, e: CostedEntry): void {
  let g = map.get(name)
  if (!g) map.set(name, (g = { name, tokens: 0, cost: 0, messages: 0 }))
  g.tokens += tokensOf(e)
  g.cost += e.cost.total
  g.messages++
}

const byCost = (a: GroupStat, b: GroupStat) => b.cost - a.cost || b.tokens - a.tokens

function topN(list: GroupStat[], n: number, otherName: string): GroupStat[] {
  if (list.length <= n) return list
  const rest = list.slice(n - 1).reduce(
    (acc, g) => ({ name: otherName, tokens: acc.tokens + g.tokens, cost: acc.cost + g.cost, messages: acc.messages + g.messages }),
    { name: otherName, tokens: 0, cost: 0, messages: 0 }
  )
  return [...list.slice(0, n - 1), rest]
}

export function computeSummary(
  entries: CostedEntry[],
  range: RangeKey,
  now: number,
  modelLabel: (model: string) => string
): RangeSummary {
  let firstTs: number | null = null
  for (const e of entries) if (firstTs === null || e.ts < firstTs) firstTs = e.ts
  const b = rangeBounds(range, now, firstTs)
  const starts = bucketStarts(b)
  const buckets = starts.map(emptyBucket)
  const cp: CostParts = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, webSearch: 0, total: 0, cacheSavings: 0 }
  const totals: TokenTotals = {
    input: 0,
    output: 0,
    cacheWrite: 0,
    cacheRead: 0,
    tokens: 0,
    cost: 0,
    costParts: cp,
    messages: 0,
    sessions: 0,
    webSearch: 0
  }
  const sessions = new Set<string>()
  const models = new Map<string, GroupStat>()
  const projects = new Map<string, GroupStat>()
  let prevTokens = 0
  let prevCost = 0

  for (const e of entries) {
    if (b.prev && e.ts >= b.prev[0] && e.ts < b.prev[1]) {
      prevTokens += tokensOf(e)
      prevCost += e.cost.total
    }
    if (e.ts < b.start || e.ts >= b.end) continue
    const tk = tokensOf(e)
    const cw = e.cacheWrite5m + e.cacheWrite1h
    totals.input += e.input
    totals.output += e.output
    totals.cacheWrite += cw
    totals.cacheRead += e.cacheRead
    totals.tokens += tk
    totals.messages++
    totals.webSearch += e.webSearch
    for (const k of Object.keys(cp) as (keyof CostParts)[]) cp[k] += e.cost[k]
    if (e.sessionId) sessions.add(e.sessionId)

    const bk = buckets[findBucket(starts, e.ts)]
    bk.input += e.input
    bk.output += e.output
    bk.cacheWrite += cw
    bk.cacheRead += e.cacheRead
    bk.tokens += tk
    bk.cost += e.cost.total
    bk.costInput += e.cost.input + e.cost.webSearch
    bk.costOutput += e.cost.output
    bk.costCacheWrite += e.cost.cacheWrite
    bk.costCacheRead += e.cost.cacheRead

    group(models, modelLabel(e.model), e)
    group(projects, e.project || '未知项目', e)
  }
  totals.cost = cp.total
  totals.sessions = sessions.size
  const promptTokens = totals.input + totals.cacheWrite + totals.cacheRead

  return {
    range,
    start: b.start,
    end: b.end,
    bucketUnit: b.unit,
    totals,
    previous: b.prev ? { tokens: prevTokens, cost: prevCost } : null,
    cacheHitRate: promptTokens ? totals.cacheRead / promptTokens : 0,
    buckets,
    byModel: [...models.values()].sort(byCost),
    byProject: topN([...projects.values()].sort(byCost), 8, '其他'),
    heatmap: range === 'all' ? computeHeatmap(entries, now) : null
  }
}

const RANGE_KEYS: RangeKey[] = ['today', '7d', '30d', 'month', 'all']

/** Totals for every range at once, plus how far back the data goes */
export function computeRanges(entries: CostedEntry[], now: number, archived: number): RangeOverview {
  let firstTs: number | null = null
  const days = new Set<string>()
  // empty rows (failed requests) don't count as coverage
  for (const e of entries) {
    if (tokensOf(e) <= 0) continue
    if (firstTs === null || e.ts < firstTs) firstTs = e.ts
    days.add(dayKey(e.ts))
  }
  const chips = RANGE_KEYS.map((range) => {
    const b = rangeBounds(range, now, firstTs)
    let tokens = 0
    let cost = 0
    for (const e of entries) {
      if (e.ts < b.start || e.ts >= b.end) continue
      tokens += tokensOf(e)
      cost += e.cost.total
    }
    return { range, start: b.start, end: b.end, tokens, cost }
  })
  return { chips, firstTs, activeDays: days.size, archived }
}

/** Daily cells for the last 53 weeks, Monday-aligned */
export function computeHeatmap(entries: CostedEntry[], now: number): HeatCell[] {
  const today = startOfDay(now)
  const start = startOfWeek(addDays(today, -52 * 7))
  const cells: HeatCell[] = []
  const index = new Map<string, HeatCell>()
  for (let t = start; t <= today; t = addDays(t, 1)) {
    const c = { date: dayKey(t), t, tokens: 0, cost: 0 }
    cells.push(c)
    index.set(c.date, c)
  }
  for (const e of entries) {
    if (e.ts < start) continue
    const c = index.get(dayKey(e.ts))
    if (!c) continue
    c.tokens += tokensOf(e)
    c.cost += e.cost.total
  }
  return cells
}

/** Assumed active hours per day when turning a daily average into a per-minute baseline */
const ACTIVE_HOURS = 6

/** Smallest 1/2/2.5/5 x 10^k that is >= x */
export function niceCeil(x: number): number {
  if (x <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(x))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= x - 1e-9) return m * p
  return 10 * p
}

export function computeLive(entries: CostedEntry[], now: number, dailyBudget: number | null): LiveStats {
  const today = startOfDay(now)
  const month = startOfMonth(now)
  const histStart = addDays(today, -30)
  const t10 = now - 10 * MIN
  const t60 = now - HOUR
  let tTokens = 0
  let tCost = 0
  let tMsgs = 0
  let monthCost = 0
  let tokens10 = 0
  let cost60 = 0
  let last: number | null = null
  const days = new Map<string, { tokens: number; cost: number }>()

  for (const e of entries) {
    const tk = tokensOf(e)
    if (last === null || e.ts > last) last = e.ts
    if (e.ts >= today) {
      tTokens += tk
      tCost += e.cost.total
      tMsgs++
    } else if (e.ts >= histStart) {
      const k = dayKey(e.ts)
      const d = days.get(k) ?? { tokens: 0, cost: 0 }
      d.tokens += tk
      d.cost += e.cost.total
      days.set(k, d)
    }
    if (e.ts >= month) monthCost += e.cost.total
    if (e.ts > t10 && e.ts <= now) tokens10 += tk
    if (e.ts > t60 && e.ts <= now) cost60 += e.cost.total
  }

  const active = [...days.values()]
  const dailyAvgCost = active.length ? active.reduce((s, d) => s + d.cost, 0) / active.length : 0
  const dailyAvgTokens = active.length ? active.reduce((s, d) => s + d.tokens, 0) / active.length : 0
  const tokensPerMin = tokens10 / 10
  const baseline = dailyAvgTokens > 0 ? dailyAvgTokens / (ACTIVE_HOURS * 60) : 50_000
  const r = tokensPerMin / baseline
  const intensity: Intensity = tokensPerMin === 0 || r < 0.2 ? 0 : r < 1 ? 1 : r < 3 ? 2 : 3
  const hoursLeft = (addDays(today, 1) - now) / HOUR

  return {
    now,
    today: { tokens: tTokens, cost: tCost, messages: tMsgs },
    monthCost,
    tokensPerMin,
    costPerHour: cost60,
    intensity,
    projectedTodayCost: tCost + cost60 * hoursLeft,
    // without a budget the tank scales to a round number above both a typical day and today
    capacity: dailyBudget && dailyBudget > 0 ? dailyBudget : niceCeil(Math.max(dailyAvgCost * 1.5, tCost * 1.1, 1)),
    capacityFromBudget: !!(dailyBudget && dailyBudget > 0),
    dailyAvgCost,
    lastEntryAt: last,
    totalEntries: entries.length
  }
}

export function computeSessions(
  entries: CostedEntry[],
  reported: Map<string, number>,
  modelLabel: (model: string) => string,
  limit = 500
): SessionRow[] {
  const map = new Map<string, SessionRow & { modelSet: Set<string> }>()
  for (const e of entries) {
    const id = e.sessionId || '(unknown)'
    let s = map.get(id)
    if (!s) {
      s = {
        sessionId: id,
        project: e.project,
        models: [],
        modelSet: new Set(),
        start: e.ts,
        end: e.ts,
        messages: 0,
        tokens: 0,
        cost: 0,
        reportedCost: reported.get(id) ?? null,
        context: 0,
        ...(e.source === 'codex' ? { source: 'codex' as const } : {})
      }
      map.set(id, s)
    }
    if (!e.side && e.ts >= s.end) s.context = e.input + e.cacheRead + e.cacheWrite5m + e.cacheWrite1h
    s.modelSet.add(modelLabel(e.model))
    s.start = Math.min(s.start, e.ts)
    s.end = Math.max(s.end, e.ts)
    s.messages++
    s.tokens += tokensOf(e)
    s.cost += e.cost.total
  }
  return [...map.values()]
    .sort((a, b) => b.end - a.end)
    .slice(0, limit)
    .map(({ modelSet, ...row }) => ({ ...row, models: [...modelSet] }))
}
