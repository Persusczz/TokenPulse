import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codexQuota, CodexStore } from '../src/main/collector/codex'
import { authorizeRequest, CodexUsageService, jwtClaims, loginOf, usageLimits, type Vault } from '../src/main/codexUsage'

const T = Date.UTC(2026, 9, 5, 15, 0)
const iso = (t: number) => new Date(t).toISOString()
const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`
const count = (t: number, rl: object) => JSON.stringify({ timestamp: iso(t), type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: rl } })

describe('codex limits from the logs', () => {
  it('ignores the empty "premium" limit newer Codex logs after the real one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-cx-'))
    const file = join(dir, 'rollout-2026-10-05T08-00-00-abc.jsonl')
    writeFileSync(
      file,
      [
        count(T, { limit_id: 'codex', primary: { used_percent: 99, window_minutes: 300, resets_at: (T + 3600_000) / 1000 }, secondary: { used_percent: 73, window_minutes: 10080, resets_at: (T + 86_400_000) / 1000 }, plan_type: 'plus' }),
        count(T + 1000, { limit_id: 'codex', primary: { used_percent: 100, window_minutes: 300, resets_at: (T + 3600_000) / 1000 }, secondary: { used_percent: 73, window_minutes: 10080, resets_at: (T + 86_400_000) / 1000 }, plan_type: 'plus' }),
        count(T + 2000, { limit_id: 'premium', primary: null, secondary: null, plan_type: 'plus' })
      ].join('\n') + '\n'
    )
    const s = new CodexStore()
    await s.readFile(file)
    expect(s.limits).toMatchObject({ at: T + 1000, limitId: 'codex', primary: { pct: 100 }, secondary: { pct: 73 } })
    const q = codexQuota(s.limits, T + 5000, 1)!
    expect(q.windows.map((w) => [w.key, w.utilization])).toEqual([
      ['codex_5h', 100],
      ['codex_7d', 73]
    ])
    expect(q.origin).toBe('logs')
  })

  it('takes a newer reading from the account over the logs', () => {
    const s = new CodexStore()
    s.noteLimits({ at: T, plan: 'plus', primary: { pct: 40, windowMin: 300, resetsAt: T + 3600_000 }, secondary: null, limitId: 'codex' })
    s.noteLimits(usageLimits({ plan_type: 'plus', rate_limit: { primary_window: { used_percent: 52, limit_window_seconds: 18000, reset_at: (T + 3600_000) / 1000 } } }, T + 60_000)!)
    expect(s.limits).toMatchObject({ origin: 'api', primary: { pct: 52, windowMin: 300 } })
    expect(s.windows[0].peak).toBe(52)
    expect(codexQuota(s.limits, T + 61_000, 0)!.origin).toBe('api')
  })
})

describe('codex usage endpoint', () => {
  it('reads the 5-hour and 7-day windows of a usage response', () => {
    const l = usageLimits(
      {
        plan_type: 'plus',
        rate_limit: {
          primary_window: { used_percent: 100, limit_window_seconds: 18000, reset_after_seconds: 12338, reset_at: 1791281765 },
          secondary_window: { used_percent: 73, limit_window_seconds: 604800, reset_at: 1791617119 }
        }
      },
      T
    )
    expect(l).toEqual({ at: T, plan: 'plus', limitId: 'codex', origin: 'api', primary: { pct: 100, windowMin: 300, resetsAt: 1791281765000 }, secondary: { pct: 73, windowMin: 10080, resetsAt: 1791617119000 } })
    expect(usageLimits({ rate_limit: { primary_window: null } }, T)).toBeNull()
    expect(usageLimits({ rate_limit: { primary_window: { used_percent: 5, limit_window_seconds: 18000, reset_after_seconds: 60 } } }, T)!.primary!.resetsAt).toBe(T + 60_000)
  })

  it('builds the PKCE login request and reads the account from the tokens', () => {
    const r = authorizeRequest()
    const u = new URL(r.url)
    expect(u.origin + u.pathname).toBe('https://auth.openai.com/oauth/authorize')
    expect(u.searchParams.get('redirect_uri')).toBe('http://localhost:1455/auth/callback')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('state')).toBe(r.state)
    expect(u.searchParams.get('scope')).toContain('offline_access')
    const id = jwt({ email: 'a@b.c', 'https://api.openai.com/auth': { chatgpt_account_id: 'acc-1' } })
    const access = jwt({ exp: 2_000_000_000 })
    expect(jwtClaims(access).exp).toBe(2_000_000_000)
    expect(loginOf({ id_token: id, access_token: access, refresh_token: 'r1' })).toEqual({ access, refresh: 'r1', idToken: id, accountId: 'acc-1', email: 'a@b.c', expires: 2_000_000_000_000 })
    // a refresh may leave the refresh token out: the old one stays
    expect(loginOf({ access_token: 'new' }, loginOf({ id_token: id, access_token: access, refresh_token: 'r1' })!)).toMatchObject({ access: 'new', refresh: 'r1', accountId: 'acc-1' })
  })
})

describe('codex usage service', () => {
  const vault: Vault = { available: () => true, seal: (s) => Buffer.from(s), open: (b) => b.toString() }
  const home = () => mkdtempSync(join(tmpdir(), 'tp-cxh-'))
  const ok = { plan_type: 'plus', rate_limit: { primary_window: { used_percent: 30, limit_window_seconds: 18000, reset_after_seconds: 600 } } }

  it('reads with Codex CLI login without ever refreshing it', async () => {
    const h = home()
    writeFileSync(join(h, 'auth.json'), JSON.stringify({ tokens: { access_token: 'cli-token', account_id: 'acc', id_token: jwt({ email: 'me@x.y' }), refresh_token: 'never' } }))
    const calls: { url: string; auth?: string; account?: string }[] = []
    const svc = new CodexUsageService(
      async (url, init) => {
        const hd = (init?.headers ?? {}) as Record<string, string>
        calls.push({ url, auth: hd.Authorization, account: hd['ChatGPT-Account-Id'] })
        return new Response(JSON.stringify(ok), { status: 200 })
      },
      join(h, 'login.dat'),
      h,
      vault
    )
    const l = await svc.poll()
    expect(l?.primary?.pct).toBe(30)
    expect(calls).toEqual([{ url: 'https://chatgpt.com/backend-api/wham/usage', auth: 'Bearer cli-token', account: 'acc' }])
    expect(svc.state).toMatchObject({ status: 'ok', source: 'cli', email: 'me@x.y', cliLogin: true, loggedIn: false })
  })

  it('says so when there is no login, and when the CLI login has expired', async () => {
    const h = home()
    const none = new CodexUsageService(async () => new Response('{}'), join(h, 'login.dat'), h, vault)
    expect(await none.poll()).toBeNull()
    expect(none.state.status).toBe('nologin')
    writeFileSync(join(h, 'auth.json'), JSON.stringify({ tokens: { access_token: 'old', account_id: 'acc' } }))
    const expired = new CodexUsageService(async () => new Response('{}', { status: 401 }), join(h, 'login.dat'), h, vault)
    expect(await expired.poll()).toBeNull()
    expect(expired.state).toMatchObject({ status: 'error', source: 'cli' })
    expect(expired.state.error).toContain('Codex CLI 的登录已过期')
  })

  it('prefers its own login and refreshes it when the access token is turned away', async () => {
    const h = home()
    writeFileSync(join(h, 'auth.json'), JSON.stringify({ tokens: { access_token: 'cli-token', account_id: 'acc' } }))
    const id = jwt({ email: 'own@x.y', 'https://api.openai.com/auth': { chatgpt_account_id: 'own-acc' } })
    const login = { access: 'stale', refresh: 'r1', idToken: id, accountId: 'own-acc', email: 'own@x.y', expires: 0 }
    writeFileSync(join(h, 'login.dat'), Buffer.from(JSON.stringify(login)).toString('base64'))
    const seen: string[] = []
    const svc = new CodexUsageService(
      async (url, init) => {
        if (url.endsWith('/oauth/token')) {
          seen.push(`refresh ${JSON.parse(String(init!.body)).refresh_token}`)
          return new Response(JSON.stringify({ access_token: 'fresh', refresh_token: 'r2', id_token: id }), { status: 200 })
        }
        const auth = ((init?.headers ?? {}) as Record<string, string>).Authorization
        seen.push(auth)
        return auth === 'Bearer fresh' ? new Response(JSON.stringify(ok), { status: 200 }) : new Response('{}', { status: 401 })
      },
      join(h, 'login.dat'),
      h,
      vault
    )
    expect((await svc.poll())?.primary?.pct).toBe(30)
    expect(seen).toEqual(['Bearer stale', 'refresh r1', 'Bearer fresh'])
    expect(svc.state).toMatchObject({ status: 'ok', source: 'tokenpulse', email: 'own@x.y', loggedIn: true })
    await svc.signOut()
    expect(svc.state.loggedIn).toBe(false)
  })
})
