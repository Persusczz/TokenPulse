import { readFile, writeFile } from 'node:fs/promises'
import type { Counter, Counters } from './achievements'

const DAY = 24 * 3600_000
const COUNTERS = ['guard', 'limit', 'tasks', 'remote', 'runaway', 'palette', 'rescued', 'checked'] as const

/** Small bits of state kept across restarts (state.json in the profile) */
export class AppState {
  firedAlerts = new Set<string>()
  /** keys of quota notices already sent (QuotaEvent.key) */
  quotaKeys = new Set<string>()
  /** when the 5h window reached 90% */
  quotaHits: number[] = []
  /** achievements already announced; null until the first computation (which announces nothing) */
  seenAchievements: Set<string> | null = null
  /** events TokenPulse counts for achievements */
  counters: Counters = {}
  /** local day ("YYYY-MM-DD") the evening report was last sent */
  lastReportDay: string | null = null
  /** revision of the Telegram button keyboard last sent to the chat */
  tgKeyboard: string | null = null
  /** the sunrise / sunset whose theme pack was last applied (dayNightPhase id) */
  dayNightPhase: string | null = null
  /** theme packs tried, with when (an achievement collects them) */
  packsTried: { key: string; at: number }[] = []
  private timer: NodeJS.Timeout | null = null

  constructor(private path: string) {}

  get guardPauses(): number {
    return this.counters.guard?.n ?? 0
  }

  async load(): Promise<void> {
    try {
      const s = JSON.parse(await readFile(this.path, 'utf8'))
      if (Array.isArray(s.firedAlerts)) s.firedAlerts.forEach((k: string) => this.firedAlerts.add(k))
      if (Array.isArray(s.quotaKeys)) s.quotaKeys.forEach((k: string) => this.quotaKeys.add(k))
      if (Array.isArray(s.quotaHits)) this.quotaHits = s.quotaHits.filter((t: unknown) => typeof t === 'number')
      if (Array.isArray(s.seenAchievements)) this.seenAchievements = new Set(s.seenAchievements)
      for (const k of COUNTERS) {
        const c = s.counters?.[k]
        if (c && Number.isFinite(c.n) && Number.isFinite(c.first)) this.counters[k] = { n: c.n, first: c.first, ...(Number.isFinite(c.at10) ? { at10: c.at10 } : {}) }
      }
      // state.json from before the counters
      if (!this.counters.guard && Number.isFinite(s.guardPauses) && s.guardPauses > 0) this.counters.guard = { n: s.guardPauses, first: Number(s.firstGuardPause) || Date.now() }
      if (!this.counters.limit && this.quotaHits.length) this.counters.limit = { n: this.quotaHits.length, first: this.quotaHits[0] }
      if (typeof s.lastReportDay === 'string') this.lastReportDay = s.lastReportDay
      if (typeof s.tgKeyboard === 'string') this.tgKeyboard = s.tgKeyboard
      if (typeof s.dayNightPhase === 'string') this.dayNightPhase = s.dayNightPhase
      if (Array.isArray(s.packsTried)) this.packsTried = s.packsTried.filter((p: { key?: unknown; at?: unknown }) => typeof p?.key === 'string' && typeof p?.at === 'number')
    } catch {
      /* first run */
    }
  }

  /** 5h windows that hit 90% since `since` */
  hitsSince(since: number): number {
    return this.quotaHits.filter((t) => t >= since).length
  }

  recordHit(t: number): void {
    this.quotaHits = [...this.quotaHits.filter((x) => t - x < 40 * DAY), t]
    this.bump('limit', t)
  }

  recordGuardPause(t: number): void {
    this.bump('guard', t)
  }

  /** Counts one more of an event */
  bump(name: keyof Counters, t = Date.now()): void {
    const c: Counter = this.counters[name] ?? { n: 0, first: t }
    c.n++
    if (c.n === 10) c.at10 = t
    this.counters[name] = c
    this.save()
  }

  /** remembers a theme pack as tried */
  tryPack(key: string, t = Date.now()): void {
    if (key === 'none' || this.packsTried.some((p) => p.key === key)) return
    this.packsTried = [...this.packsTried, { key, at: t }]
    this.save()
  }

  /** Debounced write */
  save(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      // quota keys only matter while their window is open: keep the newest few hundred
      const keys = [...this.quotaKeys].slice(-300)
      const body = {
        firedAlerts: [...this.firedAlerts],
        quotaKeys: keys,
        quotaHits: this.quotaHits,
        seenAchievements: this.seenAchievements ? [...this.seenAchievements] : null,
        counters: this.counters,
        lastReportDay: this.lastReportDay,
        tgKeyboard: this.tgKeyboard,
        dayNightPhase: this.dayNightPhase,
        packsTried: this.packsTried
      }
      void writeFile(this.path, JSON.stringify(body), 'utf8').catch(() => {})
    }, 300)
  }
}
