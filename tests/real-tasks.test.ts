import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { findNode } from '../src/main/guard'
import { findClaude, findCodex, TaskService } from '../src/main/tasks'
import type { ScheduledTask } from '../src/shared/types'

/**
 * Real runs against the installed CLIs (they cost a little): TP_REAL_TASKS=1
 * npx vitest run tests/real-tasks.test.ts. TP_CODEX_MODEL picks the Codex model.
 */
const real = process.env.TP_REAL_TASKS === '1'
const procs: ChildProcess[] = []
afterAll(() => procs.forEach((p) => p.kill()))

const until = async (cond: () => boolean, ms: number) => {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 200))
  }
}

function service() {
  const dir = mkdtempSync(join(tmpdir(), 'tp-real-'))
  const svc = new TaskService(join(dir, 'tasks.json'), join(dir, 'logs'), {
    window: () => ({ five: null, localEnd: null }),
    blocker: () => null,
    claude: findClaude,
    codex: findCodex,
    node: findNode,
    terminal: () => true,
    // the task window, hidden
    openTerminal: (x) => procs.push(spawn(x.node, [x.script, x.laneDir], { stdio: 'ignore', windowsHide: true }))
  })
  return { svc, dir }
}

const show = (t: ScheduledTask) => ({ status: t.status, mode: t.mode, summary: t.summary, error: t.error, cost: t.costUsd, session: t.sessionId })

describe.skipIf(!real)('real CLIs', () => {
  it('runs Claude in the task window, then carries the conversation on in a fork', async () => {
    const { svc, dir } = service()
    await svc.load()
    const first = svc.add({ prompt: '只回复两个字：好的', cwd: dir, trigger: 'now', model: 'haiku', continue: true })
    const second = svc.add({ prompt: '你上一条回复的两个字是什么？原样只回复那两个字', cwd: dir, trigger: 'manual', parentId: first.id, model: 'haiku', continue: true, autoCompact: false })
    await until(() => second.status === 'done' || second.status === 'failed' || first.status === 'failed', 180_000)
    console.log('claude', show(first), show(second))
    expect(first).toMatchObject({ status: 'done', mode: 'terminal' })
    expect(second.status).toBe('done')
    expect(second.summary).toContain('好的')
    // a fork: its own session id
    expect(second.sessionId).toBeTruthy()
    expect(second.sessionId).not.toBe(first.sessionId)
    const raw = readFileSync(join(dir, 'logs', `${second.id}.jsonl`), 'utf8')
    expect(raw).toContain('"type":"tp_exit"')
    expect(raw).not.toContain('"type":"stream_event"')
  }, 200_000)

  it('runs Codex through its npm shim, prompt on stdin, and resumes the session', async () => {
    const { svc, dir } = service()
    await svc.load()
    const model = process.env.TP_CODEX_MODEL || null
    const first = svc.add({ prompt: '只回复两个字：好的', cwd: dir, tool: 'codex', trigger: 'now', model, continue: true, permission: 'plan' })
    const second = svc.add({ prompt: '你上一条回复的两个字是什么？原样只回复那两个字', cwd: dir, tool: 'codex', trigger: 'manual', parentId: first.id, model, continue: true, permission: 'plan' })
    await until(() => second.status === 'done' || second.status === 'failed' || first.status === 'failed', 240_000)
    console.log('codex', show(first), show(second))
    console.log((await svc.log(first.id)).map((l) => `${l.kind}: ${l.text}`).join('\n'))
    expect(first.status).toBe('done')
    expect(second.status).toBe('done')
    expect(second.summary).toContain('好的')
    expect(second.sessionId).toBe(first.sessionId)
  }, 260_000)
})
