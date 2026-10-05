import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { QuotaConfig } from '../src/main/quota'
import { mergeWindows, parseQuota, parseStatuslineLimits, QuotaService, settle, WINDOW_MS } from '../src/main/quota'

const dir = mkdtempSync(join(tmpdir(), 'tp-quota-'))
const cfg = (p: Partial<QuotaConfig> = {}): QuotaConfig => ({ enabled: true, source: 'auto', limitUsd: null, pauseAt: 90, guardOn: false, ...p })
const noSpend = { spend: () => 0, window: () => null }

function service(opts: { fetch?: () => Promise<Response>; cred?: boolean; statusline?: unknown; spend?: (a: number, b: number) => number } = {}) {
  const sub = mkdtempSync(join(dir, 's-'))
  const cred = join(sub, 'cred.json')
  if (opts.cred) writeFileSync(cred, JSON.stringify({ claudeAiOauth: { accessToken: 't', subscriptionType: 'pro', expiresAt: Date.now() + 3600_000 } }))
  const sl = join(sub, 'statusline.json')
  if (opts.statusline) writeFileSync(sl, JSON.stringify(opts.statusline))
  return new QuotaService(
    () => (opts.cred ? cred : null),
    opts.fetch ?? (async () => new Response('{}')),
    sl,
    join(sub, 'calib.json'),
    { ...noSpend, ...(opts.spend ? { spend: opts.spend } : {}) }
  )
}

const iso = (t: number) => new Date(t).toISOString()

describe('QuotaService', () => {
  it('reports disabled when started disabled', () => {
    const q = service()
    q.configure(cfg({ enabled: false }))
    expect(q.info.status).toBe('disabled')
  })

  it('reports missing credentials without calling the endpoint', async () => {
    let called = false
    const q = service({
      fetch: async () => {
        called = true
        return new Response('{}')
      }
    })
    q.configure(cfg({ source: 'oauth' }))
    await q.refresh()
    q.configure(cfg({ enabled: false }))
    expect(called).toBe(false)
  })

  it('reads the official statusline numbers', async () => {
    const reset = Math.floor(Date.now() / 1000) + 3600
    const q = service({ statusline: { updatedAt: Date.now(), rate_limits: { five_hour: { used_percentage: 42.5, resets_at: reset } } } })
    q.configure(cfg({ source: 'statusline' }))
    await q.refresh()
    const info = q.info
    q.configure(cfg({ enabled: false }))
    expect(info.status).toBe('ok')
    expect(info.origin).toBe('statusline')
    expect(info.windows[0]).toMatchObject({ key: 'five_hour', utilization: 42.5, resetsAt: iso(reset * 1000) })
  })

  it('auto overlays fresher statusline numbers on the OAuth reading', async () => {
    const reset = Date.now() + 3600_000
    const q = service({
      cred: true,
      fetch: async () =>
        Response.json({
          limits: [
            { kind: 'session', percent: 40, resets_at: iso(reset) },
            { kind: 'weekly_opus', percent: 7, resets_at: iso(reset + 86400_000) }
          ]
        })
    })
    q.configure(cfg())
    await q.refresh()
    expect(q.info.origin).toBe('oauth')
    expect(q.info.plan).toBe('Pro')
    writeFileSync(
      (q as any).statuslinePath,
      JSON.stringify({ updatedAt: Date.now() + 1000, rate_limits: { five_hour: { used_percentage: 55, resets_at: Math.floor(reset / 1000) } } })
    )
    await q.checkStatusline()
    const info = q.info
    q.configure(cfg({ enabled: false }))
    expect(info.origin).toBe('statusline')
    expect(info.windows.map((w) => [w.key, w.utilization])).toEqual([
      ['session', 55],
      ['weekly_opus', 7]
    ])
  })

  it('learns the 5h limit from official readings and reuses their window locally', async () => {
    const reset = Date.now() + 2 * 3600_000
    // $3 spent in the official window at 30% => a $10 window
    const q = service({
      cred: true,
      spend: (a) => (a === reset - WINDOW_MS ? 3 : 0),
      fetch: async () => Response.json({ five_hour: { utilization: 30, resets_at: iso(reset) } })
    })
    q.configure(cfg({ source: 'oauth' }))
    await q.refresh()
    expect(q.calibratedLimit).toBeCloseTo(10)
    q.configure(cfg({ source: 'local' }))
    await q.refresh()
    const local = q.info
    q.configure(cfg({ enabled: false }))
    expect(local.origin).toBe('local')
    expect(local.windows[0]).toMatchObject({ key: 'five_hour', resetsAt: iso(reset) })
    expect(local.windows[0].utilization).toBeCloseTo(30)
    expect(local.local?.calibrated).toBe(true)
  })

  it('auto falls back to the local estimate when OAuth never answered', async () => {
    const start = Date.now() - 3600_000
    const sub = mkdtempSync(join(dir, 'fb-'))
    const cred = join(sub, 'cred.json')
    writeFileSync(cred, JSON.stringify({ claudeAiOauth: { accessToken: 't', subscriptionType: 'max', expiresAt: Date.now() + 3600_000 } }))
    writeFileSync(join(sub, 'calib.json'), JSON.stringify({ limitUsd: 10 }))
    const q = new QuotaService(() => cred, async () => new Response('', { status: 500 }), join(sub, 'sl.json'), join(sub, 'calib.json'), {
      spend: () => 4,
      window: () => ({ start, end: start + WINDOW_MS })
    })
    await q.loadCalibration()
    q.configure(cfg())
    await q.refresh()
    const info = q.info
    q.configure(cfg({ enabled: false }))
    expect(info.origin).toBe('local')
    expect(info.error).toBe('HTTP 500')
    expect(info.windows[0].utilization).toBeCloseTo(40)
    expect(info.local).toMatchObject({ usedUsd: 4, limitUsd: 10, calibrated: true })
  })
})

describe('rate limiting', () => {
  it('backs off after a 429 and honours Retry-After', async () => {
    let calls = 0
    const q = service({
      cred: true,
      fetch: async () => {
        calls++
        return new Response('', { status: 429, headers: { 'retry-after': '600' } })
      }
    })
    q.configure(cfg({ source: 'oauth' }))
    await q.refresh()
    await q.refresh()
    const info = q.info
    q.configure(cfg({ enabled: false }))
    expect(calls).toBe(1)
    expect(info.error).toContain('10 分钟')
  })
})

describe('local source', () => {
  it('measures spend against the configured limit and projects the burn', async () => {
    const now = Date.now()
    const start = now - 3600_000
    // $5 of a $10 window used; $1 in the last 30 min => 20%/h
    const q = new QuotaService(() => null, async () => new Response('{}'), join(dir, 'none.json'), join(dir, 'c.json'), {
      spend: (a) => (a === start ? 5 : 1),
      window: () => ({ start, end: start + WINDOW_MS })
    })
    q.configure(cfg({ source: 'local', limitUsd: 10 }))
    await q.refresh()
    const info = q.info
    q.configure(cfg({ enabled: false }))
    expect(info.windows[0].utilization).toBeCloseTo(50)
    expect(info.local).toMatchObject({ usedUsd: 5, limitUsd: 10, calibrated: false })
    expect(info.burn!.pctPerHour).toBeCloseTo(20)
    // 40 points to the 90% guard line at 20%/h = 2h; 100% at 2.5h, both before the reset 4h out
    expect((info.burn!.etaPause! - now) / 3600_000).toBeCloseTo(2, 1)
    expect((info.burn!.etaFull! - now) / 3600_000).toBeCloseTo(2.5, 1)
  })

  it('shows spend without a percentage until a limit is known', async () => {
    const start = Date.now() - 600_000
    const q = new QuotaService(() => null, async () => new Response('{}'), join(dir, 'none.json'), join(dir, 'missing', 'c.json'), {
      spend: () => 2,
      window: () => ({ start, end: start + WINDOW_MS })
    })
    q.configure(cfg({ source: 'local' }))
    await q.refresh()
    const info = q.info
    q.configure(cfg({ enabled: false }))
    expect(info.windows).toEqual([])
    expect(info.local).toMatchObject({ usedUsd: 2, limitUsd: null })
  })
})

describe('parseQuota', () => {
  it('prefers the limits list and ignores codename keys', () => {
    const q = parseQuota({
      five_hour: { utilization: 49.0, resets_at: '2026-10-03T20:00:00+00:00' },
      iguana_necktie: { utilization: 0.0, resets_at: '2026-11-05T07:59:00+00:00' },
      limits: [
        { kind: 'session', percent: 49, severity: 'normal', resets_at: '2026-10-03T20:00:00+00:00' },
        { kind: 'weekly_all', percent: 20, severity: 'normal', resets_at: '2026-10-09T00:00:00+00:00' }
      ],
      seven_day_breakdown: { rows: [{ key: 'claude_code', display_name: 'Claude Code', percent: 100 }] }
    })
    expect(q.windows).toEqual([
      { key: 'session', label: '5 小时会话', utilization: 49, resetsAt: '2026-10-03T20:00:00+00:00', severity: 'normal' },
      { key: 'weekly_all', label: '7 天 · 全部模型', utilization: 20, resetsAt: '2026-10-09T00:00:00+00:00', severity: 'normal' }
    ])
    expect(q.breakdown).toEqual([{ name: 'Claude Code', percent: 100 }])
  })

  it('falls back to the known window keys', () => {
    const q = parseQuota({
      five_hour: { utilization: 10, resets_at: null },
      seven_day: { utilization: 5, resets_at: 'x' },
      seven_day_opus: null,
      tangelo: { utilization: 99 }
    })
    expect(q.windows.map((w) => [w.key, w.utilization])).toEqual([
      ['five_hour', 10],
      ['seven_day', 5]
    ])
  })

  it('tolerates junk', () => {
    expect(parseQuota(null)).toEqual({ windows: [], breakdown: [] })
    expect(parseStatuslineLimits(undefined)).toEqual([])
  })
})

describe('window helpers', () => {
  const now = Date.parse('2026-10-03T12:00:00Z')

  it('empties windows whose reset time has passed', () => {
    const ws = settle(
      [
        { key: 'five_hour', label: '', utilization: 91, resetsAt: '2026-10-03T11:00:00Z', severity: 'critical' },
        { key: 'seven_day', label: '', utilization: 30, resetsAt: '2026-10-05T00:00:00Z', severity: null }
      ],
      now
    )
    expect(ws.map((w) => [w.utilization, w.resetsAt])).toEqual([
      [0, null],
      [30, '2026-10-05T00:00:00Z']
    ])
  })

  it('adds windows the base reading lacks', () => {
    const fresh = parseStatuslineLimits({ five_hour: { used_percentage: 12, resets_at: 1 }, seven_day: { used_percentage: 3, resets_at: 2 } })
    expect(mergeWindows([], fresh).map((w) => w.key)).toEqual(['five_hour', 'seven_day'])
  })
})
