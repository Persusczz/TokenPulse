import { describe, expect, it, vi } from 'vitest'
import { ledgerStamp, parseLedgerPage, WorkBuddyLedgerService } from '../src/features/workbuddy/ledger'

const auth = { token: 'TEST_TOKEN_PLACEHOLDER', endpoint: 'https://copilot.tencent.com', domain: 'copilot.tencent.com', uid: 'test-user' }
const row = (id = 'request-1', credit: unknown = '0.14') => ({ requestId: id, credit, model: 'deepseek-v4.1-flash', requestTime: '2026-10-07 20:32:00', input: 'private prompt', client: 'private client' })
const response = (rows: unknown[], total = rows.length) => new Response(JSON.stringify({ code: 0, data: { total, data: rows } }))

describe('WorkBuddy official request ledger', () => {
  it('reads numeric-string credits and fixed China timestamps without exposing inputs', () => {
    const page = parseLedgerPage({ total: 1, data: [row()] })
    expect(page.rows[0]).toEqual({ id: 'request-1', credits: 0.14, model: 'deepseek-v4.1-flash', ts: Date.parse('2026-10-07T12:32:00Z') })
    expect(JSON.stringify(page)).not.toContain('private')
    expect(ledgerStamp(Date.parse('2026-10-07T12:32:00Z'))).toBe('2026-10-07 20:32:00')
  })
  it('rejects malformed pages and absent credits instead of reporting zero', () => {
    expect(() => parseLedgerPage({})).toThrow()
    expect(() => parseLedgerPage({ total: 1, data: [row('bad', null)] })).toThrow()
    expect(parseLedgerPage({ total: 1, data: [row('free', 0)] }).rows[0].credits).toBe(0)
  })
  it('paginates and deduplicates official request ids without mixing local log credits', async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => JSON.parse(init.body as string).pageNum === 1 ? response([row('one')], 2) : response([row('one'), row('two', 0.06)], 2))
    const ledger = new WorkBuddyLedgerService(fetch, async () => auth)
    const result = await ledger.get('today')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ status: 'ok', credits: 0.2, requests: 2, reportedTotal: 2, partial: false, models: [{ credits: 0.2, requests: 2 }] })
    expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toMatchObject({ pageNum: 1, pageSize: 1000 })
    expect(JSON.stringify(result)).not.toContain('TEST_TOKEN_PLACEHOLDER')
    await ledger.get('today')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('marks truncated pages explicitly and clears balances on logout', async () => {
    let credential: typeof auth | null = auth
    const fetch = vi.fn(async () => response([row()], 100))
    const ledger = new WorkBuddyLedgerService(fetch, async () => credential)
    expect(await ledger.get('today')).toMatchObject({ partial: true, requests: 1, reportedTotal: 100 })
    credential = null
    expect(await ledger.get('today')).toMatchObject({ status: 'unavailable', credits: null, requests: 0 })
  })
  it('retains explicitly stale data on network failure and clears rejected authentication', async () => {
    const fetch = vi.fn(async () => response([row()]))
    const ledger = new WorkBuddyLedgerService(fetch, async () => auth)
    await ledger.get('today')
    fetch.mockImplementation(async () => { throw new Error('TEST_TOKEN_PLACEHOLDER') })
    expect(await ledger.get('today', true)).toMatchObject({ status: 'error', credits: 0.14 })
    fetch.mockImplementation(async () => new Response('', { status: 401 }))
    expect(await ledger.get('today', true)).toMatchObject({ status: 'unavailable', credits: null })
  })
  it('bounds pagination and reports partial data rather than an incomplete total', async () => {
    let n = 0
    const fetch = vi.fn(async () => response([row('row-' + ++n)], 21))
    const ledger = new WorkBuddyLedgerService(fetch, async () => auth)
    expect(await ledger.get('30d')).toMatchObject({ partial: true, requests: 20, reportedTotal: 21 })
    expect(fetch).toHaveBeenCalledTimes(20)
  })
  it('does not restore a pending old account after logout', async () => {
    let credential: typeof auth | null = auth
    let finish!: (r: Response) => void
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve }))
    const ledger = new WorkBuddyLedgerService(fetch, async () => credential)
    const running = ledger.get('today')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    credential = null
    await ledger.get('today')
    finish(response([row()]))
    expect(await running).toMatchObject({ status: 'unavailable', credits: null })
  })
  it('adds up each day of the range, quiet days included', async () => {
    const fetch = vi.fn(async () => response([row('a', 1), { ...row('b', 2), requestTime: '2026-10-05 09:00:00' }, row('c', 0.5)]))
    const ledger = new WorkBuddyLedgerService(fetch, async () => auth)
    vi.useFakeTimers({ now: Date.parse('2026-10-07T13:00:00Z'), toFake: ['Date'] })
    try {
      const daily = (await ledger.get('7d')).daily
      expect(daily).toHaveLength(7)
      expect(daily.filter((d) => d.requests).map((d) => [d.credits, d.requests])).toEqual([[2, 1], [1.5, 2]])
      expect(daily.reduce((a, d) => a + d.requests, 0)).toBe(3)
    } finally { vi.useRealTimers() }
  })
})
