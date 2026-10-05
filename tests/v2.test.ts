import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PromptMark } from '../src/shared/types'
import type { CostedEntry } from '../src/main/aggregate'
import { CodexStore, newCodexFile, parseCodexLine } from '../src/main/collector/codex'
import { parseLine } from '../src/main/collector/parser'
import { activeContexts, CLAUDE_LONG_WINDOW, CLAUDE_WINDOW, contextAlerts, contextLevel, sessionContext, windowOf } from '../src/main/context'
import { chatgptPlan, computeValue } from '../src/main/insights'
import { costByPrompt, indexPrompts, promptReport } from '../src/main/prompts'
import { trayBitmap } from '../src/main/trayIcon'
import { buildHistory, ClaudeWindowLog, estimateClaudeWindows, FIVE_H } from '../src/main/windowHistory'

const T = Date.UTC(2026, 9, 4, 8, 0)
const M = 60_000
const iso = (t: number) => new Date(t).toISOString()

let n = 0
const entry = (ts: number, o: Partial<CostedEntry> = {}, cost = 1): CostedEntry => ({
  key: `k${n++}`,
  ts,
  model: 'claude-opus-5-5',
  sessionId: 's1',
  project: 'p',
  projectPath: '/p',
  input: 10,
  output: 100,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
  webSearch: 0,
  speed: 'standard',
  geo: null,
  cost: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, webSearch: 0, total: cost, cacheSavings: 0 },
  ...o
})

const user = (o: object) => JSON.stringify({ type: 'user', sessionId: 's1', cwd: 'G:\\code\\app', timestamp: iso(T), uuid: 'u1', promptId: 'p1', isSidechain: false, ...o })

describe('prompts in Claude Code logs', () => {
  it('keeps what the user typed and skips tool results, subagents and meta lines', () => {
    const p = parseLine(user({ message: { role: 'user', content: '把测试修好\n然后跑一遍' } }), 'fb')
    expect(p).toMatchObject({ kind: 'prompt', prompt: { key: 's1:p1', text: '把测试修好 然后跑一遍', project: 'app', source: 'claude', ts: T } })
    const cmd = parseLine(user({ message: { role: 'user', content: '<command-message>compact</command-message>\n<command-name>/compact</command-name>\n<command-args>keep the plan</command-args>' } }), 'fb')
    expect(cmd).toMatchObject({ prompt: { text: '/compact keep the plan' } })
    expect(parseLine(user({ message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'x' }] } }), 'fb')).toBeNull()
    expect(parseLine(user({ isSidechain: true, message: { role: 'user', content: 'subagent task' } }), 'fb')).toBeNull()
    expect(parseLine(user({ isMeta: true, message: { role: 'user', content: 'caveat' } }), 'fb')).toBeNull()
    expect(parseLine(user({ message: { role: 'user', content: '<local-command-stdout>ok</local-command-stdout>' } }), 'fb')).toBeNull()
    expect(parseLine(user({ message: { role: 'user', content: '<task-notification> <task-id>b1</task-id> done' } }), 'fb')).toBeNull()
    expect(parseLine(user({ message: { role: 'user', content: [{ type: 'text', text: '看图' }, { type: 'image', source: {} }] } }), 'fb')).toMatchObject({ prompt: { text: '看图' } })
  })

  it('marks subagent requests', () => {
    const line = JSON.stringify({
      type: 'assistant',
      isSidechain: true,
      sessionId: 's1',
      timestamp: iso(T),
      requestId: 'r',
      message: { id: 'm', model: 'claude-sonnet-5-5', usage: { input_tokens: 5, output_tokens: 6 } }
    })
    expect(parseLine(line, 'fb')).toMatchObject({ kind: 'usage', entry: { side: true } })
  })
})

describe('Codex prompts and windows', () => {
  const item = (text: string, t = T, id = 'item-1') =>
    JSON.stringify({ timestamp: iso(t), ordinal: 12, type: 'event_msg', payload: { type: 'item_completed', thread_id: 'sess-1', turn_id: 'turn-1', item: { type: 'UserMessage', id, content: [{ type: 'text', text }] } } })
  const limits = (t: number, pct: number, reset: number) =>
    JSON.stringify({ timestamp: iso(t), ordinal: 3, type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: { primary: { used_percent: pct, window_minutes: 300, resets_at: reset / 1000 }, plan_type: 'plus' } } })

  it('reads the user messages', () => {
    const f = newCodexFile('sess-1')
    expect(parseCodexLine(item('写个脚本'), f)).toMatchObject({ prompt: { key: 'codex:sess-1:turn-1:item-1', text: '写个脚本', source: 'codex' } })
    expect(parseCodexLine(item('<environment_context>cwd</environment_context>'), f)).toBeNull()
  })

  it('follows each 5-hour window: peak, and when it ran out', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-v2-'))
    const file = join(dir, 'rollout-2026-10-04T08-00-00-01a00000-0000-0000-0000-000000000001.jsonl')
    const r1 = T + 5 * 3600_000
    const r2 = r1 + 6 * 3600_000
    // a filler line with a long head, as real item_completed lines have
    writeFileSync(
      file,
      [item('第一个问题', T), limits(T + M, 40, r1), limits(T + 60 * M, 100, r1 + 1000), limits(T + 61 * M, 100, r1), limits(r1 + 2 * 3600_000, 30, r2), item('第二个问题', r1 + 2 * 3600_000, 'item-9')].join('\n') + '\n'
    )
    const s = new CodexStore()
    await s.readFile(file)
    expect([...s.prompts.values()].map((p) => p.text)).toEqual(['第一个问题', '第二个问题'])
    expect(s.windows).toHaveLength(2)
    expect(s.windows[0]).toMatchObject({ end: r1, peak: 100, hitAt: T + 60 * M })
    expect(s.windows[1]).toMatchObject({ peak: 30, hitAt: null })
  })
})

describe('cost per prompt', () => {
  const prompts: PromptMark[] = [
    { key: 'a', sessionId: 's1', ts: T, text: 'first', project: 'p', source: 'claude' },
    { key: 'b', sessionId: 's1', ts: T + 10 * M, text: 'second', project: 'p', source: 'claude' },
    { key: 'c', sessionId: 's2', ts: T + 2 * M, text: 'other', project: 'q', source: 'claude' }
  ]
  const entries = [
    entry(T + M, {}, 2),
    // a subagent's request, logged under the parent session
    entry(T + 3 * M, { side: true }, 3),
    entry(T + 11 * M, {}, 0.5),
    entry(T + 12 * M, {}, 0.5),
    entry(T + 3 * M, { sessionId: 's2' }, 4),
    // before any prompt of its session
    entry(T - 5 * M, { sessionId: 's3' }, 7)
  ].sort((a, b) => a.ts - b.ts)

  it('adds up everything a prompt set off until the next one', () => {
    const { list, unattributed } = costByPrompt(entries, indexPrompts(prompts), T - 60 * M, T + 60 * M)
    const by = Object.fromEntries(list.map((p) => [p.key, p]))
    expect(by.a).toMatchObject({ cost: 5, requests: 2, durationMs: 3 * M })
    expect(by.b).toMatchObject({ cost: 1, requests: 2 })
    expect(by.c.cost).toBe(4)
    expect(unattributed).toBe(7)
  })

  it('ranks the most expensive with average and median', () => {
    const r = promptReport(entries, indexPrompts(prompts), 'today', T - 60 * M, T + 60 * M, undefined, 2)
    expect(r.top.map((p) => p.key)).toEqual(['a', 'c'])
    expect(r.count).toBe(3)
    expect(r.medianCost).toBe(4)
    expect(r.avgCost).toBeCloseTo(10 / 3, 6)
  })
})

describe('context growth', () => {
  const ctx = (ts: number, read: number, o: Partial<CostedEntry> = {}) => entry(ts, { cacheRead: read, input: 1000, ...o })
  const list = [ctx(T, 20_000), ctx(T + M, 60_000), ctx(T + 2 * M, 140_000), ctx(T + 2.5 * M, 5_000, { side: true }), ctx(T + 3 * M, 30_000), ctx(T + 4 * M, 50_000), ctx(T + 5 * M, 150_000)]

  it('draws a session’s context, finds compactions and the growth since', () => {
    const c = sessionContext(list, 120_000)!
    expect(c.requests).toBe(6)
    expect(c.peak).toBe(151_000)
    expect(c.latest).toBe(151_000)
    expect(c.compactions).toEqual([T + 3 * M])
    expect(c.growthPerRequest).toBe(60_000)
    expect(c.points.at(-1)).toEqual({ t: T + 5 * M, tokens: 151_000 })
  })

  it('warns about active sessions past the line', () => {
    const line = (warnAt: number) => () => ({ window: 200_000, warnAt })
    expect(contextAlerts(list, T + 6 * M, line(120_000))).toMatchObject([{ sessionId: 's1', tokens: 151_000, window: 200_000 }])
    expect(contextAlerts(list, T + 6 * M, line(200_000))).toEqual([])
    expect(contextAlerts(list, T + 60 * M, line(120_000))).toEqual([])
    // every active session, warned or not, so a compaction can reset its warnings
    expect(activeContexts(list, T + 6 * M, line(200_000))).toHaveLength(1)
  })

  it('judges by the model’s own window', () => {
    expect(windowOf('claude-opus-5-5', 'claude', 150_000)).toBe(CLAUDE_WINDOW)
    // a Claude model seen past 200k is a 1M one
    expect(windowOf('claude-opus-5-5', 'claude', 480_000)).toBe(CLAUDE_LONG_WINDOW)
    expect(windowOf('claude-sonnet-5-5[1m]', 'claude', 0)).toBe(CLAUDE_LONG_WINDOW)
    expect(windowOf('gpt-5.5', 'codex', 0, new Map([['gpt-5.5', 258_400]]))).toBe(258_400)
    expect(windowOf('gpt-x', 'codex', 0)).toBe(258_400)
    const a = (tokens: number) => ({ tokens, window: 1_000_000, warnAt: 700_000 })
    // auto: 70% once, 88% (close to auto-compact) once more
    expect([a(500_000), a(720_000), a(900_000)].map((x) => contextLevel(x, true))).toEqual([0, 1, 2])
    // fixed line: 1.5× the line is the second step
    expect(contextLevel({ tokens: 190_000, window: 1_000_000, warnAt: 120_000 }, false)).toBe(2)
  })
})

describe('5-hour window history', () => {
  it('records official readings per window and when one ran out', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-win-'))
    const log = new ClaudeWindowLog(join(dir, 'w.json'))
    const end = T + FIVE_H
    expect(log.record(20, end, T + 10 * M)).toBe(true)
    // the same reading again: nothing new
    expect(log.record(20, end + 2000, T + 11 * M)).toBe(false)
    log.record(100, end, T + 3 * 3600_000)
    log.record(100, end, T + 3.5 * 3600_000)
    expect(log.windows).toHaveLength(1)
    expect(log.windows[0]).toMatchObject({ peak: 100, hitAt: T + 3 * 3600_000 })
    // a reading from outside the window is not taken
    expect(log.record(5, end, end + M)).toBe(false)
  })

  it('estimates older windows from the logs and fills only the gaps', () => {
    // $10 limit: $4 then $7 in one window (runs out), $2 in the next
    const entries = [entry(T + 10 * M, {}, 4), entry(T + 2 * 3600_000, {}, 7), entry(T + 6 * 3600_000, {}, 2)]
    const est = estimateClaudeWindows(entries, 10, T - 3600_000, T + 8 * 3600_000)
    expect(est).toHaveLength(2)
    expect(est[0]).toMatchObject({ start: T, peak: 100, hitAt: T + 2 * 3600_000, estimated: true })
    expect(est[1]).toMatchObject({ start: T + 6 * 3600_000, peak: 20, hitAt: null })
    const h = buildHistory({
      days: 1,
      now: T + 8 * 3600_000,
      sources: ['claude', 'codex'],
      claude: [{ end: T + 11 * 3600_000, peak: 64, hitAt: null, samples: [{ t: T + 7 * 3600_000, pct: 64 }] }],
      claudeEstimated: est,
      codex: [{ end: T + 4 * 3600_000, peak: 100, hitAt: T + 3 * 3600_000, samples: [{ t: T + 3 * 3600_000, pct: 100 }] }]
    })
    // the recorded window replaces the estimate it overlaps
    expect(h.windows.filter((w) => w.source === 'claude').map((w) => [w.estimated, w.peak])).toEqual([
      [true, 100],
      [false, 64]
    ])
    expect(h.summary.find((s) => s.source === 'claude')).toMatchObject({ windows: 2, hits: 1, avgToHitMs: 2 * 3600_000, estimated: 1 })
    // that window opened at T - 1h
    expect(h.summary.find((s) => s.source === 'codex')).toMatchObject({ windows: 1, hits: 1, avgToHitMs: 4 * 3600_000 })
    // the replay starts from an empty window
    expect(h.windows.find((w) => !w.estimated && w.source === 'claude')!.samples[0]).toEqual({ t: T + 6 * 3600_000, pct: 0 })
  })
})

describe('each tool its own subscription', () => {
  const money = (v: number) => `$${v.toFixed(0)}`
  const now = new Date(2026, 9, 15, 12).getTime()
  const month = [entry(new Date(2026, 9, 2).getTime(), {}, 150), entry(new Date(2026, 9, 10).getTime(), {}, 150)]
  it('prices ChatGPT plans and adds both plans up under 全部', () => {
    expect(chatgptPlan('plus')).toBe('ChatGPT Plus')
    const codex = computeValue(month, now, { plan: 'ChatGPT Plus', priceSetting: null, quotaHits: 4, money, source: 'codex' })
    expect(codex).toMatchObject({ source: 'codex', planPrice: 20, verdict: 'upgrade' })
    const both = computeValue(month, now, { plan: 'Max 5x + ChatGPT Plus', priceSetting: null, quotaHits: 0, money, source: 'all' })
    expect(both.planPrice).toBe(120)
    expect(both.multiple).toBeCloseTo(2.5, 6)
  })
})

describe('tray icon', () => {
  it('draws a Codex hexagon instead of the spark', () => {
    const look = { pct: null, angle: 0, paused: false, accent: [91, 108, 255] as [number, number, number] }
    const spark = trayBitmap(32, look)
    const hex = trayBitmap(32, { ...look, glyph: 'codex' })
    const lit = (b: Buffer) => b.filter((_, i) => i % 4 === 3 && b[i] > 128).length
    expect(lit(hex)).toBeGreaterThan(40)
    expect(hex.equals(spark)).toBe(false)
  })
})
