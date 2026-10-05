import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CostedEntry } from '../src/main/aggregate'
import { codingSign, zodiacOf, zodiacToday } from '../src/main/stars'
import { parseStreamLine, TaskService, unsupportedModel } from '../src/main/tasks'
import type { ScheduledTask } from '../src/shared/types'

const HOUR = 3600_000
const DAY = 24 * HOUR

const entry = (ts: number, o: Partial<CostedEntry> = {}): CostedEntry => ({
  key: `k${ts}${Math.random()}`,
  ts,
  model: 'claude-opus-5-5',
  sessionId: 's1',
  project: 'p',
  projectPath: 'G:\\p',
  input: 1000,
  output: 1000,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 8000,
  webSearch: 0,
  speed: 'standard',
  geo: null,
  cost: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, webSearch: 0, total: 1, cacheSavings: 0 },
  ...o
})

describe('stars', () => {
  it('knows the sun sign, across the new year too', () => {
    expect(zodiacOf(new Date(2026, 9, 4).getTime()).name).toBe('天秤座')
    expect(zodiacOf(new Date(2026, 11, 25).getTime()).name).toBe('摩羯座')
    expect(zodiacOf(new Date(2026, 0, 10).getTime()).name).toBe('摩羯座')
    expect(zodiacOf(new Date(2026, 0, 25).getTime()).name).toBe('水瓶座')
    expect(zodiacOf(new Date(2026, 2, 21).getTime()).name).toBe('白羊座')
    expect(zodiacOf(new Date(2026, 11, 1).getTime()).name).toBe('射手座')
  })

  it('lights today’s stars in proportion to an ordinary day', () => {
    const now = new Date(2026, 9, 4, 18).getTime()
    const past = [1, 2, 3, 4].map((d) => entry(now - d * DAY, { input: 100_000, output: 0, cacheRead: 0 }))
    const half = zodiacToday([...past, entry(now - HOUR, { input: 50_000, output: 0, cacheRead: 0 })], now)
    expect(half.stars).toBe(5)
    expect(half.lit).toBe(2)
    const full = zodiacToday([...past, entry(now - HOUR, { input: 150_000, output: 0, cacheRead: 0 })], now)
    expect(full.lit).toBe(5)
    expect(zodiacToday(past, now).lit).toBe(0)
  })

  it('reads a night owl from the hours', () => {
    const now = new Date(2026, 9, 4, 18).getTime()
    const nights = Array.from({ length: 20 }, (_, i) => entry(new Date(2026, 9, 1 + (i % 3), 23, i).getTime(), { sessionId: `n${i % 3}` }))
    const days = Array.from({ length: 6 }, (_, i) => entry(new Date(2026, 9, 2, 14, i).getTime(), { sessionId: 'd' }))
    // one session resumed over days is not a marathon: only the active time counts
    const resumed = [entry(new Date(2026, 9, 1, 23, 50).getTime(), { sessionId: 'n0' })]
    expect(codingSign([...nights, ...days, ...resumed], now).name).toBe('夜航座')
    const s = codingSign([...nights, ...days], now)
    expect(s.name).toBe('夜航座')
    expect(s.traits[0]).toContain('夜里')
    expect(s.points.length).toBeGreaterThan(2)
    expect(codingSign([], now).name).toBe('轻舟座')
  })
})

describe('Codex tasks', () => {
  it('reads the token counts Codex reports', () => {
    const r = parseStreamLine(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 19240, cached_input_tokens: 1408, output_tokens: 84 } }))
    expect(r.result?.usage).toEqual({ input: 19240, cached: 1408, output: 84 })
    expect(unsupportedModel("The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.")).toBe('gpt-6.1-sol')
    expect(unsupportedModel('something else')).toBeNull()
  })

  it('switches to a model the ChatGPT account takes, remembers it, and prices the run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-codex-'))
    const fake = join(dir, 'fake-codex.cjs')
    // refuses gpt-6.1-sol (also the "default" when no -m is given), takes the rest
    writeFileSync(
      fake,
      `const a = process.argv.slice(2); const i = a.indexOf('-m'); const m = i >= 0 ? a[i + 1] : 'gpt-6.1-sol'
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
process.stdin.resume(); process.stdin.on('end', () => {
  out({ type: 'thread.started', thread_id: 'th-1' })
  if (m === 'gpt-6.1-sol') out({ type: 'turn.failed', error: { message: JSON.stringify({ error: { message: "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account." } }) } })
  else { out({ type: 'item.completed', item: { type: 'agent_message', text: 'ok ' + m } }); out({ type: 'turn.completed', usage: { input_tokens: 1000000, cached_input_tokens: 0, output_tokens: 0 } }) }
})`
    )
    mkdirSync(join(dir, 'w'))
    const priced: (string | null)[] = []
    const make = () =>
      new TaskService(join(dir, 'tasks.json'), join(dir, 'logs'), {
        window: () => ({ five: null, localEnd: null }),
        blocker: () => null,
        claude: async () => null,
        codex: async () => 'codex',
        command: () => ({ cmd: process.execPath, pre: [fake] }),
        price: (t) => {
          priced.push(t.model)
          return 2.5
        }
      })
    const svc = make()
    await svc.load()
    const done = new Promise<ScheduledTask>((r) => svc.once('finished', r))
    const t = svc.add({ prompt: 'hi', cwd: join(dir, 'w'), tool: 'codex', trigger: 'now' })
    const r = await done
    expect(r.status).toBe('done')
    expect(r.summary).toBe('ok gpt-5.5')
    expect(r.costUsd).toBe(2.5)
    expect(r.tokens).toBe(1_000_000)
    expect(priced).toEqual(['gpt-5.5'])
    expect(t.note).toContain('改用 gpt-5.5')
    // learned: a new service goes straight to the fallback
    const again = make()
    await again.load()
    const done2 = new Promise<ScheduledTask>((res) => again.once('finished', res))
    again.add({ prompt: 'hi', cwd: join(dir, 'w'), tool: 'codex', trigger: 'now' })
    expect((await done2).summary).toBe('ok gpt-5.5')
  })
})
