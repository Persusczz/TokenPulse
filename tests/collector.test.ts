import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseLine } from '../src/main/collector/parser'
import { UsageStore } from '../src/main/collector/store'

const assistant = (id: string, req: string, output: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-10-03T16:00:50.217Z',
    requestId: req,
    sessionId: 'sess-1',
    cwd: 'G:\\code\\demo',
    message: {
      id,
      model: 'claude-opus-5-5',
      usage: {
        input_tokens: 2,
        cache_creation_input_tokens: 2811,
        cache_read_input_tokens: 28400,
        output_tokens: output,
        output_tokens_details: { thinking_tokens: 118 },
        server_tool_use: { web_search_requests: 1 },
        cache_creation: { ephemeral_1h_input_tokens: 2811, ephemeral_5m_input_tokens: 0 },
        speed: 'standard',
        inference_geo: 'not_available'
      }
    },
    ...extra
  })

describe('parseLine', () => {
  it('extracts usage from assistant messages', () => {
    const p = parseLine(assistant('msg_1', 'req_1', 239), 'fallback')
    expect(p?.kind).toBe('usage')
    if (p?.kind !== 'usage') return
    expect(p.entry).toMatchObject({
      key: 'msg_1:req_1',
      model: 'claude-opus-5-5',
      sessionId: 'sess-1',
      project: 'demo',
      input: 2,
      output: 239,
      cacheWrite5m: 0,
      cacheWrite1h: 2811,
      cacheRead: 28400,
      webSearch: 1,
      speed: 'standard'
    })
  })

  it('treats cache creation without a TTL breakdown as 5m writes', () => {
    const line = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-01-01T00:00:00Z',
      message: { id: 'm', model: 'claude-sonnet-4-5', usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 500 } }
    })
    const p = parseLine(line, 'fb')
    expect(p?.kind === 'usage' && p.entry).toMatchObject({ cacheWrite5m: 500, cacheWrite1h: 0, project: 'fb' })
  })

  it('skips synthetic messages, user lines and garbage', () => {
    expect(parseLine(assistant('m', 'r', 1).replace('claude-opus-5-5', '<synthetic>'), 'x')).toBeNull()
    expect(parseLine('{"type":"user","message":{"content":"usage"}}', 'x')).toBeNull()
    expect(parseLine('{"usage": broken', 'x')).toBeNull()
  })

  it('reads cost-state snapshots', () => {
    const p = parseLine('{"type":"cost-state","sessionId":"s1","totalCostUSD":0.46}', 'x')
    expect(p).toEqual({ kind: 'cost', state: { sessionId: 's1', totalCostUSD: 0.46 } })
  })
})

describe('UsageStore', () => {
  let dir = ''
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }))

  function setup() {
    dir = mkdtempSync(join(tmpdir(), 'tp-'))
    const proj = join(dir, 'G--code-demo')
    mkdirSync(proj)
    return { file: join(proj, 'sess-1.jsonl') }
  }

  it('dedupes repeated content-block lines of one response', async () => {
    const { file } = setup()
    writeFileSync(file, [assistant('m1', 'r1', 239), assistant('m1', 'r1', 239), assistant('m2', 'r2', 10)].join('\n') + '\n')
    const store = new UsageStore()
    const added = await store.scan([dir])
    expect(added).toHaveLength(2)
    expect(store.entries.size).toBe(2)
  })

  it('keeps the larger output when a duplicate grows', async () => {
    const { file } = setup()
    writeFileSync(file, [assistant('m1', 'r1', 5), assistant('m1', 'r1', 300)].join('\n') + '\n')
    const store = new UsageStore()
    const added = await store.scan([dir])
    expect(added).toHaveLength(1)
    expect(store.entries.get('m1:r1')?.output).toBe(300)
  })

  it('waits for a partial trailing line and resumes from the right offset', async () => {
    const { file } = setup()
    const second = assistant('m2', 'r2', 7)
    writeFileSync(file, assistant('m1', 'r1', 1) + '\n' + second.slice(0, 40))
    const store = new UsageStore()
    expect(await store.scan([dir])).toHaveLength(1)
    appendFileSync(file, second.slice(40) + '\n' + assistant('m3', 'r3', 9) + '\n')
    const more = await store.readFile(file, dir)
    expect(more.map((e) => e.key)).toEqual(['m2:r2', 'm3:r3'])
    expect(await store.readFile(file, dir)).toHaveLength(0)
  })

  it('accepts a complete final line without newline', async () => {
    const { file } = setup()
    writeFileSync(file, assistant('m1', 'r1', 1))
    const store = new UsageStore()
    expect(await store.scan([dir])).toHaveLength(1)
  })

  it('re-reads a file that was truncated', async () => {
    const { file } = setup()
    writeFileSync(file, [assistant('m1', 'r1', 1), assistant('m2', 'r2', 1)].join('\n') + '\n')
    const store = new UsageStore()
    await store.scan([dir])
    writeFileSync(file, assistant('m9', 'r9', 1) + '\n')
    await store.readFile(file, dir)
    expect([...store.entries.keys()]).toEqual(['m9:r9'])
  })

  it('records reported session cost', async () => {
    const { file } = setup()
    writeFileSync(file, '{"type":"cost-state","sessionId":"sess-1","totalCostUSD":1.5}\n')
    const store = new UsageStore()
    await store.scan([dir])
    expect(store.reportedCost.get('sess-1')).toBe(1.5)
  })
})
