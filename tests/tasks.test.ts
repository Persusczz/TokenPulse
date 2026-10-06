import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { claudeArgs, cleanEnv, computeNotBefore, nextDue, parseStreamLine, RESET_GRACE_MS, TaskService, type WindowInfo } from '../src/main/tasks'
import type { ScheduledTask } from '../src/shared/types'

const now = Date.UTC(2026, 9, 4, 12)
const HOUR = 3600_000

describe('scheduling', () => {
  const busy: WindowInfo = { five: { pct: 40, resetsAt: now + 2 * HOUR }, localEnd: null }
  it('waits for the 5h refresh, or not at all when the window is fresh', () => {
    expect(computeNotBefore('reset', null, now, busy)).toBe(now + 2 * HOUR + RESET_GRACE_MS)
    expect(computeNotBefore('reset', null, now, { five: { pct: 0, resetsAt: now + HOUR }, localEnd: null })).toBe(now)
    expect(computeNotBefore('reset', null, now, { five: { pct: 30, resetsAt: now - 1 }, localEnd: null })).toBe(now)
    // no official data: the window seen in local logs
    expect(computeNotBefore('reset', null, now, { five: null, localEnd: now + HOUR })).toBe(now + HOUR + RESET_GRACE_MS)
    expect(computeNotBefore('now', null, now, busy)).toBe(now)
    expect(computeNotBefore('time', now + 5 * HOUR, now, busy)).toBe(now + 5 * HOUR)
  })

  it('picks the oldest due task', () => {
    const t = (id: string, notBefore: number, createdAt: number, status: ScheduledTask['status'] = 'queued') => ({ id, notBefore, createdAt, status }) as ScheduledTask
    expect(nextDue([t('a', now + 1, 0), t('b', now - 10, 5), t('c', now - 10, 2), t('d', now - 99, 0, 'done')], now)?.id).toBe('c')
    expect(nextDue([t('a', now + 1, 0)], now)).toBeUndefined()
  })

  it('builds the headless command line', () => {
    const args = claudeArgs({ prompt: '修复测试', permission: 'acceptEdits', model: 'sonnet', sessionId: 'abc' })
    expect(args.slice(0, 5)).toEqual(['-p', '修复测试', '--output-format', 'stream-json', '--verbose'])
    expect(args).toContain('--append-system-prompt')
    expect(args.join(' ')).toContain('--session-id abc')
    expect(args.join(' ')).toContain('--permission-mode acceptEdits')
    expect(args.join(' ')).toContain('--model sonnet')
    expect(claudeArgs({ prompt: 'x', permission: 'inherit', model: null, sessionId: null }).join(' ')).not.toContain('--permission-mode')
  })

  it('drops the parent session variables so claude does not think it is nested', () => {
    expect(cleanEnv({ PATH: 'p', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'x', CLAUDE_CONFIG_DIR: 'keep' })).toEqual({ PATH: 'p', CLAUDE_CONFIG_DIR: 'keep' })
  })

  it('reads stream-json events', () => {
    expect(parseStreamLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm   test' } }] } }), 1).logs).toEqual([
      { t: 1, kind: 'tool', text: 'Bash：npm test' }
    ])
    const r = parseStreamLine(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 4, result: '完成', total_cost_usd: 0.5 }), 2)
    expect(r.result).toEqual({ ok: true, text: '完成', costUsd: 0.5, turns: 4 })
    expect(parseStreamLine(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true }), 3).result?.ok).toBe(false)
  })
})

/** a stand-in for claude: prints stream-json; the prompt decides what it does */
const FAKE = `
const args = process.argv.slice(2)
const prompt = args[1]
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
out({ type: 'system', subtype: 'init', model: 'claude-test', cwd: process.cwd() })
out({ type: 'assistant', message: { content: [{ type: 'text', text: '开始' }, { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } })
if (prompt.includes('FAIL')) { process.stderr.write('boom'); process.exit(2) }
else if (prompt.includes('HANG')) setInterval(() => {}, 1000)
else out({ type: 'result', subtype: 'success', is_error: false, num_turns: 3, result: '完成：' + prompt + ' @ ' + process.cwd(), total_cost_usd: 0.42 })
`

function service(win: WindowInfo = { five: null, localEnd: null }, blocker: string | null = null) {
  const dir = mkdtempSync(join(tmpdir(), 'tp-tasks-'))
  const fake = join(dir, 'fake-claude.cjs')
  writeFileSync(fake, FAKE)
  const svc = new TaskService(join(dir, 'tasks.json'), join(dir, 'logs'), {
    window: () => win,
    blocker: () => blocker,
    claude: async () => 'claude',
    command: () => ({ cmd: process.execPath, pre: [fake] })
  })
  return { svc, dir }
}
const finished = (svc: TaskService) => new Promise<ScheduledTask>((r) => svc.once('finished', r))

describe('task runner', () => {
  it('runs a due task with claude and records the result and log', async () => {
    const { svc, dir } = service()
    await svc.load()
    const done = finished(svc)
    const t = svc.add({ prompt: '修好测试', cwd: dir, trigger: 'now' })
    const r = await done
    expect(r.status).toBe('done')
    expect(r.summary).toContain('完成：修好测试')
    expect(r.summary).toContain(dir)
    expect(r.costUsd).toBe(0.42)
    expect(r.turns).toBe(3)
    expect(r.sessionId).toMatch(/^[0-9a-f-]{36}$/)
    const log = await svc.log(t.id)
    expect(log.map((l) => l.kind)).toEqual(['system', 'text', 'tool', 'result'])
    // saved in the background, whole: wait for it to land
    await vi.waitFor(() => expect(JSON.parse(readFileSync(join(dir, 'tasks.json'), 'utf8'))[0].status).toBe('done'))
  })

  it('reports failures and can stop a running task', async () => {
    const { svc, dir } = service()
    await svc.load()
    let done = finished(svc)
    svc.add({ prompt: 'FAIL please', cwd: dir, trigger: 'now' })
    const f = await done
    expect(f.status).toBe('failed')
    expect(f.error).toBe('boom')

    done = finished(svc)
    const t = svc.add({ prompt: 'HANG', cwd: dir, trigger: 'now' })
    await new Promise((r) => setTimeout(r, 600))
    expect(svc.tasks.find((x) => x.id === t.id)?.status).toBe('running')
    await svc.action(t.id, 'stop')
    const s = await done
    expect(s.status).toBe('failed')
    expect(s.error).toBe('已手动停止')
  })

  it('waits while blocked or before its time, and queues a repeating task for the next refresh', async () => {
    const win: WindowInfo = { five: { pct: 50, resetsAt: Date.now() + 2 * HOUR }, localEnd: null }
    const blocked = service(win, '5h 额度已到守卫线')
    await blocked.svc.load()
    blocked.svc.add({ prompt: 'x', cwd: blocked.dir, trigger: 'now' })
    await blocked.svc.tick()
    expect(blocked.svc.tasks[0].status).toBe('queued')
    expect(blocked.svc.state().waiting).toBe('5h 额度已到守卫线')

    const { svc, dir } = service(win)
    await svc.load()
    const later = svc.add({ prompt: 'later', cwd: dir, trigger: 'reset' })
    expect(later.notBefore).toBe(win.five!.resetsAt! + RESET_GRACE_MS)
    await svc.tick()
    expect(later.status).toBe('queued')
    const done = finished(svc)
    const rep = svc.add({ prompt: 'nightly', cwd: dir, trigger: 'now', repeat: true })
    await done
    const again = svc.tasks.find((x) => x.id === rep.id)!
    expect(again.status).toBe('queued')
    expect(again.runs).toBe(1)
    expect(again.notBefore).toBe(win.five!.resetsAt! + RESET_GRACE_MS)
  })

  it('marks a task cut short by a restart as interrupted', async () => {
    const { svc, dir } = service()
    writeFileSync(join(dir, 'tasks.json'), JSON.stringify([{ id: 'x', status: 'running', prompt: 'p', cwd: dir, notBefore: 0, createdAt: 0, runs: 1 }]))
    await svc.load()
    expect(svc.tasks[0]).toMatchObject({ status: 'failed', error: 'TokenPulse 退出时任务被中断' })
  })
})
