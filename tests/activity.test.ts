import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PromptCost, PromptMark, ToolAction } from '@shared/types'
import { actionStats, personalRecords } from '../src/main/activity'
import type { CostedEntry } from '../src/main/aggregate'
import { codexFileChange, codexHeadAction, lineDiff } from '../src/main/collector/actions'
import { CodexStore } from '../src/main/collector/codex'
import { parseLine } from '../src/main/collector/parser'
import { UsageStore } from '../src/main/collector/store'

const T = Date.parse('2026-10-06T10:00:00Z')

const assistant = (blocks: unknown[], id = 'msg_1') =>
  JSON.stringify({
    type: 'assistant',
    timestamp: new Date(T).toISOString(),
    sessionId: 's1',
    cwd: 'G:\\code\\app',
    requestId: 'req_1',
    message: { id, model: 'claude-opus-4-7', content: blocks, usage: { input_tokens: 1, output_tokens: 2 } }
  })

describe('tool calls in the logs', () => {
  it('counts lines an edit adds and removes', () => {
    expect(lineDiff('a\nb\nc\n', 'a\nB\nc\nd\n')).toEqual([2, 1])
    expect(lineDiff('', 'x\ny')).toEqual([2, 0])
    // a moved line is neither
    expect(lineDiff('a\nb', 'b\na')).toEqual([0, 0])
  })

  it('reads Claude tool_use blocks with their edits', () => {
    const p = parseLine(
      assistant([
        { type: 'text', text: 'ok' },
        { type: 'tool_use', id: 'toolu_1', name: 'Edit', input: { file_path: 'G:\\code\\app\\a.ts', old_string: 'x\ny', new_string: 'x\nz\nw' } },
        { type: 'tool_use', id: 'toolu_2', name: 'Bash', input: { command: 'ls' } },
        { type: 'tool_use', id: 'toolu_3', name: 'mcp__github__get_issue', input: {} }
      ]),
      'fallback'
    )
    expect(p?.kind).toBe('usage')
    if (p?.kind !== 'usage') return
    expect(p.actions.map((a) => [a.key, a.kind, a.name])).toEqual([
      ['toolu_1', 'edit', 'Edit'],
      ['toolu_2', 'run', 'Bash'],
      ['toolu_3', 'mcp', 'github · get_issue']
    ])
    expect(p.actions[0]).toMatchObject({ added: 2, removed: 1, project: 'app', files: [{ path: 'G:\\code\\app\\a.ts', added: 2, removed: 1 }] })
  })

  it('keeps a tool call once when a resumed session repeats it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-act-'))
    const line = assistant([{ type: 'tool_use', id: 'toolu_9', name: 'Write', input: { file_path: 'b.ts', content: '1\n2\n3\n' } }])
    writeFileSync(join(dir, 'a.jsonl'), line + '\n')
    writeFileSync(join(dir, 'b.jsonl'), line.replace('msg_1', 'msg_2') + '\n')
    const s = new UsageStore()
    await s.scan([dir])
    expect([...s.actions.values()]).toHaveLength(1)
    expect(s.actions.get('toolu_9')).toMatchObject({ kind: 'edit', added: 3, removed: 0 })
  })

  it('reads Codex items from the head, and file changes in full', async () => {
    const ts = '2026-10-06T10:00:00.000Z'
    const head = (item: string) => `{"timestamp":"${ts}","ordinal":1,"type":"event_msg","payload":{"type":"item_completed","thread_id":"t","turn_id":"u","item":${item}`
    expect(codexHeadAction(head('{"type":"CommandExecution","id":"exec-1","process_id":"7","command":["ls"]'), 's', 'p')).toMatchObject({ key: 'codex:exec-1', kind: 'run', name: 'Shell' })
    expect(codexHeadAction(head('{"type":"McpToolCall","id":"m1","server":"cua","tool":"js","arguments":'), 's', 'p')).toMatchObject({ kind: 'mcp', name: 'cua · js' })
    expect(codexHeadAction(head('{"type":"Extension","kind":"web.search","id":"e1","query":"x"'), 's', 'p')).toMatchObject({ kind: 'web', name: 'web_search' })
    expect(codexHeadAction(head('{"type":"SubAgentActivity","id":"a1","kind":"finished"'), 's', 'p')).toBeNull()
    expect(codexHeadAction(head('{"type":"Reasoning","id":"r1"'), 's', 'p')).toBeNull()

    const change = {
      timestamp: ts,
      type: 'event_msg',
      payload: {
        type: 'item_completed',
        item: {
          type: 'FileChange',
          id: 'exec-2',
          changes: {
            'C:\\x\\new.py': { type: 'add', content: 'a\nb\n' },
            'C:\\x\\old.kt': { type: 'update', unified_diff: '@@ -1,2 +1,3 @@\n a\r\n+b\r\n+c\r\n-d\r\n' }
          }
        }
      }
    }
    expect(codexFileChange(change, 's', 'p')).toMatchObject({
      kind: 'edit',
      added: 4,
      removed: 1,
      files: [
        { path: 'C:\\x\\new.py', added: 2, removed: 0 },
        { path: 'C:\\x\\old.kt', added: 2, removed: 1 }
      ]
    })

    // a whole log: the command's output is never decoded, the file change is
    const dir = mkdtempSync(join(tmpdir(), 'tp-cx-'))
    const file = join(dir, 'rollout-2026-10-06T10-00-00-01a10fa3-7409-7032-8533-1fe9e6360d13.jsonl')
    const big = 'x'.repeat(5000)
    writeFileSync(
      file,
      [
        JSON.stringify({ timestamp: ts, type: 'session_meta', payload: { id: '01a10fa3-7409-7032-8533-1fe9e6360d13', cwd: 'G:\\code\\proj' } }),
        `${head('{"type":"CommandExecution","id":"exec-1","process_id":"7","command":["ls"],"aggregated_output":"' + big + '"}')}}}`,
        JSON.stringify(change)
      ].join('\n') + '\n'
    )
    const c = new CodexStore()
    await c.readFile(file)
    expect([...c.actions.values()].map((a) => [a.name, a.project])).toEqual([
      ['Shell', 'proj'],
      ['apply_patch', 'proj']
    ])
  })
})

const act = (over: Partial<ToolAction>): ToolAction => ({ key: Math.random().toString(36), ts: T, sessionId: 's', project: 'p', source: 'claude', kind: 'run', name: 'Bash', ...over })

describe('the overview cards', () => {
  it('sums tool calls in a range', () => {
    const list = [
      act({ ts: T - 86_400_000 * 3 }),
      act({}),
      act({ kind: 'edit', name: 'Edit', added: 5, removed: 1, files: [{ path: 'G:\\A\\x.ts', added: 5, removed: 1 }] }),
      act({ kind: 'edit', name: 'Edit', added: 2, removed: 0, files: [{ path: 'g:/a/X.ts', added: 2, removed: 0 }] }),
      act({ kind: 'read', name: 'Read' })
    ]
    const s = actionStats(list, T - 3600_000, T + 3600_000, 2)
    expect(s.total).toBe(4)
    expect(s.kinds.find((k) => k.kind === 'edit')?.count).toBe(2)
    expect(s.files).toBe(1)
    expect(s.topFiles[0]).toMatchObject({ name: 'x.ts', edits: 2, added: 7, removed: 1 })
    expect(s.tools[0]).toMatchObject({ name: 'Edit', count: 2 })
    expect(s.since).toBe(T - 86_400_000 * 3)
  })

  it('finds records, streaks and today', () => {
    const now = new Date(2026, 9, 6, 15, 30).getTime()
    const at = (d: number, h = 12) => new Date(2026, 9, 6 - d, h).getTime()
    const e = (ts: number, output: number, cost: number, sessionId = 's1'): CostedEntry =>
      ({ key: String(ts), ts, model: 'm', sessionId, project: 'p', projectPath: 'p', input: 0, output, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, webSearch: 0, speed: 'standard', geo: null, cost: { total: cost } }) as unknown as CostedEntry
    // used 9..7 days ago (3 in a row), then 2, 1 and today (3 in a row, still going)
    const entries = [e(at(9), 10, 1), e(at(8), 500, 9, 's2'), e(at(7), 10, 1), e(at(2), 10, 1), e(at(1), 10, 1), e(at(0, 15), 250, 3)].sort((a, b) => a.ts - b.ts)
    const marks: PromptMark[] = [at(0), at(0), at(8)].map((ts, i) => ({ key: String(i), sessionId: 's1', ts, text: 'q', project: 'p', source: 'claude' }))
    const costs = [{ ts: at(8), cost: 4, tokens: 400, text: 'big one', sessionId: 's2' }] as PromptCost[]
    const r = personalRecords(entries, marks, costs, [act({ ts: at(0), added: 30, removed: 2 })], now)
    expect(r.bestDay).toEqual({ t: new Date(2026, 9, 6 - 8).getTime(), tokens: 500 })
    expect(r.costDay?.cost).toBe(9)
    expect(r.streak?.days).toBe(3)
    expect(r.current).toBe(3)
    expect(r.bigSession).toMatchObject({ id: 's2', tokens: 500 })
    expect(r.promptDay?.prompts).toBe(2)
    expect(r.costPrompt).toMatchObject({ cost: 4, text: 'big one' })
    expect(r.codeDay).toMatchObject({ added: 30, removed: 2 })
    expect(r.today).toMatchObject({ tokens: 250, cost: 3, prompts: 2, added: 30, hour: 250 })
    expect(r.days).toBe(6)
    expect(r.avg.dayTokens).toBeCloseTo(790 / 6)
  })
})
