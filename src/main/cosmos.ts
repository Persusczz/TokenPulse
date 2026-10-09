import type { CosmicCalendar, Meteor, Pace, ProjectPlanet, PromptCost, QuotaStar, Remnant, RemnantKind, SessionStar, SpectralClass, StarStage, StellarType, UsageSource, WindowRecord } from '@shared/types'
import { STAGES, stageOf } from '@shared/stages'
import { addDays, startOfDay, tokensOf, type CostedEntry } from './aggregate'

/**
 * Quota and sessions as celestial bodies: a 5-hour window is a star's life
 * (nebula → … → supernova), the 7-day window an orbit, each closed window
 * leaves a remnant (white dwarf, neutron star, planetary nebula, black hole),
 * sessions are stars on a Hertzsprung–Russell diagram, and the last 30 days
 * make you one kind of star.
 */

const MIN = 60_000
const HOUR = 60 * MIN

// the stages live in shared code: the overview shows them too
export { STAGES, stageOf }

export const REMNANTS: Record<RemnantKind, { name: string; desc: string }> = {
  dwarf: { name: '白矮星', desc: '峰值不到 50%：安静地燃尽，留下一颗白矮星' },
  neutron: { name: '中子星', desc: '峰值 50–90%：一颗高速自转的中子星' },
  nebula: { name: '行星状星云', desc: '峰值 90% 以上但没触顶：抛出一圈发光的外壳' },
  blackhole: { name: '黑洞', desc: '额度用到了 100%：坍缩成一个黑洞' }
}

export function remnantOf(peak: number, hit: boolean): RemnantKind {
  if (hit || peak >= 100) return 'blackhole'
  if (peak >= 90) return 'nebula'
  if (peak >= 50) return 'neutron'
  return 'dwarf'
}

/** the 5-hour window of a tool as a star, with its 7-day window as the orbit around it */
export function quotaStar(five: Pace, week: Pace | null, now: number): QuotaStar {
  const pct = Math.max(0, five.pct)
  const stage = stageOf(pct)
  // when each later stage arrives at the recent pace, if before the reset
  const next = STAGES.filter((s) => s.from > pct).map((s) => {
    const hours = five.pctPerHour > 0.05 ? (s.from - pct) / five.pctPerHour : Infinity
    const at = now + hours * HOUR
    return { stage: s.key, name: s.name, at: Number.isFinite(at) && at < five.end ? Math.round(at) : null }
  })
  const projected = Math.min(100, five.projected)
  return {
    key: five.key,
    source: five.source,
    label: five.label,
    pct,
    stage,
    start: five.start,
    end: five.end,
    pctPerHour: five.pctPerHour,
    projected: five.projected,
    next,
    fate: remnantOf(projected, five.projected >= 100),
    week: week ? { pct: week.pct, start: week.start, end: week.end, ideal: week.ideal, projected: week.projected } : null
  }
}

/** closed windows (and their tokens) as remnants, newest last */
export function remnants(windows: WindowRecord[], entries: { claude: CostedEntry[]; codex: CostedEntry[] }, now: number): Remnant[] {
  return windows
    .filter((w) => w.end <= now && w.peak > 0)
    .map((w) => {
      const list = w.source === 'codex' ? entries.codex : entries.claude
      let tokens = 0
      let cost = 0
      for (let i = lowerBound(list, w.start); i < list.length && list[i].ts < w.end; i++) {
        tokens += tokensOf(list[i])
        cost += list[i].cost.total
      }
      const hit = !!w.hitAt || w.peak >= 100
      return { source: w.source, start: w.start, end: w.end, peak: w.peak, hitAt: w.hitAt, kind: remnantOf(w.peak, hit), tokens, cost, estimated: w.estimated }
    })
    .sort((a, b) => a.start - b.start)
}

function lowerBound(list: CostedEntry[], t: number): number {
  let lo = 0
  let hi = list.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (list[mid].ts < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

// ---------------------------------------------------------------- sessions as stars

/** spectral class by burn rate: tokens per active minute */
const CLASS_RATE: [SpectralClass, number][] = [
  ['O', 3_000_000],
  ['B', 1_500_000],
  ['A', 800_000],
  ['F', 400_000],
  ['G', 200_000],
  ['K', 80_000],
  ['M', 0]
]
export const classOf = (rate: number): SpectralClass => CLASS_RATE.find(([, min]) => rate >= min)![0]

/**
 * Sessions of the last `days` as stars: luminosity = tokens, temperature =
 * tokens per active minute (gaps over 30 minutes don't count), the biggest `limit`.
 */
export function sessionStars(entries: CostedEntry[], now: number, days = 30, limit = 300, label: (m: string) => string = (m) => m): SessionStar[] {
  const from = now - days * 24 * HOUR
  const by = new Map<string, { id: string; project: string; source: UsageSource; model: string; tokens: number; cost: number; start: number; end: number; active: number; last: number }>()
  for (const e of entries) {
    if (e.ts < from || e.ts > now || !e.sessionId) continue
    const tok = tokensOf(e)
    if (!tok) continue
    let s = by.get(e.sessionId)
    if (!s) by.set(e.sessionId, (s = { id: e.sessionId, project: e.project, source: e.source ?? 'claude', model: e.model, tokens: 0, cost: 0, start: e.ts, end: e.ts, active: 0, last: e.ts }))
    const gap = e.ts - s.last
    if (gap > 0 && gap <= 30 * MIN) s.active += gap
    s.last = e.ts
    s.end = Math.max(s.end, e.ts)
    s.tokens += tok
    s.cost += e.cost.total
    if (!e.side) s.model = e.model
  }
  const all = [...by.values()].filter((s) => s.tokens > 0)
  all.sort((a, b) => b.tokens - a.tokens)
  return all.slice(0, limit).map((s) => {
    const minutes = Math.max(1, s.active / MIN)
    const rate = s.tokens / minutes
    const cls = classOf(rate)
    // giants: long and big; white dwarfs: tiny, short and hot; the rest on the main sequence
    const branch = minutes >= 120 && s.tokens >= 20_000_000 ? 'giant' : minutes <= 10 && s.tokens < 2_000_000 && rate >= 200_000 ? 'dwarf' : 'main'
    return { id: s.id, project: s.project, source: s.source, model: label(s.model), tokens: s.tokens, cost: s.cost, minutes: Math.round(minutes), rate: Math.round(rate), cls, branch, start: s.start, end: s.end }
  })
}

// ---------------------------------------------------------------- you as a star

const SPECTRAL: Record<SpectralClass, { name: string; color: string; temp: number }> = {
  O: { name: 'O 型蓝超巨星', color: '#9db4ff', temp: 40000 },
  B: { name: 'B 型蓝巨星', color: '#aabfff', temp: 20000 },
  A: { name: 'A 型白星', color: '#cad7ff', temp: 9000 },
  F: { name: 'F 型黄白星', color: '#f8f7ff', temp: 7000 },
  G: { name: 'G 型黄矮星', color: '#fff4ea', temp: 5800 },
  K: { name: 'K 型橙矮星', color: '#ffd2a1', temp: 4500 },
  M: { name: 'M 型红矮星', color: '#ffad6b', temp: 3200 }
}
export const spectralColor = (c: SpectralClass) => SPECTRAL[c].color

/** spectral class of a whole user by tokens per active day */
const MASS: [SpectralClass, number][] = [
  ['O', 200_000_000],
  ['B', 60_000_000],
  ['A', 25_000_000],
  ['F', 10_000_000],
  ['G', 3_000_000],
  ['K', 800_000],
  ['M', 0]
]

/**
 * The last 30 days as one star. Special kinds come first (black hole for
 * windows run dry again and again, white dwarf for a heavy past gone quiet,
 * binary for two tools, neutron star for few dense sessions, flare star for
 * spikes, pulsar for clockwork hours); otherwise the spectral class follows
 * the tokens of an average active day.
 */
export function stellarType(entries: CostedEntry[], windows: Remnant[], now: number): StellarType {
  const from = addDays(startOfDay(now), -29)
  const day = new Map<number, number>()
  const startHour = new Map<number, number>()
  const sessions = new Set<string>()
  let claude = 0
  let codex = 0
  for (const e of entries) {
    if (e.ts < from || e.ts > now) continue
    const tok = tokensOf(e)
    if (!tok) continue
    const d = startOfDay(e.ts)
    day.set(d, (day.get(d) ?? 0) + tok)
    if (!startHour.has(d)) startHour.set(d, new Date(e.ts).getHours())
    if (e.sessionId) sessions.add(e.sessionId)
    if (e.source === 'codex') codex += tok
    else if ((e.source ?? 'claude') === 'claude') claude += tok
  }
  const vals = [...day.values()]
  const total = claude + codex
  const avg = vals.length ? total / vals.length : 0
  const sorted = [...vals].sort((a, b) => a - b)
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0
  const peak = sorted[sorted.length - 1] ?? 0
  const last7 = [...day].filter(([d]) => d >= addDays(startOfDay(now), -6)).reduce((a, [, v]) => a + v, 0)
  const before = total - last7
  const beforeDays = [...day.keys()].filter((d) => d < addDays(startOfDay(now), -6)).length
  const hits = windows.filter((w) => w.kind === 'blackhole' && w.start >= from).length
  // the most common starting hour (±1) across active days
  const hours = [...startHour.values()]
  const steady = hours.length ? Math.max(...Array.from({ length: 24 }, (_, h) => hours.filter((x) => Math.abs(x - h) <= 1 || Math.abs(x - h) >= 23).length)) / hours.length : 0
  const perSession = sessions.size ? total / sessions.size : 0
  const base = MASS.find(([, min]) => avg >= min)![0]
  const fmt = (n: number) => (n >= 1e8 ? `${(n / 1e8).toFixed(1)} 亿` : n >= 1e4 ? `${Math.round(n / 1e4)} 万` : `${Math.round(n)}`)
  const traits = [`活跃 ${vals.length} 天，平均每天 ${fmt(avg)} Token`, `最多的一天 ${fmt(peak)}`, `${sessions.size} 个会话`]
  if (hits) traits.push(`${hits} 个 5 小时窗口用到了 100%`)
  if (codex > 0 && claude > 0) traits.push(`Claude ${Math.round((claude / total) * 100)}% · Codex ${Math.round((codex / total) * 100)}%`)
  const mk = (kind: StellarType['kind'], name: string, code: string, color: string, desc: string): StellarType => ({ kind, name, code, cls: base, color, desc, traits, days: vals.length })
  if (!vals.length) return mk('dust', '星际尘埃', '—', '#8a8a9e', '最近 30 天还没有用量，还是一团星际尘埃')
  if (hits >= 5) return mk('blackhole', '黑洞', 'BH', '#ff9a5a', `30 天里 ${hits} 次把 5 小时额度吃到 100%：引力大到连光都逃不掉`)
  if (beforeDays >= 7 && before / beforeDays > 3 * (last7 / 7 + 1) && avg >= 3_000_000) return mk('white-dwarf', '白矮星', 'DA', '#e8eeff', '曾经燃烧得很猛，这一周安静下来了：一颗慢慢冷却的白矮星')
  if (codex > 0 && claude > 0 && Math.min(claude, codex) / total >= 0.25) return mk('binary', '双星', `${base}+${base}`, '#c9b8ff', 'Claude 和 Codex 互相绕着转：一对双星，你同时驾驭两颗')
  if (sessions.size >= 3 && sessions.size <= 12 && perSession >= 40_000_000) return mk('neutron', '中子星', 'NS', '#9ee7ff', `只有 ${sessions.size} 个会话，却每个平均 ${fmt(perSession)}：极度致密`)
  if (vals.length >= 5 && median > 0 && peak >= 6 * median) return mk('flare', '耀星', `${base}Ve`, '#ff8a6b', `平时温和，偶尔一天爆发到中位数的 ${Math.round(peak / median)} 倍：会突然闪耀的耀星`)
  if (vals.length >= 10 && steady >= 0.7) return mk('pulsar', '脉冲星', 'PSR', '#7fd6ff', `${Math.round(steady * 100)}% 的日子在同一个钟点开工：像脉冲星一样准时`)
  const s = SPECTRAL[base]
  const desc: Record<SpectralClass, string> = {
    O: '质量巨大、炽热耀眼，燃烧极快：每天的用量以亿计',
    B: '明亮的蓝巨星，用量远超一般人',
    A: '明亮的白色恒星，用得很勤',
    F: '比太阳略热一些，稳定而活跃',
    G: '和太阳同一类：稳定、适中，可以燃烧很久',
    K: '温和的橙矮星，用得不多但很长久',
    M: '小而冷的红矮星：用量很少，寿命却是所有恒星里最长的'
  }
  return mk('star', s.name, `${base}${base === 'O' || base === 'B' ? 'I' : 'V'}`, s.color, desc[base])
}

// ---------------------------------------------------------------- projects as planets

/** the projects of the last `days` as planets: size by tokens, orbit by how recently they were active */
export function projectPlanets(entries: CostedEntry[], now: number, days = 30, label: (m: string) => string = (m) => m, limit = 12): ProjectPlanet[] {
  const from = now - days * 24 * HOUR
  const by = new Map<string, { project: string; tokens: number; cost: number; sessions: Set<string>; days: Set<number>; last: number; codex: number; workbuddy: number; models: Map<string, number> }>()
  for (const e of entries) {
    if (e.ts < from || e.ts > now) continue
    const tok = tokensOf(e)
    if (!tok) continue
    let p = by.get(e.project)
    if (!p) by.set(e.project, (p = { project: e.project, tokens: 0, cost: 0, sessions: new Set(), days: new Set(), last: 0, codex: 0, workbuddy: 0, models: new Map() }))
    p.tokens += tok
    p.cost += e.cost.total
    if (e.sessionId) p.sessions.add(e.sessionId)
    p.days.add(startOfDay(e.ts))
    p.last = Math.max(p.last, e.ts)
    if (e.source === 'codex') p.codex += tok
    if (e.source === 'workbuddy') p.workbuddy += tok
    const m = label(e.model)
    p.models.set(m, (p.models.get(m) ?? 0) + tok)
  }
  const list = [...by.values()].sort((a, b) => b.tokens - a.tokens).slice(0, limit)
  const total = list.reduce((a, p) => a + p.tokens, 0) || 1
  return list.map((p) => ({
    project: p.project,
    tokens: p.tokens,
    cost: p.cost,
    share: p.tokens / total,
    sessions: p.sessions.size,
    activeDays: p.days.size,
    last: p.last,
    source: p.workbuddy > Math.max(p.codex, p.tokens - p.codex - p.workbuddy) ? 'workbuddy' : p.codex > p.tokens - p.codex - p.workbuddy ? 'codex' : 'claude',
    model: [...p.models].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
  }))
}

// ---------------------------------------------------------------- prompts as meteors

/** today's prompts, in order: each one a meteor whose brightness is its cost */
export function meteors(list: PromptCost[]): Meteor[] {
  return list
    .map((p) => ({ ts: p.ts, cost: p.cost, tokens: p.tokens, text: p.text.replace(/\s+/g, ' ').slice(0, 60), sessionId: p.sessionId, project: p.project, source: p.source, durationMs: p.durationMs }))
    .sort((a, b) => a.ts - b.ts)
    .slice(-400)
}

/** the busiest hour of meteors: prompts in the densest 60 minutes */
export function zhr(list: { ts: number }[]): { rate: number; at: number | null } {
  const ts = list.map((m) => m.ts).sort((a, b) => a - b)
  let best = 0
  let at: number | null = null
  for (let i = 0, j = 0; i < ts.length; i++) {
    while (ts[i] - ts[j] > HOUR) j++
    if (i - j + 1 > best) {
      best = i - j + 1
      at = ts[j]
    }
  }
  return { rate: best, at }
}

// ---------------------------------------------------------------- the cosmic calendar

/**
 * The whole history squeezed into one year, as in Sagan's cosmic calendar:
 * the first token is the Big Bang on 1 January, now is midnight on 31
 * December, and the notable moments fall where they fall.
 */
export function cosmicCalendar(entries: CostedEntry[], unlocked: { title: string; icon: string; at: number | null; tier: number }[], now: number): CosmicCalendar {
  let start = Infinity
  let firstCodex = Infinity
  const day = new Map<number, number>()
  for (const e of entries) {
    const tok = tokensOf(e)
    if (!tok) continue
    if (e.ts < start) start = e.ts
    if (e.source === 'codex' && e.ts < firstCodex) firstCodex = e.ts
    const d = startOfDay(e.ts)
    day.set(d, (day.get(d) ?? 0) + tok)
  }
  if (!Number.isFinite(start)) return { start: now, end: now, events: [] }
  const events: CosmicCalendar['events'] = [{ ts: start, title: '大爆炸：第一个 Token', icon: '✺', kind: 'origin' }]
  if (Number.isFinite(firstCodex) && firstCodex > start) events.push({ ts: firstCodex, title: '第二颗恒星点亮：第一次用 Codex', icon: '✦', kind: 'origin' })
  const peak = [...day].sort((a, b) => b[1] - a[1])[0]
  if (peak) events.push({ ts: peak[0] + 12 * HOUR, title: `最亮的一天（${Math.round(peak[1] / 1e6)}M Token）`, icon: '☀', kind: 'record' })
  for (const a of unlocked) if (a.at && a.tier >= 2) events.push({ ts: a.at, title: a.title, icon: a.icon, kind: 'ach' })
  events.sort((a, b) => a.ts - b.ts)
  // keep the story readable: origins and the record, plus the highest tiers spread over the year
  const keep = events.filter((e) => e.kind !== 'ach')
  const ach = events.filter((e) => e.kind === 'ach')
  const room = Math.max(0, 14 - keep.length)
  const step = ach.length > room ? ach.length / room : 1
  for (let i = 0; i < Math.min(room, ach.length); i++) keep.push(ach[Math.floor(i * step)])
  return { start, end: now, events: keep.sort((a, b) => a.ts - b.ts) }
}
