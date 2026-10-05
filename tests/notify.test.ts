import { describe, expect, it } from 'vitest'
import { escapeHtml, TelegramNotifier } from '../src/main/telegram'
import { pauseBadge, QUOTA_AMBER, QUOTA_GREEN, QUOTA_RED, quotaColor, trayBitmap } from '../src/main/trayIcon'

type Call = { url: string; init?: RequestInit }

function fakeFetch(reply: (c: Call) => { status: number; body: unknown }) {
  const calls: Call[] = []
  const fn = async (url: string, init?: RequestInit) => {
    const c = { url, init }
    calls.push(c)
    const r = reply(c)
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } })
  }
  return { fn, calls }
}

describe('telegram', () => {
  it('sends HTML messages to the chat', async () => {
    const f = fakeFetch(() => ({ status: 200, body: { ok: true, result: {} } }))
    const t = new TelegramNotifier(f.fn, 'http://tg')
    expect(await t.send('123:ABC', '42', '<b>hi</b>')).toEqual({ ok: true })
    expect(f.calls[0].url).toBe('http://tg/bot123:ABC/sendMessage')
    expect(JSON.parse(String(f.calls[0].init!.body))).toMatchObject({ chat_id: '42', text: '<b>hi</b>', parse_mode: 'HTML' })
  })

  it('explains failures without leaking the token', async () => {
    const bad = new TelegramNotifier(fakeFetch(() => ({ status: 401, body: { ok: false, description: 'Unauthorized' } })).fn, 'http://tg')
    expect(await bad.send('123:SECRET', '42', 'x')).toEqual({ ok: false, error: 'Bot Token 无效' })
    const down = new TelegramNotifier(async () => {
      throw new Error('connect ECONNREFUSED for http://tg/bot123:SECRET/sendMessage')
    }, 'http://tg')
    const r = await down.send('123:SECRET', '42', 'x')
    expect(r.ok).toBe(false)
    expect(r.error).not.toContain('SECRET')
    expect(await bad.send('', '', 'x')).toMatchObject({ ok: false })
  })

  it('finds the chat of the newest message to the bot', async () => {
    const f = fakeFetch(() => ({
      status: 200,
      body: { ok: true, result: [{ message: { chat: { id: 1, first_name: 'Old' } } }, { message: { chat: { id: 987654, first_name: 'Ada', last_name: 'L' } } }] }
    }))
    expect(await new TelegramNotifier(f.fn, 'http://tg').detectChat('123:ABC')).toEqual({ ok: true, chatId: '987654', name: 'Ada L' })
    const none = new TelegramNotifier(fakeFetch(() => ({ status: 200, body: { ok: true, result: [] } })).fn, 'http://tg')
    expect((await none.detectChat('123:ABC')).ok).toBe(false)
  })

  it('escapes HTML', () => {
    expect(escapeHtml('<a & b>')).toBe('&lt;a &amp; b&gt;')
  })
})

describe('tray icon', () => {
  const px = (buf: Buffer, size: number, x: number, y: number) => {
    const i = (y * size + x) * 4
    return { b: buf[i], g: buf[i + 1], r: buf[i + 2], a: buf[i + 3] }
  }
  const accent: [number, number, number] = [217, 119, 87]

  it('fills the quota ring clockwise from the top', () => {
    const half = trayBitmap(32, { pct: 50, angle: 0, paused: false, accent })
    // top of the ring (12 o'clock) and right side (3 o'clock) are filled, left side (9 o'clock) is only the track
    const top = px(half, 32, 16, 3)
    const right = px(half, 32, 28, 16)
    const left = px(half, 32, 3, 16)
    expect(top.a).toBe(255)
    expect([top.r, top.g, top.b]).toEqual(QUOTA_GREEN)
    expect(right.g).toBeGreaterThan(150)
    expect(left.a).toBeLessThan(140)
    // the spark in the middle
    expect(px(half, 32, 16, 16)).toMatchObject({ r: 217, g: 119, b: 87, a: 255 })
    // corners stay transparent
    expect(px(half, 32, 0, 0).a).toBe(0)
  })

  it('colours by level and shows pause bars while paused', () => {
    expect(quotaColor(50)).toBe(QUOTA_GREEN)
    expect(quotaColor(80)).toBe(QUOTA_AMBER)
    expect(quotaColor(95)).toBe(QUOTA_RED)
    const paused = trayBitmap(32, { pct: 95, angle: 0, paused: true, accent })
    expect(px(paused, 32, 16, 16).a).toBe(0)
    expect(px(paused, 32, 13, 16)).toMatchObject({ r: 208, g: 59, b: 59 })
    const badge = pauseBadge(16)
    expect(badge.length).toBe(16 * 16 * 4)
    expect(px(badge, 16, 8, 2).a).toBeGreaterThan(200)
  })
})
