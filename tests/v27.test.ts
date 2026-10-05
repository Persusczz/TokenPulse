import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeArgs, classifyFailure, codexArgs, parseStreamLine, readiness, RESET_GRACE_MS, retryPrompt, tailOf, TaskService, type WindowInfo } from '../src/main/tasks'
import { computeAchievements } from '../src/main/achievements'
import { stageOf } from '../src/shared/stages'
import type { ScheduledTask } from '../src/shared/types'

describe('the quota star', () => {
  it('ages with the 5h window', () => {
    expect(stageOf(45)).toBe('main')
  })
})

const HOUR = 3600_000

describe('sorting failures', () => {
  it('tells quota, network trouble, a cap, setup problems and stops apart', () => {
    expect(classifyFailure('Claude AI usage limit reached|1760000000')).toBe('quota')
    expect(classifyFailure("You've hit your usage limit. Try again later")).toBe('quota')
    expect(classifyFailure('API Error: 529 {"type":"overloaded_error"}')).toBe('transient')
    expect(classifyFailure('request failed: ECONNRESET')).toBe('transient')
    expect(classifyFailure('', { subtype: 'error_max_budget_usd' })).toBe('budget')
    expect(classifyFailure('工作目录不存在：G:\\nope')).toBe('setup')
    expect(classifyFailure('已手动停止')).toBe('stopped')
    expect(classifyFailure('任务窗口被关闭，任务中断')).toBe('stopped')
    expect(classifyFailure('x', { timedOut: true })).toBe('timeout')
    expect(classifyFailure('tests still failing')).toBe('other')
  })

  it('asks the next try to fix what the check showed', () => {
    const p = retryPrompt('check', { verify: 'npm test', check: { code: 1, tail: 'FAIL a.test.ts', ms: 10 } })
    expect(p).toContain('npm test')
    expect(p).toContain('退出代码 1')
    expect(p).toContain('FAIL a.test.ts')
    expect(retryPrompt('timeout', { timeoutMin: 30 })).toContain('30 分钟')
    expect(tailOf('\x1b[31mred\x1b[0m\r\n\r\nlast', 5)).toBe('red\nlast')
  })

  it('reads the check and try records in the log', () => {
    expect(parseStreamLine(JSON.stringify({ type: 'tp_try', n: 2, why: '失败后重试' }), 1).logs).toEqual([{ t: 1, kind: 'system', text: '第 2 次尝试 · 失败后重试' }])
    expect(parseStreamLine(JSON.stringify({ type: 'tp_check', phase: 'end', code: 0, ms: 2500 }), 1).logs[0]).toMatchObject({ kind: 'result', text: '检查通过 · 3 秒' })
    expect(parseStreamLine(JSON.stringify({ type: 'tp_check', phase: 'end', code: 2, tail: 'a\n2 failed', ms: 10 }), 1).logs[0]).toMatchObject({ kind: 'error', text: '检查没通过（退出 2）：2 failed' })
    const r = parseStreamLine(JSON.stringify({ type: 'result', subtype: 'error_max_budget_usd', is_error: true }), 1)
    expect(r.result?.subtype).toBe('error_max_budget_usd')
    expect(r.logs[0].text).toBe('达到了这个任务的花费上限')
  })

  it('passes a cap, a fallback, an effort, and resumes a conversation by id', () => {
    const t = { prompt: 'x', permission: 'inherit' as const, model: 'opus', sessionId: null }
    const a = claudeArgs({ ...t, budgetUsd: 2.5, fallbackModel: 'sonnet', effort: 'high' }, { resume: 'abc', fork: true }).join(' ')
    expect(a).toContain('--resume abc --fork-session')
    expect(a).toContain('--max-budget-usd 2.5')
    expect(a).toContain('--fallback-model sonnet')
    expect(a).toContain('--effort high')
    // a fallback equal to the model is left out (Claude Code refuses it)
    expect(claudeArgs({ ...t, fallbackModel: 'opus' }).join(' ')).not.toContain('--fallback-model')
    expect(claudeArgs(t, { resume: 'abc' }).join(' ')).not.toContain('--fork-session')
    expect(codexArgs({ permission: 'inherit', model: null, effort: 'max' })).toContain('model_reasoning_effort=xhigh')
  })

  it('counts tasks saved by trial and error, and checks passed, as achievements', () => {
    const a = Object.fromEntries(computeAchievements([], { rescued: { n: 1, first: 5 }, checked: { n: 10, first: 1, at10: 9 } }).map((x) => [x.id, x]))
    expect(a['rescue-1']).toMatchObject({ unlocked: true, at: 5 })
    expect(a['rescue-10'].unlocked).toBe(false)
    expect(a['check-10']).toMatchObject({ unlocked: true, at: 9 })
  })

  it('lets a waiting retry go once its time has come, whatever its trigger', () => {
    const t = { status: 'queued', trigger: 'manual', notBefore: 100, parentId: 'gone', queuedAt: 0, pending: { kind: 'retry', prompt: null, resumeId: null, model: null } } as unknown as ScheduledTask
    expect(readiness(t, [], 50)).toBe('time')
    expect(readiness(t, [], 150)).toBe('ready')
  })
})

/** a stand-in CLI: the folder's name decides what it does; it counts its runs there */
const FAKE = `
const fs = require('fs')
const path = require('path')
const args = process.argv.slice(2)
const prompt = args[1]
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
const i = args.indexOf('--resume')
const resumed = i >= 0 ? args[i + 1] : null
const m = args.indexOf('--model')
fs.appendFileSync(process.env.TP_TRACE, JSON.stringify({ prompt, resumed, fork: args.includes('--fork-session'), model: m >= 0 ? args[m + 1] : null }) + '\\n')
const n = (fs.existsSync('n.txt') ? Number(fs.readFileSync('n.txt', 'utf8')) : 0) + 1
fs.writeFileSync('n.txt', String(n))
out({ type: 'system', subtype: 'init', model: 'claude-test', cwd: process.cwd(), session_id: resumed && !args.includes('--fork-session') ? resumed : 'sess-' + n })
if (prompt.includes('修好')) fs.writeFileSync('ok.txt', '1')
const name = path.basename(process.cwd())
const err = (text) => out({ type: 'result', subtype: 'error_during_execution', is_error: true, result: text, total_cost_usd: 0.05 })
if (name === 'overload' && n === 1) err('API Error: 529 overloaded_error')
else if (name === 'limit' && n === 1) err('Claude AI usage limit reached|1760000000')
else if (name === 'always') err('something broke')
else out({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, result: 'ok ' + n, total_cost_usd: 0.1 })
`

function service(win: WindowInfo = { five: null, localEnd: null }) {
  const dir = mkdtempSync(join(tmpdir(), 'tp-v27-'))
  const fake = join(dir, 'fake.cjs')
  const trace = join(dir, 'trace.txt')
  writeFileSync(fake, FAKE)
  writeFileSync(trace, '')
  process.env.TP_TRACE = trace
  const folder = (name: string) => {
    const p = join(dir, name)
    mkdirSync(p, { recursive: true })
    return p
  }
  const svc = new TaskService(join(dir, 'tasks.json'), join(dir, 'logs'), {
    window: () => win,
    blocker: () => null,
    claude: async () => 'claude',
    command: () => ({ cmd: process.execPath, pre: [fake] }),
    retryDelay: () => 20
  })
  const calls = () =>
    readFileSync(trace, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { prompt: string; resumed: string | null; fork: boolean; model: string | null })
  return { svc, dir, folder, calls }
}

const settled = (svc: TaskService) => new Promise<ScheduledTask>((r) => svc.once('finished', r))

describe('trial and error', () => {
  it('runs the check, has a failing one fixed in the same conversation, and checks again', async () => {
    const { svc, dir, folder, calls } = service()
    await svc.load()
    const cwd = folder('fixme')
    const check = join(dir, 'check.cjs')
    writeFileSync(check, `process.stdout.write('checking\\n'); if (!require('fs').existsSync('ok.txt')) { console.error('1 test failed'); process.exit(1) }`)
    const done = settled(svc)
    const t = svc.add({ prompt: 'build it', cwd, trigger: 'now', retries: 2, verify: `"${process.execPath}" "${check}"` })
    const r = await done
    expect(r.status).toBe('done')
    expect(r.attempts?.map((a) => [a.kind, a.ok, a.failure ?? null])).toEqual([
      ['run', false, 'check'],
      ['fix', true, null]
    ])
    expect(r.attempts?.[0].check).toMatchObject({ code: 1 })
    expect(r.attempts?.[0].check?.tail).toContain('1 test failed')
    expect(r.attempts?.[1].check?.code).toBe(0)
    const c = calls()
    // the fix carried on the first try's conversation, told what failed
    expect(c[1].resumed).toBe('sess-1')
    expect(c[1].fork).toBe(false)
    expect(c[1].prompt).toContain('1 test failed')
    // both tries' cost
    expect(r.costUsd).toBeCloseTo(0.2)
    expect(r.note).toContain('试了 2 次')
    const log = await svc.log(t.id)
    expect(log.map((l) => l.text)).toEqual(expect.arrayContaining(['第 2 次尝试 · 修正检查没通过的地方', '检查：' + `"${process.execPath}" "${check}"`.replace(/\s+/g, ' ')]))
    expect(log.some((l) => l.kind === 'error' && l.text.startsWith('检查没通过（退出 1）'))).toBe(true)
  })

  it('retries after network trouble with the backup model, and gives up when the tries run out', async () => {
    const { svc, folder, calls } = service()
    await svc.load()
    let done = settled(svc)
    const a = svc.add({ prompt: 'go', cwd: folder('overload'), trigger: 'now', retries: 1, model: 'opus', fallbackModel: 'sonnet' })
    let r = await done
    expect(r.status).toBe('done')
    expect(r.attempts?.map((x) => x.failure ?? null)).toEqual(['transient', null])
    expect(calls().map((x) => x.model)).toEqual(['opus', 'sonnet'])
    expect(a.attempts?.[1].model).toBe('sonnet')

    done = settled(svc)
    svc.add({ prompt: 'go', cwd: folder('always'), trigger: 'now', retries: 2 })
    r = await done
    expect(r.status).toBe('failed')
    expect(r.attempts).toHaveLength(3)
    expect(r.error).toBe('something broke')
  })

  it('waits for the refresh when the quota runs out, then carries on without using a retry', async () => {
    const win: WindowInfo = { five: { pct: 100, resetsAt: Date.now() + HOUR }, localEnd: null }
    const { svc, folder } = service({ five: null, localEnd: null })
    await svc.load()
    const t = svc.add({ prompt: 'go', cwd: folder('limit'), trigger: 'now', retries: 0 })
    // the window seen once the run has started
    ;(svc as unknown as { deps: { window: () => WindowInfo } }).deps.window = () => win
    const end = Date.now() + 10_000
    while (!(t.status === 'queued' && t.pending) && Date.now() < end) await new Promise((r) => setTimeout(r, 30))
    expect(t.pending).toMatchObject({ kind: 'resume', resumeId: 'sess-1' })
    expect(t.notBefore).toBe(win.five!.resetsAt! + RESET_GRACE_MS)
    expect(t.note).toContain('刷新后接着做')
    expect(t.attempts?.[0].failure).toBe('quota')
    // the refresh: it goes on, in the same conversation
    const done = settled(svc)
    t.notBefore = Date.now()
    await svc.tick()
    const r = await done
    expect(r.status).toBe('done')
    expect(r.attempts?.map((a) => a.kind)).toEqual(['run', 'resume'])
  })

  it('edits a task, queues it again, follows one up, and clears the history', async () => {
    const { svc, folder, calls } = service({ five: { pct: 50, resetsAt: Date.now() + HOUR }, localEnd: null })
    await svc.load()
    const cwd = folder('plain')
    const t = svc.add({ prompt: 'old', cwd, trigger: 'reset' })
    expect(svc.update(t.id, { prompt: 'new', verify: '  ', retries: 9, timeoutMin: 0, effort: 'high' })).toBe(true)
    expect(t).toMatchObject({ prompt: 'new', verify: null, retries: 5, timeoutMin: null, effort: 'high', status: 'queued' })
    let done = settled(svc)
    svc.update(t.id, {}, 'now')
    const r = await done
    expect(r.status).toBe('done')
    expect(calls()[0].prompt).toBe('new')

    done = settled(svc)
    const f = svc.add({ prompt: 'and then?', cwd, trigger: 'now', resumeId: r.sessionId!, followOf: r.id })
    await done
    expect(calls()[1]).toMatchObject({ prompt: 'and then?', resumed: r.sessionId, fork: true })
    expect(f.followOf).toBe(t.id)

    expect(svc.clearHistory('codex')).toBe(0)
    expect(svc.clearHistory('all')).toBe(2)
    expect(svc.tasks).toHaveLength(0)
  })

  it('reads a growing log in pieces', async () => {
    const { svc, dir } = service()
    await svc.load()
    mkdirSync(join(dir, 'logs'), { recursive: true })
    const file = join(dir, 'logs', 'x.jsonl')
    const line = (o: object) => appendFileSync(file, `1\t${JSON.stringify(o)}\n`)
    line({ type: 'assistant', message: { content: [{ type: 'text', text: 'a' }] } })
    expect((await svc.log('x')).map((l) => l.text)).toEqual(['a'])
    // half a line, then the rest
    appendFileSync(file, `2\t${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'b' }] } }).slice(0, 10)}`)
    expect((await svc.log('x')).map((l) => l.text)).toEqual(['a'])
    appendFileSync(file, `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'b' }] } }).slice(10)}\n`)
    expect((await svc.log('x')).map((l) => l.text)).toEqual(['a', 'b'])
    // started afresh
    writeFileSync(file, '')
    line({ type: 'assistant', message: { content: [{ type: 'text', text: 'c' }] } })
    expect((await svc.log('x')).map((l) => l.text)).toEqual(['c'])
    expect(existsSync(file)).toBe(true)
  })
})
