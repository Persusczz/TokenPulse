import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import type { CodexResetPost, CodexResets, QuotaCycle, ResetEffect } from '@shared/types'
import { writeFileAtomic } from './atomicFile'

/**
 * Tibo (@thsottiaux, who leads Codex) announces Codex limit resets on X, and
 * sometimes hints at one first. Reading X itself needs a paid API key (the
 * free endpoints answer 401 / 429), so the posts come from Codex Resets
 * (codex-resets.com), which watches his account and offers a free, keyless
 * read-only API: the latest reset, one announced but not yet seen landing,
 * a hint with its chance, and the whole history with links to the posts.
 * Their terms ask for a link back wherever the data is shown.
 */

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export const RESETS_SITE = 'https://codex-resets.com'
const HOUR = 3_600_000
const DAY = 24 * HOUR
const WEEK = 7 * DAY

const time = (v: unknown): number | null => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isFinite(t) ? t : null
}
const str = (v: unknown) => (typeof v === 'string' ? v : '')
/** X shortens links in a post to t.co; one at the very end is the post's own media */
const tidyText = (t: string) => t.replace(/\s*https:\/\/t\.co\/\w+\s*$/, '').trim()

export function postOf(r: any): CodexResetPost | null {
  const at = time(r?.announced_at)
  if (!r || typeof r.id !== 'string' || at === null) return null
  const src = r.source ?? {}
  return {
    id: r.id,
    kind: r.reset_type === 'banked' ? 'banked' : 'regular',
    at,
    text: tidyText(str(r.text)),
    url: typeof src.url === 'string' && /^https:\/\/(x|twitter)\.com\//.test(src.url) ? src.url : null,
    observed: src.type === 'observed'
  }
}

/** the parts of /api/v1/status the app shows */
export function statusOf(j: any): Pick<CodexResets, 'latest' | 'scheduled' | 'hint' | 'stats'> | null {
  const d = j?.data
  if (!d || typeof d !== 'object') return null
  const s = d.scheduled_reset
  const sp = s ? postOf(s) : null
  const w = d.active_watch
  const wAt = time(w?.observed_at)
  const wUntil = time(w?.expires_at)
  const url = (v: any) => (typeof v?.url === 'string' && /^https:\/\/(x|twitter)\.com\//.test(v.url) ? v.url : null)
  return {
    latest: d.latest_reset ? postOf(d.latest_reset) : null,
    scheduled: sp ? { ...sp, due: time(s.scheduled_for) } : null,
    hint:
      w && wAt !== null && wUntil !== null
        ? {
            level: w.level === 'strong' ? 'strong' : 'elevated',
            chance: Number.isFinite(w.reset_chance_percent) ? Math.max(0, Math.min(100, Math.round(w.reset_chance_percent))) : null,
            window: str(w.forecast_window),
            at: wAt,
            until: wUntil,
            text: tidyText(str(w.text)),
            url: url(w.source)
          }
        : null,
    stats: d.stats ? { total: Number.isFinite(d.stats.total) ? d.stats.total : 0, avgDays: Number.isFinite(d.stats.avg_interval_days) ? d.stats.avg_interval_days : null } : null
  }
}

/** /api/v1/resets as posts, newest first */
export function historyOf(j: any): CodexResetPost[] {
  const list = Array.isArray(j?.data) ? j.data : []
  return list
    .map(postOf)
    .filter((p: CodexResetPost | null): p is CodexResetPost => !!p)
    .sort((a: CodexResetPost, b: CodexResetPost) => b.at - a.at)
}

export type ResetNews =
  | { kind: 'reset'; post: CodexResetPost }
  | { kind: 'scheduled'; post: CodexResetPost & { due: number | null } }
  | { kind: 'hint'; hint: NonNullable<CodexResets['hint']> }

/** keys for what has been told already */
export const newsKey = (n: ResetNews) => (n.kind === 'hint' ? `hint:${n.hint.at}` : `${n.kind}:${n.post.id}`)

/** what a read brings that the user hasn't been told: a reset (regular or banked), one announced ahead, a hint */
export function newsOf(r: CodexResets, told: Set<string>, now: number): ResetNews[] {
  const out: ResetNews[] = []
  // only fresh things: a reset from days ago isn't news after a week offline
  if (r.latest && now - r.latest.at < DAY) out.push({ kind: 'reset', post: r.latest })
  if (r.scheduled && now - r.scheduled.at < DAY) out.push({ kind: 'scheduled', post: r.scheduled })
  if (r.hint && r.hint.until > now) out.push({ kind: 'hint', hint: r.hint })
  return out.filter((n) => !told.has(newsKey(n)))
}

/**
 * What a reset announced at `at` did to the user's Codex week: the reading
 * the week had reached, and whether it was started over. cycles.ts ends a
 * week where a new one starts inside it, so a week cut short around the
 * announcement is one the reset ended. Resets roll out over a while and the
 * "all propagated" post can come after, hence the slack. Null when the user
 * had no known week open then.
 */
export function effectOf(at: number, weeks: QuotaCycle[], readAt: number | null): ResetEffect | null {
  const SLACK = 6 * HOUR
  const known = weeks.filter((c) => !c.estimated)
  const open = known.find((c) => c.start <= at && at < c.end + SLACK)
  if (!open) return null
  const restarted = open.end < open.start + WEEK - HOUR
  // not restarted, for sure: that week is still the one open by a reading taken after the post, or it ran its full
  // length into a week that came after it
  const checked = restarted || (open.current && readAt !== null && readAt > at) || known.some((c) => c !== open && c.start >= open.end - 10 * 60_000)
  return { before: open.pct, restarted, checked }
}

interface Saved {
  at: number | null
  latest: CodexResetPost | null
  scheduled: CodexResets['scheduled']
  hint: CodexResets['hint']
  stats: CodexResets['stats']
  history: CodexResetPost[]
  historyAt: number
  told: string[]
}

export class ResetWatchService extends EventEmitter {
  state: CodexResets = { status: 'off', at: null, latest: null, scheduled: null, hint: null, stats: null, history: [] }
  private historyAt = 0
  private told = new Set<string>()
  /** a file existed: news is told from the first read on; without one the first read only learns what is there */
  private known = false
  private loaded = false
  private busy: Promise<void> | null = null
  private nextAt = 0

  constructor(
    private fetchFn: Fetch,
    private path: string,
    private api = `${RESETS_SITE}/api/v1`
  ) {
    super()
  }

  private set(patch: Partial<CodexResets>): void {
    this.state = { ...this.state, ...patch }
    this.emit('state', this.state)
  }

  async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const s: Saved = JSON.parse(await readFile(this.path, 'utf8'))
      this.state = { ...this.state, at: s.at ?? null, latest: s.latest ?? null, scheduled: s.scheduled ?? null, hint: s.hint ?? null, stats: s.stats ?? null, history: Array.isArray(s.history) ? s.history : [] }
      this.historyAt = s.historyAt ?? 0
      this.told = new Set(Array.isArray(s.told) ? s.told : [])
      this.known = true
    } catch {
      /* first run */
    }
  }

  private async save(): Promise<void> {
    const { at, latest, scheduled, hint, stats, history } = this.state
    const s: Saved = { at, latest, scheduled, hint, stats, history, historyAt: this.historyAt, told: [...this.told].slice(-200) }
    await writeFileAtomic(this.path, JSON.stringify(s)).catch(() => {})
  }

  private async get(path: string): Promise<any> {
    const res = await this.fetchFn(`${this.api}${path}`, { headers: { Accept: 'application/json', 'User-Agent': 'TokenPulse' }, signal: AbortSignal.timeout(20_000) })
    if (!res.ok) throw new Error(res.status === 429 ? '请求太频繁，稍后再试' : `HTTP ${res.status}`)
    return res.json()
  }

  /** time for another read: every 10 minutes, every 3 while a reset is hinted at or announced ahead */
  due(now = Date.now()): boolean {
    return now >= this.nextAt
  }

  /** reads the tracker; resolves with the news to tell (none on the very first read) */
  poll(now = Date.now()): Promise<ResetNews[]> {
    let news: ResetNews[] = []
    this.busy ??= this.read(now)
      .then((n) => void (news = n))
      .finally(() => (this.busy = null))
    return this.busy.then(() => news)
  }

  private async read(now: number): Promise<ResetNews[]> {
    await this.load()
    if (!this.state.at) this.set({ status: 'loading' })
    try {
      const st = statusOf(await this.get('/status'))
      if (!st) throw new Error('接口返回的数据看不懂')
      let history = this.state.history
      // the full list again when a reset is missing from it, and once a day
      if (!history.length || (st.latest && !history.some((p) => p.id === st.latest!.id)) || now - this.historyAt > DAY) {
        history = historyOf(await this.get('/resets?limit=100'))
        this.historyAt = now
      }
      if (st.latest && !history.some((p) => p.id === st.latest!.id)) history = [st.latest, ...history]
      this.set({ status: 'ok', at: now, error: undefined, ...st, history })
      const news = newsOf(this.state, this.told, now)
      for (const n of news) this.told.add(newsKey(n))
      const tell = this.known ? news : []
      this.known = true
      this.nextAt = now + (st.hint || st.scheduled ? 3 : 10) * 60_000
      await this.save()
      return tell
    } catch (e) {
      this.nextAt = now + 5 * 60_000
      this.set({ status: 'error', error: `读不到 codex-resets.com：${e instanceof Error ? e.message : String(e)}` })
      return []
    }
  }

  /** switched off */
  idle(): void {
    if (this.state.status !== 'off') this.set({ status: 'off', error: undefined })
    this.nextAt = 0
  }
}
