import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import type { ChallengeDay, ChallengeEntry, CodexResetPost, CodexResets, QuotaCycle, ResetEffect, ResetLang, TiboChallenge } from '@shared/types'
import { writeFileAtomic } from './atomicFile'

/**
 * Tibo (@thsottiaux, who leads Codex) announces Codex limit resets on X, and
 * sometimes hints at one first. Reading X itself needs a paid API key (the
 * free endpoints answer 401 / 429), so the posts come from Codex Resets
 * (codex-resets.com), which watches his account and offers a free, keyless
 * read-only API: the latest reset, one announced but not yet seen landing,
 * a hint with its chance, and the whole history with links to the posts.
 * Their terms ask for a link back wherever the data is shown.
 *
 * Two things the public API doesn't carry come from the site itself: the
 * posts in other languages (the feed its own pages read, ?locale=…) and
 * Tibo's 28-day challenge (its /tibo-28 page). Both are extras: when either
 * fails the card keeps the posts as written and the last challenge it read.
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

/** the site's own feed in a language: post id → the post as the site translates it ('hint' = the hint's post) */
export function localOf(j: any): Record<string, string> {
  const out: Record<string, string> = {}
  const add = (e: any, key: unknown = e?.tweet_id) => {
    const t = tidyText(str(e?.display_text))
    if (typeof key === 'string' && t) out[key] = t
  }
  for (const e of Array.isArray(j?.events) ? j.events : []) add(e)
  if (j?.scheduled) add(j.scheduled)
  if (j?.watch) add(j.watch, 'hint')
  return out
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const decode = (t: string) =>
  t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m
  })
const plain = (h: string) => decode(h.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim()
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null
const xUrl = (u: string | null) => (u && /^https:\/\/(x|twitter)\.com\//.test(u) ? decode(u) : null)
const count = (v: string | undefined) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : null)

/** the challenge page's path in a language */
export const challengePath = (lang: ResetLang) => (lang === 'en' ? '/tibo-28' : `/${lang}/tibo-28`)

/**
 * Tibo's 28-day challenge, read off the site's /tibo-28 page: the day strip
 * (each day kept by an improvement or a reset, or still ahead), the log of
 * what was shipped each day with the site's votes, and the promise itself.
 * Null when the page has no challenge on it.
 */
export function challengeOf(html: string, url: string, now: number): TiboChallenge | null {
  const clock = html.match(/<[^>]*\sdata-challenge-clock\b[^>]*>/)?.[0]
  const start = clock ? attr(clock, 'data-start') : null
  const days = Number(clock ? attr(clock, 'data-days') : NaN)
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isInteger(days) || days < 1 || days > 100) return null

  const states = new Map<number, ChallengeDay['state']>()
  const strip = html.match(/<ol class="challenge-strip"[\s\S]*?<\/ol>/)?.[0] ?? ''
  for (const m of strip.matchAll(/<li class="([^"]*)"[^>]*>([\s\S]*?)<\/li>/g)) {
    const day = Number(m[2].match(/challenge-cell-day[^>]*>\s*(\d+)\s*</)?.[1])
    if (!day) continue
    const tags = [...m[1].matchAll(/challenge-state--([\w-]+)/g)].map((t) => t[1])
    states.set(
      day,
      tags.includes('reset') ? 'reset' : tags.includes('improvement') ? 'improvement' : tags.includes('upcoming') ? 'upcoming' : tags.some((t) => /miss|broke|fail|skip/.test(t)) ? 'missed' : 'open'
    )
  }

  const logs = new Map<number, ChallengeEntry[]>()
  const ledger = html.match(/<ol class="challenge-ledger"[^>]*>([\s\S]*?)<\/ol>/)?.[1] ?? ''
  for (const row of ledger.split(/<li class="challenge-row/).slice(1)) {
    const day = Number(row.match(/^[^>]*\sid="day-(\d+)"/)?.[1])
    if (!day) continue
    const entries: ChallengeEntry[] = []
    for (const a of row.matchAll(/<article class="challenge-entry challenge-entry--([\w-]+)"[^>]*>([\s\S]*?)<\/article>/g)) {
      const body = a[2]
      const head = body.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1] ?? ''
      const link = head.match(/<a\s[^>]*>/)?.[0]
      const url = xUrl(link ? attr(link, 'href') : null)
      const when = Date.parse(body.match(/<time datetime="([^"]*T[^"]*)"/)?.[1] ?? '')
      const title = plain(head)
      if (!title) continue
      entries.push({
        id: body.match(/data-vote-entry="post:([^"]+)"/)?.[1] ?? url?.match(/status\/(\d+)/)?.[1] ?? `${day}-${entries.length}`,
        kind: a[1] === 'reset' ? 'reset' : 'improvement',
        title,
        text: [...body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((p) => plain(p[1])).filter(Boolean).join('\n'),
        url,
        at: Number.isFinite(when) ? when : null,
        up: count(body.match(/data-vote-choice="1"[\s\S]*?data-value="(\d+)"/)?.[1]),
        down: count(body.match(/data-vote-choice="-1"[\s\S]*?data-value="(\d+)"/)?.[1])
      })
    }
    logs.set(day, entries)
  }

  const quote = html.match(/<figure class="challenge-promise"[\s\S]*?(<blockquote[^>]*>)([\s\S]*?)<\/blockquote>/)
  const first = Date.parse(`${start}T00:00:00Z`)
  const list: ChallengeDay[] = Array.from({ length: days }, (_, i) => {
    const day = i + 1
    const entries = logs.get(day) ?? []
    const state = states.get(day) ?? (entries.some((e) => e.kind === 'reset') ? 'reset' : entries.length ? 'improvement' : 'upcoming')
    return { day, date: new Date(first + i * DAY).toISOString().slice(0, 10), state, entries }
  })
  return {
    start,
    days,
    list,
    promise: quote ? { text: plain(quote[2]).replace(/^[“"「]|[”"」]$/g, ''), url: xUrl(attr(quote[1], 'cite')) } : null,
    url,
    at: now
  }
}

/** still worth reading often: running, or just over (its dates are Pacific; a day either side covers that) */
export function challengeLive(c: TiboChallenge | null | undefined, now: number): boolean {
  if (!c) return false
  const from = Date.parse(`${c.start}T00:00:00Z`)
  return now >= from - DAY && now < from + (c.days + 2) * DAY
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
  local?: Record<string, string>
  localLang?: ResetLang | null
  localAt?: number
  challenge?: TiboChallenge | null
  challengeLang?: ResetLang | null
  challengeAt?: number
}

export class ResetWatchService extends EventEmitter {
  state: CodexResets = { status: 'off', at: null, latest: null, scheduled: null, hint: null, stats: null, history: [], lang: 'en', local: {}, challenge: null }
  private historyAt = 0
  private lang: ResetLang = 'en'
  /** the translations held, and the language they are in */
  private local: Record<string, string> = {}
  private localLang: ResetLang | null = null
  private localAt = 0
  private challengeLang: ResetLang | null = null
  private challengeAt = 0
  private told = new Set<string>()
  /** a file existed: news is told from the first read on; without one the first read only learns what is there */
  private known = false
  private loaded = false
  private busy: Promise<void> | null = null
  private nextAt = 0

  constructor(
    private fetchFn: Fetch,
    private path: string,
    private api = `${RESETS_SITE}/api/v1`,
    private site = api.replace(/\/api\/v1\/?$/, '')
  ) {
    super()
  }

  private set(patch: Partial<CodexResets>): void {
    this.state = { ...this.state, ...patch, lang: this.lang, local: this.localLang === this.lang ? this.local : {} }
    this.emit('state', this.state)
  }

  /** the language to show posts and the challenge in; a change reads again soon */
  setLang(lang: ResetLang): void {
    if (lang === this.lang) return
    this.lang = lang
    this.nextAt = 0
    this.set({})
  }

  async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const s: Saved = JSON.parse(await readFile(this.path, 'utf8'))
      this.local = s.local && typeof s.local === 'object' ? s.local : {}
      this.localLang = s.localLang ?? null
      this.localAt = s.localAt ?? 0
      this.challengeLang = s.challengeLang ?? null
      this.challengeAt = s.challengeAt ?? 0
      this.state = {
        ...this.state,
        at: s.at ?? null,
        latest: s.latest ?? null,
        scheduled: s.scheduled ?? null,
        hint: s.hint ?? null,
        stats: s.stats ?? null,
        history: Array.isArray(s.history) ? s.history : [],
        lang: this.lang,
        local: this.localLang === this.lang ? this.local : {},
        challenge: s.challenge ?? null
      }
      this.historyAt = s.historyAt ?? 0
      this.told = new Set(Array.isArray(s.told) ? s.told : [])
      this.known = true
    } catch {
      /* first run */
    }
  }

  private async save(): Promise<void> {
    const { at, latest, scheduled, hint, stats, history, challenge } = this.state
    const s: Saved = {
      at,
      latest,
      scheduled,
      hint,
      stats,
      history,
      historyAt: this.historyAt,
      told: [...this.told].slice(-200),
      local: this.local,
      localLang: this.localLang,
      localAt: this.localAt,
      challenge,
      challengeLang: this.challengeLang,
      challengeAt: this.challengeAt
    }
    await writeFileAtomic(this.path, JSON.stringify(s)).catch(() => {})
  }

  private async get(path: string, base = this.api): Promise<any> {
    const res = await this.fetchFn(`${base}${path}`, { headers: { Accept: 'application/json', 'User-Agent': 'TokenPulse' }, signal: AbortSignal.timeout(20_000) })
    if (!res.ok) throw new Error(res.status === 429 ? '请求太频繁，稍后再试' : `HTTP ${res.status}`)
    return res.json()
  }

  /** the posts in the chosen language: when it changes, when something shown has none yet (the site may take a while), and daily */
  private async translate(st: NonNullable<ReturnType<typeof statusOf>>, now: number): Promise<void> {
    const lang = this.lang
    if (lang === 'en') return
    const fresh = this.localLang === lang
    const missing = [st.latest?.id, st.scheduled?.id, st.hint ? 'hint' : undefined].some((id) => id && !(id in this.local))
    if (fresh && !(missing && now - this.localAt > 15 * 60_000) && now - this.localAt < DAY) return
    try {
      const local = localOf(await this.get(`/api/resets?locale=${encodeURIComponent(lang)}`, this.site))
      if (this.lang !== lang) return
      this.local = fresh ? { ...this.local, ...local } : local
      this.localLang = lang
      this.localAt = now
    } catch {
      /* the posts stay as written */
    }
  }

  /** the challenge page: about every read while it runs, daily otherwise (a new one may start) */
  private async readChallenge(now: number): Promise<void> {
    const lang = this.lang
    const often = !this.challengeAt || challengeLive(this.state.challenge, now)
    if (this.challengeLang === lang && now - this.challengeAt < (often ? 9 * 60_000 : DAY)) return
    const path = challengePath(lang)
    try {
      const res = await this.fetchFn(`${this.site}${path}`, { headers: { Accept: 'text/html', 'User-Agent': 'TokenPulse' }, signal: AbortSignal.timeout(20_000) })
      if (!res.ok && res.status !== 404) return
      const challenge = res.ok ? challengeOf(await res.text(), `${RESETS_SITE}${path}`, now) : null
      if (this.lang !== lang) return
      this.state = { ...this.state, challenge }
      this.challengeLang = lang
      this.challengeAt = now
    } catch {
      /* the last one read stays */
    }
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
    const lang = this.lang
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
      await this.translate(st, now)
      await this.readChallenge(now)
      this.set({ status: 'ok', at: now, error: undefined, ...st, history })
      const news = newsOf(this.state, this.told, now)
      for (const n of news) this.told.add(newsKey(n))
      const tell = this.known ? news : []
      this.known = true
      // a language picked while this read was out is read right after
      this.nextAt = this.lang !== lang ? 0 : now + (st.hint || st.scheduled ? 3 : 10) * 60_000
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
