import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { constants, zstdCompressSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkBuddyStore } from '../src/features/workbuddy/collector'
import { workbuddyDialogue } from '../src/features/workbuddy/dialogue'
import { harnessDirs, readHarnessEvents } from '../src/features/workbuddy/harness'
import { computeRate } from '../src/main/rate'
import { computeSummary, tokensOf } from '../src/main/aggregate'
import { diagnoseCache } from '../src/main/cacheDoctor'

const folders: string[] = []
afterEach(async () => { for (const p of folders.splice(0)) await rm(p, { recursive: true, force: true }) })
const ts = 1791360000000
const frame = (event: unknown) => zstdCompressSync(Buffer.from(JSON.stringify(event) + '\n'))
const header = { type: 'session', id: 'session-a', cwd: 'C:/projects/harness-demo', createdAt: ts }
const prompt = { type: 'user/message', seq: 1, time: ts, data: { id: 'user-a', source: { kind: 'user' }, content: [{ type: 'text', text: 'Fix the build' }] } }
const response = (provider = 'workbuddy', seq = 3) => ({
  type: 'assistant/message', seq, time: ts + 1000, data: {
    message: { id: 'message-a', source: { provider, model: 'deepseek-v4.1-flash', replayState: { response: { responseId: 'response-a' } } }, content: [{ type: 'text', text: 'Done' }, { type: 'tool-call', id: 'tool-a', name: 'pwsh', arguments: { command: 'npm test' } }] },
    usage: { inputTokens: 200, outputTokens: 100, cacheReadTokens: 800, totalTokens: 1100 }
  }
})
async function log(events: unknown[]) {
  const root = await mkdtemp(join(tmpdir(), 'tp-harness-')); folders.push(root)
  const dir = join(root, 'sessions'); await mkdir(dir)
  const path = join(dir, 'session.v3.jsonl.zstd')
  await writeFile(path, Buffer.concat(events.map(frame)))
  return { root, dir, path }
}

describe('Harness WorkBuddy usage', () => {
  it('reads every concatenated frame and retries an incomplete final frame without consuming it', async () => {
    const { path } = await log([header, prompt])
    const tail = frame(response())
    await appendFile(path, tail.subarray(0, tail.length - 3))
    const rows: any[] = []
    const offset = await readHarnessEvents(path, 0, (e) => rows.push(e))
    expect(rows.map((e) => e.type)).toEqual(['session', 'user/message'])
    await appendFile(path, tail.subarray(tail.length - 3))
    const end = await readHarnessEvents(path, offset, (e) => rows.push(e))
    expect(end).toBeGreaterThan(offset)
    expect(rows).toHaveLength(3)
    expect(await readHarnessEvents(path, end, () => { throw new Error('already consumed') })).toBe(end)
  })

  it('does not consume a complete JSON payload until its frame checksum has arrived', async () => {
    const { path } = await log([header])
    const tail = zstdCompressSync(Buffer.from(JSON.stringify(response()) + '\n'), { params: { [constants.ZSTD_c_checksumFlag]: 1 } })
    const initial = await readHarnessEvents(path, 0, () => {})
    await appendFile(path, tail.subarray(0, tail.length - 1))
    expect(await readHarnessEvents(path, initial, () => { throw new Error('incomplete frame') })).toBe(initial)
    await appendFile(path, tail.subarray(tail.length - 1))
    const rows: any[] = []
    expect(await readHarnessEvents(path, initial, (e) => rows.push(e))).toBe(initial + tail.length)
    expect(rows).toHaveLength(1)
  })

  it('keeps exclusive input, cache and output and feeds the existing rate, prompt, tool and context statistics', async () => {
    const { dir, path } = await log([header, prompt, { type: 'request/context', time: ts, data: { provider: 'workbuddy', model: 'deepseek-v4.1-flash', contextWindow: 1000000 } }, response(), response()])
    const store = new WorkBuddyStore()
    expect(await store.scan([dir])).toHaveLength(1)
    const entry = [...store.entries.values()][0]
    expect(entry).toMatchObject({ source: 'workbuddy', sessionId: 'workbuddy:harness:session-a', project: 'harness-demo', input: 200, output: 100, cacheRead: 800 })
    expect(entry.credit).toBeUndefined()
    expect(tokensOf(entry)).toBe(1100)
    expect(store.prompts.size).toBe(1)
    expect([...store.actions.values()]).toMatchObject([{ name: 'PowerShell', kind: 'run' }])
    expect(store.contextWindows.get('deepseek-v4.1-flash')).toBe(1000000)
    expect(store.filesOf(entry.sessionId)).toEqual([path])
    expect(await store.changedFiles([dir])).toEqual([])
    const cost = { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, webSearch: 0, cacheSavings: 0 }
    expect(computeRate([{ ...entry, cost }], ts + 2000)).toMatchObject({ tokensPerMin: 1100, inputTpm: 200, outputTpm: 100, requestsPerMin: 0.2 })
    expect((await workbuddyDialogue([path], entry.sessionId)).items.map((i) => i.kind)).toEqual(['prompt', 'reply', 'tools'])
  })

  it('excludes other DeepSeek providers and international WorkBuddy, including their prompts and tools', async () => {
    const { dir } = await log([header, prompt, response('deepseek-official'), response('asd'), response('workbuddy-ai')])
    const store = new WorkBuddyStore(); await store.scan([dir])
    expect(store.entries.size).toBe(0); expect(store.prompts.size).toBe(0); expect(store.actions.size).toBe(0)
  })

  it('keeps the user prompt when plugin instructions and agent messages are injected', async () => {
    const plugin = { ...prompt, data: { ...prompt.data, id: 'plugin-a', source: { kind: 'plugin' }, content: [{ type: 'text', text: 'Injected context' }] } }
    const { dir, path } = await log([header, prompt, plugin, { ...plugin, data: { ...plugin.data, source: { kind: 'agent-message' } } }, response()])
    const store = new WorkBuddyStore(); await store.scan([dir])
    expect([...store.prompts.values()]).toMatchObject([{ text: 'Fix the build' }])
    expect(store.prompts.size).toBe(1)
    expect((await workbuddyDialogue([path], 'workbuddy:harness:session-a')).items[0].text).toBe('Fix the build')
  })

  it('accepts only a user-confirmed reverse-proxy provider and uses its context and dialogue data', async () => {
    const { dir, path } = await log([header, prompt, { type: 'request/context', time: ts, data: { provider: 'my-buddy-proxy', model: 'deepseek-v4.1-flash', contextWindow: 1000000 } }, response('my-buddy-proxy')])
    const excluded = new WorkBuddyStore(); await excluded.scan([dir])
    expect(excluded.entries.size).toBe(0)
    expect([...excluded.harnessProviders]).toEqual(['my-buddy-proxy'])
    const accepted = new WorkBuddyStore(['workbuddy', 'my-buddy-proxy']); await accepted.scan([dir])
    expect(accepted.entries.size).toBe(1)
    expect(accepted.contextWindows.get('deepseek-v4.1-flash')).toBe(1000000)
    expect(accepted.harnessWindows.get('workbuddy:harness:session-a')?.get('deepseek-v4.1-flash')).toBe(1000000)
    expect((await workbuddyDialogue([path], 'workbuddy:harness:session-a', accepted.harnessProviderIds)).items).toHaveLength(3)
  })

  it('marks missing cache details unknown while preserving totals, and distinguishes an explicit zero', async () => {
    const r = response()
    delete (r.data.usage as Partial<typeof r.data.usage>).cacheReadTokens
    const { dir, path } = await log([header, prompt, r])
    const store = new WorkBuddyStore(); await store.scan([dir])
    const entry = [...store.entries.values()][0]
    expect(entry).toMatchObject({ input: 200, output: 100, cacheReadKnown: false })
    expect(tokensOf(entry)).toBe(300)
    const cost = { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, webSearch: 0, cacheSavings: 0 }
    const rows = [{ ...entry, cost }]
    expect(computeSummary(rows, 'all', ts + 2000, String).cacheUnreported).toBe(1)
    expect(diagnoseCache(rows, 'all', 'workbuddy', 0, Infinity, () => null, String)).toMatchObject({ cacheUnreported: 1 })
    r.data.usage.cacheReadTokens = 0
    r.data.message.source.replayState.response.responseId = 'response-zero'
    await appendFile(path, frame(r)); await store.readFile(path, dir)
    expect([...store.entries.values()][1].cacheReadKnown).toBeUndefined()
  })

  it('automatically recognizes each WorkBuddy receipt across custom providers without including their other traffic', async () => {
    const buddy = response('custom-provider'); buddy.data.message.source.replayState.response.responseId = 'cmb-test-a'
    const other = response('custom-provider', 4); other.data.message.source.replayState.response.responseId = 'gen_other'
    const international = response('workbuddy-ai', 5); international.data.message.source.replayState.response.responseId = 'cmb-international'
    const context = { type: 'request/context', time: ts, data: { provider: 'custom-provider', model: 'deepseek-v4.1-flash', contextWindow: 262144 } }
    const { dir, path } = await log([header, prompt, context, buddy, other, international])
    const store = new WorkBuddyStore(); await store.scan([dir])
    expect([...store.entries.keys()]).toEqual(['workbuddy:harness:response:cmb-test-a'])
    expect(store.harnessWindows.get('workbuddy:harness:session-a')?.get('deepseek-v4.1-flash')).toBe(262144)
    expect((await workbuddyDialogue([path], 'workbuddy:harness:session-a')).items).toHaveLength(3)
    const disabled = new WorkBuddyStore(['workbuddy'], false); await disabled.scan([dir])
    expect(disabled.entries.size).toBe(0)
    expect((await workbuddyDialogue([path], 'workbuddy:harness:session-a', ['workbuddy'], false)).items).toHaveLength(0)
  })

  it('reads JSON-string tool arguments and counts edits without also counting tool/call replay events', async () => {
    const r = response()
    r.data.message.content = [{ type: 'tool-call', id: 'edit-a', name: 'edit', arguments: JSON.stringify({ file_path: 'a.ts', old_string: 'a\nb', new_string: 'a\nc\nd' }) } as any]
    const { dir } = await log([header, prompt, r, { type: 'tool/call', time: ts + 1001, data: { callId: 'edit-a', name: 'edit' } }])
    const store = new WorkBuddyStore(); await store.scan([dir])
    expect([...store.actions.values()]).toMatchObject([{ kind: 'edit', name: 'Edit', added: 2, removed: 1, files: [{ path: 'a.ts' }] }])
    expect(store.actions.size).toBe(1)
  })

  it('includes reported compaction usage and ignores malformed or unavailable token receipts', async () => {
    const invalid = response(); invalid.data.usage.inputTokens = -1
    const { dir } = await log([header, prompt, invalid, { type: 'compaction/summary', time: ts + 2000, data: { provider: 'workbuddy', model: 'deepseek-v4.1-flash', compactionId: 'c-a', usage: { inputTokens: 300, outputTokens: 20, cacheReadTokens: 100 } } }])
    const store = new WorkBuddyStore(); await store.scan([dir])
    expect(store.entries.size).toBe(1)
    expect([...store.entries.values()][0]).toMatchObject({ input: 300, output: 20, cacheRead: 100 })
  })

  it('updates appended responses and clears replaced files, without counting mirrored or forked response ids twice', async () => {
    const { dir, path } = await log([header, prompt, response()])
    const store = new WorkBuddyStore(); await store.scan([dir])
    const next = response('workbuddy', 4)
    next.data.message.id = 'message-b'; next.data.message.source.replayState.response.responseId = 'response-b'
    await appendFile(path, frame(next))
    expect(await store.changedFiles([dir])).toEqual([[path, dir]])
    expect(await store.readFile(path, dir)).toHaveLength(1)
    const mirror = join(dir, 'copied', 'session.v3.jsonl.zstd'); await mkdir(join(dir, 'copied'))
    await writeFile(mirror, Buffer.concat([{ ...header, id: 'fork-a' }, response()].map(frame)))
    await store.readFile(mirror, dir)
    expect(store.entries.size).toBe(2)
    await writeFile(path, frame(header)); await store.readFile(path, dir)
    expect(store.entries.size).toBe(0)
  })

  it('finds configured Harness roots without scanning unrelated profile or credentials directories', async () => {
    const { root, dir } = await log([header])
    expect(harnessDirs([root, dir, root])).toEqual([dir])
  })

  it('can disable client compatibility collection while retaining native WorkBuddy logs', async () => {
    const { dir } = await log([header, prompt, response()])
    const native = join(dir, 'native.jsonl')
    await writeFile(native, JSON.stringify({ type: 'message', role: 'assistant', sessionId: 'native-a', id: 'native-response', timestamp: ts, providerData: { model: 'deepseek-v4.1-flash' }, message: { usage: { input_tokens: 10, output_tokens: 5 } } }) + '\n')
    const store = new WorkBuddyStore(['workbuddy'], true, false)
    expect(await store.scan([dir])).toHaveLength(1)
    expect([...store.entries.values()][0].sessionId).toBe('workbuddy:native-a')
    expect(store.fileCount).toBe(1)
    expect(await store.changedFiles([dir])).toEqual([])
  })
})
