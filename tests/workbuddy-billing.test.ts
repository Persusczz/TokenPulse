import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseWorkBuddyAccount, readWorkBuddyAuth, WorkBuddyBilling } from '../src/features/workbuddy/billing'

const roots: string[] = []
afterEach(async () => { for (const p of roots.splice(0)) await rm(p, { recursive: true, force: true }) })
const summary = {
  SubscriptionPackageName: '体验版', Packages: [
    { PackageCode: 'monthly', CycleTotalCapacity: '500', CycleRemainCapacity: '500', CycleUsedCapacity: '0' },
    { PackageCode: 'bonus', CycleTotalCapacity: '1000', CycleRemainCapacity: '558.3500006', CycleUsedCapacity: '441.6499994' }
  ]
}
const session = { token: 'TEST_TOKEN_PLACEHOLDER', endpoint: 'https://copilot.tencent.com', domain: 'copilot.tencent.com', uid: 'test-user', version: '5.5.6' }
const json = (data: unknown, status = 200) => new Response(JSON.stringify({ code: 0, data }), { status })

describe('WorkBuddy account credits', () => {
  it('uses official decimal capacities rather than treating numeric strings as zero', () => {
    expect(parseWorkBuddyAccount(summary, 1000)).toMatchObject({ status: 'ok', total: 1500, remaining: 1058.3500006, used: 441.6499994, checkedAt: 1000, plan: '体验版' })
  })

  it('keeps missing or malformed capacities unknown instead of displaying zero', () => {
    expect(() => parseWorkBuddyAccount({ Packages: [{ PackageCode: 'bad', CycleTotalCapacity: '', CycleRemainCapacity: 'invalid' }] }, 1)).toThrow()
    expect(() => parseWorkBuddyAccount({}, 1)).toThrow()
    expect(parseWorkBuddyAccount({ Packages: [] }, 1)).toMatchObject({ total: 0, remaining: 0, used: 0 })
  })

  it('uses reported usage and only derives usage when the API omits it', () => {
    expect(parseWorkBuddyAccount({ Packages: [{ PackageCode: 'a', CycleTotalCapacity: '100', CycleRemainCapacity: '80', CycleUsedCapacity: '19.99' }] }, 1).used).toBe(19.99)
    expect(parseWorkBuddyAccount({ Packages: [{ PackageCode: 'a', CycleTotalCapacity: '100', CycleRemainCapacity: '80' }] }, 1).used).toBe(20)
  })

  it('reads native login credentials without returning private account fields to the renderer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tp-wb-auth-')); roots.push(root)
    await mkdir(join(root, 'auth'))
    const file = join(root, 'auth', 'workbuddy-desktop.info')
    await writeFile(file, JSON.stringify({ auth: { accessToken: 'TEST_TOKEN_PLACEHOLDER', domain: 'copilot.tencent.com', expiresAt: Date.now() + 60_000 }, account: { uid: 'test-user', nickname: 'private-name' } }))
    const auth = await readWorkBuddyAuth(root)
    expect(auth).toMatchObject({ token: 'TEST_TOKEN_PLACEHOLDER', endpoint: 'https://copilot.tencent.com' })
    expect(auth).not.toHaveProperty('nickname')
    await writeFile(file + '.logged-out', '1')
    expect(await readWorkBuddyAuth(root)).toBeNull()
  })

  it('does not send native tokens to an unrecognized endpoint', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tp-wb-auth-')); roots.push(root)
    await mkdir(join(root, 'auth'))
    await writeFile(join(root, 'auth', 'workbuddy-desktop.info'), JSON.stringify({ auth: { accessToken: 'TEST_TOKEN_PLACEHOLDER', domain: 'untrusted.example' }, account: { uid: 'test-user' } }))
    expect(await readWorkBuddyAuth(root)).toBeNull()
  })

  it('accepts a flat native login with expiry in seconds and honors its expiry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tp-wb-auth-')); roots.push(root)
    await mkdir(join(root, 'auth'))
    const file = join(root, 'auth', 'workbuddy-desktop.info')
    await writeFile(file, JSON.stringify({ accessToken: 'TEST_TOKEN_PLACEHOLDER', domain: 'copilot.tencent.com', expiresAt: Date.now() / 1000 + 60, account: { uid: 'test-user' } }))
    expect(await readWorkBuddyAuth(root)).toMatchObject({ uid: 'test-user' })
    await writeFile(file, JSON.stringify({ auth: { accessToken: 'TEST_TOKEN_PLACEHOLDER', domain: 'copilot.tencent.com', expiresAt: Date.now() / 1000 - 1 } }))
    expect(await readWorkBuddyAuth(root)).toBeNull()
  })

  it('coalesces account reads, caches for a minute, and exposes only billing fields', async () => {
    const fetch = vi.fn(async (_url: string) => json(summary))
    const billing = new WorkBuddyBilling(fetch, async () => session)
    const [a, b] = await Promise.all([billing.get(), billing.get()])
    expect(a).toEqual(b); expect(fetch).toHaveBeenCalledTimes(1)
    await billing.get(); expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[0]).toBe('https://copilot.tencent.com/billing/meter/get-user-resource-summary')
    const serialized = JSON.stringify(a)
    expect(serialized).not.toContain('TEST_TOKEN_PLACEHOLDER'); expect(serialized).not.toContain('test-user')
  })

  it('clears account balances after logout or rejected authentication', async () => {
    let auth: typeof session | null = session
    const fetch = vi.fn(async () => json(summary))
    const billing = new WorkBuddyBilling(fetch, async () => auth)
    expect((await billing.get()).remaining).toBeGreaterThan(0)
    auth = null
    expect(await billing.get()).toMatchObject({ status: 'unavailable', total: null, remaining: null })
    auth = session; fetch.mockImplementation(async () => json({}, 401))
    expect(await billing.get(true)).toMatchObject({ status: 'unavailable', remaining: null })
  })

  it('does not restore an old balance when a pending request finishes after logout', async () => {
    let auth: typeof session | null = session
    let finish!: (response: Response) => void
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve }))
    const billing = new WorkBuddyBilling(fetch, async () => auth)
    const pending = billing.get()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    auth = null
    await billing.get()
    finish(json(summary))
    expect(await pending).toMatchObject({ status: 'unavailable', remaining: null })
  })

  it('keeps the new account when requests from two accounts finish out of order', async () => {
    let auth = session
    const finishes: ((response: Response) => void)[] = []
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { finishes.push(resolve) }))
    const billing = new WorkBuddyBilling(fetch, async () => auth)
    const old = billing.get()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    auth = { ...session, uid: 'another-user' }
    const current = billing.get()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    finishes[1](json({ Packages: [{ CycleTotalCapacity: '10', CycleRemainCapacity: '8' }] }))
    expect((await current).remaining).toBe(8)
    finishes[0](json(summary))
    expect((await old).remaining).toBe(8)
    expect((await billing.get()).remaining).toBe(8)
  })

  it('marks cached values as stale on network errors and never returns raw error contents', async () => {
    const fetch = vi.fn(async () => json(summary))
    const billing = new WorkBuddyBilling(fetch, async () => session)
    const previous = await billing.get()
    fetch.mockImplementation(async () => { throw new Error('Authorization: TEST_TOKEN_PLACEHOLDER') })
    const failed = await billing.get(true)
    expect(failed).toMatchObject({ status: 'error', remaining: previous.remaining, checkedAt: previous.checkedAt })
    expect(JSON.stringify(failed)).not.toContain('TEST_TOKEN_PLACEHOLDER')
  })
})
