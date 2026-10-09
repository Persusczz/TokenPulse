import type { WorkBuddyLedger } from '@shared/types'
import { rangeBounds } from '../../main/aggregate'
import { readWorkBuddyAuth } from './billing'

type Fetch = (url: string, init: RequestInit) => Promise<Response>
type Range = WorkBuddyLedger['range']
type Auth = NonNullable<Awaited<ReturnType<typeof readWorkBuddyAuth>>>
const empty = (range: Range): WorkBuddyLedger => ({ range, status: 'unavailable', checkedAt: null, credits: null, requests: 0, reportedTotal: 0, partial: false, models: [], recent: [], daily: [] })
const dayKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const amount = (v: unknown) => typeof v === 'number' || typeof v === 'string' && v.trim() ? Number(v) : NaN
/** The billing gateway accepts and reports China wall-clock timestamps. */
export const ledgerStamp = (ms: number): string => new Date(ms + 8 * 3600_000).toISOString().slice(0, 19).replace('T', ' ')

export function parseLedgerPage(raw: any): { total: number; rows: WorkBuddyLedger['recent'] } {
  if (!Array.isArray(raw?.data) || !Number.isInteger(raw.total) || raw.total < 0) throw new Error('Incomplete ledger')
  const rows = raw.data.map((r: any) => {
    const credits = amount(r.credit)
    const ts = typeof r.requestTime === 'string' && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(r.requestTime) ? Date.parse(r.requestTime.replace(' ', 'T') + '+08:00') : NaN
    if (typeof r.requestId !== 'string' || !r.requestId || typeof r.model !== 'string' || !Number.isFinite(credits) || credits < 0 || !Number.isFinite(ts)) throw new Error('Invalid ledger row')
    return { id: r.requestId, model: r.model, credits, ts }
  })
  return { total: raw.total, rows }
}

/** Separate official ledger: never merged with local logs, which can record the same requests. */
export class WorkBuddyLedgerService {
  private identity = ''
  private revision = 0
  private values = new Map<Range, WorkBuddyLedger>()
  private pending = new Map<Range, Promise<WorkBuddyLedger>>()
  constructor(private fetchFn: Fetch, private auth = readWorkBuddyAuth) {}

  reset(): void {
    this.identity = ''; this.revision++; this.values.clear(); this.pending.clear()
  }

  async get(range: Range, refresh = false): Promise<WorkBuddyLedger> {
    const auth = await this.auth()
    const identity = auth ? auth.domain + ':' + auth.uid : ''
    if (identity !== this.identity || !auth) {
      this.identity = identity; this.revision++; this.values.clear(); this.pending.clear()
    }
    if (!auth) return { ...empty(range), error: '请在设置中登录国内个人版 WorkBuddy，或沿用本机登录' }
    const previous = this.values.get(range)
    if (!refresh && previous?.checkedAt && Date.now() - previous.checkedAt < 60_000) return previous
    const running = this.pending.get(range)
    if (running) return running
    const pending = this.query(auth, range, this.revision).finally(() => { if (this.pending.get(range) === pending) this.pending.delete(range) })
    this.pending.set(range, pending)
    return pending
  }

  private async query(auth: Auth, range: Range, revision: number): Promise<WorkBuddyLedger> {
    let next: WorkBuddyLedger
    try {
      const now = Date.now(), bounds = rangeBounds(range, now, null)
      const rows = new Map<string, WorkBuddyLedger['recent'][number]>()
      let total = 0
      for (let pageNum = 1; pageNum <= 20; pageNum++) {
        const response = await this.fetchFn(auth.endpoint + '/billing/meter/get-user-request-usage', {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
          headers: { Authorization: 'Bearer ' + auth.token, 'X-Domain': auth.domain, 'X-User-Id': auth.uid, 'X-Client-Platform': 'web', 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ startTime: ledgerStamp(bounds.start), endTime: ledgerStamp(now), pageSize: 1000, pageNum })
        })
        if (response.status === 401 || response.status === 403) {
          if (revision === this.revision) { this.values.clear(); this.revision++ }
          return { ...empty(range), error: 'WorkBuddy 登录已失效，请重新登录' }
        }
        if (!response.ok) throw new Error('request')
        const result = await response.json() as { code?: number; data?: unknown }
        if (result.code !== 0) throw new Error('request')
        const page = parseLedgerPage(result.data), before = rows.size
        total = page.total
        for (const row of page.rows) rows.set(row.id, row)
        if (rows.size >= total || rows.size === before) break
      }
      const models = new Map<string, { model: string; credits: number; requests: number }>()
      // every day of the range, quiet ones included
      const daily = new Map<string, { day: string; credits: number; requests: number }>()
      for (let d = new Date(bounds.start); d.getTime() <= now; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) daily.set(dayKey(d), { day: dayKey(d), credits: 0, requests: 0 })
      let credits = 0
      for (const r of rows.values()) {
        credits += r.credits
        const m = models.get(r.model) ?? { model: r.model, credits: 0, requests: 0 }
        m.credits += r.credits; m.requests++; models.set(r.model, m)
        const day = daily.get(dayKey(new Date(r.ts)))
        if (day) { day.credits += r.credits; day.requests++ }
      }
      next = { range, status: 'ok', checkedAt: Date.now(), credits: Math.round(credits * 1e8) / 1e8, requests: rows.size, reportedTotal: total, partial: rows.size < total, models: [...models.values()].sort((a, b) => b.credits - a.credits), recent: [...rows.values()].sort((a, b) => b.ts - a.ts).slice(0, 10), daily: [...daily.values()] }
    } catch {
      next = { ...(this.values.get(range) ?? empty(range)), status: 'error', error: '官方请求账本读取失败；已有结果为上次记录，请稍后刷新' }
    }
    if (revision !== this.revision) return this.values.get(range) ?? empty(range)
    this.values.set(range, next)
    return next
  }
}
