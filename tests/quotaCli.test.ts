import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hasBridgeStatusline } from '../src/main/claudeSettings'

const CLI = resolve(__dirname, '../src/bridge/quota.cjs')
const cli = createRequire(import.meta.url)(CLI)
const plain = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')

const iso = (t: number) => new Date(t).toISOString()
const sample = (now: number) => ({
  limits: [
    { kind: 'session', percent: 42, severity: 'normal', resets_at: iso(now + 2 * 3600_000) },
    { kind: 'weekly_all', percent: 25, severity: 'normal', resets_at: iso(now + 5 * 86400_000) },
    { kind: 'weekly_opus', percent: 80, severity: 'warning', resets_at: iso(now + 5 * 86400_000) }
  ],
  five_hour: { utilization: 1, resets_at: iso(now) },
  seven_day_breakdown: { rows: [{ display_name: 'Opus', percent: 70 }, { display_name: 'Sonnet', percent: 30 }] },
  amber_ladder: { percent: 99 }
})

function tpq(args: string[], env: Record<string, string>) {
  return new Promise<{ out: string; err: string; code: number | null }>((done, fail) => {
    const base = { ...process.env }
    delete base.TOKENPULSE_BRIDGE_DIR
    const p = spawn(process.execPath, [CLI, ...args], { env: { ...base, NO_COLOR: '1', ...env } })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', fail)
    p.on('close', (code) => done({ out, err, code }))
  })
}

/** A Claude config folder with a (fake) login */
function claudeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'tp-cli-'))
  writeFileSync(
    join(root, '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: 'tok-123', expiresAt: Date.now() + 3600_000, subscriptionType: 'max' } })
  )
  return root
}

describe('parseUsage', () => {
  it('reads the limits list and ignores codename keys', () => {
    const now = Date.now()
    const { windows, breakdown } = cli.parseUsage(sample(now))
    expect(windows.map((w: any) => [w.key, w.label, w.pct])).toEqual([
      ['session', '5 小时会话', 42],
      ['weekly_all', '7 天 · 全部模型', 25],
      ['weekly_opus', '7 天 · Opus', 80]
    ])
    expect(windows[0].resetsAt).toBe(now + 2 * 3600_000)
    expect(breakdown).toEqual([
      { name: 'Opus', pct: 70 },
      { name: 'Sonnet', pct: 30 }
    ])
  })

  it('falls back to the per-window keys and adds enabled extra usage', () => {
    const { windows } = cli.parseUsage({
      five_hour: { utilization: 12, resets_at: '2026-10-04T07:19:59.822176+00:00' },
      seven_day: { utilization: 30, resets_at: null },
      seven_day_opus: null,
      extra_usage: { is_enabled: true, utilization: 15 }
    })
    expect(windows).toEqual([
      { key: 'five_hour', label: '5 小时会话', pct: 12, resetsAt: Date.parse('2026-10-04T07:19:59.822Z') },
      { key: 'seven_day', label: '7 天 · 全部模型', pct: 30, resetsAt: null },
      { key: 'extra_usage', label: '额外用量 · 本月', pct: 15, resetsAt: null }
    ])
  })
})

describe('saved readings', () => {
  it('picks the newest of TokenPulse, the statusline bridge and the cache, reading old quota.json too', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-saved-'))
    const now = Date.now()
    writeFileSync(join(dir, 'quota.json'), JSON.stringify({ updatedAt: now - 1000, origin: 'oauth', fiveHour: { pct: 61, resetsAt: now + 3600_000 }, sevenDay: null }))
    writeFileSync(join(dir, 'statusline.json'), JSON.stringify({ updatedAt: now - 5000, rate_limits: { five_hour: { used_percentage: 58, resets_at: 1 } } }))
    const list = cli.savedReadings(dir)
    expect(list.map((r: any) => r.source)).toEqual(['app', 'statusline'])
    expect(list[0].windows).toEqual([{ key: 'five_hour', label: '5 小时会话', pct: 61, resetsAt: now + 3600_000 }])
  })

  it('empties windows whose reset has passed', () => {
    expect(cli.settle([{ key: 'session', pct: 95, resetsAt: 10 }], 11)).toEqual([{ key: 'session', pct: 0, resetsAt: null, reset: true }])
  })
})

describe('rendering', () => {
  const now = new Date(2026, 9, 3, 12, 0).getTime()
  const reading = {
    source: 'oauth',
    fetchedAt: now,
    plan: 'Pro',
    breakdown: [],
    windows: [
      { key: 'session', label: '5 小时会话', pct: 50, resetsAt: now + 2.5 * 3600_000 },
      { key: 'weekly_all', label: '7 天 · 全部模型', pct: 25, resetsAt: now + (5 * 24 + 4) * 3600_000 }
    ]
  }
  const C = cli.palette(false)

  it('draws bars with the elapsed-time tick and reset times', () => {
    const lines = cli.renderPanel(reading, now, C).split('\n')
    expect(lines[1]).toMatch(/^ {2}✻ TokenPulse · Claude Pro +用量接口 · 刚刚$/)
    expect(lines[3]).toMatch(/^ {2}5 小时会话 {7}█{12}┃░{11} {2}50% {3}2 小时 30 分后重置 · 今天 14:30$/)
    expect(lines[4]).toMatch(/^ {2}7 天 · 全部模型 {2}█{6}┃░{17} {2}25% {3}5 天 4 小时后重置 · 10\/8 周四 16:00$/)
    expect(lines.some((l: string) => l.startsWith('  ┃ 窗口已过去的时间'))).toBe(true)
  })

  it('renders one line and fractional bar cells', () => {
    expect(cli.renderLine(reading, now, C)).toBe('5h 50% ↻2h30m · 7d 25% ↻5d04h')
    expect(cli.bar(42.4, 8, C)).toBe('███▍░░░░')
    expect(cli.bar(100, 4, C)).toBe('████')
    expect(cli.width('7 天 · 全部模型')).toBe(15)
  })
})

describe('tpq command', () => {
  let server: Server
  let url = ''
  let hits = 0
  let auth = ''
  let limited = false

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits++
      auth = String(req.headers.authorization)
      if (limited) {
        res.writeHead(429, { 'retry-after': '600' })
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(sample(Date.now())))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/oauth/usage`
  })
  afterAll(() => server.close())

  it('fetches with the stored token, reuses it for a minute, and on 429 backs off and shows the newest saved reading', async () => {
    const root = claudeRoot()
    const env = { CLAUDE_CONFIG_DIR: root, TOKENPULSE_USAGE_URL: url }
    hits = 0
    let j = JSON.parse((await tpq(['--json'], env)).out)
    expect(j.source).toBe('oauth')
    expect(j.plan).toBe('Max')
    expect(auth).toBe('Bearer tok-123')
    expect(j.windows.map((w: any) => [w.key, w.usedPercent])).toEqual([
      ['session', 42],
      ['weekly_all', 25],
      ['weekly_opus', 80]
    ])

    j = JSON.parse((await tpq(['--json'], env)).out)
    expect(j.source).toBe('cache')
    expect(hits).toBe(1)

    // the cache goes stale, the endpoint rate-limits, the statusline bridge has something newer
    const cacheFile = join(root, 'tokenpulse', 'usage.json')
    const cache = JSON.parse(readFileSync(cacheFile, 'utf8'))
    writeFileSync(cacheFile, JSON.stringify({ ...cache, fetchedAt: cache.fetchedAt - 5 * 60_000 }))
    const resets = Math.floor(Date.now() / 1000) + 3600
    writeFileSync(join(root, 'tokenpulse', 'statusline.json'), JSON.stringify({ updatedAt: Date.now() - 1000, rate_limits: { five_hour: { used_percentage: 47, resets_at: resets } } }))
    limited = true
    try {
      j = JSON.parse((await tpq(['--json'], env)).out)
      expect(hits).toBe(2)
      expect(j.source).toBe('statusline')
      expect(j.windows[0].usedPercent).toBe(47)
      expect(j.note).toContain('429')
      expect(j.note).toContain('10 分钟')

      const line = await tpq(['--line'], env)
      expect(hits).toBe(2)
      expect(plain(line.out)).toMatch(/^5h 47% ↻(59m|1h00m)\n$/)
      const panel = plain((await tpq([], env)).out)
      expect(panel).toContain('官方状态栏')
      expect(panel).toContain('用量接口限流中')
    } finally {
      limited = false
    }
  })

  it('reports a missing login without asking the endpoint', async () => {
    const root = claudeRoot()
    writeFileSync(join(root, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'old', expiresAt: Date.now() - 1000 } }))
    hits = 0
    const r = await tpq(['--line'], { CLAUDE_CONFIG_DIR: root, TOKENPULSE_USAGE_URL: url })
    expect(hits).toBe(0)
    expect(r.code).toBe(1)
    expect(r.out).toContain('登录令牌已过期')
  })

  it('install wraps the statusline the way TokenPulse does, and uninstall restores it', async () => {
    const root = claudeRoot()
    const user = { model: 'opus', statusLine: { type: 'command', command: 'python statusline.py', refreshInterval: 5 } }
    const settings = join(root, 'settings.json')
    const prevFile = join(root, 'tokenpulse', 'statusline-prev.json')
    writeFileSync(settings, JSON.stringify(user, null, 2))
    const env = { CLAUDE_CONFIG_DIR: root }

    const r = await tpq(['install', '--no-shim'], env)
    expect(r.code).toBe(0)
    const next = JSON.parse(readFileSync(settings, 'utf8'))
    expect(hasBridgeStatusline(next)).toBe(true)
    expect(next.statusLine.command).toBe(`"${process.execPath}" "${join(root, 'tokenpulse', 'statusline.cjs')}"`)
    expect(next.statusLine.refreshInterval).toBe(5)
    expect(next.model).toBe('opus')
    expect(existsSync(join(root, 'tokenpulse', 'quota.cjs'))).toBe(true)
    expect(JSON.parse(readFileSync(`${settings}.tokenpulse.bak`, 'utf8'))).toEqual(user)
    expect(JSON.parse(readFileSync(prevFile, 'utf8'))).toEqual(user.statusLine)

    // installing again keeps the original
    await tpq(['install', '--no-shim'], env)
    expect(JSON.parse(readFileSync(prevFile, 'utf8'))).toEqual(user.statusLine)

    await tpq(['uninstall', '--no-shim'], env)
    expect(JSON.parse(readFileSync(settings, 'utf8'))).toEqual(user)
    expect(existsSync(prevFile)).toBe(false)
  })

  it('leaves invalid settings.json alone', async () => {
    const root = claudeRoot()
    mkdirSync(join(root, 'tokenpulse'), { recursive: true })
    writeFileSync(join(root, 'settings.json'), '{ broken')
    const r = await tpq(['install', '--no-shim'], { CLAUDE_CONFIG_DIR: root })
    expect(r.code).toBe(1)
    expect(r.err).toContain('tpq:')
    expect(readFileSync(join(root, 'settings.json'), 'utf8')).toBe('{ broken')
  })
})
