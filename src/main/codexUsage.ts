import { createHash, randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { readFile, unlink } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import type { CodexUsageState } from '@shared/types'
import type { CodexLimit, CodexLimits } from './collector/codex'
import { writeFileAtomic } from './atomicFile'

/**
 * Codex's limits read straight from the ChatGPT account (the endpoint Codex's
 * own /status uses), instead of waiting for Codex to write them into its
 * logs. Credentials come from TokenPulse's own ChatGPT login (OAuth with PKCE,
 * the flow `codex login` runs) or, read only, from Codex CLI's login in
 * ~/.codex/auth.json. Codex CLI's tokens are never refreshed here: refresh
 * tokens are single-use, so refreshing them would sign Codex itself out.
 */

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

const ISSUER = 'https://auth.openai.com'
/** Codex CLI's public OAuth client; its redirect is registered on localhost:1455 */
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const PORT = 1455
const REDIRECT = `http://localhost:${PORT}/auth/callback`
const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'

export interface Login {
  access: string
  refresh: string
  idToken: string
  accountId: string
  email: string | null
  /** access token expiry, epoch ms (0 = unknown) */
  expires: number
}

/** stores a secret string on disk (DPAPI on Windows through Electron's safeStorage) */
export interface Vault {
  available: () => boolean
  seal: (s: string) => Buffer
  open: (b: Buffer) => string
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** the claims of a JWT, unverified (only read for the account id, email and expiry) */
export function jwtClaims(token: string): Record<string, any> {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'))
  } catch {
    return {}
  }
}

/** a usage response as the limits the rest of TokenPulse reads */
export function usageLimits(j: any, now: number): CodexLimits | null {
  const rl = j?.rate_limit
  const win = (v: any): CodexLimit | null =>
    v && Number.isFinite(v.used_percent)
      ? {
          pct: v.used_percent,
          windowMin: Math.round(num(v.limit_window_seconds) / 60),
          resetsAt: Number.isFinite(v.reset_at) ? v.reset_at * 1000 : Number.isFinite(v.reset_after_seconds) ? now + v.reset_after_seconds * 1000 : null
        }
      : null
  const primary = win(rl?.primary_window)
  const secondary = win(rl?.secondary_window)
  if (!primary && !secondary) return null
  return { at: now, plan: typeof j?.plan_type === 'string' ? j.plan_type : null, primary, secondary, limitId: 'codex', origin: 'api' }
}

/** the browser address that starts the login, with its PKCE verifier and state */
export function authorizeRequest(): { url: string; verifier: string; state: string } {
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(24).toString('base64url')
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    scope: 'openid profile email offline_access',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    state
  })
  return { url: `${ISSUER}/oauth/authorize?${q}`, verifier, state }
}

/** tokens from the token endpoint as a login */
export function loginOf(t: { id_token?: string; access_token?: string; refresh_token?: string }, prev?: Login): Login | null {
  const access = t.access_token ?? prev?.access
  const refresh = t.refresh_token ?? prev?.refresh
  const idToken = t.id_token ?? prev?.idToken
  if (!access || !refresh || !idToken) return null
  const id = jwtClaims(idToken)
  const auth = id['https://api.openai.com/auth'] ?? {}
  const accountId = typeof auth.chatgpt_account_id === 'string' ? auth.chatgpt_account_id : (prev?.accountId ?? '')
  const exp = num(jwtClaims(access).exp)
  return { access, refresh, idToken, accountId, email: typeof id.email === 'string' ? id.email : (prev?.email ?? null), expires: exp ? exp * 1000 : 0 }
}

const PAGE = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>TokenPulse</title><body style="font:16px system-ui,'Microsoft YaHei UI',sans-serif;background:#14141a;color:#eee;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2 style="margin:0 0 8px">${title}</h2><p style="color:#aaa">${body}</p></div></body>`

export class CodexUsageService extends EventEmitter {
  state: CodexUsageState = { status: 'off', source: null, email: null, at: null, loggedIn: false, cliLogin: false }
  private login: Login | null = null
  private loaded = false
  private busy: Promise<CodexLimits | null> | null = null
  private server: Server | null = null

  constructor(
    private fetchFn: Fetch,
    private path: string,
    private codexHome: string,
    private vault: Vault
  ) {
    super()
  }

  private set(patch: Partial<CodexUsageState>): void {
    this.state = { ...this.state, ...patch }
    this.emit('state', this.state)
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = await readFile(this.path, 'utf8')
      this.login = JSON.parse(this.vault.open(Buffer.from(raw.trim(), 'base64')))
    } catch {
      this.login = null
    }
    this.set({ loggedIn: !!this.login, email: this.login?.email ?? this.state.email })
  }

  private async save(): Promise<void> {
    if (!this.login) {
      await unlink(this.path).catch(() => {})
      return
    }
    // without a vault the login lives only until TokenPulse quits
    if (this.vault.available()) await writeFileAtomic(this.path, this.vault.seal(JSON.stringify(this.login)).toString('base64'))
  }

  /** Codex CLI's ChatGPT login, read only */
  private async cliLogin(): Promise<{ access: string; accountId: string; email: string | null } | null> {
    try {
      const j = JSON.parse((await readFile(join(this.codexHome, 'auth.json'), 'utf8')).replace(/^﻿/, ''))
      const t = j?.tokens
      if (typeof t?.access_token !== 'string' || typeof t?.account_id !== 'string') return null
      const id = typeof t.id_token === 'string' ? jwtClaims(t.id_token) : {}
      return { access: t.access_token, accountId: t.account_id, email: typeof id.email === 'string' ? id.email : null }
    } catch {
      return null
    }
  }

  private async token(body: Record<string, string>, form: boolean): Promise<any> {
    const res = await this.fetchFn(`${ISSUER}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000)
    })
    const j: any = await res.json().catch(() => null)
    if (!res.ok || !j) throw new Error(j?.error_description || j?.error?.message || j?.error || `HTTP ${res.status}`)
    return j
  }

  /** TokenPulse's own login: a fresh access token when the old one is near its end */
  private async ownAccess(force = false): Promise<Login | null> {
    const l = this.login
    if (!l) return null
    if (!force && (!l.expires || l.expires - Date.now() > 5 * 60_000)) return l
    const t = await this.token({ client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: l.refresh, scope: 'openid profile email' }, false)
    const next = loginOf(t, l)
    if (!next) throw new Error('刷新登录失败')
    this.login = next
    await this.save()
    return next
  }

  private async usage(access: string, accountId: string): Promise<{ status: number; json: any }> {
    const res = await this.fetchFn(USAGE_URL, {
      headers: { Authorization: `Bearer ${access}`, 'ChatGPT-Account-Id': accountId, Accept: 'application/json', 'User-Agent': 'TokenPulse' },
      signal: AbortSignal.timeout(20_000)
    })
    return { status: res.status, json: await res.json().catch(() => null) }
  }

  /** reads the limits now; null when there is no login or the read failed (state says why) */
  poll(): Promise<CodexLimits | null> {
    this.busy ??= this.read().finally(() => (this.busy = null))
    return this.busy
  }

  private async read(): Promise<CodexLimits | null> {
    await this.load()
    const now = Date.now()
    const cli = await this.cliLogin()
    this.set({ cliLogin: !!cli })
    try {
      let source: 'tokenpulse' | 'cli'
      let r: { status: number; json: any }
      let email: string | null
      const own = await this.ownAccess().catch(() => this.login)
      if (own) {
        source = 'tokenpulse'
        email = own.email
        r = await this.usage(own.access, own.accountId)
        if (r.status === 401) {
          const again = await this.ownAccess(true)
          r = await this.usage(again!.access, again!.accountId)
        }
      } else if (cli) {
        source = 'cli'
        email = cli.email
        r = await this.usage(cli.access, cli.accountId)
      } else {
        this.set({ status: 'nologin', source: null, error: undefined })
        return null
      }
      if (r.status === 401 || r.status === 403) {
        this.set({ status: 'error', source, email, error: source === 'cli' ? 'Codex CLI 的登录已过期：运行一次 Codex，或在这里登录 ChatGPT' : '登录已失效，请重新登录' })
        return null
      }
      const limits = r.status === 200 ? usageLimits(r.json, now) : null
      if (!limits) {
        this.set({ status: 'error', source, email, error: r.status === 200 ? '接口没有返回额度数据' : `接口返回 HTTP ${r.status}` })
        return null
      }
      this.set({ status: 'ok', source, email, at: now, error: undefined })
      return limits
    } catch (e) {
      this.set({ status: 'error', error: `连不上 ChatGPT：${e instanceof Error ? e.message : String(e)}` })
      return null
    }
  }

  /** Signs in with ChatGPT in the browser; resolves once the browser comes back (or after 5 minutes) */
  async signIn(open: (url: string) => void): Promise<{ ok: boolean; error?: string; email?: string | null }> {
    await this.load()
    this.server?.close()
    const req = authorizeRequest()
    return new Promise((resolve) => {
      let done = false
      const finish = (r: { ok: boolean; error?: string; email?: string | null }) => {
        if (done) return
        done = true
        clearTimeout(timer)
        setTimeout(() => this.server?.close(), 500)
        resolve(r)
      }
      const server = createServer(async (rq, rs) => {
        const u = new URL(rq.url ?? '/', REDIRECT)
        if (u.pathname !== '/auth/callback') {
          rs.writeHead(404).end()
          return
        }
        const code = u.searchParams.get('code')
        if (u.searchParams.get('state') !== req.state || !code) {
          rs.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE('登录没有完成', u.searchParams.get('error_description') ?? '请回到 TokenPulse 再试一次'))
          finish({ ok: false, error: u.searchParams.get('error_description') ?? '登录被取消' })
          return
        }
        try {
          const t = await this.token({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: CLIENT_ID, code_verifier: req.verifier }, true)
          const l = loginOf(t)
          if (!l) throw new Error('没有拿到令牌')
          this.login = l
          await this.save()
          this.set({ loggedIn: true, email: l.email })
          rs.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE('已登录 ✓', `${l.email ?? 'ChatGPT 账号'} 已连接到 TokenPulse，可以关闭这个页面了`))
          finish({ ok: true, email: l.email })
        } catch (e) {
          rs.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE('登录失败', e instanceof Error ? e.message : String(e)))
          finish({ ok: false, error: e instanceof Error ? e.message : String(e) })
        }
      })
      this.server = server
      server.on('error', (e: NodeJS.ErrnoException) =>
        finish({ ok: false, error: e.code === 'EADDRINUSE' ? `端口 ${PORT} 被占用（可能 Codex 自己的登录正开着），关掉后再试` : e.message })
      )
      const timer = setTimeout(() => finish({ ok: false, error: '5 分钟内没有完成登录' }), 5 * 60_000)
      server.listen(PORT, '127.0.0.1', () => open(req.url))
    })
  }

  /** not reading (switched off) */
  idle(): void {
    if (this.state.status !== 'off') this.set({ status: 'off', source: null, error: undefined })
  }

  async signOut(): Promise<void> {
    await this.load()
    this.login = null
    await this.save()
    this.set({ loggedIn: false, email: null, status: this.state.cliLogin ? this.state.status : 'nologin', source: this.state.source === 'tokenpulse' ? null : this.state.source })
  }
}
