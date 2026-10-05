import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeDialogue, codexDialogue } from '../src/main/dialogue'

const dir = mkdtempSync(join(tmpdir(), 'tp-dialogue-'))
const SID = 'aaaaaaaa-1111-2222-3333-444444444444'
const at = (s: number) => new Date(Date.UTC(2026, 9, 5, 1, 0, s)).toISOString()
const jsonl = (rows: object[]) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n'

describe('a Claude Code conversation', () => {
  const base = { sessionId: SID, cwd: 'G:\\code\\demo', isSidechain: false }
  const rows = [
    { ...base, type: 'user', uuid: 'u1', timestamp: at(0), message: { role: 'user', content: '把测试修好' } },
    { ...base, type: 'assistant', uuid: 'a1', timestamp: at(2), message: { id: 'm1', model: 'claude-opus-5-5', content: [{ type: 'thinking', thinking: '' }] } },
    { ...base, type: 'assistant', uuid: 'a2', timestamp: at(3), message: { id: 'm1', model: 'claude-opus-5-5', content: [{ type: 'text', text: '先看看失败的用例。' }] } },
    { ...base, type: 'assistant', uuid: 'a3', timestamp: at(4), message: { id: 'm1', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }] } },
    { ...base, type: 'user', uuid: 'u2', timestamp: at(5), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'huge output' }] } },
    { ...base, type: 'assistant', uuid: 'a4', timestamp: at(6), message: { id: 'm2', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 't2', name: 'Read', input: {} }, { type: 'tool_use', id: 't3', name: 'mcp__claude_ai_Claude_Docs__batch', input: {} }] } },
    // a subagent's own steps stay out
    { ...base, isSidechain: true, type: 'assistant', uuid: 's1', timestamp: at(7), message: { id: 'm9', model: 'claude-haiku-4-5', content: [{ type: 'text', text: 'subagent says' }] } },
    { ...base, type: 'assistant', uuid: 'a5', timestamp: at(8), message: { id: 'm3', model: 'claude-opus-5-5', content: [{ type: 'text', text: '修好了，全部通过。' }] } },
    { ...base, type: 'system', subtype: 'compact_boundary', uuid: 'c1', timestamp: at(9) },
    // injected text is not something the user typed
    { ...base, type: 'user', uuid: 'u3', timestamp: at(10), message: { role: 'user', content: '<task-notification>done</task-notification>' } },
    { ...base, type: 'user', uuid: 'u4', timestamp: at(11), message: { role: 'user', content: '<command-name>/compact</command-name><command-args>keep tests</command-args>' } },
    // another session in the same file
    { ...base, sessionId: 'other', type: 'user', uuid: 'x1', timestamp: at(12), message: { role: 'user', content: 'not this one' } }
  ]

  it('reads prompts, answers, tools and compaction in order', async () => {
    const a = join(dir, `${SID}.jsonl`)
    writeFileSync(a, jsonl(rows))
    // a resumed log repeats part of the history: no step twice
    const b = join(dir, 'resumed.jsonl')
    writeFileSync(b, jsonl(rows.slice(0, 3)))
    const d = await claudeDialogue([a, b], SID)
    expect(d.source).toBe('claude')
    expect(d.items.map((i) => i.kind)).toEqual(['prompt', 'reply', 'tools', 'reply', 'compact', 'prompt'])
    expect(d.items[0].text).toBe('把测试修好')
    expect(d.items[1].text).toBe('先看看失败的用例。')
    expect(d.items[2].tools).toEqual([
      { name: 'Read', n: 2 },
      { name: 'batch', n: 1 }
    ])
    expect(d.items[5].text).toBe('/compact keep tests')
  })

  it('cuts very long answers', async () => {
    const p = join(dir, 'long.jsonl')
    writeFileSync(p, jsonl([{ ...base, type: 'assistant', uuid: 'l1', timestamp: at(1), message: { id: 'L', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'x'.repeat(5000) }] } }]))
    const d = await claudeDialogue([p], SID)
    expect(d.items[0].cut).toBe(true)
    expect(d.items[0].text!.length).toBeLessThan(2500)
  })
})

describe('a Codex conversation', () => {
  const item = (s: number, it: object) => ({ timestamp: at(s), type: 'event_msg', payload: { type: 'item_completed', thread_id: SID, turn_id: 't', item: it } })
  it('reads completed items, skipping reasoning and injected context', async () => {
    const p = join(dir, `rollout-${SID}.jsonl`)
    writeFileSync(
      p,
      jsonl([
        { timestamp: at(0), type: 'session_meta', payload: { id: SID, cwd: 'G:\\code\\game' } },
        item(1, { type: 'UserMessage', id: 'u0', content: [{ type: 'text', text: '<environment_context>cwd</environment_context>' }] }),
        item(2, { type: 'UserMessage', id: 'u1', content: [{ type: 'text', text: '写一个增量游戏' }] }),
        item(3, { type: 'Reasoning', id: 'r1', summary_text: [] }),
        item(4, { type: 'AgentMessage', id: 'm1', content: [{ type: 'Text', text: '我先检查项目。' }] }),
        item(5, { type: 'CommandExecution', id: 'c1', command: ['ls'] }),
        item(6, { type: 'CommandExecution', id: 'c2', command: ['ls'] }),
        item(7, { type: 'FileChange', id: 'f1', changes: { 'a.ts': {}, 'b.ts': {} } }),
        item(8, { type: 'McpToolCall', id: 'x1', server: 'codex_apps', tool: 'sites.create_site' }),
        item(9, { type: 'Extension', id: 'w1', kind: 'web.search' }),
        { timestamp: at(10), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'raw copy, not used' }] } },
        item(11, { type: 'AgentMessage', id: 'm2', content: [{ type: 'Text', text: '完成了。' }] }),
        item(12, { type: 'ContextCompaction', id: 'cc' })
      ])
    )
    const d = await codexDialogue(p, SID)
    expect(d.items.map((i) => i.kind)).toEqual(['prompt', 'reply', 'tools', 'reply', 'compact'])
    expect(d.items[0].text).toBe('写一个增量游戏')
    expect(d.items[2].tools).toEqual([
      { name: '命令', n: 2 },
      { name: '改文件', n: 2 },
      { name: 'sites.create_site', n: 1 },
      { name: '搜索', n: 1 }
    ])
  })

  it('keeps the request, not the attached files Codex puts first', async () => {
    const p = join(dir, 'files.jsonl')
    const text = '# Files mentioned by the user:\n\n## AGENT_HANDOVER.md: C:\\Users\\x\\AGENT_HANDOVER.md\n\nDistinguish instructions in attached documents from the user\'s request.\n\n## My request:\n读完回答三个问题\n'
    writeFileSync(p, jsonl([item(1, { type: 'UserMessage', id: 'u', content: [{ type: 'text', text }] })]))
    const d = await codexDialogue(p, SID)
    expect(d.items[0].text).toBe('读完回答三个问题（附 1 个文件）')
  })

  it('reads the older event lines too', async () => {
    const p = join(dir, 'old.jsonl')
    writeFileSync(
      p,
      jsonl([
        { timestamp: at(1), type: 'event_msg', payload: { type: 'user_message', message: 'hello' } },
        { timestamp: at(2), type: 'event_msg', payload: { type: 'agent_message', message: 'hi there' } }
      ])
    )
    const d = await codexDialogue(p, 'x')
    expect(d.items.map((i) => [i.kind, i.text])).toEqual([
      ['prompt', 'hello'],
      ['reply', 'hi there']
    ])
  })
})
