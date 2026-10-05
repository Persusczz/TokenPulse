import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { cleanCompactAt, compactText } from '../src/shared/compact'
import { DEFAULT_SETTINGS, sanitize } from '../src/main/settings'
import { CLAUDE_COMPACT_RESERVE, codexArgs, codexCompactLimit, laneKey, taskEnv, TaskService } from '../src/main/tasks'

describe('where a task compacts', () => {
  it('cleans the point: a share 10–95 %, or tokens in whole thousands', () => {
    expect(cleanCompactAt({ unit: 'pct', value: 62.4 })).toEqual({ unit: 'pct', value: 62 })
    expect(cleanCompactAt({ unit: 'pct', value: 3 })).toEqual({ unit: 'pct', value: 10 })
    expect(cleanCompactAt({ unit: 'tokens', value: 151_499 })).toEqual({ unit: 'tokens', value: 151_000 })
    expect(cleanCompactAt({ unit: 'tokens', value: 5 })).toEqual({ unit: 'tokens', value: 20_000 })
    expect(cleanCompactAt({ unit: 'pages', value: 3 })).toBeNull()
    expect(cleanCompactAt(null)).toBeNull()
    expect(compactText(null)).toBe('快满时')
    expect(compactText({ unit: 'pct', value: 60 })).toBe('60%')
    expect(compactText({ unit: 'tokens', value: 300_000 })).toBe('300K')
    expect(compactText({ unit: 'tokens', value: 1_500_000 })).toBe('1.5M')
  })

  it('tells Claude Code through its environment', () => {
    // a share needs a set window too, or Claude Code waits for the API to say the context is full
    expect(taskEnv({ tool: 'claude', autoCompact: true, compactAt: { unit: 'pct', value: 60 } })).toEqual({ CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '60', CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000' })
    // a token count: the window it compacts in sits the reserve above it
    expect(taskEnv({ tool: 'claude', autoCompact: true, compactAt: { unit: 'tokens', value: 300_000 } })).toEqual({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(300_000 + CLAUDE_COMPACT_RESERVE) })
    // Claude Code takes a window of 100K to 1M
    expect(taskEnv({ tool: 'claude', autoCompact: true, compactAt: { unit: 'tokens', value: 40_000 } })).toEqual({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: '100000' })
    expect(taskEnv({ tool: 'claude', autoCompact: true, compactAt: { unit: 'tokens', value: 2_000_000 } })).toEqual({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000' })
    // off wins over a point
    expect(taskEnv({ tool: 'claude', autoCompact: false, compactAt: { unit: 'pct', value: 60 } })).toEqual({ DISABLE_AUTO_COMPACT: '1' })
    expect(taskEnv({ tool: 'codex', autoCompact: true, compactAt: { unit: 'pct', value: 60 } })).toEqual({})
  })

  it('tells Codex as a token limit, a share taken of its window', () => {
    expect(codexCompactLimit({ unit: 'pct', value: 50 }, 258_400)).toBe(129_200)
    expect(codexCompactLimit({ unit: 'tokens', value: 150_000 }, 258_400)).toBe(150_000)
    expect(codexCompactLimit(null, 258_400)).toBeNull()
    expect(codexArgs({ permission: 'inherit', model: null, compactAt: 129_200 })).toContain('model_auto_compact_token_limit=129200')
    expect(codexArgs({ permission: 'inherit', model: null }).join(' ')).not.toContain('model_auto_compact_token_limit')
  })

  it('keeps the default in settings', () => {
    expect(DEFAULT_SETTINGS.taskCompactAt).toBeNull()
    expect(sanitize({ taskCompactAt: { unit: 'pct', value: 70 } }, DEFAULT_SETTINGS).taskCompactAt).toEqual({ unit: 'pct', value: 70 })
    expect(sanitize({ taskCompactAt: 'soon' }, DEFAULT_SETTINGS).taskCompactAt).toBeNull()
    expect('taskTemplates' in sanitize({ taskTemplates: [{ name: 'x', prompt: 'y' }] }, DEFAULT_SETTINGS)).toBe(false)
  })

  it('puts the point on new tasks and keeps it through an edit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-v28c-'))
    const svc = new TaskService(join(dir, 'tasks.json'), join(dir, 'logs'), { window: () => ({ five: null, localEnd: null }), blocker: () => null, claude: async () => null })
    await svc.load()
    const t = svc.add({ prompt: 'x', cwd: dir, trigger: 'manual', compactAt: { unit: 'pct', value: 55 } })
    expect(t.compactAt).toEqual({ unit: 'pct', value: 55 })
    svc.update(t.id, { compactAt: { unit: 'tokens', value: 400_000 } })
    expect(t.compactAt).toEqual({ unit: 'tokens', value: 400_000 })
    expect(svc.add({ prompt: 'y', cwd: dir, trigger: 'manual' }).compactAt).toBeNull()
  })
})

/** a stand-in CLI: LONG runs a few seconds, HANG never ends */
const FAKE = `
const fs = require('fs')
const prompt = process.argv[3]
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
fs.appendFileSync(process.env.TP_TRACE, 'start ' + prompt + '\\n')
out({ type: 'system', subtype: 'init', model: 'claude-test', cwd: process.cwd(), session_id: 'sess-' + prompt })
out({ type: 'assistant', message: { content: [{ type: 'text', text: '开始' }] } })
const done = () => out({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, result: 'ok ' + prompt, total_cost_usd: 0.1 })
if (prompt.includes('LONG')) setTimeout(done, 11000)
else if (prompt.includes('HANG')) setInterval(() => {}, 1000)
else done()
`

const procs: ChildProcess[] = []
afterAll(() => {
  for (const p of procs) p.kill()
})

function service(windows = 1) {
  const dir = mkdtempSync(join(tmpdir(), 'tp-v28-'))
  const fake = join(dir, 'fake.cjs')
  const trace = join(dir, 'trace.txt')
  writeFileSync(fake, FAKE)
  writeFileSync(trace, '')
  const a = join(dir, 'a')
  mkdirSync(a)
  const svc = new TaskService(join(dir, 'tasks.json'), join(dir, 'logs'), {
    window: () => ({ five: null, localEnd: null }),
    blocker: () => null,
    claude: async () => 'claude',
    node: async () => process.execPath,
    terminal: () => true,
    command: () => ({ cmd: process.execPath, pre: [fake] }),
    // the task window, run hidden; `windows` of them for the folder at once
    openTerminal: (x) => {
      for (let i = 0; i < windows; i++) procs.push(spawn(x.node, [x.script, x.laneDir], { stdio: 'ignore', windowsHide: true, env: { ...process.env, TP_TRACE: trace } }))
    }
  })
  const lane = join(dir, 'logs', 'lanes', createHash('sha1').update(laneKey('claude', a)).digest('hex').slice(0, 12))
  return { svc, a, lane, starts: () => readFileSync(trace, 'utf8').split('\n').filter((l) => l.startsWith('start')) }
}

const until = async (cond: () => boolean, ms = 20_000) => {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 50))
  }
}

describe.runIf(process.platform === 'win32')('following a task window', () => {
  it('keeps a task running while its heartbeat file reads half written', async () => {
    const { svc, a, lane } = service()
    await svc.load()
    const t = svc.add({ prompt: 'LONG', cwd: a, trigger: 'now' })
    await until(() => t.status === 'running' && t.activity === '开始')
    // what a reader finds when it lands in the middle of a write, over and over
    const spoil = setInterval(() => {
      try {
        writeFileSync(join(lane, 'lane.json'), '{"pid":')
      } catch {
        /* the window has it */
      }
    }, 30)
    try {
      await until(() => t.status !== 'running', 25_000)
    } finally {
      clearInterval(spoil)
    }
    expect(t.error).toBeNull()
    expect(t.status).toBe('done')
  }, 40_000)

  it('gives a job to one window only when two are open for the folder', async () => {
    const { svc, a, starts } = service(2)
    await svc.load()
    const t = svc.add({ prompt: 'once', cwd: a, trigger: 'now' })
    await until(() => t.status === 'done')
    await new Promise((r) => setTimeout(r, 1500))
    expect(starts()).toEqual(['start once'])
  }, 30_000)

  it('still notices a window that really closed', async () => {
    const { svc, a, lane } = service()
    await svc.load()
    const t = svc.add({ prompt: 'HANG', cwd: a, trigger: 'now' })
    await until(() => t.status === 'running' && t.activity === '开始')
    const hb = JSON.parse(readFileSync(join(lane, 'lane.json'), 'utf8'))
    // closed from outside: the window and its CLI gone without a word
    process.kill(hb.child)
    process.kill(hb.pid)
    await until(() => t.status === 'failed', 20_000)
    expect(t.error).toBe('任务窗口被关闭，任务中断')
  }, 40_000)
})
