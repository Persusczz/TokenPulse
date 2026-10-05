import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { claudeArgs, cliCommand, codexArgs, laneKey, parseStreamLine, readiness, taskEnv, TaskService, type WindowInfo } from '../src/main/tasks'
import type { ScheduledTask } from '../src/shared/types'

const HOUR = 3600_000

describe('command lines', () => {
  it('carries on the folder conversation in a fork, or starts a fresh one', () => {
    const t = { prompt: 'x', permission: 'inherit' as const, model: null, sessionId: 'sid' }
    expect(claudeArgs(t, { resume: true }).join(' ')).toContain('--continue --fork-session')
    expect(claudeArgs(t, { resume: true })).not.toContain('--session-id')
    expect(claudeArgs(t).join(' ')).toContain('--session-id sid')
    expect(claudeArgs(t, { partial: true })).toContain('--include-partial-messages')
    // thinking text comes back only when summaries are asked for
    expect(claudeArgs(t).join(' ')).toContain('--settings {"showThinkingSummaries":true}')
    // an npm shim gets the prompt on stdin
    expect(claudeArgs(t, { stdinPrompt: true }).slice(0, 2)).toEqual(['-p', '--output-format'])
  })

  it('builds codex exec with its sandbox, and resumes by id or the latest session', () => {
    expect(codexArgs({ permission: 'acceptEdits', model: 'gpt-6.1-sol' })).toEqual(['exec', '--json', '--skip-git-repo-check', '-c', 'model_reasoning_summary=detailed', '-m', 'gpt-6.1-sol', '-s', 'workspace-write', '-'])
    expect(codexArgs({ permission: 'plan', model: null }, { resume: 'abc' }).slice(-5)).toEqual(['-s', 'read-only', 'resume', 'abc', '-'])
    expect(codexArgs({ permission: 'bypassPermissions', model: null }, { resume: true })).toContain('--dangerously-bypass-approvals-and-sandbox')
    expect(codexArgs({ permission: 'inherit', model: null }, { resume: true }).slice(-3)).toEqual(['resume', '--last', '-'])
  })

  it('switches auto-compact off through the environment', () => {
    expect(taskEnv({ tool: 'claude', autoCompact: false })).toEqual({ DISABLE_AUTO_COMPACT: '1' })
    expect(taskEnv({ tool: 'claude', autoCompact: true })).toEqual({})
    expect(taskEnv({ tool: 'codex', autoCompact: false })).toEqual({})
  })

  it('runs an npm .cmd shim through cmd.exe, quoting what needs it', () => {
    const c = cliCommand('C:\\Users\\me\\.npm-global\\codex.cmd', ['exec', '-m', 'gpt-5.5', '-'])
    expect(c.verbatim).toBe(true)
    expect(c.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    expect(c.args[3]).toBe('""C:\\Users\\me\\.npm-global\\codex.cmd" exec -m gpt-5.5 -"')
    expect(cliCommand('C:\\bin\\claude.exe', ['-p', 'hi there'])).toEqual({ cmd: 'C:\\bin\\claude.exe', args: ['-p', 'hi there'], verbatim: false })
  })

  it('reads Codex events, thinking and the task window records', () => {
    expect(parseStreamLine(JSON.stringify({ type: 'thread.started', thread_id: 't1' })).session).toBe('t1')
    expect(parseStreamLine(JSON.stringify({ type: 'item.completed', item: { type: 'reasoning', text: '先看看测试' } }), 1).logs).toEqual([{ t: 1, kind: 'thinking', text: '先看看测试' }])
    expect(parseStreamLine(JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'npm  test', exit_code: 1 } }), 1).logs[0].text).toBe('命令：npm test（退出 1）')
    expect(parseStreamLine(JSON.stringify({ type: 'turn.completed', usage: {} })).result?.ok).toBe(true)
    const failed = parseStreamLine(JSON.stringify({ type: 'turn.failed', error: { message: JSON.stringify({ error: { message: 'model not supported' } }) } }))
    expect(failed.result).toMatchObject({ ok: false, text: 'model not supported' })
    expect(parseStreamLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: '嗯' }] } }), 2).logs).toEqual([{ t: 2, kind: 'thinking', text: '嗯' }])
    expect(parseStreamLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's9', model: 'm', cwd: 'c' })).session).toBe('s9')
    expect(parseStreamLine(JSON.stringify({ type: 'tp_exit', code: 0, stopped: false, error: '' })).exit).toEqual({ code: 0, stopped: false, error: '' })
  })

  it('keys a lane by tool and folder, ignoring case and trailing slashes on Windows', () => {
    expect(laneKey('claude', 'G:\\code\\a\\')).toBe(laneKey('claude', 'g:\\CODE\\a'))
    expect(laneKey('claude', 'G:\\code\\a')).not.toBe(laneKey('codex', 'G:\\code\\a'))
  })
})

describe('readiness', () => {
  const base = { status: 'queued', trigger: 'reset', notBefore: 0, queuedAt: 10, parentId: null, doneAt: null } as unknown as ScheduledTask
  it('waits for its parent, a hand on manual, or its time', () => {
    const parent = { ...base, id: 'p', status: 'running' } as ScheduledTask
    const child = { ...base, id: 'c', parentId: 'p' } as ScheduledTask
    expect(readiness(child, [parent, child], 100)).toBe('parent')
    expect(readiness(child, [{ ...parent, status: 'failed' }, child], 100)).toBe('parent-failed')
    expect(readiness(child, [{ ...parent, status: 'done' }, child], 100)).toBe('ready')
    // a repeating parent queued again after a successful run
    expect(readiness(child, [{ ...parent, status: 'queued', doneAt: 50 }, child], 100)).toBe('ready')
    expect(readiness(child, [{ ...parent, status: 'queued', doneAt: 5 }, child], 100)).toBe('parent')
    expect(readiness({ ...base, trigger: 'manual' } as ScheduledTask, [], 100)).toBe('manual')
    expect(readiness({ ...base, notBefore: 200 } as ScheduledTask, [], 100)).toBe('time')
    expect(readiness({ ...base, trigger: 'manual', force: true } as ScheduledTask, [], 100)).toBe('ready')
  })
})

/** a stand-in CLI: stream-json out; SLOW waits, FAIL fails; it notes when it ran */
const FAKE = `
const fs = require('fs')
const args = process.argv.slice(2)
const prompt = args[1]
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
fs.appendFileSync(process.env.TP_TRACE, Date.now() + ' start ' + prompt + '\\n')
out({ type: 'system', subtype: 'init', model: 'claude-test', cwd: process.cwd(), session_id: 'sess-' + prompt })
out({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: '想一想 ' + prompt }, { type: 'text', text: '开始' }] } })
const finish = () => {
  fs.appendFileSync(process.env.TP_TRACE, Date.now() + ' end ' + prompt + '\\n')
  if (prompt.includes('FAIL')) { process.stderr.write('boom'); process.exit(2) }
  out({ type: 'result', subtype: 'success', is_error: false, num_turns: 2, result: 'ok ' + prompt + ' ' + args.includes('--continue'), total_cost_usd: 0.1 })
}
if (prompt.includes('SLOW')) setTimeout(finish, 900)
else if (prompt.includes('HANG')) setInterval(() => {}, 1000)
else finish()
`

const procs: ChildProcess[] = []
afterAll(() => {
  for (const p of procs) p.kill()
})

function service(o: { terminal?: boolean; win?: WindowInfo } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tp-tasks2-'))
  const fake = join(dir, 'fake.cjs')
  const trace = join(dir, 'trace.txt')
  writeFileSync(fake, FAKE)
  writeFileSync(trace, '')
  process.env.TP_TRACE = trace
  const a = join(dir, 'a')
  const b = join(dir, 'b')
  mkdirSync(a)
  mkdirSync(b)
  let opened = 0
  const svc = new TaskService(join(dir, 'tasks.json'), join(dir, 'logs'), {
    window: () => o.win ?? { five: null, localEnd: null },
    blocker: () => null,
    claude: async () => 'claude',
    node: async () => (o.terminal ? process.execPath : null),
    terminal: () => !!o.terminal,
    command: () => ({ cmd: process.execPath, pre: [fake] }),
    // the task window, run hidden
    openTerminal: (x) => {
      opened++
      procs.push(spawn(x.node, [x.script, x.laneDir], { stdio: 'ignore', windowsHide: true, env: { ...process.env, TP_TRACE: trace } }))
    }
  })
  const events = () =>
    readFileSync(trace, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split(' ').slice(1).join(' '))
  return { svc, dir, a, b, events, opened: () => opened }
}

const until = async (cond: () => boolean, ms = 15_000) => {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 50))
  }
}

describe('lanes and subtasks', () => {
  it('runs different folders side by side and one folder in order', async () => {
    const { svc, a, b, events } = service()
    await svc.load()
    const t1 = svc.add({ prompt: 'SLOW-a1', cwd: a, trigger: 'now' })
    const t2 = svc.add({ prompt: 'a2', cwd: a, trigger: 'now' })
    const t3 = svc.add({ prompt: 'SLOW-b1', cwd: b, trigger: 'now' })
    await until(() => [t1, t2, t3].every((t) => t.status === 'done'))
    const ev = events()
    // b started while a1 was still running; a2 only after a1 ended
    expect(ev.indexOf('start SLOW-b1')).toBeLessThan(ev.indexOf('end SLOW-a1'))
    expect(ev.indexOf('start a2')).toBeGreaterThan(ev.indexOf('end SLOW-a1'))
  })

  it('starts a subtask once its parent has finished, carrying on its conversation', async () => {
    const { svc, a, b, events } = service()
    await svc.load()
    const parent = svc.add({ prompt: 'SLOW-p', cwd: a, trigger: 'now' })
    const child = svc.add({ prompt: 'kid', cwd: b, trigger: 'now', parentId: parent.id, continue: true })
    const same = svc.add({ prompt: 'next', cwd: a, trigger: 'manual', parentId: parent.id, continue: true })
    expect(child.parentId).toBe(parent.id)
    await until(() => child.status === 'done' && same.status === 'done')
    const ev = events()
    expect(ev.indexOf('start kid')).toBeGreaterThan(ev.indexOf('end SLOW-p'))
    // another folder: nothing to carry on there; the same folder: the parent's conversation
    expect(child.summary).toBe('ok kid false')
    expect(same.summary).toBe('ok next true')
    expect(same.sessionId).toBe('sess-next')
  })

  it('keeps manual tasks waiting until started by hand', async () => {
    const { svc, a } = service()
    await svc.load()
    const t = svc.add({ prompt: 'hold', cwd: a, trigger: 'manual' })
    await svc.tick()
    expect(t.status).toBe('queued')
    await svc.action(t.id, 'start')
    await until(() => t.status === 'done')
  })

  it('reorders by drag and drop, nests and un-nests, and refuses cycles', async () => {
    const { svc, a } = service({ win: { five: { pct: 50, resetsAt: Date.now() + HOUR }, localEnd: null } })
    await svc.load()
    const [x, y, z] = ['x', 'y', 'z'].map((p) => svc.add({ prompt: p, cwd: a, trigger: 'reset' }))
    const order = () => [...svc.tasks].sort((p, q) => p.order - q.order).map((t) => t.prompt)
    expect(svc.move(z.id, x.id, 'before')).toBe(true)
    expect(order()).toEqual(['z', 'x', 'y'])
    expect(svc.move(y.id, z.id, 'child')).toBe(true)
    expect(y.parentId).toBe(z.id)
    expect(order()).toEqual(['z', 'y', 'x'])
    // z can't go under its own child
    expect(svc.move(z.id, y.id, 'child')).toBe(false)
    expect(svc.move(x.id, z.id, 'after')).toBe(true)
    // after z and everything under it
    expect(order()).toEqual(['z', 'y', 'x'])
    expect(svc.move(y.id, null, 'root')).toBe(true)
    expect(y.parentId).toBeNull()
    // removing a parent frees its subtasks
    svc.move(y.id, x.id, 'child')
    await svc.action(x.id, 'cancel')
    await svc.action(x.id, 'remove')
    expect(y.parentId).toBeNull()
  })
})

describe('task window', () => {
  it('runs in the window, follows its log, and reuses the window for the same folder', async () => {
    const { svc, a, opened, dir } = service({ terminal: true })
    await svc.load()
    expect(svc.state().terminal).toBe(process.platform === 'win32')
    if (process.platform !== 'win32') return
    const t1 = svc.add({ prompt: 'w1', cwd: a, trigger: 'now' })
    await until(() => t1.status === 'done')
    expect(t1.mode).toBe('terminal')
    expect(t1.summary).toBe('ok w1 false')
    expect(t1.sessionId).toBe('sess-w1')
    const log = await svc.log(t1.id)
    expect(log.map((l) => l.kind)).toEqual(['system', 'thinking', 'text', 'result'])
    expect(readFileSync(join(dir, 'logs', `${t1.id}.jsonl`), 'utf8')).toContain('"type":"tp_exit"')
    const t2 = svc.add({ prompt: 'w2', cwd: a, trigger: 'now', continue: true })
    await until(() => t2.status === 'done')
    expect(t2.summary).toBe('ok w2 true')
    expect(opened()).toBe(1)
  }, 30_000)

  it('stops a task running in the window', async () => {
    const { svc, a } = service({ terminal: true })
    await svc.load()
    if (process.platform !== 'win32') return
    const t = svc.add({ prompt: 'HANG', cwd: a, trigger: 'now' })
    // the window has taken it and the CLI is talking
    await until(() => t.status === 'running' && t.activity === '开始')
    await svc.action(t.id, 'stop')
    await until(() => t.status === 'failed')
    expect(t.error).toBe('已手动停止')
  }, 30_000)
})
