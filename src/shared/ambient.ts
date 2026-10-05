import type { Intensity } from './types'

export type Mood = 'dawn' | 'day' | 'dusk' | 'night'

/** Backdrop palettes per time of day, built around Claude's clay */
const MOODS: Record<Mood, [string, string, string, string]> = {
  dawn: ['#f2b880', '#d97757', '#f6d7c9', '#e9c46a'],
  day: ['#d97757', '#3f7fcb', '#5e9b4a', '#eeb197'],
  dusk: ['#cc4e7e', '#d97757', '#7e62c8', '#f0a487'],
  night: ['#3f5bcb', '#7e62c8', '#d97757', '#2a6f7f']
}
const ALARM = '#d03b3b'
/** glow strength per usage intensity */
const GLOW = [0.34, 0.44, 0.56, 0.7]

export interface Ambient {
  mood: Mood
  colors: [string, string, string, string]
  /** 0–1, how much the backdrop is pulled toward red by the 5h quota */
  heat: number
  /** 0–1 opacity of the backdrop shapes */
  glow: number
}

export function moodAt(hour: number): Mood {
  if (hour >= 5 && hour < 8) return 'dawn'
  if (hour >= 8 && hour < 17) return 'day'
  if (hour >= 17 && hour < 20) return 'dusk'
  return 'night'
}

/** Linear mix of two #rrggbb colours */
export function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const x = p(a)
  const y = p(b)
  const k = Math.max(0, Math.min(1, t))
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, '0')).join('')
}

const CLAY = '#d97757'

/** Swaps clay for another accent and pulls the rest of the palette toward it */
function tinted(colors: readonly string[], accent: string | undefined): string[] {
  if (!accent || accent.toLowerCase() === CLAY) return [...colors]
  return colors.map((c) => (c === CLAY ? accent : mixHex(c, accent, 0.35)))
}

/**
 * Backdrop colours, built around the accent colour. Adaptive: the palette
 * follows the time of day, gets brighter as usage heats up, and warms toward
 * red from 70% of the 5h quota.
 */
export function ambient(o: { hour: number; quotaPct: number | null; intensity: Intensity; adaptive: boolean; accent?: string }): Ambient {
  if (!o.adaptive) return { mood: 'day', colors: tinted(MOODS.day, o.accent) as Ambient['colors'], heat: 0, glow: 0.45 }
  const mood = moodAt(o.hour)
  const heat = o.quotaPct === null ? 0 : Math.max(0, Math.min(1, (o.quotaPct - 70) / 25))
  // warm toward red, but keep enough of the palette that the accent still shows
  const colors = tinted(MOODS[mood], o.accent).map((c) => (heat ? mixHex(c, ALARM, heat * 0.45) : c)) as Ambient['colors']
  return { mood, colors, heat, glow: GLOW[o.intensity] ?? GLOW[0] }
}
