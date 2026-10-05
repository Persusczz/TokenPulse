import { mkdtempSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codexDirs, codexQuota, CodexStore, newCodexFile, parseCodexLine } from '../src/main/collector/codex'
import { diagnoseCache } from '../src/main/cacheDoctor'
import type { CostedEntry } from '../src/main/aggregate'
import { computePace, wasteDue, wasteRule } from '../src/main/pace'
import { GPT_ROWS } from '../src/main/pricing/bundled'
import { parseLiteLLM } from '../src/main/pricing/litellm'
import { resolvePrice } from '../src/main/pricing/resolve'

const T = Date.UTC(2026, 9, 3, 15, 0)
const iso = (t: number) => new Date(t).toISOString()
const line = (o: object) => JSON.stringify(o)
const meta = (cwd = 'G:\\code\\app') => line({ timestamp: iso(T), ordinal: 0, type: 'session_meta', payload: { id: 'sess-1', cwd, base_instructions: 'x'.repeat(5000) } })
const turn = (model: string, t = T) => line({ timestamp: iso(t), ordinal: 1, type: 'turn_context', payload: { model, cwd: 'G:\\code\\app', effort: 'high' } })
const usage = (id: string, t: number, input: number, cached: number, output: number) =>
  line({ timestamp: iso(t), ordinal: 2, type: 'token_usage_record', payload: { session_id: 'sess-1', response_id: id, usage: { input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: 10, total_tokens: input + output } } })
const count = (t: number, total: number, last: number, pct = 40) =>
  line({
    timestamp: iso(t),
    ordinal: 3,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: { total_token_usage: { total_tokens: total }, last_token_usage: { input_tokens: last, cached_input_tokens: 0, output_tokens: 0, total_tokens: last } },
      rate_limits: { primary: { used_percent: pct, window_minutes: 300, resets_at: (T + 3600_000) / 1000 }, secondary: { used_percent: 12, window_minutes: 10080, resets_at: (T + 3 * 86_400_000) / 1000 }, plan_type: 'plus' }
    }
  })
const huge = () => line({ timestamp: iso(T), ordinal: 9, type: 'response_item', payload: { type: 'message', content: 'y'.repeat(6 << 20) } })

describe('Codex logs', () => {
  it('reads per-response usage with the model and folder of the turn', () => {
    const f = newCodexFile()
    expect(parseCodexLine(meta(), f)).toBeNull()
    parseCodexLine(turn('gpt-6.1-sol'), f)
    const r = parseCodexLine(usage('resp_1', T + 1000, 73_298, 72_320, 715), f)!
    expect(r.entry).toMatchObject({ key: 'codex:resp_1', model: 'gpt-6.1-sol', sessionId: 'sess-1', project: 'app', input: 978, cacheRead: 72_320, output: 715, source: 'codex' })
    expect(f.records).toBe(true)
    // with per-response records, running totals are not counted again
    expect(parseCodexLine(count(T + 2000, 99_999, 50_000), f)!.entry).toBeUndefined()
  })

  it('falls back to running totals in older logs and keeps the newest limits', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-codex-'))
    const old = join(dir, 'rollout-2026-06-01T10-00-00-01a00000-0000-0000-0000-000000000001.jsonl')
    writeFileSync(old, [meta(), turn('gpt-5'), count(T, 1000, 1000, 20), count(T + 1000, 1000, 1000, 21), count(T + 2000, 3000, 2000, 22), huge()].join('\n') + '\n')
    const s = new CodexStore()
    const added = await s.readFile(old)
    expect(added.map((e) => e.input)).toEqual([1000, 2000])
    expect(s.limits).toMatchObject({ plan: 'plus', primary: { pct: 22, windowMin: 300 } })
    // newer Codex: the first per-response record replaces totals taken earlier in the file
    const neu = join(dir, 'rollout-2026-10-03T10-00-00-01a00000-0000-0000-0000-000000000002.jsonl')
    writeFileSync(neu, [meta(), turn('gpt-6.1-sol'), count(T + 5000, 500, 500, 30)].join('\n') + '\n')
    expect(await s.readFile(neu)).toHaveLength(1)
    appendFileSync(neu, [usage('resp_a', T + 6000, 600, 100, 50), usage('resp_a', T + 6000, 600, 100, 50), usage('resp_b', T + 7000, 900, 0, 20)].join('\n') + '\n')
    const more = await s.readFile(neu)
    expect(more.map((e) => e.key)).toEqual(['codex:resp_a', 'codex:resp_b'])
    expect([...s.entries.keys()].filter((k) => k.includes('sess-1:t'))).toEqual(['codex:sess-1:t1000', 'codex:sess-1:t3000'])
    expect(s.limits?.primary?.pct).toBe(30)
    expect(await s.readFile(neu)).toEqual([])
  })

  it('shows a window whose reset has passed as fresh', () => {
    const l = { at: T, plan: 'plus', primary: { pct: 98, windowMin: 300, resetsAt: T + 60_000 }, secondary: { pct: 31, windowMin: 10080, resetsAt: T + 86_400_000 } }
    const q = codexQuota(l, T, 3)!
    expect(q.windows.map((w) => [w.key, w.label, w.utilization])).toEqual([
      ['codex_5h', '5 小时额度', 98],
      ['codex_7d', '7 天额度', 31]
    ])
    expect(codexQuota(l, T + 120_000, 3)!.windows[0]).toMatchObject({ utilization: 0, resetsAt: null })
    expect(codexQuota(null, T, 0)).toBeNull()
  })

  it.runIf(process.env.TP_BENCH)('scans the real Codex folder quickly', async () => {
    const s = new CodexStore()
    const t0 = performance.now()
    await s.scan(codexDirs())
    const ms = performance.now() - t0
    const models = new Map<string, number>()
    for (const e of s.entries.values()) models.set(e.model, (models.get(e.model) ?? 0) + 1)
    const hits = s.windows.filter((w) => w.hitAt)
    console.log(JSON.stringify({ ms: Math.round(ms), files: s.fileCount, entries: s.entries.size, prompts: s.prompts.size, windows: s.windows.length, hits: hits.length, models: [...models], limits: s.limits }))
  }, 120_000)
})

describe('GPT prices', () => {
  const rows = new Map(GPT_ROWS.map((r) => [r.id, r]))
  it('matches known models and estimates new ones from the newest of their size', () => {
    expect(resolvePrice('gpt-5-codex', rows)).toMatchObject({ row: { id: 'gpt-5-codex' }, estimated: false })
    expect(resolvePrice('gpt-6.1-sol', rows)).toMatchObject({ row: { input: 1.25 }, estimated: true })
    expect(resolvePrice('gpt-6-mini', rows)).toMatchObject({ row: { id: 'gpt-5-mini' }, estimated: true })
    const lite = parseLiteLLM({
      'gpt-5.1': { input_cost_per_token: 1.25e-6, output_cost_per_token: 1e-5, cache_read_input_token_cost: 1.25e-7 },
      'gpt-5-pro': { input_cost_per_token: 1.5e-5, output_cost_per_token: 1.2e-4 },
      'azure/gpt-5.1': { input_cost_per_token: 9e-6, output_cost_per_token: 9e-5 }
    })
    expect(lite.find((r) => r.id === 'gpt-5.1')).toMatchObject({ input: 1.25, cacheRead: 0.125, cacheWrite5m: 1.25 })
    const all = new Map([...rows, ...lite.map((r) => [r.id, r] as const)])
    // newest main-line model, never the pro tier
    expect(resolvePrice('gpt-6.1-sol', all)?.row.id).toBe('gpt-5.1')
  })
})

let n = 0
const entry = (ts: number, o: Partial<CostedEntry> = {}, cost = 1): CostedEntry => ({
  key: `k${n++}`,
  ts,
  model: 'claude-opus-5-5',
  sessionId: 's1',
  project: 'p',
  projectPath: '/p',
  input: 100,
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

describe('quota pace', () => {
  const H = 3600_000
  const reset = T + 2 * H
  const w = { key: 'claude_5h', label: 'Claude 5 小时', source: 'claude' as const, pct: 30, resetsAt: reset, durationMs: 5 * H }

  it('compares usage with an even line and projects the reset', () => {
    // 3 hours in: ideal 60%, used 30% — and nothing in the last 45 minutes
    const entries = [entry(T - 3 * H + 60_000), entry(T - 2 * H), entry(T - H)]
    const p = computePace(entries, w, T)
    expect(p.ideal).toBeCloseTo(60, 5)
    expect(p.lead).toBeCloseTo(-30, 5)
    expect(p.curve[0]).toEqual({ t: T - 3 * H, pct: 0 })
    expect(p.curve.at(-1)).toEqual({ t: T, pct: 30 })
    // only the average pace counts (10%/h, weighted 0.3 = 3%/h): +6% by the reset
    expect(p.projected).toBeCloseTo(36, 5)
    expect(p.unused).toBeCloseTo(64, 5)
    expect(p.etaFull).toBeNull()
    expect(wasteDue(p, T, wasteRule(p, 30))).toBe(false)
    expect(wasteDue(p, reset - 20 * 60_000, wasteRule(p, 30))).toBe(true)
  })

  it('sees a burst coming before the reset', () => {
    const entries = [entry(T - 3 * H), ...Array.from({ length: 9 }, (_, i) => entry(T - 30 * 60_000 + i * 60_000))]
    const p = computePace(entries, { ...w, pct: 70 }, T)
    expect(p.lead).toBeCloseTo(10, 5)
    expect(p.etaFull).not.toBeNull()
    expect(p.etaFull!).toBeLessThan(reset)
    expect(p.projected).toBeGreaterThan(100)
  })
})

describe('cache doctor', () => {
  const M = 60_000
  const price = () => ({ input: 5, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 })
  const money = (v: number) => `$${v.toFixed(2)}`
  const list = [
    entry(T, { cacheWrite5m: 200_000 }),
    // 3 minutes later: read from cache
    entry(T + 3 * M, { cacheRead: 200_000, cacheWrite5m: 2_000 }),
    // 8 minutes idle: the whole context written again
    entry(T + 11 * M, { cacheWrite5m: 205_000, cacheRead: 0 }),
    // 2 hours idle, another session meanwhile
    entry(T + 20 * M, { sessionId: 's2', cacheWrite5m: 50_000 }),
    entry(T + 140 * M, { cacheWrite5m: 210_000, cacheRead: 5_000 }),
    // Codex: cached by OpenAI, then 30 minutes idle and billed at full input price
    entry(T + 141 * M, { source: 'codex', sessionId: 'c', input: 1_000, cacheRead: 90_000 }),
    entry(T + 171 * M, { source: 'codex', sessionId: 'c', input: 95_000, cacheRead: 0 })
  ]
  it('counts rewrites after the cache expired, and what they cost beyond a read', () => {
    const r = diagnoseCache(list, 'today', 'claude', T - M, T + 200 * M, price, money)
    expect(r.rebuilds).toBe(2)
    expect(r.extraCost).toBeCloseTo(((205_000 + 210_000) * (6.25 - 0.5)) / 1e6, 6)
    expect(r.gaps.map((g) => g.count)).toEqual([1, 0, 0, 1])
    expect(r.sessions[0]).toMatchObject({ sessionId: 's1', rebuilds: 2 })
    expect(r.avgRebuildTokens).toBe(207_500)
    expect(r.tips.join()).toContain('/compact')
    expect(diagnoseCache([], 'today', 'claude', 0, 1, price, String).tips[0]).toContain('没有')
  })
  it('counts Codex prefixes billed at full price after a pause, apart from Claude', () => {
    const r = diagnoseCache(list, 'today', 'codex', T - M, T + 200 * M, price, money)
    expect(r.source).toBe('codex')
    expect(r.rebuilds).toBe(1)
    expect(r.extraCost).toBeCloseTo((95_000 * (5 - 0.5)) / 1e6, 6)
    expect(r.gaps.map((g) => g.count)).toEqual([0, 1, 0, 0])
    expect(diagnoseCache(list, 'today', 'all', T - M, T + 200 * M, price, money).rebuilds).toBe(3)
  })
})
