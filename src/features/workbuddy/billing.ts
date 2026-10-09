import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { WorkBuddyAccount } from '@shared/types'

export interface WorkBuddyAuth { token: string; endpoint: string; domain: string; uid: string }
type Fetch = (url: string, init: RequestInit) => Promise<Response>
const EMPTY: WorkBuddyAccount = { status: 'unavailable', checkedAt: null, plan: '', total: null, remaining: null, used: null, packages: [] }
const count = (v: unknown): number | null => {
  if (typeof v !== 'number' && (typeof v !== 'string' || !v.trim())) return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Native login is read only, stays in the main process, and is sent only to Tencent's own gateway. */
export async function readWorkBuddyAuth(root = join(process.platform === 'win32' ? process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local') : process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support') : process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'CodeBuddyExtension', 'Data', 'Public')): Promise<WorkBuddyAuth | null> {
  const file = join(root, 'auth', 'workbuddy-desktop.info')
  if (existsSync(file + '.logged-out')) return null
  try {
    const session = JSON.parse(await readFile(file, 'utf8'))
    const { accessToken, domain, expiresAt } = session.auth ?? session
    const expiry = typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt < 100_000_000_000 ? expiresAt * 1000 : expiresAt : 0
    if (typeof accessToken !== 'string' || !accessToken || (expiry && expiry <= Date.now())) return null
    if (!['copilot.tencent.com', 'www.codebuddy.cn', 'www.workbuddy.cn'].includes(domain) || session.account?.enterpriseId) return null
    return { token: accessToken, endpoint: 'https://copilot.tencent.com', domain, uid: typeof session.account?.uid === 'string' ? session.account.uid : '' }
  } catch { return null }
}

/** Current-cycle fields are paired; lifetime totals must not be mixed with current-cycle usage. */
export function parseWorkBuddyAccount(raw: any, checkedAt: number): WorkBuddyAccount {
  if (!Array.isArray(raw?.Packages)) throw new Error('WorkBuddy 积分响应缺少资源包')
  const packages = raw.Packages.map((p: any) => {
    const total = count(p.CycleTotalCapacity), remaining = count(p.CycleRemainCapacity)
    if (total === null || remaining === null) throw new Error('WorkBuddy 积分响应缺少有效额度')
    const used = count(p.CycleUsedCapacity) ?? Math.max(0, total - remaining)
    return { code: typeof p.PackageCode === 'string' ? p.PackageCode : '', total, remaining, used }
  })
  return {
    status: 'ok', checkedAt, plan: typeof raw.SubscriptionPackageName === 'string' ? raw.SubscriptionPackageName : '',
    total: packages.reduce((n: number, p: { total: number }) => n + p.total, 0),
    remaining: packages.reduce((n: number, p: { remaining: number }) => n + p.remaining, 0),
    used: packages.reduce((n: number, p: { used: number }) => n + p.used, 0), packages
  }
}

/** One-minute memory cache; failed requests retain the last balance explicitly marked stale. */
export class WorkBuddyBilling {
  private value: WorkBuddyAccount = { ...EMPTY }
  private identity = ''
  private revision = 0
  private attemptedAt = 0
  private pending: Promise<WorkBuddyAccount> | null = null
  constructor(private fetchFn: Fetch, private auth: () => Promise<WorkBuddyAuth | null> = readWorkBuddyAuth) {}

  async get(refresh = false): Promise<WorkBuddyAccount> {
    const session = await this.auth()
    if (!session) { this.reset(); return this.value = { ...EMPTY, error: '请在设置中登录国内个人版 WorkBuddy，或沿用本机登录' } }
    const identity = session.domain + ':' + session.uid
    if (identity !== this.identity) { this.identity = identity; this.revision++; this.pending = null; this.value = { ...EMPTY }; this.attemptedAt = 0 }
    if (this.pending) return this.pending
    if (!refresh && Date.now() - this.attemptedAt < 60_000) return this.value
    const pending = this.query(session, this.revision).finally(() => { if (this.pending === pending) this.pending = null })
    this.pending = pending
    return this.pending
  }

  reset(): void {
    this.identity = ''; this.revision++; this.pending = null; this.value = { ...EMPTY }; this.attemptedAt = 0
  }

  private async query(session: WorkBuddyAuth, revision: number): Promise<WorkBuddyAccount> {
    this.attemptedAt = Date.now()
    let next: WorkBuddyAccount
    try {
      const res = await this.fetchFn(session.endpoint + '/billing/meter/get-user-resource-summary', {
        method: 'POST', body: '{}', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { Authorization: 'Bearer ' + session.token, 'X-Domain': session.domain, 'X-User-Id': session.uid, 'X-Product': 'SaaS', 'Accept-Language': 'zh', 'Content-Type': 'application/json', Accept: 'application/json' }
      })
      if (res.status === 401 || res.status === 403) {
        next = { ...EMPTY, error: 'WorkBuddy 登录已失效，请在设置或 WorkBuddy 中重新登录' }
      } else {
        if (!res.ok) throw new Error('request')
        const result = await res.json() as { code?: number; data?: unknown }
        if (result.code !== 0) throw new Error('request')
        next = parseWorkBuddyAccount(result.data, Date.now())
      }
    } catch {
      next = { ...this.value, status: 'error', error: this.value.checkedAt ? '账户积分查询失败；显示上次结果，请稍后刷新' : '账户积分查询失败，请稍后刷新或在官方页面查看' }
    }
    if (revision === this.revision) this.value = next
    return this.value
  }
}
