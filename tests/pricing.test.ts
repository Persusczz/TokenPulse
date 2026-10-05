import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUNDLED_ROWS, LEGACY_ROWS } from '../src/main/pricing/bundled'
import { prettyModelName, tidy } from '../src/main/pricing'
import { parseLiteLLM } from '../src/main/pricing/litellm'
import { parsePricingMarkdown } from '../src/main/pricing/markdown'
import { nameToId, normalizeModelId, resolvePrice } from '../src/main/pricing/resolve'

const md = readFileSync(join(__dirname, 'fixtures', 'pricing.md'), 'utf8')

describe('parsePricingMarkdown', () => {
  const parsed = parsePricingMarkdown(md)
  const get = (id: string) => parsed.rows.find((r) => r.id === id)

  it('reads every model row with all five prices', () => {
    expect(parsed.rows.length).toBeGreaterThanOrEqual(15)
    expect(get('claude-opus-5-5')).toMatchObject({
      name: 'Claude Opus 5.5',
      input: 4,
      cacheWrite5m: 5,
      cacheWrite1h: 8,
      cacheRead: 0.2,
      output: 20
    })
    expect(get('claude-haiku-4-5')).toMatchObject({ input: 1, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1, output: 5 })
    expect(get('claude-fable-5-1')).toMatchObject({ input: 10, cacheRead: 0.25, output: 50 })
  })

  it('strips footnotes and link annotations from names', () => {
    expect(get('claude-sonnet-5')).toMatchObject({ input: 2, output: 10 })
    expect(get('claude-mythos-5-1')?.name).toBe('Claude Mythos 5.1')
    expect(get('claude-opus-4-1')).toMatchObject({ input: 15, output: 75 })
  })

  it('attaches fast mode prices, including combined rows', () => {
    expect(get('claude-opus-5-5')).toMatchObject({ fastInput: 8, fastOutput: 40 })
    expect(get('claude-opus-5')).toMatchObject({ fastInput: 10, fastOutput: 50 })
    expect(get('claude-opus-4-8')).toMatchObject({ fastInput: 10, fastOutput: 50 })
    expect(get('claude-opus-4-7')?.fastInput).toBeUndefined()
  })

  it('reads web search price and US geo multiplier', () => {
    expect(parsed.webSearchPer1k).toBe(10)
    expect(parsed.usGeoMultiplier).toBe(1.1)
  })

  it('matches the bundled snapshot', () => {
    for (const b of BUNDLED_ROWS) expect(get(b.id), b.id).toEqual(b)
  })

  it('rejects pages without the table', () => {
    expect(() => parsePricingMarkdown('# nothing here')).toThrow()
  })

  it('marks retired and limited models', () => {
    expect(get('claude-opus-4')?.status).toBe('retired')
    expect(get('claude-haiku-3-5')?.status).toBe('retired')
    expect(get('claude-mythos-5')?.status).toBe('limited')
    expect(get('claude-opus-5-5')?.status).toBeUndefined()
  })
})

describe('tidy', () => {
  const row = (id: string, name = id) => ({ id, name, input: 1, output: 2, cacheWrite5m: 1, cacheWrite1h: 1, cacheRead: 0.1 })
  it('drops LiteLLM duplicates and non-coding variants, and names raw keys', () => {
    const out = tidy([
      row('claude-opus-5-5', 'Claude Opus 5.5'),
      row('claude-opus-4.5', 'gmi/anthropic/claude-opus-4.5'),
      row('claude-sonnet-4.6:batch'),
      row('claude-opus-4-8-think'),
      row('gpt-5.6-sol'),
      row('gpt-5.1-codex-max'),
      row('gpt-5-2025-08-07'),
      row('gpt-4o-mini-tts'),
      row('gpt-4.1'),
      row('gpt-3.5-turbo'),
      row('gpt-5-search-api'),
      row('gpt-5.1-chat'),
      row('claude-opus-4', 'Claude Opus 4')
    ])
    expect(out.map((r) => r.id)).toEqual(['claude-opus-5-5', 'gpt-5.6-sol', 'gpt-5.1-codex-max', 'claude-opus-4'])
    expect(out.find((r) => r.id === 'gpt-5.6-sol')?.name).toBe('GPT-5.6 Sol')
    // an older cache without flags gets them from the bundled snapshot
    expect(out.find((r) => r.id === 'claude-opus-4')?.status).toBe('retired')
  })

  it('pretty-prints model ids', () => {
    expect(prettyModelName('claude-sonnet-4-5')).toBe('Claude Sonnet 4.5')
    expect(prettyModelName('gpt-5.1-codex-max')).toBe('GPT-5.1 Codex Max')
    expect(prettyModelName('gpt-6-astra')).toBe('GPT-6 Astra')
    expect(prettyModelName('deepseek-v4')).toBe('deepseek-v4')
  })
})

describe('model ids', () => {
  it.each([
    ['claude-opus-5-5', 'claude-opus-5-5'],
    ['claude-haiku-4-5-20251001', 'claude-haiku-4-5'],
    ['claude-sonnet-4-5@20250929', 'claude-sonnet-4-5'],
    ['us.anthropic.claude-sonnet-4-5-20250929-v1:0', 'claude-sonnet-4-5'],
    ['anthropic/claude-opus-4-1', 'claude-opus-4-1'],
    ['claude-opus-5-5[1m]', 'claude-opus-5-5'],
    ['claude-3-5-haiku-20241022', 'claude-haiku-3-5'],
    ['claude-3-7-sonnet-latest', 'claude-sonnet-3-7'],
    ['claude-3-opus-20240229', 'claude-opus-3']
  ])('%s -> %s', (raw, id) => expect(normalizeModelId(raw)).toBe(id))

  it('turns display names into ids', () => {
    expect(nameToId('Claude Opus 5.5')).toBe('claude-opus-5-5')
    expect(nameToId('Claude Haiku 3.5 (retired)')).toBe('claude-haiku-3-5')
  })
})

describe('resolvePrice', () => {
  const rows = new Map([...BUNDLED_ROWS, ...LEGACY_ROWS].map((r) => [r.id, r]))

  it('matches exactly', () => {
    expect(resolvePrice('claude-haiku-4-5-20251001', rows)).toMatchObject({ row: { id: 'claude-haiku-4-5' }, estimated: false })
  })

  it('drops trailing non-numeric tags', () => {
    expect(resolvePrice('claude-opus-5-5-thinking', rows)).toMatchObject({ row: { id: 'claude-opus-5-5' }, estimated: false })
  })

  it('falls back to the newest model of the family as an estimate', () => {
    expect(resolvePrice('claude-opus-7', rows)).toMatchObject({ row: { id: 'claude-opus-5-5' }, estimated: true })
    expect(resolvePrice('claude-sonnet-9-1', rows)).toMatchObject({ row: { id: 'claude-sonnet-5-5' }, estimated: true })
  })

  it('returns null for non-Claude models', () => {
    expect(resolvePrice('gpt-5', rows)).toBeNull()
  })
})

describe('parseLiteLLM', () => {
  it('converts per-token costs and prefers first-party keys', () => {
    const rows = parseLiteLLM({
      'bedrock/us.anthropic.claude-test-1-v1:0': { input_cost_per_token: 9e-6, output_cost_per_token: 9e-5 },
      'claude-test-1': {
        input_cost_per_token: 3e-6,
        output_cost_per_token: 1.5e-5,
        cache_read_input_token_cost: 3e-7
      },
      'gpt-4o': { input_cost_per_token: 1e-6, output_cost_per_token: 1e-6 },
      'mistral-large': { input_cost_per_token: 1e-6, output_cost_per_token: 1e-6 }
    })
    // Claude, plus OpenAI's models for Codex; nothing else
    expect(rows.map((r) => r.id)).toEqual(['claude-test-1', 'gpt-4o'])
    expect(rows[0].input).toBeCloseTo(3)
    expect(rows[0].output).toBeCloseTo(15)
    expect(rows[0].cacheRead).toBeCloseTo(0.3)
    expect(rows[0].cacheWrite5m).toBeCloseTo(3.75)
    expect(rows[0].cacheWrite1h).toBeCloseTo(6)
  })
})
