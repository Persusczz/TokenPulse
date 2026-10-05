import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  editClaudeSettings,
  hasBridgeStatusline,
  hasGuardHooks,
  withBridgeStatusline,
  withGuardHooks,
  withoutBridgeStatusline,
  withoutGuardHooks
} from '../src/main/claudeSettings'
import { groupPaused } from '../src/main/guard'

const GUARD = resolve(__dirname, '../src/bridge/guard.cjs')
const STATUSLINE = resolve(__dirname, '../src/bridge/statusline.cjs')
const NODE = process.execPath

function run(script: string, dir: string, input: unknown, onSpawn?: () => void, env: Record<string, string> = {}) {
  return new Promise<{ out: string; ms: number }>((done, fail) => {
    const t = Date.now()
    const p = spawn(NODE, [script], { env: { ...process.env, TOKENPULSE_BRIDGE_DIR: dir, TOKENPULSE_GUARD_POLL_MS: '150', ...env } })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.on('error', fail)
    p.on('close', () => done({ out, ms: Date.now() - t }))
    p.stdin.end(JSON.stringify(input))
    onSpawn?.()
  })
}

const bridge = (guard: unknown, quota?: unknown) => {
  const dir = mkdtempSync(join(tmpdir(), 'tp-guard-'))
  if (guard) writeFileSync(join(dir, 'guard.json'), JSON.stringify(guard))
  if (quota) writeFileSync(join(dir, 'quota.json'), JSON.stringify(quota))
  return dir
}
const hookInput = { session_id: 'sess-1', cwd: 'G:\\code\\x', hook_event_name: 'PreToolUse' }
const reading = (pct: number, p: { at?: number; resetsAt?: number | null } = {}) => ({
  updatedAt: p.at ?? Date.now(),
  fiveHour: { pct, resetsAt: p.resetsAt === undefined ? Date.now() + 3600_000 : p.resetsAt }
})

describe('guard hook script', () => {
  it('lets the task through below the threshold', async () => {
    const r = await run(GUARD, bridge({ enabled: true, pauseAt: 90 }, reading(89.9)), hookInput)
    expect(r.out).toBe('')
  })

  it('does nothing while disabled, with stale data, or once the window reset', async () => {
    for (const dir of [
      bridge({ enabled: false, pauseAt: 90 }, reading(99)),
      bridge({ enabled: true, pauseAt: 90 }, reading(99, { at: Date.now() - 3600_000 })),
      bridge({ enabled: true, pauseAt: 90 }, reading(99, { resetsAt: Date.now() - 60_000 })),
      bridge(null)
    ]) {
      const r = await run(GUARD, dir, hookInput)
      expect(r.out).toBe('')
      expect(r.ms).toBeLessThan(5000)
    }
  })

  it('holds the task at the threshold and resumes after the window resets', async () => {
    const dir = bridge({ enabled: true, pauseAt: 90 }, reading(91))
    let sawPause = false
    const r = await run(GUARD, dir, hookInput, () => {
      setTimeout(() => {
        const files = existsSync(join(dir, 'paused')) ? readdirSync(join(dir, 'paused')) : []
        sawPause = files.length === 1 && JSON.parse(readFileSync(join(dir, 'paused', files[0]), 'utf8')).sessionId === 'sess-1'
        // a new reading after the reset
        writeFileSync(join(dir, 'quota.json'), JSON.stringify(reading(3)))
      }, 700)
    })
    expect(sawPause).toBe(true)
    expect(r.ms).toBeGreaterThanOrEqual(600)
    expect(readdirSync(join(dir, 'paused'))).toEqual([])
    const out = JSON.parse(r.out)
    expect(out.hookSpecificOutput.hookEventName).toBe('PreToolUse')
    expect(out.hookSpecificOutput.additionalContext).toContain('90%')
  })

  it('also reads the statusline bridge, preferring the newest reading', async () => {
    const dir = bridge({ enabled: true, pauseAt: 90 }, reading(10, { at: Date.now() - 60_000 }))
    writeFileSync(
      join(dir, 'statusline.json'),
      JSON.stringify({ updatedAt: Date.now(), rate_limits: { five_hour: { used_percentage: 95, resets_at: Math.floor(Date.now() / 1000) + 3600 } } })
    )
    const r = await run(GUARD, dir, hookInput, () => setTimeout(() => writeFileSync(join(dir, 'quota.json'), JSON.stringify(reading(1, { at: Date.now() + 5000 }))), 500))
    expect(r.ms).toBeGreaterThanOrEqual(400)
    expect(r.out).toContain('additionalContext')
  })
})

describe('guard: weekly line and resume hours', () => {
  const week = (fivePct: number, weekPct: number, weekResetIn: number) => ({
    updatedAt: Date.now(),
    fiveHour: { pct: fivePct, resetsAt: Date.now() + 3600_000 },
    sevenDay: { pct: weekPct, resetsAt: Date.now() + weekResetIn }
  })

  it('stops the task with a reason when the 7-day reset is beyond what the hook can wait', async () => {
    const dir = bridge({ enabled: true, pauseAt: 90, weeklyAt: 95 }, week(10, 97, 3 * 86_400_000))
    const r = await run(GUARD, dir, hookInput)
    expect(r.ms).toBeLessThan(5000)
    const out = JSON.parse(r.out)
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('7 天额度已用 97%')
    const prompt = JSON.parse((await run(GUARD, dir, { ...hookInput, hook_event_name: 'UserPromptSubmit' })).out)
    expect(prompt.decision).toBe('block')
  })

  it('holds for a near 7-day reset and resumes after it', async () => {
    const dir = bridge({ enabled: true, pauseAt: 90, weeklyAt: 95 }, week(10, 96, 3600_000))
    const r = await run(GUARD, dir, hookInput, () => setTimeout(() => writeFileSync(join(dir, 'quota.json'), JSON.stringify(week(1, 2, 7 * 86_400_000))), 500))
    expect(r.ms).toBeGreaterThanOrEqual(400)
    expect(JSON.parse(r.out).hookSpecificOutput.additionalContext).toContain('7 天额度达到 95%')
    // below the weekly line it does nothing
    expect((await run(GUARD, bridge({ enabled: true, pauseAt: 90, weeklyAt: 95 }, week(10, 94, 3600_000)), hookInput)).out).toBe('')
  })

  it('after a reset, waits for the allowed hours (and stops if they are too far off)', async () => {
    const at = (min: number) => {
      const d = new Date(Date.now() + min * 60_000)
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }
    const dir = bridge({ enabled: true, pauseAt: 90, resumeFrom: at(120), resumeTo: at(180) }, reading(91, { resetsAt: null }))
    const r = await run(GUARD, dir, hookInput, () => setTimeout(() => writeFileSync(join(dir, 'quota.json'), JSON.stringify(reading(3))), 300), {
      TOKENPULSE_GUARD_MAX_WAIT_MS: '1500'
    })
    const out = JSON.parse(r.out)
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('自动继续')
    // inside the allowed hours it just resumes
    const open = bridge({ enabled: true, pauseAt: 90, resumeFrom: at(-30), resumeTo: at(60) }, reading(91, { resetsAt: null }))
    const r2 = await run(GUARD, open, hookInput, () => setTimeout(() => writeFileSync(join(open, 'quota.json'), JSON.stringify(reading(3))), 300))
    expect(JSON.parse(r2.out).hookSpecificOutput.additionalContext).toContain('90%')
  })
})

describe('guard: manual and per-session holds', () => {
  it('holds every task while paused by hand, even with the threshold off, and resumes when released', async () => {
    const dir = bridge({ enabled: false, manual: true }, reading(5))
    const r = await run(GUARD, dir, hookInput, () => setTimeout(() => writeFileSync(join(dir, 'guard.json'), JSON.stringify({ enabled: false, manual: false })), 500))
    expect(r.ms).toBeGreaterThanOrEqual(400)
    expect(JSON.parse(r.out).hookSpecificOutput.additionalContext).toContain('手动暂停')
  })

  it('holds only the listed session', async () => {
    const dir = bridge({ enabled: false, sessions: ['sess-1'] }, reading(5))
    const other = await run(GUARD, dir, { ...hookInput, session_id: 'other' })
    expect(other.out).toBe('')
    expect(other.ms).toBeLessThan(3000)
    const r = await run(GUARD, dir, hookInput, () => setTimeout(() => writeFileSync(join(dir, 'guard.json'), JSON.stringify({ enabled: false, sessions: [] })), 400))
    expect(r.ms).toBeGreaterThanOrEqual(300)
    expect(r.out).toContain('手动暂停')
  })

  it('stops the task when a manual pause outlasts the hook', async () => {
    const dir = bridge({ enabled: false, manual: true }, reading(5))
    const r = await run(GUARD, dir, hookInput, undefined, { TOKENPULSE_GUARD_MAX_WAIT_MS: '400' })
    expect(JSON.parse(r.out).hookSpecificOutput.permissionDecision).toBe('deny')
  })
})

describe('statusline bridge script', () => {
  it('saves rate_limits and prints a quota segment after the previous statusline', async () => {
    const dir = bridge({ enabled: true, pauseAt: 90 })
    writeFileSync(join(dir, 'statusline-prev.json'), JSON.stringify({ type: 'command', command: `"${NODE}" -e "process.stdout.write('PREV')"` }))
    const resets = Math.floor(Date.now() / 1000) + 2 * 3600
    const r = await run(STATUSLINE, dir, { session_id: 'x', rate_limits: { five_hour: { used_percentage: 42.4, resets_at: resets }, seven_day: { used_percentage: 7, resets_at: resets } } })
    const saved = JSON.parse(readFileSync(join(dir, 'statusline.json'), 'utf8'))
    expect(saved.rate_limits.five_hour.used_percentage).toBe(42.4)
    const plain = r.out.replace(/\x1b\[[0-9;]*m/g, '')
    expect(plain).toMatch(/^PREV │ 5h ███▍░░░░ 42% ↻(1h59m|2h00m) · 7d ▌░░░░░░░ 7% ↻(1h59m|2h00m) · 守卫 90%$/)
  })

  it('keeps the last reading when a session has none yet', async () => {
    const dir = bridge(null)
    writeFileSync(join(dir, 'statusline.json'), JSON.stringify({ updatedAt: 1, rate_limits: { seven_day: { used_percentage: 12, resets_at: 9e9 } } }))
    const r = await run(STATUSLINE, dir, { session_id: 'y' })
    expect(JSON.parse(readFileSync(join(dir, 'statusline.json'), 'utf8')).updatedAt).toBe(1)
    expect(r.out.replace(/\x1b\[[0-9;]*m/g, '')).toMatch(/^7d ▉░░░░░░░ 12% ↻\d+d\d\dh$/)
  })

  it('shows model and context without a previous statusline, and per-model weekly windows from tpq', async () => {
    const dir = bridge(null)
    const now = Date.now()
    writeFileSync(
      join(dir, 'usage.json'),
      JSON.stringify({
        fetchedAt: now - 60_000,
        windows: [
          { key: 'session', pct: 50, resetsAt: now + 3600_000 },
          { key: 'weekly_opus', pct: 80, resetsAt: now + 86400_000 }
        ]
      })
    )
    const resets = Math.floor(now / 1000) + 3 * 86400
    const r = await run(STATUSLINE, dir, {
      model: { display_name: 'Opus 5.5' },
      context_window: { used_percentage: 34.2 },
      rate_limits: { five_hour: { used_percentage: 3, resets_at: resets }, seven_day: { used_percentage: 100, resets_at: resets } }
    })
    expect(r.out.replace(/\x1b\[[0-9;]*m/g, '')).toMatch(/^Opus 5\.5 · 上下文 34% │ 5h ▏░░░░░░░ 3% ↻\S+ · 7d ████████ 100% ↻3d00h · 7d Opus 80%$/)
  })

  it('shows a window that has reset as empty', async () => {
    const dir = bridge(null)
    writeFileSync(join(dir, 'quota.json'), JSON.stringify({ updatedAt: Date.now() - 60_000, fiveHour: { pct: 96, resetsAt: Date.now() - 1000 } }))
    const r = await run(STATUSLINE, dir, {})
    expect(r.out.replace(/\x1b\[[0-9;]*m/g, '')).toBe('5h ░░░░░░░░ 0%')
  })
})

describe('Claude settings edits', () => {
  const user = {
    model: 'opus',
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node notify.cjs' }] }], PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'lint.sh' }] }] },
    statusLine: { type: 'command', command: 'python statusline.py', refreshInterval: 5 }
  }
  const script = 'C:\\Users\\me\\.claude\\tokenpulse\\guard.cjs'

  it('adds the guard alongside existing hooks, idempotently', () => {
    const once = withGuardHooks(user, 'C:\\node\\node.exe', script)
    const twice = withGuardHooks(once, 'C:\\node\\node.exe', script)
    expect(twice).toEqual(once)
    expect(hasGuardHooks(once)).toBe(true)
    expect(once.hooks.PreToolUse).toHaveLength(2)
    expect(once.hooks.PreToolUse[1]).toEqual({
      matcher: '*',
      hooks: [{ type: 'command', command: 'C:\\node\\node.exe', args: [script], timeout: 21600, statusMessage: 'TokenPulse 额度守卫' }]
    })
    expect(once.hooks.UserPromptSubmit).toHaveLength(1)
    expect(once.hooks.Stop).toEqual(user.hooks.Stop)
  })

  it('removes only its own hooks', () => {
    expect(withoutGuardHooks(withGuardHooks(user, 'node', script))).toEqual(user)
    expect(withoutGuardHooks(withGuardHooks({}, 'node', script))).toEqual({})
  })

  it('wraps and restores the previous statusline', () => {
    const { next, prev } = withBridgeStatusline(user, 'C:\\node\\node.exe', 'C:\\x\\tokenpulse\\statusline.cjs')
    expect(prev).toEqual(user.statusLine)
    expect(next.statusLine).toEqual({ type: 'command', command: '"C:\\node\\node.exe" "C:\\x\\tokenpulse\\statusline.cjs"', refreshInterval: 5 })
    expect(hasBridgeStatusline(next)).toBe(true)
    // installing again must not lose the original
    expect(withBridgeStatusline(next, 'node', 'C:\\x\\tokenpulse\\statusline.cjs').prev).toBeNull()
    expect(withoutBridgeStatusline(next, prev)).toEqual(user)
    expect(withoutBridgeStatusline({ statusLine: next.statusLine }, null)).toEqual({})
  })

  it('backs up settings.json before writing and refuses to clobber invalid JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-cs-'))
    const path = join(dir, 'settings.json')
    writeFileSync(path, '\uFEFF' + JSON.stringify(user))
    await editClaudeSettings(path, (c) => withGuardHooks(c, 'node', script))
    expect(JSON.parse(readFileSync(`${path}.tokenpulse.bak`, 'utf8').replace(/^\uFEFF/, ''))).toEqual(user)
    expect(hasGuardHooks(JSON.parse(readFileSync(path, 'utf8')))).toBe(true)
    writeFileSync(path, '{ broken')
    await expect(editClaudeSettings(path, (c) => c)).rejects.toThrow()
    expect(readFileSync(path, 'utf8')).toBe('{ broken')
  })
})

describe('groupPaused', () => {
  it('merges parallel tool calls of one session', () => {
    expect(
      groupPaused([
        { sessionId: 'a', cwd: 'x', since: 5, until: 9, pct: 91 },
        { sessionId: 'a', cwd: 'x', since: 3, until: 9, pct: 92 },
        { sessionId: 'b', cwd: 'y', since: 4, until: null, pct: 90 }
      ])
    ).toEqual([
      { sessionId: 'a', cwd: 'x', since: 3, until: 9, pct: 92 },
      { sessionId: 'b', cwd: 'y', since: 4, until: null, pct: 90 }
    ])
  })
})
