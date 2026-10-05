import { moonPhase, moonPosition, sunPosition, sunTimes, type Place } from './astro'

/**
 * The day as it really goes by at a place: the sun's height (and whether it
 * is rising or setting) decides the colour of the sky, the land, the water,
 * the light on the clouds, how many stars show and the app's own colours.
 * Everything is interpolated from the sun's altitude, so the change is as
 * gradual as the real one: dawn takes about an hour, and so does dusk.
 *
 * Four phases, by the sun:
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

/**
 * When the phase next changes after t (searched in 5-minute steps, then to
 * the minute), and to what; null when it doesn't within two days (polar day
 * or night).
 */
export function nextPhase(t: number, place: Place): { at: number; phase: DayPhase } | null {
  const ph = (x: number) => {
    const s = sunPosition(x, place)
    return phaseOf(s.alt, x < sunTimes(x, place).noon, highAlt(x, place))
  }
  const now = ph(t)
  for (let x = t + 5 * 60_000; x < t + 48 * 3600_000; x += 5 * 60_000) {
    const p = ph(x)
    if (p === now) continue
    let lo = x - 5 * 60_000
    let hi = x
    while (hi - lo > 60_000) {
      const mid = (lo + hi) / 2
      if (ph(mid) === now) lo = mid
      else hi = mid
    }
    return { at: hi, phase: p }
  }
  return null
}
