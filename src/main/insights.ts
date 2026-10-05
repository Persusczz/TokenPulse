import type { SourceView, ValueReport, WeeklyForecast } from '@shared/types'
import { addDays, startOfDay, startOfMonth, tokensOf, type CostedEntry } from './aggregate'
import { lowerBound } from './rate'

const DAY = 24 * 3600_000

/** Monthly list prices (USD) by plan label */
export const PLAN_PRICES: Record<string, number> = {
  Pro: 20,
  'Max 5x': 100,
  'Max 20x': 200,
  Max: 100,
  Team: 30,
  Enterprise: 60,
  Free: 0,
  // ChatGPT plans, as Codex reports them (plan_type)
  'ChatGPT Go': 8,
  'ChatGPT Plus': 20,
  'ChatGPT Pro': 200,
  'ChatGPT Team': 30,
  'ChatGPT Business': 30,
  'ChatGPT Enterprise': 60,
  'ChatGPT Edu': 0,
  'ChatGPT Free': 0
}

/** "plus" -> "ChatGPT Plus" */
export function chatgptPlan(planType: string | null | undefined): string | null {
  if (!planType) return null
  return `ChatGPT ${planType.charAt(0).toUpperCase()}${planType.slice(1).toLowerCase()}`
}

/**
 * The subscription measured against what the same usage would cost on the
 * API: how many times over it has paid for itself this month, where the month
 * is heading, and whether another plan would fit better given how often the
 * 5h window ran full.
 */
export function computeValue(
  entries: CostedEntry[],
  now: number,
  o: { plan: string | null; priceSetting: number | null; quotaHits: number; money: (usd: number) => string; source?: SourceView }
): ValueReport {
  const month = startOfMonth(now)
  const d = new Date(month)
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  const today = startOfDay(now)
  const daily: { t: number; cost: number }[] = []
  let monthCost = 0
  let i = lowerBound(entries, month)
  for (let t = month; t <= today; t = addDays(t, 1)) {
    const end = addDays(t, 1)
    for (; i < entries.length && entries[i].ts < end && entries[i].ts <= now; i++) monthCost += entries[i].cost.total
    daily.push({ t, cost: monthCost })
  }
  // a fraction of a day this early in the month would make wild projections
  const elapsed = Math.max(1, (now - month) / DAY)
  const projected = (monthCost / elapsed) * daysInMonth
  // "Max 5x + ChatGPT Plus" when both are on view
  const detected = o.plan ? o.plan.split(' + ').reduce<number | undefined>((s, p) => (PLAN_PRICES[p] === undefined ? s : (s ?? 0) + PLAN_PRICES[p]), undefined) : undefined
  const price = o.priceSetting ?? detected ?? 20
  const m = o.money
  const hits = o.quotaHits
  const base = {
    source: o.source ?? 'claude',
    plan: o.plan,
    planPrice: price,
    priceDetected: o.priceSetting === null,
    monthCost,
    projectedMonthCost: projected,
    multiple: price > 0 ? monthCost / price : 0,
    projectedMultiple: price > 0 ? projected / price : 0,
    dayOfMonth: new Date(now).getDate(),
    daysInMonth,
    quotaHits: hits,
    daily
  }
  if (price <= 0) return { ...base, verdict: 'unknown', advice: '当前计划没有月费，无法计算回本' }

  const paid = monthCost >= price
  const keepText = paid ? `本月已回本 ${(monthCost / price).toFixed(1)} 倍` : `再用 ${m(price - monthCost)} 等价费用即可回本`
  const plan = o.plan ?? ''
  if (plan.includes(' + ')) return { ...base, verdict: 'keep', advice: `${keepText}（两份订阅合计 ${m(price)}/月）` }
  if (plan === 'ChatGPT Pro') {
    if (projected < 60 && hits === 0) return { ...base, verdict: 'downgrade', advice: `本月 Codex 预计只折合 ${m(projected)}，也没触过额度上限，ChatGPT Plus（$20/月）可能就够了` }
    return { ...base, verdict: 'keep', advice: keepText }
  }
  if (plan.startsWith('ChatGPT')) {
    if (hits >= 3 && projected >= 200) {
      return { ...base, verdict: 'upgrade', advice: `本月 Codex 已 ${hits} 次用到 5h 额度 90%，折合 ${m(projected)}，ChatGPT Pro（$200/月）的额度更宽裕` }
    }
    if (hits >= 3) return { ...base, verdict: 'keep', advice: `${keepText}；本月 Codex 已 ${hits} 次触到额度上限，可以错开高峰使用` }
    return { ...base, verdict: 'keep', advice: keepText }
  }
  if (plan === 'Max 20x') {
    if (projected < 100 && hits === 0) return { ...base, verdict: 'downgrade', advice: `本月预计折合 ${m(projected)}，也没触过额度上限，Max 5x（$100/月）可能就够了` }
    return { ...base, verdict: 'keep', advice: keepText }
  }
  if (plan.startsWith('Max')) {
    if (hits >= 3 && projected >= 200) {
      return { ...base, verdict: 'upgrade', advice: `本月已 ${hits} 次用到 5h 额度 90%，折合 ${m(projected)}，可以考虑 Max 20x（$200/月）` }
    }
    if (projected < 40 && hits === 0) return { ...base, verdict: 'downgrade', advice: `本月预计只折合 ${m(projected)}，Pro（$20/月）可能就够用` }
    return { ...base, verdict: 'keep', advice: keepText }
  }
  // Pro and anything else priced like it
  if (hits >= 3 && projected >= 100) {
    return { ...base, verdict: 'upgrade', advice: `本月已 ${hits} 次用到 5h 额度 90%，按量折合 ${m(projected)}，升级 Max 5x（$100/月）能少很多等待` }
  }
  if (hits >= 3) return { ...base, verdict: 'keep', advice: `${keepText}；本月已 ${hits} 次触到额度上限，可以错开高峰使用` }
  return { ...base, verdict: 'keep', advice: keepText }
}

/**
 * Projects the 7-day window to its reset. The pace blends the average since
 * the window opened with the last 24 h (local logs, converted to percent via
 * tokens per percent seen so far).
 */
export function forecastWeekly(entries: CostedEntry[], w: { pct: number; resetsAt: number | null } | null, now: number): WeeklyForecast {
  const empty: WeeklyForecast = {
    available: false,
    usedPct: 0,
    resetsAt: null,
    windowStart: null,
    daysLeft: 0,
    avgPctPerDay: 0,
    recentPctPerDay: null,
    projectedPct: 0,
    etaFull: null,
    suggestPctPerDay: 0,
    tokensPerPct: null,
    suggestTokensPerDay: null,
    days: []
  }
  if (!w || !w.resetsAt || w.resetsAt <= now) return empty
  const start = w.resetsAt - 7 * DAY
  const u = w.pct
  const elapsedDays = Math.max(0.05, (now - start) / DAY)
  const daysLeft = (w.resetsAt - now) / DAY
  const avg = u / elapsedDays

  let tokensSince = 0
  let tokens24 = 0
  const perDay: number[] = []
  for (let i = lowerBound(entries, start); i < entries.length && entries[i].ts <= now; i++) {
    const tk = tokensOf(entries[i])
    tokensSince += tk
    if (entries[i].ts > now - DAY) tokens24 += tk
    const k = Math.floor((entries[i].ts - start) / DAY)
    perDay[k] = (perDay[k] ?? 0) + tk
  }
  const tokensPerPct = u >= 1 && tokensSince > 0 ? tokensSince / u : null
  const recent = tokensPerPct ? tokens24 / tokensPerPct : null
  const pace = recent !== null ? (avg + recent) / 2 : avg
  const projected = u + pace * daysLeft
  const etaFull = pace > 0 && projected > 100 ? now + ((100 - u) / pace) * DAY : null
  const suggest = Math.max(0, (95 - u) / Math.max(daysLeft, 0.1))

  const days: { t: number; pct: number }[] = [{ t: start, pct: 0 }]
  if (tokensPerPct) {
    let acc = 0
    for (let k = 0; start + (k + 1) * DAY <= now; k++) {
      acc += (perDay[k] ?? 0) / tokensPerPct
      days.push({ t: start + (k + 1) * DAY, pct: acc })
    }
  }
  days.push({ t: now, pct: u })

  return {
    available: true,
    usedPct: u,
    resetsAt: w.resetsAt,
    windowStart: start,
    daysLeft,
    avgPctPerDay: avg,
    recentPctPerDay: recent,
    projectedPct: projected,
    etaFull,
    suggestPctPerDay: suggest,
    tokensPerPct,
    suggestTokensPerDay: tokensPerPct ? suggest * tokensPerPct : null,
    days
  }
}
