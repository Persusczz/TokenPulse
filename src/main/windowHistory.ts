import { readFile } from 'node:fs/promises'
import type { UsageSource, WindowHistory, WindowRecord } from '@shared/types'
import type { CostedEntry } from './aggregate'
import { writeFileAtomic, writeFileAtomicSync } from './atomicFile'
import type { CodexWindow } from './collector/codex'

const MIN = 60_000
const HOUR = 60 * MIN
export const FIVE_H = 5 * HOUR
const DAY = 24 * HOUR
/** readings of one window: its reset time wobbles a little between sources */
const SAME_WINDOW_MS = 10 * MIN
const KEEP_MS = 60 * DAY
const MAX_SAMPLES = 80

interface Logged {
  end: number
  peak: number
  hitAt: number | null
  samples: { t: number; pct: number }[]
}

/** the highest reading of one weekly window */
export interface LoggedWeek {
  end: number
  peak: number
}
const WEEK_KEEP_MS = 120 * DAY
/** a weekly reset time read twice can differ by a few minutes */
const SAME_WEEK_MS = HOUR

/** Claude's official 5h readings, kept per window, and the 7-day windows' peaks (window-history.json in the profile) */
export class ClaudeWindowLog {
  windows: Logged[] = []
  weeks: LoggedWeek[] = []
  private timer: NodeJS.Timeout | null = null

  constructor(private path: string) {}

  async load(): Promise<void> {
    try {
      const j = JSON.parse(await readFile(this.path, 'utf8'))
      if (Array.isArray(j?.windows)) {
        this.windows = j.windows.filter((w: any) => Number.isFinite(w?.end) && Number.isFinite(w?.peak) && Array.isArray(w?.samples))
      }
      if (Array.isArray(j?.weeks)) this.weeks = j.weeks.filter((w: any) => Number.isFinite(w?.end) && Number.isFinite(w?.peak))
    } catch {
      /* first run */
    }
  }

  /** Adds a reading; true when something changed */
  record(pct: number, resetsAt: number, t: number): boolean {
    if (!Number.isFinite(pct) || !(resetsAt > 0) || t < resetsAt - FIVE_H - MIN || t > resetsAt) return false
    let w = this.windows.find((x) => Math.abs(x.end - resetsAt) < SAME_WINDOW_MS)
    if (!w) {
      w = { end: resetsAt, peak: 0, hitAt: null, samples: [] }
      this.windows.push(w)
      this.windows.sort((a, b) => a.end - b.end)
    }
    const last = w.samples[w.samples.length - 1]
    if (last && (t <= last.t || (Math.abs(pct - last.pct) < 0.5 && t - last.t < 5 * MIN))) return false
    w.samples.push({ t, pct })
    if (w.samples.length > MAX_SAMPLES * 2) w.samples = thin(w.samples, MAX_SAMPLES)
    w.peak = Math.max(w.peak, pct)
    if (pct >= 100 && w.hitAt === null) w.hitAt = t
    this.windows = this.windows.filter((x) => t - x.end < KEEP_MS)
    this.save()
    return true
  }

  /** Adds a 7-day reading; true when something changed */
  recordWeek(pct: number, resetsAt: number, t: number): boolean {
    if (!Number.isFinite(pct) || !(resetsAt > 0) || t > resetsAt) return false
    this.weeks = this.weeks.filter((x) => t - x.end < WEEK_KEEP_MS)
    const changed = noteWeek(this.weeks, pct, resetsAt)
    if (changed) this.save()
    return changed
  }

  private save(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void writeFileAtomic(this.path, JSON.stringify({ windows: this.windows, weeks: this.weeks })).catch(() => {})
    }, 2000)
  }

  /** on quit: a write still waiting goes out now */
  flush(): void {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = null
    try {
      writeFileAtomicSync(this.path, JSON.stringify({ windows: this.windows, weeks: this.weeks }))
    } catch {
      /* nothing more to do */
    }
  }
}

/** a weekly reading into its window (found by its reset time), keeping the peak; true when something changed */
export function noteWeek(weeks: LoggedWeek[], pct: number, end: number): boolean {
  const w = weeks.find((x) => Math.abs(x.end - end) < SAME_WEEK_MS)
  if (!w) {
    weeks.push({ end, peak: pct })
    weeks.sort((a, b) => a.end - b.end)
    return true
  }
  if (pct <= w.peak) return false
  w.peak = pct
  return true
}

/** Keeps the first, the last and the biggest steps */
function thin(samples: { t: number; pct: number }[], max: number): { t: number; pct: number }[] {
  if (samples.length <= max) return samples
  const step = samples.length / max
  const out: { t: number; pct: number }[] = []
  for (let i = 0; i < max; i++) out.push(samples[Math.floor(i * step)])
  out.push(samples[samples.length - 1])
  return out
}

/**
 * Claude windows worked out from local logs: a window opens at the first
 * response after the previous one closed (rounded down to the hour) and its
 * API-equivalent spend is measured against the calibrated 5h limit.
 */
export function estimateClaudeWindows(entries: CostedEntry[], limitUsd: number, from: number, now: number): WindowRecord[] {
  const out: WindowRecord[] = []
  let cur: WindowRecord | null = null
  let spend = 0
  for (const e of entries) {
    if (e.ts < from - FIVE_H || e.ts > now) continue
    if (!cur || e.ts >= cur.end) {
      const start = Math.floor(e.ts / HOUR) * HOUR
      cur = { source: 'claude', start, end: start + FIVE_H, peak: 0, hitAt: null, samples: [{ t: start, pct: 0 }], estimated: true }
      out.push(cur)
      spend = 0
    }
    spend += e.cost.total
    const pct = (spend / limitUsd) * 100
    if (pct >= 100 && cur.hitAt === null) cur.hitAt = e.ts
    cur.peak = Math.min(100, pct)
    const last = cur.samples[cur.samples.length - 1]
    if (pct - last.pct >= 1 || e.ts - last.t >= 10 * MIN) cur.samples.push({ t: e.ts, pct: Math.min(100, pct) })
  }
  return out.filter((w) => w.end > from)
}

const toRecord = (source: UsageSource, w: Logged | CodexWindow): WindowRecord => {
  const start = w.end - FIVE_H
  const samples = thin(w.samples, MAX_SAMPLES)
  return {
    source,
    start,
    end: w.end,
    peak: w.peak,
    hitAt: w.hitAt,
    // the replay starts from an empty window
    samples: samples.length && samples[0].t > start ? [{ t: start, pct: 0 }, ...samples] : samples,
    estimated: false
  }
}

/** Past (and the current) 5-hour windows of the last `days` days, newest last */
export function buildHistory(o: {
  days: number
  now: number
  sources: UsageSource[]
  claude: Logged[]
  claudeEstimated: WindowRecord[]
  codex: CodexWindow[]
}): WindowHistory {
  const from = o.now - o.days * DAY
  const windows: WindowRecord[] = []
  if (o.sources.includes('claude')) {
    const logged = o.claude.filter((w) => w.end > from).map((w) => toRecord('claude', w))
    // estimates fill the windows nothing was recorded for
    const est = o.claudeEstimated.filter((e) => !logged.some((l) => e.start < l.end && l.start < e.end))
    windows.push(...logged, ...est)
  }
  if (o.sources.includes('codex')) windows.push(...o.codex.filter((w) => w.end > from).map((w) => toRecord('codex', w)))
  windows.sort((a, b) => a.start - b.start)
  const summary = o.sources.map((source) => {
    const list = windows.filter((w) => w.source === source && w.peak > 0)
    const hits = list.filter((w) => w.hitAt !== null)
    return {
      source,
      windows: list.length,
      hits: hits.length,
      avgToHitMs: hits.length ? hits.reduce((s, w) => s + (w.hitAt! - w.start), 0) / hits.length : null,
      avgPeak: list.length ? list.reduce((s, w) => s + w.peak, 0) / list.length : 0,
      estimated: list.filter((w) => w.estimated).length
    }
  })
  return { days: o.days, windows, summary }
}
