import { sunPosition, type Place } from '@shared/astro'
import type { RangeKey, UsagePatterns } from '@shared/types'
import { addDays, rangeBounds, startOfDay, tokensOf, type CostedEntry } from './aggregate'

const STEP = 10 * 60_000

/** whether the sun is up at `place`, judged every 10 minutes (works for any place, whatever this computer's time zone) */
function sunUp(place: Place): (t: number) => boolean {
  const cache = new Map<number, boolean>()
  return (t) => {
    const k = Math.floor(t / STEP)
    let v = cache.get(k)
    if (v === undefined) cache.set(k, (v = sunPosition(k * STEP + STEP / 2, place).alt > -0.833))
    return v
  }
}

/** hour-of-day, weekday × hour and project → model flows (top 5 projects, top 4 models, the rest merged) */
export function computePatterns(entries: CostedEntry[], range: RangeKey, now: number, label: (model: string) => string): UsagePatterns {
  let first = Infinity
  for (const e of entries) if (e.ts < first) first = e.ts
  const b = rangeBounds(range, now, Number.isFinite(first) ? first : null)
  const hours = new Array(24).fill(0)
  const week = Array.from({ length: 7 }, () => new Array(24).fill(0))
  const from30 = addDays(startOfDay(now), -29)
  const pair = new Map<string, { project: string; model: string; cost: number; tokens: number }>()
  const byProject = new Map<string, number>()
  const byModel = new Map<string, number>()
  let allTokens = 0
  let recent = 0
  const active = new Set<number>()
  // the last 120 days, one ring each
  const ringFrom = addDays(startOfDay(now), -119)
  const rings = new Map<number, { t: number; tokens: number; cost: number; codex: number }>()
  for (let i = 0; i < 120; i++) {
    const t = addDays(ringFrom, i)
    rings.set(t, { t, tokens: 0, cost: 0, codex: 0 })
  }
  for (const e of entries) {
    const tok = tokensOf(e)
    allTokens += tok
    const d = new Date(e.ts)
    if (e.ts >= ringFrom && e.ts <= now) {
      const r = rings.get(startOfDay(e.ts))
      if (r) {
        r.tokens += tok
        r.cost += e.cost.total
        if (e.source === 'codex') r.codex += tok
      }
    }
    if (e.ts >= from30 && e.ts <= now) {
      week[(d.getDay() + 6) % 7][d.getHours()] += tok
      recent += tok
      if (tok > 0) active.add(startOfDay(e.ts))
    }
    if (e.ts < b.start || e.ts >= b.end) continue
    hours[d.getHours()] += tok
    const model = label(e.model)
    const key = `${e.project}\u0000${model}`
    let p = pair.get(key)
    if (!p) pair.set(key, (p = { project: e.project, model, cost: 0, tokens: 0 }))
    p.cost += e.cost.total
    p.tokens += tok
    byProject.set(e.project, (byProject.get(e.project) ?? 0) + e.cost.total)
    byModel.set(model, (byModel.get(model) ?? 0) + e.cost.total)
  }
  const top = (m: Map<string, number>, n: number) =>
    new Set(
      [...m]
        .sort((x, y) => y[1] - x[1])
        .slice(0, n)
        .map(([k]) => k)
    )
  const projects = top(byProject, 5)
  const models = top(byModel, 4)
  const merged = new Map<string, { project: string; model: string; cost: number; tokens: number }>()
  for (const p of pair.values()) {
    const project = projects.has(p.project) ? p.project : '其他项目'
    const model = models.has(p.model) ? p.model : '其他模型'
    const key = `${project}\u0000${model}`
    const m = merged.get(key) ?? { project, model, cost: 0, tokens: 0 }
    m.cost += p.cost
    m.tokens += p.tokens
    merged.set(key, m)
  }
  const flows = [...merged.values()].filter((f) => f.cost > 0 || f.tokens > 0).sort((x, y) => y.cost - x.cost || y.tokens - x.tokens)
  return { range, hours, week, flows, allTokens, dailyAvg: active.size ? recent / active.size : 0, days: [...rings.values()] }
}

/**
 * The sunrise or sunset that began the part of the day t falls in, as a stable id: the last 10-minute mark
 * before the sun crossed the horizon ("<mark>:day" / "<mark>:night"). Polar days and nights use the date.
 */
export function dayNightPhase(t: number, place: Place): { id: string; day: boolean } {
  const isUp = sunUp(place)
  const day = isUp(t)
  let k = Math.floor(t / STEP) * STEP
  for (let i = 0; i < 144; i++, k -= STEP) {
    if (isUp(k - STEP) !== day) return { id: `${Math.round(k / 60_000)}:${day ? 'day' : 'night'}`, day }
  }
  return { id: `${startOfDay(t)}:${day ? 'day' : 'night'}`, day }
}
