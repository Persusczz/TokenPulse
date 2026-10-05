import { describe, expect, it } from 'vitest'
import type { CostedEntry } from '../src/main/aggregate'
import { buildReport } from '../src/main/report'
import { detectRunaway, runawayBaseline } from '../src/main/runaway'
import { BOT_COMMANDS, KEYBOARD, parseCommand, parseInput, TelegramBot, TelegramNotifier, type Reply } from '../src/main/telegram'
import type { RangeSummary } from '../src/shared/types'

const MIN = 60_000
let n = 0
function entry(ts: number, o: Partial<CostedEntry> = {}, cost = 0.1): CostedEntry {
  return {
    key: `r${n++}`,
    ts,
    model: 'claude-opus-4',
    sessionId: 'normal',
    project: 'app',
    projectPath: '/app',
    input: 100,
    output: 200 + (n % 50),
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 5000,
    webSearch: 0,
    speed: 'standard',
    geo: null,
    cost: { input: cost, output: 0, cacheWrite: 0, cacheRead: 0, webSearch: 0, total: cost, cacheSavings: 0 },
    ...o
  }
}

describe('runaway detection', () => {
  const now = Date.UTC(2026, 9, 4, 12)
  // a week of normal use: $0.10 a response, a response a minute, a few sessions
  const history = Array.from({ length: 600 }, (_, i) => entry(now - 7 * 24 * 60 * MIN + i * 15 * MIN, { sessionId: `h${i % 5}` }))

  it('learns the usual heavy 5 minutes', () => {
    expect(runawayBaseline(history, now)).toBeCloseTo(0.1, 5)
    expect(runawayBaseline(history.slice(0, 5), now)).toBe(0)
  })

  it('flags a session spending far more than usual in 5 minutes', () => {
    const burst = Array.from({ length: 10 }, (_, i) => entry(now - 4 * MIN + i * 20_000, { sessionId: 'hot', project: 'big' }, 0.9))
    const calm = Array.from({ length: 4 }, (_, i) => entry(now - 4 * MIN + i * MIN, { sessionId: 'calm' }, 0.1))
    const found = detectRunaway([...history, ...burst, ...calm].sort((a, b) => a.ts - b.ts), now, { baseline: 0.1, sensitivity: 'medium' })
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ sessionId: 'hot', project: 'big', kind: 'burst', requests5: 10 })
    expect(found[0].cost5).toBeCloseTo(9, 5)
    expect(found[0].ratio).toBeCloseTo(90, 5)
    // the $5 floor keeps tiny bursts quiet even when they beat a small baseline
    const small = Array.from({ length: 5 }, (_, i) => entry(now - 2 * MIN + i * 10_000, { sessionId: 's' }, 0.5))
    expect(detectRunaway(small, now, { baseline: 0.1, sensitivity: 'medium' })).toEqual([])
    expect(detectRunaway(small, now, { baseline: 0.1, sensitivity: 'high' })).toEqual([])
  })

  it('flags a session repeating the same response', () => {
    const loop = Array.from({ length: 15 }, (_, i) => entry(now - 9 * MIN + i * 30_000, { sessionId: 'stuck', output: 147 }, 0.02))
    const found = detectRunaway(loop, now, { baseline: 0.1, sensitivity: 'medium' })
    expect(found).toMatchObject([{ sessionId: 'stuck', kind: 'loop', repeats: 15 }])
    // varied output is not a loop
    const varied = loop.map((e, i) => ({ ...e, output: 100 + i * 37 }))
    expect(detectRunaway(varied, now, { baseline: 0.1, sensitivity: 'medium' })).toEqual([])
    expect(detectRunaway(loop.slice(0, 12), now, { baseline: 0.1, sensitivity: 'medium' })).toEqual([])
    expect(detectRunaway(loop.slice(0, 12), now, { baseline: 0.1, sensitivity: 'high' })).toHaveLength(1)
  })
})

describe('evening report', () => {
  const now = new Date(2026, 9, 4, 22, 0).getTime()
  const hour = new Date(2026, 9, 4, 15).getTime()
  const summary = {
    range: 'today',
    start: now,
    end: now,
    bucketUnit: 'hour',
    totals: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, tokens: 268_000_000, cost: 106.06, costParts: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, webSearch: 0, total: 106.06, cacheSavings: 982.2 }, messages: 837, sessions: 7, webSearch: 0 },
    previous: null,
    cacheHitRate: 0.988,
    buckets: [
      { t: hour - 3600_000, tokens: 10 },
      { t: hour, tokens: 999 }
    ],
    byModel: [{ name: 'Opus <5.5>', tokens: 1, cost: 1, messages: 1 }],
    byProject: [{ name: 'tokenpulse2', tokens: 1, cost: 1, messages: 1 }],
    heatmap: null
  } as unknown as RangeSummary

  it('summarises the day, the quota and the forecast in Telegram HTML', () => {
    const text = buildReport({
      now,
      today: summary,
      five: { pct: 91.2, resetsAt: new Date(2026, 9, 4, 23, 17).getTime() },
      week: { pct: 31, resetsAt: now + 4 * 86_400_000 },
      forecast: { available: true, projectedPct: 115, etaFull: new Date(2026, 9, 7, 5, 35).getTime(), suggestPctPerDay: 15.8 } as never,
      value: { planPrice: 20, multiple: 5.2, monthCost: 104.58 } as never,
      unlockedToday: [{ title: '千万俱乐部' } as never],
      money: (v) => `$${v.toFixed(2)}`
    })
    expect(text).toContain('🌙 <b>TokenPulse 晚报</b> · 10/4 周日')
    expect(text).toContain('今日 <b>2.68 亿</b> tokens · $106.06')
    expect(text).toContain('响应 837 次 · 会话 7 个 · 缓存命中 98.8%（省 $982.20）')
    expect(text).toContain('最忙 15:00–16:00')
    expect(text).toContain('主力模型 Opus &lt;5.5&gt;')
    expect(text).toContain('5h 额度 91%（23:17 重置）')
    expect(text).toContain('⚠️ 按当前速度 10/7 周三 05:35 用完')
    expect(text).toContain('订阅回本：本月 5.2 倍')
    expect(text).toContain('🏆 今日解锁：千万俱乐部')
  })

  it('handles a quiet day', () => {
    const quiet = { ...summary, totals: { ...summary.totals, messages: 0 } } as RangeSummary
    const text = buildReport({ now, today: quiet, five: null, week: null, forecast: null, value: null, unlockedToday: [], money: String })
    expect(text).toContain('今天还没有使用 Claude Code')
  })
})

describe('telegram commands', () => {
  it('parses commands, with or without the bot name', () => {
    expect(parseCommand('/status')).toEqual({ name: 'status', args: [] })
    expect(parseCommand('/guard@TokenPulseBot  ON ')).toEqual({ name: 'guard', args: ['ON'] })
    expect(parseCommand('hello')).toBeNull()
  })

  it('skips the backlog, ignores other chats and answers the configured one', async () => {
    const sent: { chat: string; text: string }[] = []
    let polls = 0
    const fetchFn = async (url: string, init?: RequestInit) => {
      const method = url.split('/').pop()!
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      let result: unknown = true
      if (method === 'getUpdates' && body.offset === -1) result = [{ update_id: 100, message: { chat: { id: 42 }, text: '/pause' } }]
      else if (method === 'getUpdates') {
        polls++
        result =
          polls === 1 && body.offset === 101
            ? [
                { update_id: 101, message: { chat: { id: 999 }, text: '/status' } },
                { update_id: 102, message: { chat: { id: 42 }, text: '/status@Bot' } }
              ]
            : await new Promise((r) => setTimeout(() => r([]), 20))
      } else if (method === 'sendMessage') sent.push({ chat: body.chat_id, text: body.text })
      return new Response(JSON.stringify({ ok: true, result }), { status: 200 })
    }
    const handled: string[] = []
    const bot = new TelegramBot(new TelegramNotifier(fetchFn, 'http://tg'), async (c) => {
      handled.push(c.name)
      return `got ${c.name}`
    })
    bot.start('1:A', '42')
    for (let i = 0; i < 100 && !sent.length; i++) await new Promise((r) => setTimeout(r, 20))
    bot.stop()
    expect(handled).toEqual(['status'])
    expect(sent).toEqual([{ chat: '42', text: 'got status' }])
    expect(bot.running).toBe(false)
    expect(bot.lastChat).toEqual({ id: '42', name: undefined })
  })

  it('reads keyboard buttons as commands', () => {
    expect(parseInput('📊 状态')).toEqual({ name: 'status', args: [] })
    expect(parseInput('  ⏸ 暂停 ')).toEqual({ name: 'pause', args: [] })
    expect(parseInput('/task 修好测试')).toEqual({ name: 'task', args: ['修好测试'] })
    expect(KEYBOARD.flat().every((b) => BOT_COMMANDS.some((c) => c.command === b.command))).toBe(true)
  })

  it('registers the command menu, sends the keyboard and handles inline buttons', async () => {
    const calls: { method: string; body: any }[] = []
    let polls = 0
    const fetchFn = async (url: string, init?: RequestInit) => {
      const method = url.split('/').pop()!
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      calls.push({ method, body })
      let result: unknown = true
      if (method === 'getUpdates' && body.offset === -1) result = []
      else if (method === 'getUpdates') {
        polls++
        result =
          polls === 1
            ? [
                { update_id: 5, message: { chat: { id: 42, first_name: 'Me' }, text: '❓ 帮助' } },
                { update_id: 6, callback_query: { id: 'cb1', data: 'e:status', message: { chat: { id: 42 }, message_id: 77 } } },
                { update_id: 7, callback_query: { id: 'cb2', data: 'guard on', message: { chat: { id: 42 }, message_id: 78 } } }
              ]
            : await new Promise((r) => setTimeout(() => r([]), 20))
      }
      return new Response(JSON.stringify({ ok: true, result }), { status: 200 })
    }
    const handled: string[] = []
    const bot = new TelegramBot(new TelegramNotifier(fetchFn, 'http://tg'), async (c): Promise<Reply> => {
      handled.push([c.name, ...c.args].join(' '))
      return c.name === 'help' ? { text: 'help', keyboard: true } : { text: `got ${c.name}`, buttons: [[{ text: '🔄', data: 'e:status' }]] }
    })
    bot.start('1:A', '42')
    for (let i = 0; i < 100 && handled.length < 3; i++) await new Promise((r) => setTimeout(r, 20))
    await new Promise((r) => setTimeout(r, 50))
    bot.stop()
    expect(handled).toEqual(['help', 'status', 'guard on'])
    const m = (name: string) => calls.filter((c) => c.method === name)
    expect(m('setMyCommands').map((c) => c.body.scope ?? null)).toEqual([null, { type: 'chat', chat_id: '42' }])
    expect(m('setChatMenuButton').every((c) => c.body.menu_button.type === 'commands')).toBe(true)
    expect(bot.menuReady).toBe(true)
    const sends = m('sendMessage')
    expect(sends[0].body.reply_markup.keyboard[0][0]).toEqual({ text: '📊 状态' })
    expect(sends[0].body.reply_markup.is_persistent).toBe(true)
    // e: edits the tapped message, a plain command answers with a new one
    expect(m('editMessageText')[0].body).toMatchObject({ message_id: 77, text: 'got status' })
    expect(m('editMessageText')[0].body.reply_markup.inline_keyboard[0][0]).toEqual({ text: '🔄', callback_data: 'e:status' })
    expect(sends[1].body.text).toBe('got guard')
    expect(m('answerCallbackQuery').map((c) => c.body.callback_query_id)).toEqual(['cb1', 'cb2'])
  })
})
