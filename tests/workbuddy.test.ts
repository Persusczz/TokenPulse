import { appendFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseWorkBuddyLine, WorkBuddyStore, workbuddyDirs } from '../src/features/workbuddy/collector'
import { DatabaseSync } from 'node:sqlite'
import { workbuddyUsage } from '../src/features/workbuddy/usage'
import { workbuddyDialogue } from '../src/features/workbuddy/dialogue'
import { effectiveSource, hasClaude, hasCodex } from '../src/shared/sources'
import type { LoadState } from '../src/shared/types'
import { diagnoseCache } from '../src/main/cacheDoctor'
import { computeSummary } from '../src/main/aggregate'
import { computeCost } from '../src/main/pricing/cost'

const folders: string[] = []
afterEach(async () => { for (const p of folders.splice(0)) await rm(p, { recursive: true, force: true }) })

const response = (extra: Record<string, unknown> = {}) => ({
  id: 'row-1', type: 'message', role: 'assistant', status: 'completed',
  timestamp: 1791360000000, sessionId: 'session-1', cwd: 'C:/projects/demo',
  providerData: { messageId: 'response-1', model: 'deepseek/deepseek-v4.1-flash', rawUsage: { credit: 0.04 } },
  message: { usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 800 } },
  content: [{ type: 'text', text: 'Done' }], ...extra
})

describe('WorkBuddy transcripts', () => {
  it('splits inclusive input into uncached input and cache, preserving actual credits', () => {
    const parsed = parseWorkBuddyLine(JSON.stringify(response()), 'fallback')
    expect(parsed?.entry).toMatchObject({ source: 'workbuddy', model: 'deepseek/deepseek-v4.1-flash', input: 200, output: 200, cacheRead: 800, credit: 0.04, project: 'demo' })
    expect(parsed?.entry?.key).toBe('workbuddy:session-1:response-1')
    expect(parsed?.entry?.sessionId).toBe('workbuddy:session-1')
  })

  it('reads prompts and tool calls from WorkBuddy top-level fields', () => {
    const prompt = parseWorkBuddyLine(JSON.stringify(response({ type: 'message', role: 'user', message: undefined, content: [{ type: 'text', text: 'Fix the build' }] })), '')
    expect(prompt?.prompt).toMatchObject({ source: 'workbuddy', text: 'Fix the build', sessionId: 'workbuddy:session-1' })
    const tool = parseWorkBuddyLine(JSON.stringify(response({ type: 'function_call', name: 'Edit', callId: 'call-1', arguments: JSON.stringify({ file_path: 'a.ts', old_string: 'a\nb', new_string: 'a\nc\nd' }) })), '')
    expect(tool?.actions[0]).toMatchObject({ source: 'workbuddy', kind: 'edit', added: 2, removed: 1 })
    expect(tool?.entry).toBeDefined()
    expect(parseWorkBuddyLine(JSON.stringify(response({ role: 'user', providerData: { teammateMessage: true }, message: undefined })), '')).toBeNull()
  })

  it('ignores reasoning, results, malformed rows and unavailable usage', () => {
    for (const line of ['broken', 'null', JSON.stringify(response({ type: 'reasoning' })), JSON.stringify(response({ type: 'function_call_result' })), JSON.stringify(response({ message: undefined, providerData: { model: 'hy3' } })), JSON.stringify(response({ timestamp: 'invalid' }))]) {
      expect(parseWorkBuddyLine(line, '')?.entry).toBeUndefined()
    }
    expect(parseWorkBuddyLine(JSON.stringify(response({ providerData: { messageId: 'response-1', model: 'hy3' } })), '')?.entry?.credit).toBeUndefined()
  })

  it('uses provider token receipts when WorkBuddy normalized usage is empty', () => {
    const entry = parseWorkBuddyLine(JSON.stringify(response({ message: { usage: { input_tokens: 0, output_tokens: 0 } }, providerData: { messageId: 'response-1', model: 'deepseek-v4.1-flash', rawUsage: { prompt_tokens: 164408, completion_tokens: 788, cached_tokens: 163968 } } })), '')?.entry
    expect(entry).toMatchObject({ input: 440, cacheRead: 163968, output: 788 })
  })

  it('keeps actual credits when a response has no normalized token usage', () => {
    const entry = parseWorkBuddyLine(JSON.stringify(response({ message: undefined, providerData: { messageId: 'response-1', model: 'deepseek-v4.1-flash', rawUsage: { credit: 0.12 } } })), '')?.entry
    expect(entry).toMatchObject({ credit: 0.12, input: 0, output: 0 })
    expect(workbuddyUsage([entry!], 'all', entry!.ts + 1).credits).toBe(0.12)
  })

  it('deduplicates repeated responses, updates streaming usage, and consumes incomplete lines only when complete', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tp-workbuddy-')); folders.push(root)
    const projects = join(root, 'projects'); await mkdir(projects)
    expect(workbuddyDirs(root)).toEqual([projects])
    const file = join(projects, 'session.jsonl')
    await writeFile(file, JSON.stringify(response()) + '\n' + JSON.stringify(response()) + '\n{"type":')
    const store = new WorkBuddyStore()
    expect(await store.scan([projects])).toHaveLength(1)
    expect(store.entries.size).toBe(1)
    await appendFile(file, '"ai-title"}\n' + JSON.stringify(response({ message: { usage: { input_tokens: 1000, output_tokens: 300, cache_read_input_tokens: 800 } } })) + '\n')
    expect(await store.readFile(file, projects)).toHaveLength(1)
    expect([...store.entries.values()][0].output).toBe(300)
    expect(store.filesOf('workbuddy:session-1')).toEqual([file])
    expect(await store.changedFiles([projects])).toEqual([])
    await writeFile(file, '')
    await store.readFile(file, projects)
    expect(store.entries.size).toBe(0)
  })

  it('preserves full tokens when a later duplicate only adds credit metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tp-workbuddy-')); folders.push(root)
    const file = join(root, 'session.jsonl')
    await writeFile(file, JSON.stringify(response({ providerData: { messageId: 'response-1', model: 'hy3' } })) + '\n')
    const store = new WorkBuddyStore(); await store.readFile(file, root)
    await appendFile(file, JSON.stringify(response({ message: { usage: { input_tokens: 0, output_tokens: 0 } } })) + '\n')
    await store.readFile(file, root)
    expect([...store.entries.values()][0]).toMatchObject({ input: 200, output: 200, cacheRead: 800, credit: 0.04 })
  })

  it('reads context windows without modifying the native database', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tp-workbuddy-')); folders.push(root)
    const projects = join(root, 'projects'); await mkdir(projects)
    const db = new DatabaseSync(join(root, 'workbuddy.db'))
    db.exec("CREATE TABLE sessions (model TEXT, context_window INTEGER); INSERT INTO sessions VALUES ('glm-5.2', 300000)"); db.close()
    const store = new WorkBuddyStore(); await store.scan([projects])
    expect(store.contextWindows.get('glm-5.2')).toBe(300000)
  })

  it('distinguishes recorded zero credits from unavailable credits and filters ranges and sources', () => {
    const entry = parseWorkBuddyLine(JSON.stringify(response()), '')!.entry!
    const now = entry.ts + 3600000
    const result = workbuddyUsage([entry, { ...entry, key: 'zero', credit: 0 }, { ...entry, key: 'missing', credit: undefined }, { ...entry, key: 'old', ts: now - 40 * 86400000 }, { ...entry, key: 'other', source: 'claude' }, { ...entry, key: 'future', ts: now + 1 }], 'today', now)
    expect(result).toMatchObject({ credits: 0.04, recorded: 2, missing: 1, models: [{ credits: 0.04, requests: 2 }], daily: [{ credits: 0.04, recorded: 2, missing: 1 }] })
    expect(workbuddyUsage([{ ...entry, credit: 0 }], 'today', now).credits).toBe(0)
    expect(workbuddyUsage([{ ...entry, credit: undefined }], 'today', now).credits).toBeNull()
  })

  it('keeps the raw model id so credits still join pricing after display names are formatted', () => {
    const entry = parseWorkBuddyLine(JSON.stringify(response()), '')!.entry!
    expect(workbuddyUsage([entry], 'all', entry.ts + 1, () => 'DeepSeek V4.1 Flash').models[0]).toMatchObject({
      model: 'DeepSeek V4.1 Flash', rawModel: 'deepseek/deepseek-v4.1-flash', credits: 0.04
    })
  })

  it('keeps WorkBuddy selected and subscriptions separate when Codex is unavailable', () => {
    const settings = { sourceFilter: 'all' as const, codexEnabled: false, workbuddyEnabled: true }
    const load = { loading: false, codexFiles: 0, workbuddyFiles: 1 } as LoadState
    expect(effectiveSource(settings, load)).toBe('all')
    expect(effectiveSource({ ...settings, sourceFilter: 'workbuddy' }, load)).toBe('workbuddy')
    expect(effectiveSource({ ...settings, sourceFilter: 'workbuddy', workbuddyEnabled: false }, load)).toBe('claude')
    expect(hasClaude('workbuddy')).toBe(false); expect(hasCodex('workbuddy')).toBe(false)
  })

  it('reports actual cache hits without applying Claude expiration rules to WorkBuddy', () => {
    const e = parseWorkBuddyLine(JSON.stringify(response()), '')!.entry!
    const row = { id: e.model, name: e.model, input: 2, output: 3, cacheRead: 0.2, cacheWrite5m: 2, cacheWrite1h: 2 }
    const entries = [e, { ...e, ts: e.ts + 3600000, cacheWrite5m: 200000 }].map((entry) => ({ ...entry, cost: computeCost(entry, row, { webSearchPer1k: 0, usGeoMultiplier: 1 }) }))
    const result = diagnoseCache(entries, 'all', 'workbuddy', 0, Infinity, () => row, String)
    expect(result).toMatchObject({ rebuilds: 0, extraCost: 0 })
    expect(result.hitRate).toBeGreaterThan(0)
    expect(result.tips.join('')).toContain('不估算')
    expect(diagnoseCache(entries, 'all', 'claude', 0, Infinity, () => row, String).totalCost).toBe(0)
  })

  it('replays native prompts, responses and tool calls without subagent or duplicate rows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tp-workbuddy-')); folders.push(root)
    const file = join(root, 'session.jsonl')
    const prompt = response({ id: 'user-1', role: 'user', timestamp: '2026-10-07T07:59:00Z', content: [{ type: 'text', text: 'Fix the build' }] })
    await writeFile(file, [prompt, response(), response(), response({ id: 'child', providerData: { isSubAgent: true }, content: [{ type: 'text', text: 'Hidden' }] }), response({ id: 'teammate', role: 'user', providerData: { teammateMessage: true }, content: [{ type: 'text', text: 'Hidden' }] })].map((r) => JSON.stringify(r)).join('\n') + '\n')
    const dialogue = await workbuddyDialogue([file], 'workbuddy:session-1')
    expect(dialogue.source).toBe('workbuddy')
    expect(JSON.stringify(dialogue)).toContain('Fix the build')
    expect(JSON.stringify(dialogue)).toContain('Done')
    expect(JSON.stringify(dialogue)).not.toContain('Hidden')
  })

  // what WorkBuddy really writes: input_text / output_text blocks, the typed text inside <user_query>
  const userRow = (text: string, providerData: Record<string, unknown> = { agent: 'craft' }, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ id: 'user-' + text.length, type: 'message', role: 'user', timestamp: 1791360000000, sessionId: 'session-1', cwd: 'C:/projects/demo', providerData, content: [{ type: 'input_text', text }], ...extra })

  it('takes the typed question out of <user_query> and skips injected user rows', () => {
    const reminder = '<system-reminder data-role="user-context">\n<user_info>\nOS Version: win32\n</user_info>\n</system-reminder>\n'
    expect(parseWorkBuddyLine(userRow(`${reminder}<user_query>修一下构建</user_query>`), '')?.prompt?.text).toBe('修一下构建')
    expect(parseWorkBuddyLine(userRow('<user_query>继续</user_query>', { agent: 'craft', clientMeta: {} }), '')?.prompt?.text).toBe('继续')
    // background task notices, compaction summaries, teammate messages and reminders alone were not typed
    expect(parseWorkBuddyLine(userRow('<task-notification>done</task-notification>', { agent: 'craft', isMeta: true }), '')).toBeNull()
    expect(parseWorkBuddyLine(userRow('<conversation_history><user_query>old</user_query></conversation_history>', { isCompactInternal: true, isSummary: true, isCompacted: true }), '')).toBeNull()
    expect(parseWorkBuddyLine(userRow('Please continue with the task', { agent: 'craft', isCompactInternal: true }), '')).toBeNull()
    expect(parseWorkBuddyLine(JSON.stringify({ ...JSON.parse(userRow('')), content: '<teammate-message teammate_id="system">done</teammate-message>' }), '')).toBeNull()
    expect(parseWorkBuddyLine(userRow('<system-reminder data-role="error-recovery">Network error occurred</system-reminder>'), '')).toBeNull()
    // a subagent transcript opens with its task from the parent agent
    expect(parseWorkBuddyLine(userRow('Explore the repo and report back', { agent: 'Explore' }), '', true)).toBeNull()
    // an image sent without words
    const image = JSON.stringify({ ...JSON.parse(userRow('<user_query></user_query>')), content: [{ type: 'image_blob_ref', id: 'x' }, { type: 'input_text', text: '<user_query></user_query>' }] })
    expect(parseWorkBuddyLine(image, '')?.prompt?.text).toBe('[图片]')
  })

  it('replays output_text replies and leaves subagent transcripts and injected rows out', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tp-workbuddy-')); folders.push(root)
    const file = join(root, 'session-1.jsonl')
    const sub = join(root, 'session-1', 'subagents', 'agent-a.jsonl')
    await mkdir(join(root, 'session-1', 'subagents'), { recursive: true })
    await writeFile(file, [
      userRow('<system-reminder>ctx</system-reminder>\n<user_query>修一下构建</user_query>'),
      JSON.stringify(response({ content: [{ type: 'output_text', text: '构建好了' }] })),
      userRow('<task-notification>bg</task-notification>', { isMeta: true }),
      userRow('<cb_summary>Summary</cb_summary>', { isCompactInternal: true, isSummary: true, isCompacted: true }),
      userRow('<conversation_history>Summary</conversation_history>', { isCompactInternal: true, isSummary: true, isCompacted: true })
    ].join('\n') + '\n')
    await writeFile(sub, userRow('Explore the repo', { agent: 'Explore' }) + '\n')
    const dialogue = await workbuddyDialogue([file, sub], 'workbuddy:session-1')
    expect(dialogue.items.map((i) => i.kind)).toEqual(['prompt', 'reply', 'compact'])
    expect(dialogue.items[0].text).toBe('修一下构建')
    expect(dialogue.items[1].text).toBe('构建好了')
  })

  it('keeps every day of the range so quiet days stay on the axis', () => {
    const entry = parseWorkBuddyLine(JSON.stringify(response()), '')!.entry!
    const daily = workbuddyUsage([entry], '7d', entry.ts + 3600000).daily
    expect(daily).toHaveLength(7)
    expect(daily.filter((d) => d.recorded)).toHaveLength(1)
    expect(daily.map((d) => d.day)).toEqual([...daily.map((d) => d.day)].sort())
  })

  it('leaves responses without cache details out of the hit rate instead of counting them as misses', () => {
    const e = parseWorkBuddyLine(JSON.stringify(response()), '')!.entry!
    const cost = { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, webSearch: 0, cacheSavings: 0 }
    const rows = [{ ...e, cost }, { ...e, key: 'unknown', cacheRead: 0, cacheReadKnown: false, input: 5000, cost }]
    const s = computeSummary(rows, 'all', e.ts + 1, String)
    expect(s.cacheUnreported).toBe(1)
    expect(s.cacheHitRate).toBeCloseTo(0.8)
    expect(diagnoseCache(rows, 'all', 'workbuddy', 0, Infinity, () => null, String).hitRate).toBeCloseTo(0.8)
  })
})
