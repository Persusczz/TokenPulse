import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { GuardState, PausedTask, QuotaInfo } from '@shared/types'
import guardSrc from '../bridge/guard.cjs?raw'
import quotaCliSrc from '../bridge/quota.cjs?raw'
import statuslineSrc from '../bridge/statusline.cjs?raw'
import {
  editClaudeSettings,
  hasBridgeStatusline,
  hasGuardHooks,
  readClaudeSettings,
  withBridgeStatusline,
  withGuardHooks,
  withoutBridgeStatusline,
  withoutGuardHooks
} from './claudeSettings'
import { fiveHourWindow, sevenDayWindow } from './quota'

/** Optional guard rules beyond the 5h threshold */
export interface GuardExtra {
  weeklyAt?: number | null
  resumeFrom?: string | null
  resumeTo?: string | null
}

export function findNode(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(process.platform === 'win32' ? 'where.exe' : 'which', ['node'], { windowsHide: true, timeout: 5000 }, (err, out) => {
      const first = String(out ?? '')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find(Boolean)
      resolve(err || !first ? null : first)
    })
  })
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Groups the guard's per-process pause files into one entry per session */
export function groupPaused(files: (PausedTask & { pid?: number })[]): PausedTask[] {
  const by = new Map<string, PausedTask>()
  for (const f of files) {
    const cur = by.get(f.sessionId)
    if (!cur) by.set(f.sessionId, { sessionId: f.sessionId, cwd: f.cwd, since: f.since, until: f.until, pct: f.pct, ...(f.reason ? { reason: f.reason } : {}) })
    else {
      cur.since = Math.min(cur.since, f.since)
      cur.pct = Math.max(cur.pct, f.pct)
    }
  }
  return [...by.values()].sort((a, b) => a.since - b.since)
}

/**
 * Owns the bridge folder (~/.claude/tokenpulse) shared with the Claude Code
 * hook and statusline scripts, and the entries TokenPulse adds to Claude Code's
 * settings.json. Nothing is written to settings.json unless the user turns the
 * guard or the statusline bridge on.
 */
export class GuardService extends EventEmitter {
  readonly dir: string
  readonly settingsPath: string
  state: GuardState
  private nodePath: string | null | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private timer: NodeJS.Timeout | null = null
  private pausedKey = '[]'
  private extra: GuardExtra = {}

  constructor(claudeRoot: string) {
    super()
    this.dir = join(claudeRoot, 'tokenpulse')
    this.settingsPath = join(claudeRoot, 'settings.json')
    this.state = {
      enabled: false,
      pauseAt: 90,
      hookInstalled: false,
      bridgeInstalled: false,
      paused: [],
      nodePath: null,
      claudeSettings: this.settingsPath,
      manualHold: false,
      heldSessions: []
    }
  }

  get statuslinePath(): string {
    return join(this.dir, 'statusline.json')
  }

  /** Serializes edits so toggles in quick succession cannot interleave */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn)
    this.queue = p.catch(() => {})
    return p
  }

  private emitChange(): void {
    this.emit('change', this.state)
  }

  async init(enabled: boolean, pauseAt: number, extra: GuardExtra = {}): Promise<void> {
    const cfg = await readClaudeSettings(this.settingsPath)
    this.state.hookInstalled = hasGuardHooks(cfg)
    this.state.bridgeInstalled = hasBridgeStatusline(cfg)
    // keep installed scripts in step with this version
    if (this.state.hookInstalled || this.state.bridgeInstalled) await this.writeScripts().catch(() => {})
    // a pause set before a restart stays in force
    try {
      const prev = JSON.parse(await readFile(join(this.dir, 'guard.json'), 'utf8'))
      this.state.manualHold = prev.manual === true
      if (Array.isArray(prev.sessions)) this.state.heldSessions = prev.sessions.filter((s: unknown) => typeof s === 'string')
    } catch {
      /* none yet */
    }
    await this.configure(enabled, pauseAt, extra)
    await this.scanPaused()
    this.timer = setInterval(() => void this.scanPaused(), 3000)
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
  }

  private async node(): Promise<string> {
    if (this.nodePath === undefined) this.nodePath = await findNode()
    this.state.nodePath = this.nodePath
    if (!this.nodePath) throw new Error('未找到 Node.js（node.exe）。守卫和状态栏脚本需要 Node.js 运行，请先安装并加入 PATH')
    return this.nodePath
  }

  private async writeScripts(): Promise<void> {
    await mkdir(join(this.dir, 'paused'), { recursive: true })
    await writeFile(join(this.dir, 'guard.cjs'), guardSrc, 'utf8')
    await writeFile(join(this.dir, 'statusline.cjs'), statuslineSrc, 'utf8')
    await writeFile(join(this.dir, 'quota.cjs'), quotaCliSrc, 'utf8')
  }

  private async writeJson(name: string, value: unknown): Promise<void> {
    const tmp = join(this.dir, `${name}.${process.pid}.tmp`)
    await writeFile(tmp, JSON.stringify(value), 'utf8')
    await rename(tmp, join(this.dir, name))
  }

  /** Installs or removes the hook to match the setting, and updates the thresholds the hook reads */
  configure(enabled: boolean, pauseAt: number, extra: GuardExtra = {}): Promise<GuardState> {
    return this.run(async () => {
      this.state.enabled = enabled
      this.state.pauseAt = pauseAt
      this.extra = extra
      return this.apply()
    })
  }

  /** Holds (or releases) every Claude Code task, independent of the quota threshold */
  setManualHold(on: boolean): Promise<GuardState> {
    return this.run(async () => {
      this.state.manualHold = on
      return this.apply()
    })
  }

  /** Holds one session's next tool call (runaway protection) */
  holdSession(sessionId: string): Promise<GuardState> {
    return this.run(async () => {
      if (sessionId && !this.state.heldSessions.includes(sessionId)) this.state.heldSessions = [...this.state.heldSessions, sessionId]
      return this.apply()
    })
  }

  releaseSessions(sessionId?: string): Promise<GuardState> {
    return this.run(async () => {
      this.state.heldSessions = sessionId ? this.state.heldSessions.filter((s) => s !== sessionId) : []
      return this.apply()
    })
  }

  /**
   * Writes guard.json and keeps the hook installed while anything needs it
   * (the threshold, a manual hold or a held session). A hook installed now
   * only reaches Claude Code sessions started afterwards.
   */
  private async apply(): Promise<GuardState> {
    const s = this.state
    const cfg = {
      enabled: s.enabled,
      pauseAt: s.pauseAt,
      weeklyAt: this.extra.weeklyAt ?? null,
      resumeFrom: this.extra.resumeFrom ?? null,
      resumeTo: this.extra.resumeTo ?? null,
      manual: s.manualHold,
      sessions: s.heldSessions
    }
    const want = s.enabled || s.manualHold || s.heldSessions.length > 0
    try {
      if (want) {
        const node = await this.node()
        await this.writeScripts()
        await this.writeJson('guard.json', cfg)
        if (!s.hookInstalled) {
          await editClaudeSettings(this.settingsPath, (c) => withGuardHooks(c, node, join(this.dir, 'guard.cjs')))
          s.hookInstalled = true
          s.hookFresh = true
        }
      } else {
        if (existsSync(this.dir)) await this.writeJson('guard.json', cfg)
        if (s.hookInstalled) {
          await editClaudeSettings(this.settingsPath, withoutGuardHooks)
          s.hookInstalled = false
        }
      }
      delete s.error
    } catch (e) {
      s.error = (e as Error).message
    }
    this.emitChange()
    return s
  }

  /** Points Claude Code's statusline at the bridge (keeping the previous one running inside it), or restores it */
  setBridge(on: boolean): Promise<GuardState> {
    return this.run(async () => {
      const prevPath = join(this.dir, 'statusline-prev.json')
      try {
        if (on) {
          const node = await this.node()
          await this.writeScripts()
          let prev: Record<string, any> | null = null
          await editClaudeSettings(this.settingsPath, (c) => {
            const r = withBridgeStatusline(c, node, join(this.dir, 'statusline.cjs'))
            prev = r.prev
            return r.next
          })
          if (prev) await this.writeJson('statusline-prev.json', prev)
          this.state.bridgeInstalled = true
        } else {
          let prev: Record<string, any> | null = null
          try {
            prev = JSON.parse(await readFile(prevPath, 'utf8'))
          } catch {
            /* there was no statusline before */
          }
          await editClaudeSettings(this.settingsPath, (c) => withoutBridgeStatusline(c, prev))
          await unlink(prevPath).catch(() => {})
          this.state.bridgeInstalled = false
        }
        delete this.state.error
      } catch (e) {
        this.state.error = (e as Error).message
      }
      this.emitChange()
      return this.state
    })
  }

  /** Publishes the current reading for the hook, which may run while TokenPulse is closed */
  async publishQuota(info: QuotaInfo): Promise<void> {
    if (!existsSync(this.dir) || info.status === 'loading' || info.status === 'disabled') return
    const ms = (iso: string | null) => (iso ? Date.parse(iso) : null)
    const pick = (w: ReturnType<typeof fiveHourWindow>) => (w ? { pct: w.utilization, resetsAt: ms(w.resetsAt) } : null)
    await this.writeJson('quota.json', {
      updatedAt: info.fetchedAt ?? Date.now(),
      origin: info.origin ?? null,
      plan: info.plan ?? null,
      fiveHour: pick(fiveHourWindow(info.windows)),
      sevenDay: pick(sevenDayWindow(info.windows)),
      // every window (per-model weekly too) for the statusline bridge and `tpq`
      windows: info.windows.map((w) => ({ key: w.key, label: w.label, pct: w.utilization, resetsAt: ms(w.resetsAt) }))
    }).catch(() => {})
  }

  /** Reads the guard's pause files, dropping those whose hook process is gone (e.g. the user pressed Esc) */
  async scanPaused(): Promise<void> {
    const dir = join(this.dir, 'paused')
    let names: string[] = []
    try {
      names = (await readdir(dir)).filter((n) => n.endsWith('.json'))
    } catch {
      /* nothing paused */
    }
    const files: (PausedTask & { pid?: number })[] = []
    for (const n of names) {
      try {
        const f = JSON.parse(await readFile(join(dir, n), 'utf8'))
        if (typeof f.pid === 'number' && !alive(f.pid)) {
          await unlink(join(dir, n)).catch(() => {})
          continue
        }
        files.push({
          sessionId: String(f.sessionId ?? ''),
          cwd: String(f.cwd ?? ''),
          since: Number(f.since) || Date.now(),
          until: Number(f.until) || null,
          pct: Number(f.pct) || 0,
          reason: f.reason === 'week' || f.reason === 'window' || f.reason === 'manual' ? f.reason : 'five'
        })
      } catch {
        /* being written */
      }
    }
    const paused = groupPaused(files)
    const key = JSON.stringify(paused)
    if (key === this.pausedKey) return
    const before = this.state.paused
    this.pausedKey = key
    this.state.paused = paused
    if (!before.length && paused.length) this.emit('paused', paused)
    if (before.length && !paused.length) this.emit('resumed', before)
    this.emitChange()
  }
}
