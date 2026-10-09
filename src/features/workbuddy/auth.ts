import { readFile, unlink } from 'node:fs/promises'
import { setTimeout } from 'node:timers/promises'
import type { WorkBuddyLoginState } from '@shared/types'
import type { Vault } from '../../main/codexUsage'
import { writeFileAtomic } from '../../main/atomicFile'
import { readWorkBuddyAuth, type WorkBuddyAuth } from './billing'

const ENDPOINT = 'https://copilot.tencent.com'
const DOMAINS = ['copilot.tencent.com', 'www.codebuddy.cn', 'www.workbuddy.cn']
type Fetch = (url: string, init: RequestInit) => Promise<Response>
interface Login extends WorkBuddyAuth { expiresAt: number; nickname: string | null }

/** Independent browser login; native credentials are read only and never refreshed or replaced. */
export class WorkBuddyLoginService {
  private login: Login | null = null
  private loaded: Promise<void> | null = null
  private loadError = false
  private revision = 0
  private flow: AbortController | null = null
  private writes: Promise<void> = Promise.resolve()
  private status: WorkBuddyLoginState['status'] | null = null
  private error: string | undefined

  constructor(private fetchFn: Fetch, private path: string, private vault: Vault, private native = readWorkBuddyAuth) {}

  private load(): Promise<void> {
    return this.loaded ??= (async () => {
      try {
        const raw = await readFile(this.path, 'utf8')
        const login = JSON.parse(this.vault.open(Buffer.from(raw.trim(), 'base64')))
        if (login.endpoint !== ENDPOINT || !DOMAINS.includes(login.domain) || typeof login.token !== 'string' || !login.token || typeof login.uid !== 'string' || !login.uid || !Number.isFinite(login.expiresAt) || login.expiresAt <= 0) throw new Error('login')
        this.login = { token: login.token, endpoint: ENDPOINT, domain: login.domain, uid: login.uid, expiresAt: login.expiresAt, nickname: typeof login.nickname === 'string' ? login.nickname : null }
      } catch (e) { this.loadError = (e as NodeJS.ErrnoException).code !== 'ENOENT' }
    })()
  }

  async getAuth(): Promise<WorkBuddyAuth | null> {
    await this.load()
    if (this.login) return this.login.expiresAt > Date.now() ? this.login : null
    return this.loadError ? null : this.native()
  }

  async getState(): Promise<WorkBuddyLoginState> {
    await this.load()
    const native = await this.native()
    const expired = !!this.login && this.login.expiresAt <= Date.now()
    return {
      status: this.status ?? (this.loadError ? 'error' : expired ? 'expired' : this.login || native ? 'ready' : 'nologin'),
      source: this.login || this.loadError ? 'tokenpulse' : native ? 'workbuddy' : null,
      loggedIn: !!this.login || this.loadError, nativeLogin: !!native, nickname: this.login?.nickname ?? null,
      error: this.error ?? (this.loadError ? '已保存的登录无法读取，请重新登录' : expired ? 'WorkBuddy 登录已过期，请重新登录' : undefined)
    }
  }

  private async request(path: string, signal: AbortSignal, init: RequestInit = {}): Promise<any> {
    const response = await this.fetchFn(ENDPOINT + path, { ...init, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) })
    if (!response.ok) throw new Error('request')
    return response.json()
  }

  async signIn(open: (url: string) => Promise<void>): Promise<{ ok: boolean; error?: string }> {
    await this.load()
    this.flow?.abort()
    const revision = ++this.revision, flow = new AbortController()
    this.flow = flow; this.status = 'waiting'; this.error = undefined
    const current = () => revision === this.revision && !flow.signal.aborted
    try {
      if (!this.vault.available()) throw new Error('vault')
      const start = await this.request('/v2/plugin/auth/state?platform=CLI', flow.signal, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } })
      const state = start.data?.state, authUrl = start.data?.authUrl
      if (!current()) return { ok: false }
      if (start.code !== 0 || typeof state !== 'string' || !state || state.length > 2048 || typeof authUrl !== 'string' || authUrl.length > 8192) throw new Error('state')
      const url = new URL(authUrl)
      if (url.origin !== ENDPOINT || url.username || url.password || url.pathname !== '/login' || url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== state) throw new Error('url')
      await open(authUrl)
      const deadline = Date.now() + 5 * 60_000, query = '?state=' + encodeURIComponent(state)
      while (current() && Date.now() < deadline) {
        const result = await this.request('/v2/plugin/auth/token' + query, flow.signal)
        if (!current()) return { ok: false }
        if (result.code === 11217) { await setTimeout(3000, undefined, { signal: flow.signal }); continue }
        const token = result.data
        if (result.code !== 0 || typeof token?.accessToken !== 'string' || !token.accessToken || !DOMAINS.includes(token.domain)) throw new Error('token')
        const expiry = token.expiresAt
        const expiresAt = typeof expiry === 'number' && Number.isFinite(expiry) && expiry > 0 ? expiry < 100_000_000_000 ? expiry * 1000 : expiry : typeof token.expiresIn === 'number' && Number.isFinite(token.expiresIn) && token.expiresIn > 0 ? Date.now() + token.expiresIn * 1000 : 0
        if (expiresAt <= Date.now()) throw new Error('expiry')
        const account = await this.request('/v2/plugin/login/account' + query, flow.signal, { headers: { Authorization: 'Bearer ' + token.accessToken } })
        if (!current()) return { ok: false }
        if (Date.now() >= deadline) throw new Error('timeout')
        if (account.code !== 0 || typeof account.data?.uid !== 'string' || !account.data.uid || account.data.enterpriseId) throw new Error('account')
        const login: Login = { token: token.accessToken, endpoint: ENDPOINT, domain: token.domain, uid: account.data.uid, expiresAt, nickname: typeof account.data.nickname === 'string' ? account.data.nickname : null }
        this.writes = this.writes.catch(() => {}).then(async () => { if (current()) await writeFileAtomic(this.path, this.vault.seal(JSON.stringify(login)).toString('base64')) })
        await this.writes
        if (!current()) return { ok: false }
        this.login = login; this.loadError = false; this.status = null
        return { ok: true }
      }
      if (!current()) return { ok: false }
      this.error = '浏览器登录已超时，请重新登录'
    } catch {
      if (!current()) return { ok: false }
      this.error = this.vault.available() ? 'WorkBuddy 登录失败，请重试；仅支持国内个人账户' : '系统凭据加密不可用，无法保存 WorkBuddy 登录'
    } finally { if (this.flow === flow) this.flow = null }
    this.status = 'error'
    return { ok: false, error: this.error }
  }

  async signOut(): Promise<void> {
    await this.load()
    this.revision++; this.flow?.abort(); this.flow = null
    this.login = null; this.loadError = false; this.status = null; this.error = undefined
    this.writes = this.writes.catch(() => {}).then(async () => { try { await unlink(this.path) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e } })
    await this.writes
  }
}
