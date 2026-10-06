import { moonPhase, moonPosition, sunPosition, sunTimes, type Place } from './astro'

/**
 * The day as it really goes by at a place: the sun's height (and whether it
 * is rising or setting) decides the colour of the sky, the land, the water,
 * the light on the clouds, how many stars show and the app's own colours.
 * Everything is interpolated from the sun's altitude, so the change is as
 * gradual as the real one: dawn takes about an hour, and so does dusk.
 *
 * Four phases, by the sun (what the colours follow; the words people use
 * for the time of day are finer, see `labelOf`):
 *   早晨 morning  from nautical dawn (−12°) until the sun is well up
 *   中午 noon     the sun high (above `high`, a share of today's noon height)
 *   傍晚 dusk     from the sun getting low until nautical dusk (−12°)
 *   深夜 night    the sun more than 12° below the horizon
 */

export type DayPhase = 'morning' | 'noon' | 'dusk' | 'night'
export const PHASES: DayPhase[] = ['morning', 'noon', 'dusk', 'night']
export const PHASE_NAME: Record<DayPhase, string> = { morning: '早晨', noon: '中午', dusk: '傍晚', night: '深夜' }

/** where night ends and begins: nautical twilight */
export const NIGHT_ALT = -12

type RGB = [number, number, number]
type Key = [alt: number, rgb: string]

const rgb = (hex: string): RGB => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const hexOf = (c: RGB) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`
export const mix = (a: string, b: string, k: number): string => {
  const x = rgb(a)
  const y = rgb(b)
  return hexOf([x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k])
}
export const rgbText = (hex: string) => rgb(hex).join(',')
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
export const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** the colour at altitude `alt` along keys sorted by altitude */
function along(keys: Key[], alt: number): string {
  if (alt <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i++) {
    if (alt <= keys[i][0]) {
      const [a0, c0] = keys[i - 1]
      const [a1, c1] = keys[i]
      return mix(c0, c1, smooth(0, 1, (alt - a0) / (a1 - a0)))
    }
  }
  return keys[keys.length - 1][1]
}

/** a sky colour: the morning and evening keys, the same below and above the twilight */
interface SkyKeys {
  morning: Key[]
  evening: Key[]
}

// zenith, middle of the sky and horizon; dawn is cooler and pinker, dusk warmer and deeper
const ZENITH: SkyKeys = {
  morning: [[-18, '#03060f'], [-12, '#060c1f'], [-8, '#0c1838'], [-4, '#18305f'], [-1, '#24457e'], [2, '#3061a0'], [6, '#3b74b8'], [12, '#3d82c9'], [25, '#3484d6'], [60, '#226ed0']],
  evening: [[-18, '#03060f'], [-12, '#060c1f'], [-8, '#101838'], [-4, '#1c2a5a'], [-1, '#283f78'], [2, '#2f5c98'], [6, '#3a6eb0'], [12, '#3d7ec4'], [25, '#3484d6'], [60, '#226ed0']]
}
const MIDDLE: SkyKeys = {
  morning: [[-18, '#070d1f'], [-12, '#0d1835'], [-8, '#233a6e'], [-4, '#4d5f98'], [-1, '#8a86b4'], [2, '#a6b4d6'], [6, '#a4c4e4'], [12, '#90c0ea'], [25, '#72b4ee'], [60, '#58a6f0']],
  evening: [[-18, '#070d1f'], [-12, '#101a3a'], [-8, '#2e3470'], [-4, '#6a4c8c'], [-1, '#a8698e'], [2, '#d08a84'], [6, '#d8ad92'], [12, '#a8c2dc'], [25, '#72b4ee'], [60, '#58a6f0']]
}
const HORIZON: SkyKeys = {
  morning: [[-18, '#0e1733'], [-12, '#1d2a52'], [-8, '#5a5a8c'], [-4, '#d08c94'], [-1, '#f8aa80'], [2, '#ffc88c'], [6, '#ffe2b4'], [12, '#e8f0f4'], [25, '#cfe8f8'], [60, '#c0e0fb']],
  evening: [[-18, '#0e1733'], [-12, '#24264e'], [-8, '#714a7c'], [-4, '#e2684e'], [-1, '#ff7f3e'], [2, '#ff9a54'], [6, '#ffbe6e'], [12, '#f4dcb6'], [25, '#cfe8f8'], [60, '#c0e0fb']]
}
const SUN: Key[] = [[-2, '#ff5a1e'], [1, '#ff7a2c'], [5, '#ffad55'], [12, '#ffe0a0'], [25, '#fff6dc'], [60, '#fffef6']]
// the app's accent through the day: rose at dawn, amber in the morning, sun gold at noon, orange then violet at dusk, moonlight at night
const ACCENT: SkyKeys = {
  morning: [[-14, '#9db4ff'], [-8, '#c0a4f0'], [-3, '#ff9a92'], [3, '#ffa978'], [10, '#ffbf5e'], [25, '#ffcf4d'], [60, '#ffd447']],
  evening: [[-14, '#9db4ff'], [-8, '#c08cff'], [-3, '#ff7a6a'], [3, '#ff8a46'], [10, '#ffa840'], [25, '#ffcf4d'], [60, '#ffd447']]
}
// land: by day and by night; atmospheric haze tints the far ridges toward the horizon
const LAND_DAY = ['#7f9fc6', '#577d9c', '#355a62', '#1f3b31', '#11221a']
const LAND_NIGHT = ['#141c38', '#0e152b', '#0a1020', '#070b16', '#04070d']

export interface SkyState {
  t: number
  /** the sun, degrees */
  alt: number
  az: number
  /** before solar noon */
  rising: boolean
  phase: DayPhase
  /** sun height that separates noon from morning and dusk today */
  high: number
  zenith: string
  middle: string
  horizon: string
  sun: string
  /** how strongly the sun lights the sky around it, 0–1.3 */
  glow: number
  /** 0 by day, 1 deep in the night */
  dark: number
  stars: number
  /** share of window lights that are on */
  lights: number
  /** mist on the water: dawn mist, a thin haze at dusk */
  mist: number
  /** the light on the clouds: lit side and shade */
  cloudLit: string
  cloudShade: string
  /** five land layers, far to near */
  land: string[]
  moon: { alt: number; az: number; phase: number; fraction: number }
  accent: string
}

/** the sun's height at today's noon (cached per day and place) */
const noonCache = new Map<string, number>()
function noonAlt(t: number, place: Place): number {
  const key = `${Math.floor(t / 86_400_000)}:${place.lat}:${place.lon}`
  let v = noonCache.get(key)
  if (v === undefined) {
    v = sunPosition(sunTimes(t, place).noon, place).alt
    if (noonCache.size > 64) noonCache.clear()
    noonCache.set(key, v)
  }
  return v
}

/** the height that counts as "high": a share of today's noon height, at least 8° */
export function highAlt(t: number, place: Place): number {
  return Math.max(8, Math.min(28, noonAlt(t, place) * 0.45))
}

export function phaseOf(alt: number, rising: boolean, high: number): DayPhase {
  if (alt < NIGHT_ALT) return 'night'
  if (alt >= high) return 'noon'
  return rising ? 'morning' : 'dusk'
}

/** The sky at time t at a place */
export function skyAt(t: number, place: Place): SkyState {
  const sun = sunPosition(t, place)
  const rising = t < sunTimes(t, place).noon
  const high = highAlt(t, place)
  const alt = sun.alt
  const side = rising ? 'morning' : 'evening'
  const dark = 1 - smooth(-14, 4, alt)
  const light = smooth(-10, 10, alt)
  const horizon = along(HORIZON[side], alt)
  // the golden hours warm the land, haze pulls the far ridges toward the horizon
  const golden = smooth(-3, 1, alt) * (1 - smooth(8, 18, alt))
  const land = LAND_DAY.map((day, i) => {
    let c = mix(LAND_NIGHT[i], day, light)
    c = mix(c, horizon, [0.42, 0.24, 0.12, 0.05, 0.02][i] * (0.4 + 0.6 * light))
    return golden > 0 ? mix(c, along(SUN, alt), golden * [0.18, 0.12, 0.08, 0.05, 0.03][i]) : c
  })
  const m = moonPosition(t, place)
  const ph = moonPhase(t)
  return {
    t,
    alt,
    az: sun.az,
    rising,
    phase: phaseOf(alt, rising, high),
    high,
    zenith: along(ZENITH[side], alt),
    middle: along(MIDDLE[side], alt),
    horizon,
    sun: along(SUN, alt),
    glow: alt < -8 ? 0 : alt < 0 ? smooth(-8, 0, alt) * 1.1 : 1.3 - 0.75 * smooth(0, 40, alt),
    dark,
    stars: 1 - smooth(-15, -3, alt),
    lights: rising ? 1 - smooth(-2, 4, alt) : 1 - smooth(-6, 3, alt),
    mist: rising ? smooth(-10, -2, alt) * (1 - smooth(6, 16, alt)) : 0.25 * smooth(-10, 0, alt) * (1 - smooth(4, 12, alt)),
    cloudLit: alt > 14 ? mix('#fff6e8', '#ffffff', smooth(14, 40, alt)) : alt > -6 ? mix(along(HORIZON[side], alt + 1.5), '#fff2dc', smooth(0, 14, alt)) : mix('#3a4370', '#5b5f8c', clamp01(ph.fraction)),
    cloudShade: mix(mix(LAND_NIGHT[0], '#8f9fbf', light), along(MIDDLE[side], alt), 0.35),
    land,
    moon: { alt: m.alt, az: m.az, phase: ph.phase, fraction: ph.fraction },
    accent: along(ACCENT[side], alt)
  }
}

/** The app's colours for a sky: glass cards tinted by it, light text, the accent of the hour */
export function uiColors(s: SkyState): Record<string, string> {
  // a bright sky shows through thin glass and washes out the quieter text, so
  // the cards thicken and darken by day and thin out again at night
  const light = 1 - s.dark
  const base = mix(s.zenith, '#000000', 0.58 + 0.08 * light)
  const deep = mix(s.zenith, '#000000', 0.74)
  const accent = s.accent
  const [r, g, b] = rgb(base)
  const glass = 0.5 + 0.14 * light
  return {
    '--text-2': mix('#cdd6ea', '#e6ebf6', light),
    '--text-3': mix('#93a0bd', '#b9c3da', light),
    '--bg': deep,
    '--bg-side': mix(deep, '#000000', 0.12),
    '--surface': `rgba(${r},${g},${b},${glass.toFixed(2)})`,
    '--surface-solid': mix(base, '#000000', 0.1),
    '--surface-2': `rgba(${rgbText(mix(base, '#ffffff', 0.08))},${(glass * 0.9).toFixed(2)})`,
    '--border': `rgba(${rgbText(mix(accent, '#ffffff', 0.5))},0.16)`,
    '--border-strong': `rgba(${rgbText(mix(accent, '#ffffff', 0.4))},0.3)`,
    '--grid': `rgba(255,255,255,0.08)`,
    '--axis': `rgba(255,255,255,0.22)`,
    '--accent-rgb': rgbText(accent),
    '--accent': accent,
    '--accent-strong': mix(accent, '#ffffff', 0.18),
    '--accent-hi': mix(accent, '#ffffff', 0.55),
    '--accent-soft': `rgba(${rgbText(accent)},0.16)`,
    '--accent-wash': `rgba(${rgbText(accent)},0.07)`,
    '--s1': accent,
    '--q4': accent,
    '--q5': mix(accent, '#ffffff', 0.55),
    '--day-zenith': s.zenith,
    '--day-horizon': s.horizon,
    '--day-sun': s.sun
  }
}

/** the first change of f after t (5-minute steps, then to the minute); null when nothing changes within two days */
function nextChange<T>(t: number, f: (x: number) => T): { at: number; value: T } | null {
  const now = f(t)
  for (let x = t + 5 * 60_000; x < t + 48 * 3600_000; x += 5 * 60_000) {
    const v = f(x)
    if (v === now) continue
    let lo = x - 5 * 60_000
    let hi = x
    while (hi - lo > 60_000) {
      const mid = (lo + hi) / 2
      if (f(mid) === now) lo = mid
      else hi = mid
    }
    return { at: hi, value: v }
  }
  return null
}

/** When the phase next changes after t, and to what; null when it doesn't within two days (polar day or night) */
export function nextPhase(t: number, place: Place): { at: number; phase: DayPhase } | null {
  const n = nextChange(t, (x) => phaseOf(sunPosition(x, place).alt, x < sunTimes(x, place).noon, highAlt(x, place)))
  return n && { at: n.at, phase: n.value }
}

/**
 * What a person calls the time of day: the sun decides dawn, morning, dusk
 * and night, the clock splits the high sun into 上午 / 中午 / 下午 and the
 * dark into 夜晚 / 深夜 / 凌晨. `hour` is the local clock, fractional.
 */
export function labelOf(alt: number, rising: boolean, high: number, hour: number): string {
  if (alt < -6) return rising ? (hour < 1.5 ? '深夜' : '凌晨') : hour >= 22 ? '深夜' : '夜晚'
  if (alt < 0) return rising ? '黎明' : '黄昏'
  if (alt < high) return rising ? '早晨' : '傍晚'
  return hour < 11 ? '上午' : hour < 13 ? '中午' : '下午'
}

/** the clock at the place: this computer's, unless the place lies far from its time zone, then the place's own sun time */
function hourAt(t: number, place: Place): number {
  const d = new Date(t)
  const local = d.getHours() + d.getMinutes() / 60
  const solar = (((t / 3_600_000 + place.lon / 15) % 24) + 24) % 24
  const diff = Math.abs(local - solar)
  return Math.min(diff, 24 - diff) <= 2.5 ? local : solar
}

/** the time of day at t, as a person would call it */
export function dayLabel(t: number, place: Place): string {
  return labelOf(sunPosition(t, place).alt, t < sunTimes(t, place).noon, highAlt(t, place), hourAt(t, place))
}

/** when the time of day is next called something else, and what */
export function nextLabel(t: number, place: Place): { at: number; label: string } | null {
  const n = nextChange(t, (x) => dayLabel(x, place))
  return n && { at: n.at, label: n.value }
}

// ---------------------------------------------------------------- seasons

/** the 24 solar terms, from the spring equinox (the sun's ecliptic longitude 0°) in 15° steps */
export const TERMS = ['春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至', '小暑', '大暑', '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至', '小寒', '大寒', '立春', '雨水', '惊蛰']

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'
export const SEASON_NAME: Record<Season, string> = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' }

export interface SeasonState {
  /** the sun's ecliptic longitude, degrees (turned half a year south of the equator) */
  lon: number
  /** the solar term now and the next one */
  term: string
  next: string
  season: Season
  /** how much of each season is in the air, summing to 1: pure in the middle of a season, half and half at its 立 term */
  k: Record<Season, number>
}

/**
 * The season by the sun, the Chinese way: spring from 立春 to 立夏 and so on,
 * each centred on its equinox or solstice. South of the equator the seasons
 * (and the terms' names) are half a year on.
 */
export function seasonAt(t: number, lat: number): SeasonState {
  const lon = (sunPosition(t, { name: '', lat: 0, lon: 0 }).lon + (lat < 0 ? 180 : 0)) % 360
  const i = Math.floor(lon / 15) % 24
  const centres: [Season, number][] = [
    ['spring', 0],
    ['summer', 90],
    ['autumn', 180],
    ['winter', 270]
  ]
  const raw = centres.map(([s, c]) => [s, clamp01((60 - Math.abs(((lon - c + 540) % 360) - 180)) / 30)] as const)
  const sum = raw.reduce((a, [, v]) => a + v, 0) || 1
  const k = Object.fromEntries(raw.map(([s, v]) => [s, v / sum])) as Record<Season, number>
  const season = raw.reduce((a, b) => (b[1] > a[1] ? b : a))[0]
  return { lon, term: TERMS[i], next: TERMS[(i + 1) % 24], season, k }
}
