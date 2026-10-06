import type { FrameCap } from './types'

/** the base step: every loop's step is a multiple of it, so loops draw on the same refreshes (about 75 frames a second at most) */
export const baseStep = (refresh: number, cap: FrameCap) => (cap === 'max' ? 1 : Math.max(1, Math.round(refresh / 75)))

/**
 * How many display refreshes a loop that wants `fps` waits between frames:
 * under 自动 its own rate (at most about 30 once the clock has eased off to
 * level 2), under 30 / 60 at most that, under 不限 every refresh.
 */
export function stepOf(refresh: number, fps: number, cap: FrameCap, quality = 0): number {
  const want = cap === 'max' ? refresh : cap === 'auto' ? Math.min(fps, quality >= 2 ? 30 : fps, refresh) : Math.min(Number(cap), refresh)
  const base = baseStep(refresh, cap)
  return base * Math.max(1, Math.round(refresh / (base * want)))
}
