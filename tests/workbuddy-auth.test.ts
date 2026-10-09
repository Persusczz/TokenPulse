import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkBuddyLoginService } from '../src/features/workbuddy/auth'

const roots: string[] = []
afterEach(async () => { vi.useRealTimers(); for (const p of roots.splice(0)) await rm(p, { recursive: true, force: true }) })
const native = { token: 'NATIVE_TOKEN_PLACEHOLDER', domain: 'copilot.tencent.com', endpoint: 'https://copilot.tencent.com', uid: 'native-user' }
const vault = { available: () => true, seal: (s: string) => Buffer.from(Buffer.from(s).map((b) => b ^ 85)), open: (b: Buffer) => Buffer.from(Buffer.from(b).map((v) => v ^ 85)).toString() }
const json = (code: number, data?: unknown) => new Response(JSON.stringify({ code, data }))
const credentials = () => ({ accessToken: 'ACCESS_TOKEN_PLACEHOLDER', refreshToken: 'REFRESH_TOKEN_PLACEHOLDER', domain: 'copilot.tencent.com', expiresAt: Date.now() / 1000 + 3600 })
async function setup(fetchFn = vi.fn(async (url: string) => url.includes('/auth/state') ? json(0, { state: 'test-state', authUrl: 'https://copilot.tencent.com/login?state=test-state' }) : url.includes('/auth/token') ? json(0, credentials()) : json(0, { uid: 'own-user', nickname: '测试账户', enterpriseId: '' })), fallback = async () => native as typeof native | null) {
  const root = await mkdtemp(join(tmpdir(), 'tp-wb-login-')); roots.push(root)
  const path = join(root, 'workbuddy-login.dat')
  return { fetchFn, path, service: new WorkBuddyLoginService(fetchFn, path, vault, fallback) }
}

describe('WorkBuddy browser login', () => {
  it('uses native credentials read only until a separately encrypted browser login is available', async () => {
    const { service, path, fetchFn } = await setup()
    expect(await service.getAuth()).toEqual(native)
    const open = vi.fn(async () => {})
    expect(await service.signIn(open)).toEqual({ ok: true })
    expect(open).toHaveBeenCalledWith('https://copilot.tencent.com/login?state=test-state')
    expect(await service.getAuth()).toMatchObject({ token: 'ACCESS_TOKEN_PLACEHOLDER', uid: 'own-user', endpoint: 'https://copilot.tencent.com' })
    expect(await service.getState()).toMatchObject({ status: 'ready', source: 'tokenpulse', nickname: '测试账户', loggedIn: true, nativeLogin: true })
    expect(JSON.stringify(await service.getState())).not.toContain('TOKEN_PLACEHOLDER')
    expect(await readFile(path, 'utf8')).not.toContain('ACCESS_TOKEN_PLACEHOLDER')
    const restored = new WorkBuddyLoginService(fetchFn, path, vault, async () => null)
    expect(await restored.getAuth()).toMatchObject({ uid: 'own-user' })
    await service.signOut()
    expect(await service.getAuth()).toEqual(native)
    await expect(readFile(path)).rejects.toThrow()
  })

  it('polls pending authorization and normalizes expiry seconds without silently switching an expired own account', async () => {
    vi.useFakeTimers()
    let polls = 0
    const { service } = await setup(vi.fn(async (url: string) => url.includes('/auth/state') ? json(0, { state: 'test-state', authUrl: 'https://copilot.tencent.com/login?state=test-state' }) : url.includes('/auth/token') ? ++polls === 1 ? json(11217) : json(0, credentials()) : json(0, { uid: 'own-user' })))
    const pending = service.signIn(async () => {})
    await vi.waitFor(async () => expect((await service.getState()).status).toBe('waiting'))
    await vi.advanceTimersByTimeAsync(3000)
    expect(await pending).toEqual({ ok: true })
    await vi.advanceTimersByTimeAsync(3600_000)
    expect(await service.getAuth()).toBeNull()
    expect(await service.getState()).toMatchObject({ status: 'expired', source: 'tokenpulse', nativeLogin: true })
  })

  it.each(['https://untrusted.example/login?state=test-state', 'https://copilot.tencent.com/login?state=wrong', 'https://copilot.tencent.com@untrusted.example/login?state=test-state'])('rejects an untrusted authorization URL: %s', async (authUrl) => {
    const { service, fetchFn } = await setup(vi.fn(async () => json(0, { state: 'test-state', authUrl })))
    const open = vi.fn(async () => {})
    expect((await service.signIn(open)).ok).toBe(false)
    expect(open).not.toHaveBeenCalled(); expect(fetchFn).toHaveBeenCalledOnce()
  })

  it('cannot save a late authorization result after logout', async () => {
    let finish!: (r: Response) => void
    const { service, path } = await setup(vi.fn(async (url: string) => url.includes('/auth/state') ? json(0, { state: 'test-state', authUrl: 'https://copilot.tencent.com/login?state=test-state' }) : new Promise<Response>((resolve) => { finish = resolve })), async () => null)
    const pending = service.signIn(async () => {})
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await service.signOut(); finish(json(0, credentials()))
    expect((await pending).ok).toBe(false)
    expect(await service.getAuth()).toBeNull()
    await expect(readFile(path)).rejects.toThrow()
  })

  it('does not send credentials from an unknown domain to the account endpoint', async () => {
    const { service, fetchFn } = await setup(vi.fn(async (url: string) => url.includes('/auth/state') ? json(0, { state: 'test-state', authUrl: 'https://copilot.tencent.com/login?state=test-state' }) : json(0, { ...credentials(), domain: 'untrusted.example' })))
    expect((await service.signIn(async () => {})).ok).toBe(false)
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(await service.getAuth()).toEqual(native)
  })

  it('rejects enterprise accounts without replacing native login', async () => {
    const { service, path } = await setup(vi.fn(async (url: string) => url.includes('/auth/state') ? json(0, { state: 'test-state', authUrl: 'https://copilot.tencent.com/login?state=test-state' }) : url.includes('/auth/token') ? json(0, credentials()) : json(0, { uid: 'enterprise-user', enterpriseId: 'test-enterprise' })))
    expect((await service.signIn(async () => {})).ok).toBe(false)
    expect(await service.getAuth()).toEqual(native)
    await expect(readFile(path)).rejects.toThrow()
  })

  it('refuses plaintext persistence and never surfaces raw network errors', async () => {
    const { service, path, fetchFn } = await setup(vi.fn(async () => { throw new Error('ACCESS_TOKEN_PLACEHOLDER') }))
    expect((await service.signIn(async () => {})).ok).toBe(false)
    expect(JSON.stringify(await service.getState())).not.toContain('ACCESS_TOKEN_PLACEHOLDER')
    const unavailable = new WorkBuddyLoginService(fetchFn, path, { ...vault, available: () => false }, async () => null)
    const open = vi.fn(async () => {})
    expect((await unavailable.signIn(open)).ok).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })
})
