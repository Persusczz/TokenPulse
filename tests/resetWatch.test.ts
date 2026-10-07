import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { QuotaCycle } from '../src/shared/types'
import { resetCreditsOf } from '../src/main/codexUsage'
import { effectOf, historyOf, newsOf, ResetWatchService, statusOf } from '../src/main/resetWatch'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const NOW = Date.parse('2026-10-07T05:56:24.383Z')

// shaped like codex-resets.com's /api/v1 answers on 2026-10-07
const reset = (id: string, at: string, text: string, type = 'regular', observed = false) => ({
  id,
  reset_type: type,
  announced_at: at,
  text,
  source: observed ? { type: 'observed' } : { type: 'x_post', author: 'thsottiaux', url: `https://x.com/thsottiaux/status/${id}` }
})
const LATEST = reset('2107676072871600470', '2026-10-07T03:35:09.000Z', 'Therefore ... the reset has been https://t.co/mHSI0Pcu4M')
const status = (patch: object = {}) => ({
  data: { latest_reset: LATEST, scheduled_reset: null, active_watch: null, stats: { total: 58, last_reset_at: LATEST.announced_at, days_since_last: 0.1, avg_interval_days: 6.8 }, ...patch },
  meta: { api_version: 'v1', generated_at: '2026-10-07T05:56:24.383Z' }
})
const LIST = {
  data: [
    reset('2105120226027450685', '2026-09-29T19:00:00.000Z', '@theo Shhhhhh', 'banked', true),
    LATEST,
    reset('2106131810921136451', '2026-10-02T21:18:48.000Z', 'Reset all propagated. Enjoy. https://t.co/GaVJhbptR0')
  ],
  pagination: { has_more: false, next_cursor: null }
}
const WATCH = {
  level: 'strong',
  reset_chance_percent: 72.4,
  forecast_window: 'next 24h',
  observed_at: '2026-10-07T05:00:00.000Z',
  expires_at: '2026-10-08T05:00:00.000Z',
  text: 'the vote is close',
  source: { type: 'x_post', author: 'thsottiaux', url: 'https://x.com/thsottiaux/status/1' }
}

describe('Tibo reset feed', () => {
  it('reads the status: the latest reset without its trailing t.co link, a hint, the stats', () => {
    const s = statusOf(status({ active_watch: WATCH }))!
    expect(s.latest).toEqual({
      id: LATEST.id,
      kind: 'regular',
      at: Date.parse(LATEST.announced_at),
      text: 'Therefore ... the reset has been',
      url: `https://x.com/thsottiaux/status/${LATEST.id}`,
      observed: false
    })
    expect(s.hint).toMatchObject({ level: 'strong', chance: 72, window: 'next 24h', url: 'https://x.com/thsottiaux/status/1' })
    expect(s.stats).toEqual({ total: 58, avgDays: 6.8 })
    expect(statusOf({})).toBeNull()
    // links only to X
    expect(statusOf(status({ latest_reset: { ...LATEST, source: { type: 'x_post', url: 'https://evil.example/x' } } }))!.latest!.url).toBeNull()
  })

  it('lists the history newest first, banked and observed ones marked', () => {
    const h = historyOf(LIST)
    expect(h.map((p) => [p.id.slice(0, 6), p.kind, p.observed])).toEqual([
      ['210767', 'regular', false],
      ['210613', 'regular', false],
      ['210512', 'banked', true]
    ])
    expect(h[2].url).toBeNull()
  })

  it('tells fresh news once: a reset in the last day, one announced ahead, a live hint', () => {
    const base = { status: 'ok' as const, at: NOW, history: [], ...statusOf(status({ active_watch: WATCH }))! }
    const news = newsOf(base, new Set(), NOW)
    expect(news.map((n) => n.kind)).toEqual(['reset', 'hint'])
    expect(newsOf(base, new Set(['reset:' + LATEST.id, `hint:${Date.parse(WATCH.observed_at)}`]), NOW)).toEqual([])
    // two days later the reset is old and the hint has expired
    expect(newsOf(base, new Set(), NOW + 2 * DAY)).toEqual([])
  })
})

/** a stand-in for codex-resets.com */
function fakeApi(answers: { status: () => object; list?: () => object }) {
  const calls: string[] = []
  const fetchFn = async (url: string) => {
    calls.push(url.replace('https://api.test', ''))
    const body = url.includes('/resets') ? (answers.list ?? (() => LIST))() : answers.status()
    return new Response(JSON.stringify(body), { status: 200 })
  }
  return { calls, fetchFn }
}

describe('reset watch service', () => {
  it('learns what is there on the first read, then tells only what is new, across restarts', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'tp-rs-')), 'codex-resets.json')
    let st = status()
    const api = fakeApi({ status: () => st })
    const a = new ResetWatchService(api.fetchFn, file, 'https://api.test')
    expect(await a.poll(NOW)).toEqual([])
    expect(a.state).toMatchObject({ status: 'ok', at: NOW, latest: { id: LATEST.id } })
    expect(a.state.history).toHaveLength(3)
    expect(api.calls).toEqual(['/status', '/resets?limit=100'])
    // a hint shows up: told, and read again in 3 minutes rather than 10
    st = status({ active_watch: WATCH })
    expect((await a.poll(NOW + 60_000)).map((n) => n.kind)).toEqual(['hint'])
    expect(a.due(NOW + 60_000 + 3 * 60_000)).toBe(true)
    expect(api.calls.filter((c) => c.startsWith('/resets'))).toHaveLength(1)

    // after a restart the same hint isn't told again; a new reset is, and the list is read again for it
    const NEXT = reset('2107999999999999999', '2026-10-07T07:00:00.000Z', 'Reset all propagated.')
    st = status({ active_watch: WATCH, latest_reset: NEXT })
    const b = new ResetWatchService(api.fetchFn, file, 'https://api.test')
    const news = await b.poll(NOW + 2 * HOUR)
    expect(news.map((n) => (n.kind === 'hint' ? 'hint' : n.post.id))).toEqual([NEXT.id])
    expect(b.state.history[0].id).toBe(NEXT.id)
    expect(api.calls.filter((c) => c.startsWith('/resets'))).toHaveLength(2)
  })

  it('keeps the last good read when the site fails', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'tp-rs-')), 'codex-resets.json')
    let fail = false
    const fetchFn = async (url: string) => (fail ? new Response('slow down', { status: 429 }) : new Response(JSON.stringify(url.includes('/resets') ? LIST : status()), { status: 200 }))
    const w = new ResetWatchService(fetchFn, file, 'https://api.test')
    await w.poll(NOW)
    fail = true
    expect(await w.poll(NOW + 20 * 60_000)).toEqual([])
    expect(w.state).toMatchObject({ status: 'error', latest: { id: LATEST.id } })
    expect(w.state.error).toContain('请求太频繁')
  })
})

const week = (start: number, end: number, pct: number | null, estimated = false): QuotaCycle => ({
  kind: '7d',
  start,
  end,
  tokens: 1,
  cost: 1,
  messages: 1,
  sessions: 1,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  pct,
  hitAt: null,
  current: false,
  estimated,
  models: []
})

describe("a reset's effect on the user's week", () => {
  const T = Date.parse('2026-10-02T21:18:48.000Z')
  const S = T - 3 * DAY

  it('sees a week cut short at the reset, with the reading it had reached', () => {
    // the reset rolled out half an hour before the "all propagated" post
    const weeks = [week(S, T - HOUR / 2, 63), week(T + 2 * HOUR, T + 2 * HOUR + 7 * DAY, 12)]
    expect(effectOf(T, weeks, T + 3 * HOUR)).toEqual({ before: 63, restarted: true, checked: true })
  })

  it('says so when the week ran on past the reset', () => {
    const open = { ...week(S, S + 7 * DAY, 40), current: true }
    expect(effectOf(T, [open], T + 5 * HOUR)).toEqual({ before: 40, restarted: false, checked: true })
    // the last reading is from before the post: not known yet
    expect(effectOf(T, [open], T - HOUR)).toEqual({ before: 40, restarted: false, checked: false })
    // a closed week that ran its full length into the next one
    const weeks = [week(S, S + 7 * DAY, 40), week(S + 7 * DAY + HOUR, S + 14 * DAY + HOUR, 5)]
    expect(effectOf(T, weeks, null)).toEqual({ before: 40, restarted: false, checked: true })
    expect(effectOf(T, [week(S, S + 7 * DAY, 40)], null)).toEqual({ before: 40, restarted: false, checked: false })
  })

  it('has nothing to say without a known week then', () => {
    expect(effectOf(T, [week(S, S + 7 * DAY, null, true)], T + HOUR)).toBeNull()
    expect(effectOf(T, [], null)).toBeNull()
  })
})

describe('banked resets in the account', () => {
  it('reads rate_limit_reset_credits from the usage answer', () => {
    expect(resetCreditsOf({ rate_limit_reset_credits: { available_count: 2, applicable_available_count: 1 } })).toBe(2)
    expect(resetCreditsOf({ rate_limit_reset_credits: { available_count: 0 } })).toBe(0)
    expect(resetCreditsOf({})).toBeNull()
  })
})
