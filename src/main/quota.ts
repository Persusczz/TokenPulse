import { EventEmitter } from 'node:events'
import { readFile, stat } from 'node:fs/promises'
import type { QuotaBurn, QuotaInfo, QuotaSource, QuotaWindow } from '@shared/types'
import { writeFileAtomic } from './atomicFile'

export const OAUTH_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const HOUR = 3600_000
export const WINDOW_MS = 5 * HOUR
/** statusline readings older than this lose to a newer OAuth fetch in auto mode */
const STATUSLINE_FRESH_MS = 15 * 60_000

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

const KIND_LABELS: Record<string, string> = {
  session: '5 小时会话',
  weekly_all: '7 天 · 全部模型',
  weekly_opus: '7 天 · Opus',
  weekly_sonnet: '7 天 · Sonnet'
}

const LEGACY_KEYS: Record<string, string> = {
  five_hour: '5 小时会话',
  seven_day: '7 天 · 全部模型',
  seven_day_opus: '7 天 · Opus',
  seven_day_sonnet: '7 天 · Sonnet'
}

const PLAN_LABELS: Record<string, string> = { pro: 'Pro', max: 'Max', team: 'Team', enterprise: 'Enterprise', free: 'Free' }

/** "Max 5x" / "Max 20x" from the rate-limit tier stored with the login */
export function planLabel(subscriptionType: unknown, rateLimitTier: unknown): string | undefined {
  if (typeof subscriptionType !== 'string') return undefined
  const base = PLAN_LABELS[subscriptionType] ?? subscriptionType
  const tier = typeof rateLimitTier === 'string' ? /(\d+)x/i.exec(rateLimitTier) : null
  return base === 'Max' && tier ? `Max ${tier[1]}x` : base
}

const FIVE_HOUR_KEYS = ['session', 'five_hour']
const SEVEN_DAY_KEYS = ['weekly_all', 'seven_day']
export const fiveHourWindow = (ws: QuotaWindow[]) => ws.find((w) => FIVE_HOUR_KEYS.includes(w.key))
export const sevenDayWindow = (ws: QuotaWindow[]) => ws.find((w) => SEVEN_DAY_KEYS.includes(w.key))

/**
 * Parses the (undocumented) OAuth usage response. Prefers the `limits` list;
 * falls back to the known window keys. Other top-level keys are internal
 * codenames and are ignored on purpose.
 */
export function parseQuota(json: any): Pick<QuotaInfo, 'windows' | 'breakdown'> {
  const windows: QuotaWindow[] = []
  if (Array.isArray(json?.limits)) {
    for (const l of json.limits) {
      if (!l || typeof l.percent !== 'number' || typeof l.kind !== 'string') continue
      windows.push({
        key: l.kind,
        label: KIND_LABELS[l.kind] ?? l.kind.replace(/_/g, ' '),
        utilization: l.percent,
        resetsAt: typeof l.resets_at === 'string' ? l.resets_at : null,
        severity: typeof l.severity === 'string' ? l.severity : null
      })
    }
  }
  if (!windows.length) {
    for (const [key, label] of Object.entries(LEGACY_KEYS)) {
      const w = json?.[key]
      if (!w || typeof w.utilization !== 'number') continue
      windows.push({
        key,
        label,
        utilization: w.utilization,
        resetsAt: typeof w.resets_at === 'string' ? w.resets_at : null,
        severity: null
      })
    }
  }
  const rows = json?.seven_day_breakdown?.rows
  const breakdown = Array.isArray(rows)
    ? rows
        .filter((r: any) => r && typeof r.percent === 'number' && typeof r.display_name === 'string')
        .map((r: any) => ({ name: r.display_name as string, percent: r.percent as number }))
    : []
  return { windows, breakdown }
}

/** `rate_limits` as Claude Code hands it to statusline commands (resets_at in epoch seconds) */
export function parseStatuslineLimits(limits: any): QuotaWindow[] {
  const out: QuotaWindow[] = []
  for (const key of ['five_hour', 'seven_day'] as const) {
    const w = limits?.[key]
    if (!w || typeof w.used_percentage !== 'number') continue
    out.push({
      key,
      label: LEGACY_KEYS[key],
      utilization: w.used_percentage,
      resetsAt: typeof w.resets_at === 'number' && w.resets_at > 0 ? new Date(w.resets_at * 1000).toISOString() : null,
      severity: null
    })
  }
  return out
}

/** A window whose reset time has passed is empty until the next reading */
export function settle(windows: QuotaWindow[], now: number): QuotaWindow[] {
  return windows.map((w) => {
    const r = w.resetsAt ? Date.parse(w.resetsAt) : NaN
    return r <= now ? { ...w, utilization: 0, resetsAt: null, severity: null } : w
  })
}

/** Overlays fresher 5h / 7d numbers onto a richer reading */
export function mergeWindows(base: QuotaWindow[], fresh: QuotaWindow[]): QuotaWindow[] {
  const f5 = fiveHourWindow(fresh)
  const f7 = sevenDayWindow(fresh)
  const out = base.map((w) => {
    const f = FIVE_HOUR_KEYS.includes(w.key) ? f5 : SEVEN_DAY_KEYS.includes(w.key) ? f7 : undefined
    return f ? { ...w, utilization: f.utilization, resetsAt: f.resetsAt ?? w.resetsAt } : w
  })
  if (f5 && !fiveHourWindow(base)) out.unshift(f5)
  if (f7 && !sevenDayWindow(base)) out.splice(f5 && !fiveHourWindow(base) ? 1 : 0, 0, f7)
  return out
}

export interface LocalEstimator {
  /** API-equivalent spend (USD) in [start, end) */
  spend(start: number, end: number): number
  /** the 5h window active at `now` according to local logs */
  window(now: number): { start: number; end: number } | null
}

export interface QuotaConfig {
  enabled: boolean
  source: QuotaSource
  limitUsd: number | null
  pauseAt: number
  guardOn: boolean
}

interface Sample {
  t: number
  pct: number
  reset: string | null
}

/**
 * Subscription usage windows from one of three sources:
 * - oauth: the usage endpoint Claude Code's /usage uses, with its stored OAuth token
 *   (never refreshed or written here; an expired token is reported)
 * - statusline: the documented `rate_limits` Claude Code passes to statusline
 *   commands, saved by the TokenPulse statusline bridge
 * - local: an estimate from local logs, calibrated against official readings
 * 'auto' uses OAuth, overlays fresher statusline numbers, and falls back to the
 * statusline and then the local estimate.
 */
export class QuotaService extends EventEmitter {
  info: QuotaInfo = { status: 'loading', windows: [], breakdown: [] }
  /** null until the first configure, so starting disabled still reports 'disabled' */
  private cfg: QuotaConfig | null = null
  private oauth: QuotaInfo | null = null
  private statusline: { at: number; windows: QuotaWindow[] } | null = null
  private statuslineMtime = 0
  private samples: Sample[] = []
  private calibUsd: number | null = null
  private timer: NodeJS.Timeout | null = null
  /** the usage endpoint rate-limits; after a 429 it is left alone until then */
  private backoffUntil = 0
  private backoffMs = 0
  private inflight: Promise<QuotaInfo> | null = null

  constructor(
    private credPath: () => string | null,
    private fetchFn: Fetch,
    private statuslinePath: string,
    private calibPath: string,
    private estimator: LocalEstimator
  ) {
    super()
  }

  async loadCalibration(): Promise<void> {
    try {
      const v = JSON.parse(await readFile(this.calibPath, 'utf8'))?.limitUsd
      if (typeof v === 'number' && v > 0) this.calibUsd = v
    } catch {
      /* none yet */
    }
  }

  get calibratedLimit(): number | null {
    return this.calibUsd
  }

  configure(next: QuotaConfig): void {
    const prev = this.cfg
    this.cfg = next
    if (!next.enabled) {
      this.stopTimer()
      this.set({ status: 'disabled', windows: [], breakdown: [] })
      return
    }
    if (!prev || !prev.enabled || prev.source !== next.source) void this.refresh()
    else this.recompute()
  }

  private stopTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Faster polling while the guard is armed and the 5h window is close to its threshold */
  private pollMs(): number {
    const five = fiveHourWindow(this.info.windows)
    return this.cfg?.guardOn && five && five.utilization >= this.cfg.pauseAt - 15 ? 90_000 : 180_000
  }

  private set(info: QuotaInfo): void {
    this.info = info
    this.emit('change', info)
  }

  /** Concurrent callers share one in-flight refresh */
  refresh(): Promise<QuotaInfo> {
    this.inflight ??= this.doRefresh().finally(() => (this.inflight = null))
    return this.inflight
  }

  private async doRefresh(): Promise<QuotaInfo> {
    const cfg = this.cfg
    if (!cfg?.enabled) return this.info
    this.stopTimer()
    await this.readStatusline(true)
    if (cfg.source === 'oauth' || cfg.source === 'auto') await this.fetchOauth()
    this.recompute()
    if (this.cfg?.enabled) this.timer = setTimeout(() => void this.refresh(), this.pollMs())
    return this.info
  }

  /** Re-reads the statusline bridge file if it changed */
  async checkStatusline(): Promise<void> {
    if (this.cfg?.enabled && (await this.readStatusline(false))) this.recompute()
  }

  private async readStatusline(force: boolean): Promise<boolean> {
    try {
      const st = await stat(this.statuslinePath)
      if (!force && st.mtimeMs === this.statuslineMtime) return false
      this.statuslineMtime = st.mtimeMs
      const j = JSON.parse(await readFile(this.statuslinePath, 'utf8'))
      const windows = parseStatuslineLimits(j?.rate_limits)
      if (!windows.length) return false
      this.statusline = { at: Number(j.updatedAt) || st.mtimeMs, windows }
      return true
    } catch {
      return false
    }
  }

  private async fetchOauth(): Promise<void> {
    if (Date.now() < this.backoffUntil) return
    const path = this.credPath()
    if (!path) {
      this.oauth = { status: 'no-credentials', windows: [], breakdown: [], origin: 'oauth' }
      return
    }
    let oauth: any
    try {
      oauth = JSON.parse(await readFile(path, 'utf8'))?.claudeAiOauth
    } catch {
      oauth = null
    }
    if (!oauth?.accessToken) {
      this.oauth = { status: 'no-credentials', windows: [], breakdown: [], origin: 'oauth' }
      return
    }
    const plan = planLabel(oauth.subscriptionType, oauth.rateLimitTier)
    const last = this.oauth?.windows.length ? this.oauth : { status: 'error' as const, windows: [], breakdown: [] }
    if (typeof oauth.expiresAt === 'number' && oauth.expiresAt < Date.now()) {
      this.oauth = { ...last, status: 'expired', plan, origin: 'oauth' }
      return
    }
    try {
      const res = await this.fetchFn(OAUTH_USAGE_URL, {
        headers: {
          Authorization: `Bearer ${oauth.accessToken}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'User-Agent': 'TokenPulse/1.1'
        },
        signal: AbortSignal.timeout(20000)
      })
      if (res.status === 401) this.oauth = { ...last, status: 'expired', plan, origin: 'oauth' }
      else if (res.status === 429) {
        const retry = Number(res.headers.get('retry-after'))
        this.backoffMs = Math.min(30 * 60_000, Math.max(this.backoffMs * 2, 5 * 60_000))
        const wait = retry > 0 ? Math.min(60 * 60_000, retry * 1000) : this.backoffMs
        this.backoffUntil = Date.now() + wait
        this.oauth = { ...last, status: 'error', plan, error: `接口限流（HTTP 429），${Math.ceil(wait / 60_000)} 分钟后再试`, origin: 'oauth' }
      } else if (!res.ok) this.oauth = { ...last, status: 'error', plan, error: `HTTP ${res.status}`, origin: 'oauth' }
      else {
        this.backoffMs = 0
        this.oauth = { status: 'ok', plan, fetchedAt: Date.now(), origin: 'oauth', ...parseQuota(await res.json()) }
      }
    } catch (e) {
      this.oauth = { ...last, status: 'error', plan, error: (e as Error).message, origin: 'oauth' }
    }
  }

  private fromStatusline(plan?: string): QuotaInfo {
    const sl = this.statusline
    if (!sl) return { status: 'no-data', windows: [], breakdown: [], origin: 'statusline', plan }
    return { status: 'ok', windows: sl.windows, breakdown: [], fetchedAt: sl.at, origin: 'statusline', plan }
  }

  /** The newest official 5h reset time still in the future */
  private knownReset(now: number): number | null {
    for (let i = this.samples.length - 1; i >= 0; i--) {
      const r = this.samples[i].reset ? Date.parse(this.samples[i].reset!) : NaN
      if (r > now && r - now <= WINDOW_MS) return r
    }
    return null
  }

  private localInfo(now: number, plan?: string): QuotaInfo {
    const reset = this.knownReset(now)
    const win = reset ? { start: reset - WINDOW_MS, end: reset } : this.estimator.window(now)
    const limitUsd = this.cfg?.limitUsd ?? this.calibUsd
    const usedUsd = win ? this.estimator.spend(win.start, now + 1) : 0
    const local = {
      usedUsd,
      limitUsd,
      calibrated: !this.cfg?.limitUsd && !!this.calibUsd,
      windowStart: win?.start ?? now,
      windowEnd: win?.end ?? now
    }
    const windows: QuotaWindow[] = limitUsd
      ? [
          {
            key: 'five_hour',
            label: '5 小时会话 · 估算',
            utilization: (usedUsd / limitUsd) * 100,
            resetsAt: win ? new Date(win.end).toISOString() : null,
            severity: null
          }
        ]
      : []
    return { status: 'ok', windows, breakdown: [], fetchedAt: now, origin: 'local', local, plan }
  }

  /** Combines the cached readings according to the chosen source */
  recompute(): void {
    const cfg = this.cfg
    if (!cfg?.enabled) return
    const now = Date.now()
    const sl = this.statusline
    const oa = this.oauth
    let info: QuotaInfo
    switch (cfg.source) {
      case 'oauth':
        info = oa ?? { status: 'loading', windows: [], breakdown: [] }
        break
      case 'statusline':
        info = this.fromStatusline(oa?.plan)
        break
      case 'local':
        info = this.localInfo(now, oa?.plan)
        break
      default:
        if (oa?.windows.length) {
          info = oa
          if (sl && sl.at > (oa.fetchedAt ?? 0) && now - sl.at < STATUSLINE_FRESH_MS) {
            info = { ...oa, windows: mergeWindows(oa.windows, sl.windows), fetchedAt: sl.at, origin: 'statusline' }
          }
        } else if (sl) {
          info = { ...this.fromStatusline(oa?.plan), error: oa?.error }
        } else if (!oa) {
          info = { status: 'loading', windows: [], breakdown: [] }
        } else {
          // the official sources failed: estimate, but keep the reason visible
          const reason = oa.status === 'expired' ? '登录令牌已过期' : oa.status === 'no-credentials' ? '未找到登录凭据' : oa.error
          info = { ...this.localInfo(now, oa.plan), error: reason }
        }
    }
    info = { ...info, windows: settle(info.windows, now) }
    this.record(info, now)
    info.burn = this.burn(info, now)
    this.set(info)
  }

  /** Keeps official 5h samples for the burn rate and calibrates the local estimate */
  private record(info: QuotaInfo, now: number): void {
    if (info.origin === 'local' || info.status === 'loading') return
    const five = fiveHourWindow(info.windows)
    if (!five) return
    const t = info.fetchedAt ?? now
    const last = this.samples[this.samples.length - 1]
    if (last && last.t >= t) return
    this.samples.push({ t, pct: five.utilization, reset: five.resetsAt })
    this.samples = this.samples.filter((s) => now - s.t <= 2 * HOUR)

    const reset = five.resetsAt ? Date.parse(five.resetsAt) : NaN
    if (five.utilization >= 5 && reset > now) {
      const used = this.estimator.spend(reset - WINDOW_MS, now + 1)
      if (used > 0) {
        const est = used / (five.utilization / 100)
        this.calibUsd = this.calibUsd ? this.calibUsd * 0.7 + est * 0.3 : est
        void writeFileAtomic(this.calibPath, JSON.stringify({ limitUsd: this.calibUsd, at: now })).catch(() => {})
      }
    }
  }

  private burn(info: QuotaInfo, now: number): QuotaBurn | null {
    const five = fiveHourWindow(info.windows)
    if (!five || !this.cfg) return null
    let rate: number | null = null
    const recent = this.samples.filter((s) => s.reset === five.resetsAt && now - s.t <= 45 * 60_000)
    const a = recent[0]
    const b = recent[recent.length - 1]
    if (info.origin !== 'local' && a && b && b.t - a.t >= 8 * 60_000) {
      rate = (b.pct - a.pct) / ((b.t - a.t) / HOUR)
    } else {
      const limit = this.cfg.limitUsd ?? this.calibUsd
      if (limit) rate = ((this.estimator.spend(now - 30 * 60_000, now + 1) * 2) / limit) * 100
    }
    if (rate === null) return null
    rate = Math.max(0, rate)
    const reset = five.resetsAt ? Date.parse(five.resetsAt) : null
    const eta = (target: number): number | null => {
      if (five.utilization >= target || rate! < 0.05) return null
      const t = now + ((target - five.utilization) / rate!) * HOUR
      return reset && t > reset ? null : t
    }
    return { pctPerHour: rate, etaPause: eta(this.cfg.pauseAt), etaFull: eta(100) }
  }
}
