import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { workbuddyArgs, findWorkBuddy } from '../src/features/workbuddy/tasks'
import { TaskService, taskEnv } from '../src/main/tasks'
import type { ScheduledTask, TaskInput } from '../src/shared/types'

const folders: string[] = []
const services: TaskService[] = []
const procs: ChildProcess[] = []
afterEach(async () => {
  services.splice(0).forEach((s) => s.stopAll())
  procs.splice(0).forEach((p) => p.kill())
  vi.unstubAllEnvs()
  for (const p of folders.splice(0)) await rm(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const fake = `
const fs = require('node:fs')
const args = process.argv.slice(2)
fs.writeFileSync('invocation.json', JSON.stringify({ args, root: process.env.WORKBUDDY_CONFIG_DIR, codebuddyRoot: process.env.CODEBUDDY_CONFIG_DIR }))
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
out({ type: 'system', subtype: 'init', session_id: 'wb-native-session', model: 'glm-5.2' })
out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Working' }] } })
out({ type: 'result', subtype: args[1] === 'NO_CREDITS' ? 'error_during_execution' : 'success', is_error: args[1] === 'NO_CREDITS', result: args[1] === 'NO_CREDITS' ? '' : 'Done', errors: args[1] === 'NO_CREDITS' ? ['积分不足'] : [], num_turns: 2, total_cost_usd: 0 })
`

async function service(terminal = false) {
  const root = await mkdtemp(join(tmpdir(), 'tp-workbuddy-task-')); folders.push(root)
  const launcher = join(root, 'codebuddy'); await writeFile(launcher, fake)
  vi.stubEnv('WORKBUDDY_CONFIG_DIR', join(root, 'native'))
  const svc = new TaskService(join(root, 'tasks.json'), join(root, 'logs'), {
    window: () => ({ five: null, localEnd: null }), blocker: () => null,
    claude: async () => null, workbuddy: async () => launcher, node: async () => process.execPath,
    terminal: () => terminal,
    openTerminal: (o) => { procs.push(spawn(o.node, [o.script, o.laneDir], { stdio: 'ignore', windowsHide: true })) }
  })
  services.push(svc); await svc.load()
  return { svc, root, launcher }
}
const finished = (s: TaskService) => new Promise<ScheduledTask>((resolve) => s.once('finished', resolve))
const input: TaskInput = { tool: 'workbuddy', prompt: 'Test', cwd: '.', trigger: 'manual' }

describe('WorkBuddy task integration', () => {
  it('uses supported streaming, resume and compaction flags without a Claude budget', () => {
    const args = workbuddyArgs({ permission: 'acceptEdits', model: 'glm-5.2', effort: 'high', compactAt: { unit: 'tokens', value: 200000 }, autoCompact: true, fallbackModel: 'deepseek/deepseek-v4.1-flash' }, { prompt: 'Task', system: 'System', resume: 'native-id', fork: true, partial: true })
    expect(args).toContain('--resume'); expect(args).toContain('native-id'); expect(args).toContain('--fork-session')
    expect(args).toContain('--autocompact'); expect(args).toContain('200000'); expect(args).toContain('--include-partial-messages')
    expect(args).not.toContain('--max-budget-usd'); expect(args).not.toContain('--session-id')
    expect(workbuddyArgs({ permission: 'inherit', model: null, effort: null, compactAt: { unit: 'pct', value: 60 }, autoCompact: false, fallbackModel: null }, { prompt: 'x', system: 's' })).not.toContain('--autocompact')
  })

  it('runs the bundled Node launcher, reports streaming results and shares WorkBuddy storage', async () => {
    const { svc, root, launcher } = await service()
    expect(await findWorkBuddy(launcher)).toBe(launcher)
    expect(svc.state().tools.workbuddy?.cli).toBe(launcher)
    const done = finished(svc)
    svc.add({ ...input, cwd: root, trigger: 'now', prompt: 'Complete', budgetUsd: 1 })
    const task = await done
    expect(task).toMatchObject({ tool: 'workbuddy', status: 'done', summary: 'Done', sessionId: 'wb-native-session', turns: 2, costUsd: null })
    const invocation = JSON.parse(await readFile(join(root, 'invocation.json'), 'utf8'))
    expect(invocation.args.slice(0, 5)).toEqual(['-p', 'Complete', '--output-format', 'stream-json', '--verbose'])
    expect(invocation.args).not.toContain('--max-budget-usd')
    expect(invocation.root).toBe(join(root, 'native')); expect(invocation.codebuddyRoot).toBe(invocation.root)
    expect(taskEnv({ tool: 'workbuddy', autoCompact: false })).not.toHaveProperty('DISABLE_AUTO_COMPACT')
  })

  it('stops when credits run out instead of inventing a refresh time', async () => {
    const { svc, root } = await service()
    const done = finished(svc)
    svc.add({ ...input, cwd: root, trigger: 'now', prompt: 'NO_CREDITS', retries: 5 })
    const task = await done
    expect(task).toMatchObject({ status: 'failed', error: '积分不足', pending: null })
    expect(task.attempts).toHaveLength(1)
    await expect(svc.action(task.id, 'requeue')).rejects.toThrow('WorkBuddy')
  })

  it.skipIf(process.platform !== 'win32')('uses the shared terminal runner for WorkBuddy without reporting a false zero bill', async () => {
    const { svc, root } = await service(true)
    const done = finished(svc)
    svc.add({ ...input, cwd: root, trigger: 'now', prompt: 'Complete' })
    const task = await done
    expect(task).toMatchObject({ tool: 'workbuddy', mode: 'terminal', status: 'done', summary: 'Done', costUsd: null })
    expect(JSON.parse(await readFile(join(root, 'invocation.json'), 'utf8')).root).toBe(join(root, 'native'))
  })

  it('allows manual and timed tasks and rejects quota reset and repeating triggers', async () => {
    const { svc, root } = await service()
    expect(() => svc.add({ ...input, cwd: root, trigger: 'reset' })).toThrow('WorkBuddy')
    expect(() => svc.add({ ...input, cwd: root, repeat: true })).toThrow('WorkBuddy')
    const task = svc.add({ ...input, cwd: root })
    expect(task.trigger).toBe('manual')
    expect(() => svc.update(task.id, { trigger: 'reset' })).toThrow('WorkBuddy')
    expect(() => svc.update(task.id, { repeat: true })).toThrow('WorkBuddy')
    expect(svc.update(task.id, { trigger: 'time', at: Date.now() + 3600000 })).toBe(true)
    expect(task.status).toBe('queued')
  })
})
