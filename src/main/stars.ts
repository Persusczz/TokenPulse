import type { CodingSign, StarFigure, ZodiacInfo } from '@shared/types'
import { tokensOf, type CostedEntry } from './aggregate'
import { contextOf } from './context'

/**
 * Constellations, for fun: today's zodiac sign lights up star by star as the
 * day's usage grows toward your usual day, and a "coding constellation" is
 * read from the last 30 days of habits (night owl, marathons, thrift …).
 */

type Fig = [points: [number, number][], lines: [number, number][]]

/** the twelve signs, their dates (month, day they start) and a simplified figure (0–1) */
const ZODIAC: { key: string; name: string; symbol: string; from: [number, number]; fig: Fig }[] = [
  { key: 'capricorn', name: '摩羯座', symbol: '♑', from: [12, 22], fig: [[[0.1, 0.3], [0.3, 0.36], [0.55, 0.3], [0.86, 0.24], [0.76, 0.56], [0.5, 0.76], [0.3, 0.6]], [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 0]]] },
  { key: 'aquarius', name: '水瓶座', symbol: '♒', from: [1, 20], fig: [[[0.08, 0.25], [0.28, 0.3], [0.44, 0.2], [0.55, 0.42], [0.5, 0.62], [0.66, 0.76], [0.8, 0.64], [0.92, 0.86]], [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7]]] },
  { key: 'pisces', name: '双鱼座', symbol: '♓', from: [2, 19], fig: [[[0.1, 0.22], [0.25, 0.36], [0.4, 0.52], [0.55, 0.72], [0.7, 0.56], [0.84, 0.46], [0.94, 0.52], [0.9, 0.34], [0.05, 0.1], [0.17, 0.08]], [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 5], [0, 8], [8, 9], [9, 0]]] },
  { key: 'aries', name: '白羊座', symbol: '♈', from: [3, 21], fig: [[[0.1, 0.62], [0.42, 0.46], [0.68, 0.42], [0.86, 0.56]], [[0, 1], [1, 2], [2, 3]]] },
  { key: 'taurus', name: '金牛座', symbol: '♉', from: [4, 20], fig: [[[0.5, 0.56], [0.4, 0.46], [0.3, 0.36], [0.1, 0.2], [0.6, 0.46], [0.7, 0.36], [0.9, 0.24], [0.55, 0.74]], [[0, 1], [1, 2], [2, 3], [0, 4], [4, 5], [5, 6], [0, 7]]] },
  { key: 'gemini', name: '双子座', symbol: '♊', from: [5, 21], fig: [[[0.22, 0.14], [0.26, 0.46], [0.3, 0.82], [0.58, 0.1], [0.62, 0.46], [0.66, 0.82], [0.14, 0.86], [0.78, 0.9]], [[0, 1], [1, 2], [2, 6], [3, 4], [4, 5], [5, 7], [0, 3], [1, 4]]] },
  { key: 'cancer', name: '巨蟹座', symbol: '♋', from: [6, 22], fig: [[[0.5, 0.52], [0.46, 0.18], [0.2, 0.78], [0.8, 0.8], [0.5, 0.36]], [[0, 4], [4, 1], [0, 2], [0, 3]]] },
  { key: 'leo', name: '狮子座', symbol: '♌', from: [7, 23], fig: [[[0.16, 0.56], [0.3, 0.46], [0.3, 0.3], [0.2, 0.18], [0.38, 0.1], [0.56, 0.56], [0.86, 0.5], [0.8, 0.72]], [[0, 1], [1, 2], [2, 3], [3, 4], [1, 5], [5, 6], [6, 7], [7, 5]]] },
  { key: 'virgo', name: '处女座', symbol: '♍', from: [8, 23], fig: [[[0.08, 0.3], [0.28, 0.36], [0.44, 0.5], [0.6, 0.46], [0.76, 0.62], [0.92, 0.56], [0.5, 0.78], [0.38, 0.18]], [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [2, 6], [1, 7]]] },
  { key: 'libra', name: '天秤座', symbol: '♎', from: [9, 23], fig: [[[0.5, 0.14], [0.24, 0.46], [0.76, 0.46], [0.2, 0.82], [0.8, 0.78]], [[0, 1], [0, 2], [1, 2], [1, 3], [2, 4]]] },
  { key: 'scorpio', name: '天蝎座', symbol: '♏', from: [10, 24], fig: [[[0.1, 0.2], [0.2, 0.3], [0.32, 0.38], [0.42, 0.5], [0.48, 0.66], [0.58, 0.8], [0.72, 0.84], [0.85, 0.74], [0.88, 0.58], [0.06, 0.36], [0.12, 0.06]], [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [1, 9], [0, 10]]] },
  { key: 'sagittarius', name: '射手座', symbol: '♐', from: [11, 23], fig: [[[0.2, 0.5], [0.35, 0.34], [0.5, 0.3], [0.66, 0.4], [0.7, 0.6], [0.46, 0.66], [0.26, 0.7], [0.86, 0.28]], [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 0], [1, 5], [3, 7]]] }
]

const fig = (f: Fig): StarFigure => ({ points: f[0], lines: f[1] })

/** The sun sign of a date */
export function zodiacOf(t: number): (typeof ZODIAC)[number] {
  const d = new Date(t)
  const md = (d.getMonth() + 1) * 100 + d.getDate()
  // Capricorn spans the new year
  if (md >= 1222 || md < 120) return ZODIAC[0]
  let pick = ZODIAC[1]
  for (const z of ZODIAC.slice(1)) if (md >= z.from[0] * 100 + z.from[1]) pick = z
  return pick
}

const DAY = 86_400_000

/** Today's sign, with as many stars lit as today's usage reaches of an ordinary (active) day */
export function zodiacToday(entries: CostedEntry[], now: number): ZodiacInfo {
  const z = zodiacOf(now)
  const start = new Date(now).setHours(0, 0, 0, 0)
  let today = 0
  const days = new Map<number, number>()
  for (const e of entries) {
    if (e.ts >= start) today += tokensOf(e)
    else if (e.ts >= start - 30 * DAY) {
      const k = Math.floor((e.ts - start) / DAY)
      days.set(k, (days.get(k) ?? 0) + tokensOf(e))
    }
  }
  const avg = days.size ? [...days.values()].reduce((a, b) => a + b, 0) / days.size : 0
  const stars = z.fig[0].length
  const lit = today <= 0 ? 0 : avg > 0 ? Math.max(1, Math.min(stars, Math.floor((today / avg) * stars))) : stars
  return { key: z.key, name: z.name, symbol: z.symbol, stars, lit, today, average: avg, ...fig(z.fig) }
}

/** the coding constellations and the figures they draw */
const SIGNS: Record<string, { name: string; symbol: string; desc: string; fig: Fig }> = {
  night: { name: '夜航座', symbol: '🌙', desc: '你在夜深人静时最专注，星星亮起来的时候代码也跑得最欢。', fig: [[[0.2, 0.2], [0.12, 0.45], [0.2, 0.72], [0.42, 0.86], [0.62, 0.8], [0.4, 0.62], [0.34, 0.42], [0.42, 0.24]], [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 0]]] },
  dawn: { name: '晨曦座', symbol: '🌅', desc: '天刚亮就开工，一天最清醒的几个小时都给了代码。', fig: [[[0.5, 0.62], [0.2, 0.62], [0.8, 0.62], [0.5, 0.3], [0.28, 0.4], [0.72, 0.4], [0.5, 0.12]], [[1, 0], [0, 2], [0, 3], [0, 4], [0, 5], [3, 6]]] },
  marathon: { name: '长河座', symbol: '🌊', desc: '一个会话能聊上好几个小时，像一条不肯停下的长河。', fig: [[[0.05, 0.5], [0.2, 0.36], [0.35, 0.5], [0.5, 0.64], [0.65, 0.5], [0.8, 0.36], [0.95, 0.5]], [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]]] },
  burst: { name: '疾风座', symbol: '⚡', desc: '平时安静，一出手就是暴风骤雨，几分钟烧掉别人一小时的量。', fig: [[[0.6, 0.06], [0.3, 0.5], [0.52, 0.5], [0.36, 0.94], [0.76, 0.4], [0.54, 0.4]], [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]]] },
  thrift: { name: '省灯座', symbol: '🕯', desc: '缓存用得炉火纯青，同样的上下文几乎从不重复花钱。', fig: [[[0.5, 0.1], [0.42, 0.3], [0.58, 0.3], [0.4, 0.5], [0.6, 0.5], [0.4, 0.9], [0.6, 0.9]], [[0, 1], [0, 2], [1, 3], [2, 4], [3, 5], [4, 6], [5, 6]]] },
  dual: { name: '双星座', symbol: '🪐', desc: 'Claude 和 Codex 你都用得很重，两颗星互相绕着转。', fig: [[[0.3, 0.5], [0.7, 0.5], [0.3, 0.25], [0.12, 0.6], [0.36, 0.78], [0.7, 0.25], [0.88, 0.6], [0.64, 0.78]], [[0, 1], [0, 2], [0, 3], [0, 4], [1, 5], [1, 6], [1, 7]]] },
  web: { name: '织网座', symbol: '🕸', desc: '同时照看好几个项目，在它们之间来回穿梭织成一张网。', fig: [[[0.5, 0.5], [0.5, 0.1], [0.88, 0.32], [0.84, 0.76], [0.5, 0.92], [0.16, 0.76], [0.12, 0.32]], [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 1]]] },
  deep: { name: '深潜座', symbol: '🐋', desc: '你喜欢把整个仓库都塞进上下文里，一口气潜到最深处。', fig: [[[0.1, 0.5], [0.3, 0.36], [0.6, 0.34], [0.84, 0.44], [0.92, 0.3], [0.94, 0.62], [0.6, 0.66], [0.3, 0.64]], [[0, 1], [1, 2], [2, 3], [3, 4], [3, 5], [3, 6], [6, 7], [7, 0]]] },
  steady: { name: '恒星座', symbol: '☀️', desc: '几乎每天都在写，稳定得像一颗恒星。', fig: [[[0.5, 0.5], [0.5, 0.12], [0.82, 0.3], [0.82, 0.7], [0.5, 0.88], [0.18, 0.7], [0.18, 0.3]], [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6]]] },
  weekend: { name: '周末座', symbol: '🎈', desc: '周末才是你的主场，别人休息的时候你在造东西。', fig: [[[0.5, 0.14], [0.3, 0.3], [0.32, 0.54], [0.5, 0.66], [0.68, 0.54], [0.7, 0.3], [0.5, 0.92]], [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [3, 6]]] },
  master: { name: '巨匠座', symbol: '🏛', desc: '只用最强的模型，花钱不手软，要的就是一次做对。', fig: [[[0.14, 0.86], [0.86, 0.86], [0.2, 0.36], [0.4, 0.36], [0.6, 0.36], [0.8, 0.36], [0.5, 0.12]], [[0, 1], [0, 2], [2, 3], [3, 4], [4, 5], [5, 1], [2, 6], [6, 5]]] },
  light: { name: '轻舟座', symbol: '⛵', desc: '用得不多也不急，像一叶轻舟慢慢往前划。', fig: [[[0.1, 0.7], [0.9, 0.7], [0.74, 0.86], [0.26, 0.86], [0.5, 0.14], [0.5, 0.7], [0.22, 0.6]], [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [4, 6], [6, 5]]] }
}

/** Reads the last 30 days of habits as a constellation */
export function codingSign(entries: CostedEntry[], now: number): CodingSign {
  const from = now - 30 * DAY
  let total = 0
  let night = 0
  let dawn = 0
  let weekend = 0
  let codex = 0
  let claude = 0
  let cost = 0
  let topCost = 0
  let read = 0
  let fresh = 0
  let ctxSum = 0
  let ctxN = 0
  const hours = new Map<number, number>()
  const days = new Set<number>()
  const projects = new Set<string>()
  /** per session: the last request, and the time actually spent (pauses over 30 minutes don't count) */
  const sessions = new Map<string, [number, number]>()
  for (const e of entries) {
    if (e.ts < from || e.ts > now) continue
    const n = tokensOf(e)
    const d = new Date(e.ts)
    const h = d.getHours()
    total += n
    if (h >= 22 || h < 5) night += n
    if (h >= 5 && h < 9) dawn += n
    if (d.getDay() === 0 || d.getDay() === 6) weekend += n
    if (e.source === 'codex') codex += n
    if ((e.source ?? 'claude') === 'claude') claude += n
    cost += e.cost.total
    if (/opus|fable|mythos|astra|-pro\b/i.test(e.model)) topCost += e.cost.total
    read += e.cacheRead
    fresh += e.input + e.cacheWrite5m + e.cacheWrite1h
    if (!e.side) {
      ctxSum += contextOf(e)
      ctxN++
    }
    const hk = Math.floor(e.ts / 3_600_000)
    hours.set(hk, (hours.get(hk) ?? 0) + n)
    days.add(Math.floor((e.ts - new Date(e.ts).getTimezoneOffset() * 60_000) / DAY))
    if (e.project) projects.add(e.project)
    const s = sessions.get(e.sessionId)
    if (!s) sessions.set(e.sessionId, [e.ts, 0])
    else {
      const gap = e.ts - s[0]
      if (gap > 0 && gap <= 30 * 60_000) s[1] += gap
      s[0] = Math.max(s[0], e.ts)
    }
  }
  const zodiac = zodiacToday(entries, now)
  const share = (v: number) => (total ? v / total : 0)
  const durations = [...sessions.values()].map(([, active]) => active).sort((a, b) => a - b)
  const medianMin = durations.length ? durations[Math.floor(durations.length / 2)] / 60_000 : 0
  const hourly = [...hours.values()]
  const meanHour = hourly.length ? hourly.reduce((a, b) => a + b, 0) / hourly.length : 0
  const peakRatio = meanHour ? Math.max(...hourly) / meanHour : 0
  const hit = read + fresh ? read / (read + fresh) : 0
  const avgCtx = ctxN ? ctxSum / ctxN : 0
  // habits by weekday or by how many days need a couple of weeks of data to mean anything
  let first = Infinity
  for (const e of entries) if (e.ts >= from && e.ts < first) first = e.ts
  const spanDays = first === Infinity ? 0 : (now - first) / DAY
  const longEnough = spanDays >= 14
  const pct = (v: number) => `${Math.round(v * 100)}%`
  // each trait: how far past its threshold, and what to say about it
  const scored: { key: string; score: number; trait: string }[] = [
    { key: 'night', score: share(night) / 0.35, trait: `夜里 22 点到凌晨 5 点的用量占 ${pct(share(night))}` },
    { key: 'dawn', score: share(dawn) / 0.25, trait: `早上 5–9 点的用量占 ${pct(share(dawn))}` },
    { key: 'marathon', score: medianMin / 90, trait: `会话时长的中位数是 ${Math.round(medianMin)} 分钟` },
    { key: 'burst', score: peakRatio / 6, trait: `最忙的一小时是平时的 ${peakRatio.toFixed(1)} 倍` },
    { key: 'thrift', score: hit / 0.96, trait: `缓存命中率 ${(hit * 100).toFixed(1)}%` },
    { key: 'dual', score: Math.min(share(codex), share(claude)) / 0.2, trait: `Claude 和 Codex 各占 ${pct(share(claude))} / ${pct(share(codex))}` },
    { key: 'web', score: projects.size / 6, trait: `30 天里碰过 ${projects.size} 个项目` },
    { key: 'deep', score: avgCtx / 250_000, trait: `每次请求平均带着 ${Math.round(avgCtx / 1000)}k 上下文` },
    { key: 'steady', score: longEnough ? days.size / 24 : 0, trait: `30 天里有 ${days.size} 天在用` },
    { key: 'weekend', score: longEnough ? share(weekend) / 0.4 : 0, trait: `周末的用量占 ${pct(share(weekend))}` },
    { key: 'master', score: cost ? topCost / cost / 0.8 : 0, trait: `${pct(cost ? topCost / cost : 0)} 的花费在最强的模型上` }
  ]
  const matched = scored.filter((x) => x.score >= 1 && total > 0).sort((a, b) => b.score - a.score)
  const key = matched[0]?.key ?? 'light'
  const s = SIGNS[key]
  return {
    key,
    name: s.name,
    symbol: s.symbol,
    desc: longEnough || !total ? s.desc : `${s.desc}（目前只有 ${Math.max(1, Math.ceil(spanDays))} 天的数据，星座还会变）`,
    traits: (matched.length ? matched : scored.sort((a, b) => b.score - a.score)).slice(0, 3).map((x) => x.trait),
    ...fig(s.fig),
    zodiac
  }
}
