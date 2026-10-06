/**
 * One clock for every animation loop in a window. A loop asks for a frame
 * rate; the clock runs it on whole display refreshes, every k-th one, so its
 * frames come at an even pace (instead of alternating between two and three
 * refreshes), and holds them all to the frame-rate cap from the settings.
 *
 * The loops share their refreshes: on a busy page most of a frame's cost is
 * the page itself (style, layout, paint, compositing), paid once per frame
 * whatever drew in it, so every loop's step is a multiple of one base step
 * (about 75 frames a second at most) and they all draw on the same frames.
 * With nothing to run, the clock stops and the page can idle.
 *
 * Under 自动 the clock also watches whether the display's frames come on
 * time. When they keep coming late (the GPU can't keep up: big glass cards
 * over a busy scene on a high refresh display), the backdrop scenes draw at a
 * lower resolution, then everything at about 30 frames a second; after a
 * while of frames on time, back up again.
 */

import { stepOf } from '@shared/frameStep'
import type { FrameCap } from '@shared/types'

interface Loop {
  name: string
  /** the rate the loop was made for */
  fps: number
  run: (dt: number, now: number) => void
  /** runs on every k-th refresh (refreshes counted from the clock's start) */
  k: number
  /** the next refresh it may run on */
  next: number
  last: number
  /** ms per run, smoothed */
  cost: number
  /** runs in the last second, for the meter */
  runs: number
}

const loops = new Set<Loop>()
let raf = 0
let cap: FrameCap = 'auto'
/** the display's refresh rate, measured */
let refresh = 60
let epoch = 0
let prev = 0
const gaps: number[] = []
let frames = 0
const RATES = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 240]

/** how much the clock has eased off under 自动: 0 not at all, 1 scenes at 80% resolution, 2 at 65% and every loop at about 30 frames */
let quality = 0
const SCALE = [1, 0.8, 0.65]
const qualitySubs = new Set<() => void>()
/** loop turns in the current second and how many came late; the late share, smoothed */
let turns = 0
let missed = 0
let windowAt = 0
let strain = 0
/** seconds in a row the strain has been high */
let over = 0
let shiftedAt = 0
/** the same over the last second, for the meter */
let secTurns = 0
let secMissed = 0
/** the display's refresh rate as Windows reports it, when known */
let reported = 0

/** every loop's step, a multiple of the base step so loops land on the same refreshes */
function retune(): void {
  for (const l of loops) {
    l.k = stepOf(refresh, l.fps, cap, quality)
    l.next = 0
  }
}

function setQuality(q: number, now: number): void {
  if (q === quality) return
  quality = q
  shiftedAt = now
  retune()
  qualitySubs.forEach((f) => f())
}

/**
 * Under 自动: the share of loop turns that came a refresh or more late (what
 * shows as a stutter), smoothed over several seconds. Above three in a
 * hundred for three seconds running the clock eases off a step; when it
 * stays near none it comes back after 25 s.
 * Heavy moments come and go with a scene (a wave breaking, a shower), so it
 * is the average that counts, not any one second.
 */
function watch(now: number): void {
  if (!windowAt) windowAt = now
  if (now - windowAt < 1000) return
  const rate = turns ? missed / turns : 0
  turns = 0
  missed = 0
  windowAt = now
  if (cap !== 'auto') return
  strain = strain * 0.75 + rate * 0.25
  // a page change or a pack's entrance stutters for a moment; only strain that lasts counts
  over = strain > 0.03 ? over + 1 : 0
  if (over >= 3 && quality < 2 && now - shiftedAt > 5000) {
    strain = 0.015
    over = 0
    setQuality(quality + 1, now)
  } else if (strain < 0.012 && quality > 0 && now - shiftedAt > 25_000) setQuality(quality - 1, now)
}

function setRefresh(hz: number, now: number): void {
  const snapped = RATES.reduce((a, b) => (Math.abs(b - hz) < Math.abs(a - hz) ? b : a))
  if (snapped !== refresh) {
    refresh = snapped
    epoch = now
    retune()
  }
}

/**
 * The refresh rate: as Windows reports it for the window's display, else
 * from the gaps between frames (the shortest of them that keep recurring,
 * since a busy page skips refreshes but never makes them come sooner).
 */
function measure(now: number): void {
  const gap = now - prev
  prev = now
  if (gap > 2 && gap < 60) {
    gaps.push(gap)
    if (gaps.length > 120) gaps.shift()
  }
  if (reported || gaps.length < 40 || frames % 60) return
  const sorted = [...gaps].sort((a, b) => a - b)
  setRefresh(1000 / sorted[Math.floor(sorted.length * 0.1)], now)
}

/** asks the main process what the display runs at, now and then (the window may move to another screen) */
function askDisplay(): void {
  const api = (window as { api?: { displayHz?: () => Promise<number> } }).api
  void api?.displayHz?.().then((hz) => {
    if (hz > 20) {
      reported = hz
      setRefresh(hz, performance.now())
    }
  }, () => {})
}
askDisplay()
setInterval(askDisplay, 15_000)

function tick(now: number): void {
  if (!loops.size) {
    raf = 0
    prev = 0
    return
  }
  raf = requestAnimationFrame(tick)
  frames++
  measure(now)
  const slot = Math.round((now - epoch) / (1000 / refresh))
  for (const l of loops) {
    const off = ((slot % l.k) + l.k) % l.k
    // a new or retuned loop waits for its first turn; one missed to a slow frame runs now, then back on its turns
    if (!l.next ? off : slot < l.next) {
      if (!l.next) l.next = slot + l.k - off
      continue
    }
    if (l.next) {
      const lateBy = slot > l.next ? 1 : 0
      turns++
      missed += lateBy
      secTurns++
      secMissed += lateBy
    }
    l.next = slot - off + l.k
    const dt = l.last ? Math.min(0.1, (now - l.last) / 1000) : 0
    l.last = now
    const t0 = performance.now()
    l.run(dt, now)
    l.cost = l.cost * 0.9 + (performance.now() - t0) * 0.1
    l.runs++
  }
  watch(now)
}

/**
 * Runs `run(dt, now)` about `fps` times a second (dt in seconds, at most
 * 0.1) until the returned function is called.
 */
export function onFrame(fps: number, run: (dt: number, now: number) => void, name = ''): () => void {
  const l: Loop = { name, fps, run, k: 1, next: 0, last: 0, cost: 0, runs: 0 }
  loops.add(l)
  retune()
  if (!raf) {
    epoch = performance.now()
    raf = requestAnimationFrame(tick)
  }
  return () => {
    loops.delete(l)
    retune()
  }
}

export function setFrameCap(c: FrameCap): void {
  if (c === cap) return
  cap = c
  // the settings say how fast: the easing off of 自动 no longer applies
  if (c !== 'auto') setQuality(0, performance.now())
  retune()
}

/** the share of full resolution the backdrop scenes draw at now */
export const sceneScale = (): number => SCALE[quality]

/** calls `f` when the scenes' resolution changes */
export function onQuality(f: () => void): () => void {
  qualitySubs.add(f)
  return () => void qualitySubs.delete(f)
}

export interface FrameStats {
  refresh: number
  /** 0 full, 1 and 2 eased off (自动) */
  quality: number
  /** the share of loop turns in the last second that came a refresh or more late */
  missed: number
  loops: { name: string; fps: number; runs: number; cost: number }[]
}

/** what ran in the last second, and resets the count */
export function frameStats(): FrameStats {
  const out = [...loops].map((l) => ({ name: l.name, fps: Math.round(refresh / l.k), runs: l.runs, cost: l.cost }))
  for (const l of loops) l.runs = 0
  const miss = secTurns ? secMissed / secTurns : 0
  secTurns = 0
  secMissed = 0
  return { refresh, quality, missed: miss, loops: out }
}

declare global {
  interface Window {
    /** the clock's loops, for screenshots and checks */
    __tpFrames?: () => FrameStats
    /** forces the eased-off level, for screenshots and checks */
    __tpQuality?: (q: number) => void
  }
}
window.__tpFrames = frameStats
window.__tpQuality = (q) => setQuality(Math.max(0, Math.min(2, q)), performance.now())
