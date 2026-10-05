import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { appendFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { cleanCompactAt, compactText } from '@shared/compact'
import type {
  ScheduledTask,
  SourceView,
  TaskAction,
  TaskAttempt,
  TaskCheck,
  TaskEffort,
  TaskFailure,
  TaskInput,
  TaskLogLine,
  TaskMove,
  TaskPatch,
  TaskQueueState,
  TaskToolState,
  UsageSource
} from '@shared/types'
import runnerSrc from '../bridge/taskrunner.cjs?raw'
import { CODEX_WINDOW } from './context'

/** a little after the reset, so the new window has really opened */
export const RESET_GRACE_MS = 60_000
/** a check command gets this long */
export const CHECK_TIMEOUT_MS = 10 * 60_000
/** finished tasks kept in the history (older ones go, with their logs) */
export const HISTORY_KEEP = 300
/** a run that ran out of quota waits for the refresh at most this often */
const QUOTA_WAITS = 3

export interface WindowInfo {
  /** the 5h window from official data */
  five: { pct: number; resetsAt: number | null } | null
  /** the 5h window seen in local logs */
  localEnd: number | null
}

const TOOLS: UsageSource[] = ['claude', 'codex']
const TRIGGERS: ScheduledTask['trigger'][] = ['reset', 'now', 'time', 'manual']
const PERMISSIONS: ScheduledTask['permission'][] = ['inherit', 'auto', 'acceptEdits', 'bypassPermissions', 'plan']

/**
 * Earliest start for a task. 'reset' waits for the current 5h window to end;
 * with nothing used in the window yet there is nothing to wait for.
 */
export function computeNotBefore(trigger: ScheduledTask['trigger'], at: number | null, now: number, w: WindowInfo): number {
  if (trigger === 'now' || trigger === 'manual') return now
  if (trigger === 'time') return at ?? now
  const r = w.five?.resetsAt
  if (w.five && r && r > now && w.five.pct > 0) return r + RESET_GRACE_MS
  if (!w.five && w.localEnd && w.localEnd > now) return w.localEnd + RESET_GRACE_MS
  return now
}

/** Why a queued task is not ready (its folder being busy aside), or 'ready' */
export type Readiness = 'ready' | 'time' | 'manual' | 'parent' | 'parent-failed'

export function readiness(t: ScheduledTask, all: ScheduledTask[], now: number): Readiness {
  if (t.force) return 'ready'
  // the next try of a run that has started: only its time counts
  if (t.pending) return t.notBefore <= now ? 'ready' : 'time'
  const parent = t.parentId ? all.find((x) => x.id === t.parentId) : undefined
  if (parent) {
    // a repeating parent is queued again after each run: its last success counts
    if (parent.status === 'done' || (parent.doneAt && parent.doneAt >= (t.queuedAt ?? 0))) return 'ready'
    return parent.status === 'failed' || parent.status === 'cancelled' ? 'parent-failed' : 'parent'
  }
  if (t.trigger === 'manual') return 'manual'
  return t.notBefore <= now ? 'ready' : 'time'
}

const byOrder = (a: ScheduledTask, b: ScheduledTask) => (a.order ?? 0) - (b.order ?? 0) || a.notBefore - b.notBefore || a.createdAt - b.createdAt

/** The next queued task whose time has come (queue order first) */
export function nextDue(tasks: ScheduledTask[], now: number): ScheduledTask | undefined {
  return tasks.filter((t) => t.status === 'queued' && readiness(t, tasks, now) === 'ready').sort(byOrder)[0]
}

/** One folder of one tool: its tasks run one after another, other folders alongside */
export function laneKey(tool: UsageSource | undefined, cwd: string): string {
  let p = resolve(cwd || homedir()).replace(/[\\/]+$/, '')
  if (process.platform === 'win32') p = p.toLowerCase()
  return `${tool ?? 'claude'}:${p}`
}

const UNATTENDED =
  '这是 TokenPulse 在订阅额度刷新时自动发起的无人值守任务，没有人会回答问题：不要等待确认，遇到不确定的地方按最合理的方式处理并说明；完成后用几句话总结做了什么、还有什么没做。'

/**
 * `claude -p` with the stream TokenPulse reads. `resume`: true carries on the
 * folder's latest conversation in a fork; an id carries on that conversation
 * (in a fork when `fork`, as for a follow-up).
 */
export function claudeArgs(
  t: Pick<ScheduledTask, 'prompt' | 'permission' | 'model' | 'sessionId'> & Partial<Pick<ScheduledTask, 'budgetUsd' | 'fallbackModel' | 'effort'>>,
  o: { resume?: boolean | string; fork?: boolean; partial?: boolean; stdinPrompt?: boolean } = {}
): string[] {
  const args = ['-p', ...(o.stdinPrompt ? [] : [t.prompt]), '--output-format', 'stream-json', '--verbose', '--append-system-prompt', UNATTENDED]
  if (o.partial) args.push('--include-partial-messages')
  // a fork: never writes into a conversation the user may still have open
  if (typeof o.resume === 'string') args.push('--resume', o.resume, ...(o.fork ? ['--fork-session'] : []))
  else if (o.resume) args.push('--continue', '--fork-session')
  else if (t.sessionId) args.push('--session-id', t.sessionId)
  if (t.permission !== 'inherit') args.push('--permission-mode', t.permission)
  if (t.model) args.push('--model', t.model)
  // Claude Code refuses a fallback that is the model itself
  if (t.fallbackModel && t.fallbackModel !== t.model) args.push('--fallback-model', t.fallbackModel)
  if (t.budgetUsd) args.push('--max-budget-usd', String(t.budgetUsd))
  if (t.effort) args.push('--effort', t.effort)
  // without it Claude Code leaves the thinking blocks empty (signature only); older versions ignore the key
  args.push('--settings', JSON.stringify({ showThinkingSummaries: true }))
  return args
}

/**
 * `codex exec --json`, the prompt read from stdin; `resume` carries on a
 * session (by id, or the folder's latest). `compactAt`: the token count at
 * which Codex compacts the conversation.
 */
export function codexArgs(t: Pick<ScheduledTask, 'permission' | 'model'> & { effort?: TaskEffort | null; compactAt?: number | null }, o: { resume?: string | boolean } = {}): string[] {
  // reasoning summaries, so the thinking shows (a bare word is taken as a string by -c)
  const args = ['exec', '--json', '--skip-git-repo-check', '-c', 'model_reasoning_summary=detailed']
  // Codex tops out at xhigh
  if (t.effort) args.push('-c', `model_reasoning_effort=${t.effort === 'max' ? 'xhigh' : t.effort}`)
  if (t.compactAt) args.push('-c', `model_auto_compact_token_limit=${Math.round(t.compactAt)}`)
  if (t.model) args.push('-m', t.model)
  if (t.permission === 'plan') args.push('-s', 'read-only')
  else if (t.permission === 'acceptEdits' || t.permission === 'auto') args.push('-s', 'workspace-write')
  else if (t.permission === 'bypassPermissions') args.push('--dangerously-bypass-approvals-and-sandbox')
  args.push(...(typeof o.resume === 'string' ? ['resume', o.resume, '-'] : o.resume ? ['resume', '--last', '-'] : ['-']))
  return args
}

/** what goes to Codex on stdin: the task, told nobody is watching */
export const codexPrompt = (prompt: string) => `${prompt.trim()}\n\n（${UNATTENDED}）`

/**
 * What Claude Code keeps free under its compaction window: room for the
 * summary's output (up to 20K) and a 13K buffer. Set to a window of N, it
 * compacts at about N minus this.
 */
export const CLAUDE_COMPACT_RESERVE = 33_000
/** Claude Code takes a compaction window between these */
const CLAUDE_COMPACT_WINDOW = { min: 100_000, max: 1_000_000 }

/**
 * Extra environment for a Claude run: auto-compact switched off, or moved
 * earlier: to a share of the model's window (CLAUDE_AUTOCOMPACT_PCT_OVERRIDE),
 * or to a token count, through the window it compacts in. Claude Code 2.1
 * left on its 'auto' window only compacts once the API says the context is
 * full; a window set through CLAUDE_CODE_AUTO_COMPACT_WINDOW makes it compact
 * at the threshold, so a share comes with the largest window (Claude Code
 * keeps the smaller of it and the model's own).
 */
export function taskEnv(t: Pick<ScheduledTask, 'tool' | 'autoCompact'> & { compactAt?: ScheduledTask['compactAt'] }): Record<string, string> {
  if ((t.tool ?? 'claude') !== 'claude') return {}
  if (t.autoCompact === false) return { DISABLE_AUTO_COMPACT: '1' }
  const c = t.compactAt
  if (c?.unit === 'pct') return { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: String(c.value), CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(CLAUDE_COMPACT_WINDOW.max) }
  if (c?.unit === 'tokens') {
    const w = Math.min(CLAUDE_COMPACT_WINDOW.max, Math.max(CLAUDE_COMPACT_WINDOW.min, c.value + CLAUDE_COMPACT_RESERVE))
    return { CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(w) }
  }
  return {}
}

/** The token count a Codex run compacts at, for a model with this window */
export function codexCompactLimit(c: ScheduledTask['compactAt'], window: number): number | null {
  if (!c) return null
  return c.unit === 'tokens' ? c.value : Math.round((window * c.value) / 100)
}

/** How to start a CLI: an npm .cmd shim needs cmd.exe, a real binary runs directly */
export function cliCommand(path: string, args: string[]): { cmd: string; args: string[]; verbatim: boolean } {
  if (!/\.(cmd|bat)$/i.test(path)) return { cmd: path, args, verbatim: false }
  const q = (a: string) => (/^[\w.:\\/=@+-]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`)
  return { cmd: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${[`"${path}"`, ...args.map(q)].join(' ')}"`], verbatim: true }
}

export interface StreamResult {
  ok: boolean
  text: string
  costUsd: number | null
  turns: number | null
  /** token counts (Codex reports them instead of a cost) */
  usage?: { input: number; cached: number; output: number }
  /** Claude Code's reason for a failed result (error_max_budget_usd, error_max_turns, …) */
  subtype?: string
}

const SUBTYPE_TEXT: Record<string, string> = {
  error_max_budget_usd: '达到了这个任务的花费上限',
  error_max_turns: '达到了最大轮数',
  error_during_execution: '执行中出错'
}

/** Sorts a failed try by its message: what it is decides whether to retry, wait for the quota, or stop */
export function classifyFailure(error: string | null | undefined, o: { subtype?: string; timedOut?: boolean; stopped?: boolean } = {}): TaskFailure {
  const e = error ?? ''
  if (o.timedOut) return 'timeout'
  // closing the task window is the user's way of stopping it
  if (o.stopped || e === '已手动停止' || /任务窗口被关闭/.test(e)) return 'stopped'
  if (o.subtype === 'error_max_budget_usd' || /max[_-]?budget|花费上限/i.test(e)) return 'budget'
  if (/工作目录不存在|无法启动|没能打开任务窗口|没有找到 \w+ 命令|ENOENT/i.test(e)) return 'setup'
  if (/usage limit|limit reached|hit your (usage )?limit|rate[_ ]?limit|too many requests|\b429\b|insufficient_quota|额度已用完|额度用完/i.test(e)) return 'quota'
  if (/overloaded|\b5(00|02|03|04|29)\b|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network error|fetch failed|stream (disconnected|error)|connection (reset|refused|error)|Internal server error|API Error/i.test(e)) return 'transient'
  return 'other'
}

/** the end of a command's output: its last lines, at most n characters */
export function tailOf(text: string, lines = 40, n = 2000): string {
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r\n?/g, '\n')
  const kept = clean.split('\n').filter((l) => l.trim()).slice(-lines).join('\n')
  return kept.length > n ? `…${kept.slice(-n)}` : kept
}

/** what the next try is told, when it carries on the conversation of the try that failed */
export function retryPrompt(kind: TaskFailure, o: { reason?: string | null; verify?: string | null; check?: TaskCheck | null; timeoutMin?: number | null }): string {
  const why = short(flat(o.reason ?? ''), 300)
  switch (kind) {
    case 'check':
      return `刚才的结果没有通过检查。检查命令：${o.verify}（退出代码 ${o.check?.code ?? '?'}）。输出的最后部分：\n\n${o.check?.tail || '（没有输出）'}\n\n请找出没通过的原因并修好，修完后自己再跑一遍这个检查，确认通过后总结改了什么。`
    case 'timeout':
      return `上一次执行超过了 ${o.timeoutMin ?? '?'} 分钟的时限，被停下了。请看看已经做到哪一步，接着把剩下的部分做完，抓紧时间，最后总结。`
    case 'quota':
      return '额度已经刷新。请看看上次做到了哪一步，接着把任务完成。'
    case 'transient':
      return `上一次执行因为网络或服务的问题中断了（${why}）。请看看已经做到哪一步，接着完成任务。`
    default:
      return `上一次执行没有成功完成（${why || '没有给出原因'}）。请检查现在的状态，想想哪里出了问题，换一种做法把任务完成。`
  }
}

const FAILURE_TEXT: Record<TaskFailure, string> = {
  stopped: '被手动停止',
  quota: '额度用完',
  transient: '网络或服务出错',
  timeout: '超时',
  check: '检查没通过',
  budget: '到了花费上限',
  setup: '无法启动',
  other: '没有完成'
}

/** models a ChatGPT account can run through Codex, tried in turn when the chosen one is refused */
export const CODEX_FALLBACKS = ['gpt-5.5', 'gpt-5.4', 'gpt-5']
/** Codex refuses some models for ChatGPT accounts; the name is in the message */
export const unsupportedModel = (error: string | null | undefined): string | null =>
  /The '([^']+)' model is not supported when using Codex with a ChatGPT account/i.exec(error ?? '')?.[1] ?? null

/** the window's own end-of-run record */
export interface ExitRecord {
  code: number
  stopped: boolean
  error: string
}

/** how a try ended */
interface Outcome {
  ok: boolean
  error?: string | null
  result?: StreamResult
  /** known without reading the message */
  failure?: TaskFailure
  check?: TaskCheck
}

/** the failures of some tries, in words, each kind once */
const triedText = (tries: TaskAttempt[]) => [...new Set(tries.map((a) => (a.failure === 'setup' ? '换了模型' : a.failure ? FAILURE_TEXT[a.failure] : '没有完成')))].join('、')

const TRY_TEXT: Record<TaskAttempt['kind'], string> = { run: '重新开始', retry: '失败后重试', fix: '修正检查没通过的地方', resume: '额度刷新后接着做' }

const clock = (t: number) => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const flat = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim()

function toolText(name: string, input: any): string {
  const detail = input?.command ?? input?.file_path ?? input?.path ?? input?.pattern ?? input?.description ?? input?.url ?? input?.query ?? ''
  return detail ? `${name}：${short(flat(detail), 90)}` : name
}

/** the message inside Codex's JSON error strings */
function codexMessage(m: unknown): string {
  const s = typeof m === 'string' ? m : ((m as { message?: string } | null)?.message ?? '')
  try {
    const j = JSON.parse(s)
    return j?.error?.message ?? j?.message ?? s
  } catch {
    return s
  }
}

/**
 * One line of a task log as readable entries: Claude Code's stream-json,
 * Codex's exec --json, or the task window's own start/exit records.
 */
export function parseStreamLine(line: string, t = Date.now()): { logs: TaskLogLine[]; result?: StreamResult; session?: string; exit?: ExitRecord } {
  let ev: any
  try {
    ev = JSON.parse(line)
  } catch {
    return line.trim() ? { logs: [{ t, kind: 'system', text: short(line.trim(), 200) }] } : { logs: [] }
  }
  switch (ev?.type) {
    case 'tp_exit': {
      const exit: ExitRecord = { code: Number(ev.code ?? -1), stopped: !!ev.stopped, error: String(ev.error ?? '') }
      return { logs: exit.error && !exit.stopped ? [{ t, kind: 'error', text: short(exit.error, 300) }] : [], exit }
    }
    // TokenPulse's own records: a try starting, the check after it
    case 'tp_try':
      return { logs: [{ t, kind: 'system', text: `第 ${ev.n} 次尝试${ev.why ? ` · ${ev.why}` : ''}` }] }
    case 'tp_check': {
      if (ev.phase === 'start') return { logs: [{ t, kind: 'system', text: `检查：${short(flat(ev.cmd), 120)}` }] }
      const secs = Math.max(1, Math.round(Number(ev.ms ?? 0) / 1000))
      if (ev.code === 0) return { logs: [{ t, kind: 'result', text: `检查通过 · ${secs} 秒` }] }
      const last = String(ev.tail ?? '').split('\n').filter((l) => l.trim()).pop() ?? ''
      return { logs: [{ t, kind: 'error', text: short(`检查没通过（退出 ${ev.code}）${last ? `：${flat(last)}` : ''}`, 300) }] }
    }
    case 'system':
      if (ev.subtype === 'init') return { logs: [{ t, kind: 'system', text: `开始 · ${ev.model ?? ''} · ${ev.cwd ?? ''}`.trim() }], session: ev.session_id }
      if (ev.subtype === 'compact_boundary') return { logs: [{ t, kind: 'system', text: '上下文已自动压缩' }] }
      if (ev.subtype === 'status' && ev.status === 'compacting') return { logs: [{ t, kind: 'system', text: '正在压缩上下文…' }] }
      if (ev.subtype === 'status' && ev.compact_result === 'failed') return { logs: [{ t, kind: 'system', text: `这次没有压缩${ev.compact_error === 'too_few_groups' ? '：对话还太短' : ev.compact_error ? `（${ev.compact_error}）` : ''}` }] }
      return { logs: [] }
    case 'assistant': {
      const logs: TaskLogLine[] = []
      for (const c of Array.isArray(ev.message?.content) ? ev.message.content : []) {
        if (c.type === 'thinking' && c.thinking?.trim()) logs.push({ t, kind: 'thinking', text: short(c.thinking.trim(), 600) })
        if (c.type === 'text' && c.text?.trim()) logs.push({ t, kind: 'text', text: short(c.text.trim(), 400) })
        if (c.type === 'tool_use') logs.push({ t, kind: 'tool', text: toolText(c.name, c.input) })
      }
      return { logs }
    }
    case 'result': {
      const ok = ev.subtype === 'success' && !ev.is_error
      const text = typeof ev.result === 'string' ? ev.result : ''
      return {
        logs: [{ t, kind: ok ? 'result' : 'error', text: short(text || SUBTYPE_TEXT[ev.subtype] || ev.subtype || '结束', 400) }],
        result: {
          ok,
          text,
          costUsd: typeof ev.total_cost_usd === 'number' ? ev.total_cost_usd : null,
          turns: typeof ev.num_turns === 'number' ? ev.num_turns : null,
          ...(ok ? {} : { subtype: String(ev.subtype ?? '') })
        }
      }
    }
    // ---- Codex
    case 'thread.started':
      return { logs: [{ t, kind: 'system', text: '开始 · Codex' }], session: ev.thread_id }
    case 'item.completed': {
      const it = ev.item ?? {}
      if (it.type === 'reasoning' && it.text?.trim()) return { logs: [{ t, kind: 'thinking', text: short(it.text.trim(), 600) }] }
      if (it.type === 'agent_message' && it.text?.trim()) return { logs: [{ t, kind: 'text', text: short(it.text.trim(), 400) }] }
      if (it.type === 'command_execution') return { logs: [{ t, kind: 'tool', text: `命令：${short(flat(it.command), 90)}${typeof it.exit_code === 'number' && it.exit_code ? `（退出 ${it.exit_code}）` : ''}` }] }
      if (it.type === 'file_change') return { logs: [{ t, kind: 'tool', text: `改文件：${short((it.changes ?? []).map((c: { path: string }) => c.path).join('、'), 90)}` }] }
      if (it.type === 'mcp_tool_call') return { logs: [{ t, kind: 'tool', text: `${it.server ?? ''}.${it.tool ?? ''}` }] }
      if (it.type === 'web_search') return { logs: [{ t, kind: 'tool', text: `搜索：${short(flat(it.query), 90)}` }] }
      if (it.type === 'error' && it.message) return { logs: [{ t, kind: 'system', text: short(it.message, 200) }] }
      return { logs: [] }
    }
    case 'turn.completed': {
      const u = ev.usage ?? {}
      const n = (v: unknown) => (typeof v === 'number' && v > 0 ? v : 0)
      return {
        logs: [{ t, kind: 'result', text: '完成' }],
        result: { ok: true, text: '', costUsd: null, turns: 1, usage: { input: n(u.input_tokens), cached: n(u.cached_input_tokens), output: n(u.output_tokens) } }
      }
    }
    case 'turn.failed': {
      const msg = codexMessage(ev.error) || '任务没有成功完成'
      return { logs: [{ t, kind: 'error', text: short(msg, 400) }], result: { ok: false, text: msg, costUsd: null, turns: null } }
    }
    case 'error':
      return { logs: [{ t, kind: 'error', text: short(codexMessage(ev.message), 300) }] }
  }
  return { logs: [] }
}

/** Claude Code refuses to start inside another session; a task is its own session */
export function cleanEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(env)) if (!/^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_PID|ELECTRON_RUN_AS_NODE)$/.test(k)) out[k] = v
  return out
}

function where(name: string): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(process.platform === 'win32' ? 'where.exe' : 'which', [name], { windowsHide: true, timeout: 5000 }, (err, out) => {
      resolve(
        err
          ? []
          : String(out ?? '')
              .split(/\r?\n/)
              .map((s) => s.trim())
              .filter(Boolean)
      )
    })
  })
}

/** native binary first, then an npm .cmd shim; Windows can't run the extension-less shell shim */
function pickCli(lines: string[]): string | null {
  if (process.platform !== 'win32') return lines[0] ?? null
  return lines.find((l) => /\.exe$/i.test(l)) ?? lines.find((l) => /\.(cmd|bat)$/i.test(l)) ?? null
}

export async function findClaude(): Promise<string | null> {
  return pickCli(await where('claude'))
}

/** Codex is often installed under an npm prefix that is not on PATH */
export async function findCodex(): Promise<string | null> {
  const found = pickCli(await where('codex'))
  if (found) return found
  if (process.platform !== 'win32') return null
  const home = homedir()
  const guesses = [join(home, '.npm-global', 'codex.cmd'), join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'npm', 'codex.cmd')]
  return guesses.find((p) => existsSync(p)) ?? null
}

/** Opens a console window running the task window script for one folder */
export function openTerminal(o: { node: string; script: string; laneDir: string; cwd: string; title: string }): void {
  const safe = (s: string) => s.replace(/["%^&|<>]/g, '')
  const line = `"start "${safe(o.title)}" /D "${o.cwd}" "${o.node}" "${o.script}" "${o.laneDir}""`
  spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', line], { windowsHide: true, detached: true, stdio: 'ignore', windowsVerbatimArguments: true, env: cleanEnv(process.env) }).unref()
}

/** the CLI starts children of its own: take the whole tree down */
function killTree(pid: number): void {
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
  else
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

interface Deps {
  window(tool: UsageSource): WindowInfo
  /** why a due task of this tool must wait, or null to go */
  blocker(tool: UsageSource): string | null
  claude(): Promise<string | null>
  codex?(): Promise<string | null>
  /** Node.js for the task window; none = runs stay hidden */
  node?(): Promise<string | null>
  /** visible terminal windows wanted (the setting) */
  terminal?(): boolean
  /** the folder's latest conversation of this tool in the logs, to carry on */
  lastSession?(tool: UsageSource, cwd: string): { id: string; at: number } | null
  /** command and leading args used to run the CLI (tests swap in a fake) */
  command?: (cliPath: string, tool: UsageSource) => { cmd: string; pre: string[] }
  /** opens the task window (tests run the script hidden) */
  openTerminal?: typeof openTerminal
  /** API-equivalent cost of a run that reported tokens instead of a cost (Codex) */
  price?(t: ScheduledTask, usage: NonNullable<StreamResult['usage']>): number | null
  /** wait before a retry, ms (tests make it short) */
  retryDelay?(failure: TaskFailure, tries: number): number
  /** the context window of a Codex model (null: the config's default), for a compaction point given as a share */
  codexWindow?(model: string | null): number
}

/** the task window's heartbeat */
interface Beat {
  pid: number
  busy: string | null
  /** the CLI it is running */
  child?: number | null
  at: number
}

interface Run {
  task: ScheduledTask
  lane: string
  mode: 'terminal' | 'background'
  logFile: string
  stopping: boolean
  result?: StreamResult
  lastText: string | null
  // background
  proc?: ChildProcess
  // terminal
  laneDir?: string
  offset: number
  partial: string
  launchedAt: number
  /** the window has taken the job */
  seen: boolean
  relaunched: boolean
  /** the model asked for (null: the CLI's own default) */
  model?: string | null
  /** the CLI reported its conversation id in this try, so a retry can carry it on */
  sawSession: boolean
  /** what this try carried on: a conversation id, the folder's latest (true), or nothing */
  resume?: string | boolean | null
  /** the time limit of this try */
  timer?: NodeJS.Timeout
  timedOut?: boolean
  /** the check after a successful run has started; its process while it runs */
  checked?: boolean
  checkProc?: ChildProcess
  /** the last heartbeat that could be read: a read can fail while the window replaces the file */
  beat?: Beat
  /** the window's own process, from its start record */
  runnerPid?: number
  /** polls in a row that found neither the window nor its CLI alive */
  gone?: number
}

const EFFORTS: TaskEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(hi, Math.max(lo, v)) : null)
const modelName = (v: unknown): string | null => (typeof v === 'string' && /^[\w.[\]-]{1,60}$/.test(v.trim()) ? v.trim() : null)

/** The options of a task, cleaned; only the keys given are set */
function fields(input: Partial<TaskInput>): Partial<ScheduledTask> {
  const f: Partial<ScheduledTask> = {}
  if (typeof input.prompt === 'string' && input.prompt.trim()) f.prompt = input.prompt.trim()
  if (typeof input.cwd === 'string' && input.cwd.trim()) f.cwd = input.cwd.trim()
  if ('repeat' in input) f.repeat = !!input.repeat
  if (input.permission && PERMISSIONS.includes(input.permission)) f.permission = input.permission
  if ('model' in input) f.model = typeof input.model === 'string' && input.model.trim() ? input.model.trim() : null
  if ('continue' in input) f.continue = !!input.continue
  if ('autoCompact' in input) f.autoCompact = input.autoCompact !== false
  if ('compactAt' in input) f.compactAt = cleanCompactAt(input.compactAt)
  if ('retries' in input) f.retries = Math.round(num(input.retries, 0, 5) ?? 0)
  if ('verify' in input) f.verify = typeof input.verify === 'string' && input.verify.trim() ? input.verify.trim().slice(0, 500) : null
  if ('timeoutMin' in input) f.timeoutMin = num(input.timeoutMin, 1, 720) && Math.round(num(input.timeoutMin, 1, 720)!)
  if ('budgetUsd' in input) f.budgetUsd = num(input.budgetUsd, 0.01, 1000) && Math.round(num(input.budgetUsd, 0.01, 1000)! * 100) / 100
  if ('fallbackModel' in input) f.fallbackModel = modelName(input.fallbackModel)
  if ('effort' in input) f.effort = EFFORTS.includes(input.effort as TaskEffort) ? input.effort! : null
  return f
}

/**
 * The queue of refresh tasks, persisted to a JSON file. Tasks of one folder
 * (and tool) run one after another; different folders run side by side, each
 * in its own terminal window when Node.js is available, otherwise hidden.
 * Each run is logged to <logDir>/<id>.jsonl. Emits 'change' with the queue
 * state, and 'started' / 'finished' with the task.
 */
export class TaskService extends EventEmitter {
  tasks: ScheduledTask[] = []
  private runs = new Map<string, Run>()
  private cli: Partial<Record<UsageSource, string | null>> = {}
  private nodePath: string | null = null
  private background = false
  private ticking = false
  private again = false
  private pollTimer: NodeJS.Timeout | null = null
  private polling = false
  /** Codex models the ChatGPT account refused, and whether the config's default is one */
  private codexRefused = new Set<string>()
  private codexDefaultRefused = false
  /** a write of tasks.json under way, and another one wanted after it */
  private saving = false
  private dirty = false
  /** a coalesced 'change' for activity updates */
  private soonTimer: NodeJS.Timeout | null = null
  /** parsed logs, read on from where the last read stopped */
  private logCache = new Map<string, { size: number; partial: string; lines: TaskLogLine[] }>

  constructor(
    private file: string,
    private logDir: string,
    private deps: Deps
  ) {
    super()
  }

  async load(): Promise<void> {
    try {
      const list = JSON.parse(await readFile(this.file, 'utf8'))
      if (Array.isArray(list)) this.tasks = list
    } catch {
      /* none yet */
    }
    // tasks saved by older versions
    this.tasks.sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt))
    this.tasks.forEach((t, i) => {
      t.tool ??= 'claude'
      t.order ??= i
      t.parentId ??= null
      t.continue ??= false
      t.autoCompact ??= true
      t.compactAt ??= null
      t.queuedAt ??= t.createdAt
      t.doneAt ??= t.status === 'done' ? t.finishedAt : null
      t.mode ??= null
      t.retries ??= 0
    })
    // a long history: the oldest finished tasks go, with their logs
    const old = this.tasks
      .filter((t) => t.status === 'done' || t.status === 'failed' || t.status === 'cancelled')
      .sort((a, b) => (b.finishedAt ?? b.createdAt) - (a.finishedAt ?? a.createdAt))
      .slice(HISTORY_KEEP)
    if (old.length) {
      const gone = new Set(old)
      this.tasks = this.tasks.filter((t) => !gone.has(t))
      for (const t of this.tasks) if (t.parentId && old.some((o) => o.id === t.parentId)) t.parentId = null
      for (const t of old) void rm(join(this.logDir, `${t.id}.jsonl`), { force: true })
      this.persist()
    }
    for (const t of this.tasks) {
      if (t.status !== 'running') continue
      // a task window keeps going without TokenPulse: follow it again
      if (t.mode === 'terminal') this.follow(t)
      else Object.assign(t, { status: 'failed', error: 'TokenPulse 退出时任务被中断', finishedAt: Date.now(), activity: null })
    }
    try {
      const m = JSON.parse(await readFile(this.codexFile, 'utf8'))
      this.codexRefused = new Set(Array.isArray(m.refused) ? m.refused : [])
      this.codexDefaultRefused = !!m.defaultRefused
    } catch {
      /* nothing learned yet */
    }
    const [claude, codex, node] = await Promise.all([this.deps.claude(), this.deps.codex?.() ?? null, this.deps.node?.() ?? null])
    this.cli = { claude, codex }
    this.nodePath = node
  }

  private get codexFile(): string {
    return join(this.logDir, 'codex-models.json')
  }

  /** the model a Codex run really uses: a refused one is swapped for the first fallback the account takes */
  private codexModel(t: ScheduledTask): string | null {
    const refused = t.model ? this.codexRefused.has(t.model) : this.codexDefaultRefused
    if (!refused) return t.model
    return CODEX_FALLBACKS.find((m) => !this.codexRefused.has(m)) ?? t.model
  }

  /** one write at a time; changes made meanwhile go out in the next one */
  private persist(): void {
    if (this.saving) return void (this.dirty = true)
    this.saving = true
    void writeFile(this.file, JSON.stringify(this.tasks, null, 1), 'utf8')
      .catch(() => {})
      .finally(() => {
        this.saving = false
        if (this.dirty) {
          this.dirty = false
          this.persist()
        }
      })
  }

  /** on quit: whatever is not on disk yet */
  flush(): void {
    try {
      writeFileSync(this.file, JSON.stringify(this.tasks, null, 1), 'utf8')
    } catch {
      /* nothing more to do */
    }
  }

  /** activity changes many times a second while a task streams: tell the windows at most every 250 ms */
  private soon(): void {
    if (this.soonTimer) return
    this.soonTimer = setTimeout(() => {
      this.soonTimer = null
      this.emit('change', this.state())
    }, 250)
  }

  private terminalOn(): boolean {
    return !this.background && process.platform === 'win32' && !!this.nodePath && (this.deps.terminal?.() ?? true)
  }

  private busyLanes(): Set<string> {
    return new Set([...this.runs.values()].map((r) => r.lane))
  }

  state(now = Date.now()): TaskQueueState {
    const busy = this.busyLanes()
    const tools = {} as Record<UsageSource, TaskToolState>
    for (const tool of TOOLS) {
      const w = this.deps.window(tool)
      const nextReset = w.five?.resetsAt && w.five.resetsAt > now ? w.five.resetsAt : w.localEnd && w.localEnd > now ? w.localEnd : null
      const due = this.tasks.some((t) => (t.tool ?? 'claude') === tool && t.status === 'queued' && !busy.has(laneKey(t.tool, t.cwd)) && readiness(t, this.tasks, now) === 'ready')
      const cli = this.cli[tool] ?? null
      tools[tool] = { cli, nextReset, waiting: due ? (cli ? this.deps.blocker(tool) : `没有找到 ${tool} 命令`) : null }
    }
    return { tasks: this.tasks, nextReset: tools.claude.nextReset, claude: tools.claude.cli, waiting: tools.claude.waiting, tools, terminal: this.terminalOn(), node: this.nodePath }
  }

  private changed(): void {
    if (this.soonTimer) {
      clearTimeout(this.soonTimer)
      this.soonTimer = null
    }
    this.persist()
    this.emit('change', this.state())
  }

  add(input: TaskInput, now = Date.now()): ScheduledTask {
    const tool: UsageSource = input.tool === 'codex' ? 'codex' : 'claude'
    const trigger = TRIGGERS.includes(input.trigger) ? input.trigger : 'reset'
    const parent = input.parentId ? this.tasks.find((x) => x.id === input.parentId && (x.status === 'queued' || x.status === 'running')) : undefined
    const f = fields(input)
    const t: ScheduledTask = {
      id: randomUUID(),
      tool,
      prompt: f.prompt ?? '',
      cwd: f.cwd ?? '',
      trigger,
      at: trigger === 'time' ? (input.at ?? now) : null,
      notBefore: computeNotBefore(trigger, input.at ?? null, now, this.deps.window(tool)),
      repeat: f.repeat ?? false,
      permission: f.permission ?? 'inherit',
      model: f.model ?? null,
      continue: f.continue ?? false,
      autoCompact: f.autoCompact ?? true,
      compactAt: f.compactAt ?? null,
      retries: f.retries ?? 0,
      verify: f.verify ?? null,
      timeoutMin: f.timeoutMin ?? null,
      budgetUsd: f.budgetUsd ?? null,
      fallbackModel: f.fallbackModel ?? null,
      effort: f.effort ?? null,
      resumeId: typeof input.resumeId === 'string' && /^[\w-]{4,80}$/.test(input.resumeId) ? input.resumeId : null,
      followOf: typeof input.followOf === 'string' ? input.followOf : null,
      parentId: parent?.id ?? null,
      order: Math.max(-1, ...this.tasks.map((x) => x.order ?? 0)) + 1,
      queuedAt: now,
      status: 'queued',
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      doneAt: null,
      sessionId: null,
      costUsd: null,
      turns: null,
      summary: null,
      error: null,
      activity: null,
      runs: 0,
      mode: null
    }
    this.tasks.push(t)
    this.changed()
    void this.tick()
    return t
  }

  async action(id: string, action: TaskAction): Promise<void> {
    const t = this.tasks.find((x) => x.id === id)
    if (!t) return
    if (action === 'start' && t.status === 'queued') {
      // by hand: as soon as its folder is free, whatever its trigger, parent or the guard says
      t.force = true
      t.notBefore = Math.min(t.notBefore, Date.now())
    } else if (action === 'stop') {
      const run = this.runs.get(id)
      if (run) await this.stop(run)
    } else if (action === 'cancel' && t.status === 'queued') {
      // a retry waiting for its time ends the run as it stands
      Object.assign(t, { status: t.pending ? 'failed' : 'cancelled', pending: null, finishedAt: t.pending ? Date.now() : t.finishedAt })
    } else if ((action === 'requeue' || action === 'retry') && t.status !== 'running') {
      const now = Date.now()
      const at = action === 'retry' ? now : computeNotBefore('reset', null, now, this.deps.window(t.tool ?? 'claude'))
      Object.assign(t, { status: 'queued', notBefore: at, error: null, activity: null, force: action === 'retry', pending: null, note: null, queuedAt: now })
    } else if (action === 'remove' && t.status !== 'running') {
      this.drop([t])
    }
    this.changed()
    if (action === 'start' || action === 'retry') await this.tick()
  }

  /** takes tasks out of the list with their logs; their subtasks stay, on their own */
  private drop(list: ScheduledTask[]): void {
    const gone = new Set(list.map((t) => t.id))
    this.tasks = this.tasks.filter((x) => !gone.has(x.id))
    for (const c of this.tasks) if (c.parentId && gone.has(c.parentId)) Object.assign(c, { parentId: null, queuedAt: Date.now() })
    for (const id of gone) {
      this.logCache.delete(id)
      void rm(join(this.logDir, `${id}.jsonl`), { force: true })
    }
  }

  /**
   * Changes a task that is not running. A queued task keeps its place (a new
   * trigger or time moves its start); `then` queues it again, now or at the
   * next refresh, which is how a failed task is adjusted and tried again.
   */
  update(id: string, patch: TaskPatch, then: 'keep' | 'now' | 'reset' = 'keep', now = Date.now()): boolean {
    const t = this.tasks.find((x) => x.id === id)
    if (!t || t.status === 'running') return false
    Object.assign(t, fields(patch))
    const tool = t.tool ?? 'claude'
    if (patch.trigger && TRIGGERS.includes(patch.trigger)) {
      t.trigger = patch.trigger
      t.at = t.trigger === 'time' ? (patch.at ?? t.at ?? now) : null
      if (t.status === 'queued' && !t.pending) t.notBefore = computeNotBefore(t.trigger, t.at, now, this.deps.window(tool))
    }
    if (then !== 'keep') {
      Object.assign(t, {
        status: 'queued',
        notBefore: then === 'now' ? now : computeNotBefore('reset', null, now, this.deps.window(tool)),
        force: then === 'now',
        error: null,
        activity: null,
        pending: null,
        note: null,
        queuedAt: now
      })
    }
    this.changed()
    void this.tick()
    return true
  }

  /** removes the finished, failed and cancelled tasks of a tool, or of both */
  clearHistory(tool: SourceView = 'all'): number {
    const list = this.tasks.filter((t) => (t.status === 'done' || t.status === 'failed' || t.status === 'cancelled') && (tool === 'all' || (t.tool ?? 'claude') === tool))
    if (!list.length) return 0
    this.drop(list)
    this.changed()
    return list.length
  }

  /** `a` sits somewhere under `b` */
  private isUnder(a: ScheduledTask, b: ScheduledTask): boolean {
    for (let p = a.parentId, n = 0; p && n < 100; n++) {
      if (p === b.id) return true
      p = this.tasks.find((x) => x.id === p)?.parentId ?? null
    }
    return false
  }

  /**
   * Drag and drop: a queued task goes before or after another (as its
   * sibling), under it as a subtask that starts once it has finished, or back
   * to the top level. False when the move makes no sense.
   */
  move(id: string, targetId: string | null, how: TaskMove, now = Date.now()): boolean {
    const t = this.tasks.find((x) => x.id === id)
    if (!t || t.status !== 'queued') return false
    const target = targetId ? this.tasks.find((x) => x.id === targetId) : undefined
    if (how !== 'root' && (!target || target === t || this.isUnder(target, t))) return false
    if (how === 'child' && target!.status !== 'queued' && target!.status !== 'running') return false
    const parent = how === 'root' ? null : how === 'child' ? target!.id : (target!.parentId ?? null)
    if (parent !== t.parentId) Object.assign(t, { parentId: parent, queuedAt: now })
    // the new place in the queue
    const rest = this.tasks.filter((x) => x !== t).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    let at = rest.length
    if (target && how !== 'root') {
      const i = rest.indexOf(target)
      if (how === 'before') at = i
      else {
        // after the target and everything under it
        let j = i + 1
        while (j < rest.length && this.isUnder(rest[j], target)) j++
        at = j
      }
    }
    rest.splice(at, 0, t)
    rest.forEach((x, i) => (x.order = i))
    this.changed()
    void this.tick()
    return true
  }

  /** Starts every task whose time has come, one per folder, while nothing blocks */
  async tick(now?: number): Promise<void> {
    // asked again while starting others: go round once more
    if (this.ticking) return void (this.again = true)
    this.ticking = true
    try {
      do {
        this.again = false
        await this.startDue(now ?? Date.now())
      } while (this.again)
    } finally {
      this.ticking = false
    }
  }

  private async startDue(now: number): Promise<void> {
    {
      const busy = this.busyLanes()
      let held = false
      for (const t of this.tasks.filter((x) => x.status === 'queued' && readiness(x, this.tasks, now) === 'ready').sort(byOrder)) {
        const lane = laneKey(t.tool, t.cwd)
        if (busy.has(lane)) continue
        const tool = t.tool ?? 'claude'
        this.cli[tool] ??= await (tool === 'codex' ? (this.deps.codex?.() ?? null) : this.deps.claude())
        const cli = this.cli[tool]
        if (!cli || (!t.force && this.deps.blocker(tool))) {
          held = true
          continue
        }
        busy.add(lane)
        await this.run(t, cli, lane)
      }
      if (held) this.emit('change', this.state(now))
    }
  }

  /**
   * A task's log as readable lines (the latest 400). The task page asks every
   * 2 s while a task runs, so only what was appended since the last read is
   * parsed.
   */
  async log(id: string): Promise<TaskLogLine[]> {
    const file = join(this.logDir, `${id}.jsonl`)
    let size: number
    try {
      size = (await stat(file)).size
    } catch {
      this.logCache.delete(id)
      return []
    }
    let c = this.logCache.get(id)
    // a new run starts the log afresh
    if (!c || size < c.size) c = { size: 0, partial: '', lines: [] }
    if (size > c.size) {
      const fh = await open(file, 'r')
      try {
        const buf = Buffer.alloc(size - c.size)
        await fh.read(buf, 0, buf.length, c.size)
        const parts = (c.partial + buf.toString('utf8')).split('\n')
        c.partial = parts.pop() ?? ''
        for (const line of parts) {
          const m = /^(\d+)\t(.*)$/.exec(line.replace(/\r$/, ''))
          if (m) c.lines.push(...parseStreamLine(m[2], Number(m[1])).logs)
        }
        if (c.lines.length > 400) c.lines = c.lines.slice(-400)
        c.size = size
      } finally {
        await fh.close()
      }
    }
    this.logCache.delete(id)
    this.logCache.set(id, c)
    // a few logs are enough to keep
    while (this.logCache.size > 12) this.logCache.delete(this.logCache.keys().next().value!)
    return c.lines.slice()
  }

  /** Stops hidden runs and checks (on quit); task windows carry on and are followed again next time */
  stopAll(): void {
    for (const r of this.runs.values()) {
      if (r.mode === 'background') this.kill(r)
      if (r.checkProc?.pid) killTree(r.checkProc.pid)
    }
    this.flush()
  }

  /** Swaps the command that runs the CLI (screenshot runs use a stand-in, hidden) */
  useCommand(fn: Deps['command']): void {
    this.deps.command = fn
    this.background = true
    this.cli.claude ??= 'claude'
    this.cli.codex ??= 'codex'
  }

  private kill(r: Run): void {
    if (r.proc?.pid) killTree(r.proc.pid)
  }

  private async stop(r: Run): Promise<void> {
    r.stopping = true
    // the run itself is over, its check is running
    if (r.checked) {
      if (r.checkProc?.pid) killTree(r.checkProc.pid)
      return
    }
    if (r.mode === 'background') return this.kill(r)
    await writeFile(join(r.laneDir!, `stop-${r.task.id}`), '').catch(() => {})
    const hb = (await this.heartbeat(r.laneDir!)) ?? r.beat
    if (hb && (alive(hb.pid) || (hb.child && alive(hb.child)))) return
    // no window to stop it: make sure no window picks it up later
    await rm(join(r.laneDir!, 'job.json'), { force: true })
    await rm(join(r.laneDir!, `stop-${r.task.id}`), { force: true })
    this.finish(r, this.outcome(r, { code: -1, stopped: true, error: '' }))
  }

  /** the folder's latest conversation to carry on: a task's own, or one from the logs */
  private previous(t: ScheduledTask, lane: string): string | null {
    const mine = this.tasks
      .filter((x) => x !== t && x.doneAt && x.sessionId && laneKey(x.tool, x.cwd) === lane)
      .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))[0]
    const seen = this.deps.lastSession?.(t.tool ?? 'claude', t.cwd) ?? null
    if (mine && (!seen || (mine.doneAt ?? 0) >= seen.at)) return mine.sessionId
    return seen?.id ?? null
  }

  /** program, arguments and stdin for one try, and the model it asks for */
  private commandFor(
    t: ScheduledTask,
    cli: string,
    go: { prompt: string; model: string | null; resume: string | boolean | null; fork: boolean },
    partial: boolean
  ): { cmd: string; args: string[]; verbatim: boolean; stdin: string | null; model: string | null } {
    const tool = t.tool ?? 'claude'
    const shim = /\.(cmd|bat)$/i.test(cli)
    let model = go.model
    if (tool === 'codex') {
      const want = model
      model = this.codexModel({ ...t, model })
      if (model !== want) t.note = `${want ?? '默认模型'}不能用 ChatGPT 账号直接调用，这次改用 ${model}`
    }
    const resume = go.resume ?? false
    const compactAt = tool === 'codex' ? codexCompactLimit(t.compactAt ?? null, this.deps.codexWindow?.(model) ?? CODEX_WINDOW) : null
    const args =
      tool === 'codex'
        ? codexArgs({ permission: t.permission, model, effort: t.effort, compactAt }, { resume })
        : claudeArgs({ ...t, prompt: go.prompt, model }, { resume, fork: go.fork, partial, stdinPrompt: shim })
    const stdin = tool === 'codex' ? codexPrompt(go.prompt) : shim ? go.prompt : null
    const swap = this.deps.command?.(cli, tool)
    if (swap) return { cmd: swap.cmd, args: [...swap.pre, ...args], verbatim: false, stdin, model }
    return { ...cliCommand(cli, args), stdin, model }
  }

  private async run(t: ScheduledTask, cli: string, lane: string): Promise<void> {
    await mkdir(this.logDir, { recursive: true })
    const next = t.pending ?? null
    const now = Date.now()
    // a follow-up carries on its task's conversation in a fork; a retry carries on its own try's;
    // carrying on the folder's latest: Claude forks it (-c), Codex resumes it by id
    const latest = !next && !t.resumeId && t.continue ? this.previous(t, lane) : null
    const resume: string | boolean | null = next ? next.resumeId : t.resumeId ? t.resumeId : latest ? (t.tool === 'codex' ? latest : true) : null
    const go = { prompt: next?.prompt ?? t.prompt, model: next?.model ?? t.model, resume, fork: !next && !!t.resumeId }
    const terminal = this.terminalOn()
    if (!next) Object.assign(t, { attempts: [], quotaWaits: 0, costUsd: null, summary: null, runs: t.runs + 1 })
    const attempts = (t.attempts ??= [])
    const kind: TaskAttempt['kind'] = next?.kind ?? 'run'
    attempts.push({ n: attempts.length + 1, kind, startedAt: now, finishedAt: null, ok: null, reason: null, costUsd: null, model: go.model })
    Object.assign(t, {
      status: 'running',
      startedAt: next ? (t.startedAt ?? now) : now,
      finishedAt: null,
      // a carried-on conversation gets its id from the CLI (a retry keeps its own)
      sessionId: typeof resume === 'string' && !go.fork ? resume : resume || t.tool === 'codex' ? null : randomUUID(),
      error: null,
      turns: null,
      force: false,
      pending: null,
      note: next ? t.note : null,
      tokens: null,
      steps: 0,
      mode: terminal ? 'terminal' : 'background',
      activity: terminal ? '正在打开任务窗口…' : `正在启动 ${t.tool === 'codex' ? 'Codex' : 'Claude Code'}…`
    })
    const run: Run = {
      task: t,
      lane,
      mode: terminal ? 'terminal' : 'background',
      logFile: join(this.logDir, `${t.id}.jsonl`),
      stopping: false,
      lastText: null,
      offset: 0,
      partial: '',
      launchedAt: now,
      seen: false,
      relaunched: false,
      sawSession: false,
      resume
    }
    this.runs.set(t.id, run)
    // a new run starts its log afresh; the tries of one run share it
    if (!next) {
      this.logCache.delete(t.id)
      await rm(run.logFile, { force: true })
    }
    if (attempts.length > 1 || kind !== 'run') await appendFile(run.logFile, `${now}\t${JSON.stringify({ type: 'tp_try', n: attempts.length, why: TRY_TEXT[kind] })}\n`).catch(() => {})
    // the window follows this try's lines only
    run.offset = await stat(run.logFile).then((s) => s.size, () => 0)
    this.changed()
    this.emit('started', t)
    if (t.cwd && !existsSync(t.cwd)) return this.finish(run, { ok: false, error: `工作目录不存在：${t.cwd}` })
    const c = this.commandFor(t, cli, go, terminal)
    run.model = c.model
    attempts[attempts.length - 1].model = c.model
    if (t.timeoutMin) {
      run.timer = setTimeout(() => {
        run.timedOut = true
        void this.stop(run)
      }, t.timeoutMin * 60_000)
    }
    if (terminal) await this.openWindow(run, c, !!resume, attempts.length > 1 ? `第 ${attempts.length} 次尝试 · ${TRY_TEXT[kind]}` : null, go.prompt)
    else this.spawnHidden(run, c)
  }

  // ---------------------------------------------------------------- hidden runs

  private spawnHidden(run: Run, c: { cmd: string; args: string[]; verbatim: boolean; stdin: string | null }): void {
    const t = run.task
    let stderr = ''
    let buf = ''
    let child: ChildProcess
    try {
      child = spawn(c.cmd, c.args, {
        cwd: t.cwd || undefined,
        env: { ...cleanEnv(process.env), ...taskEnv(t) },
        windowsHide: true,
        windowsVerbatimArguments: c.verbatim,
        stdio: [c.stdin !== null ? 'pipe' : 'ignore', 'pipe', 'pipe']
      })
    } catch (e) {
      this.finish(run, { ok: false, error: `无法启动：${(e as Error).message}` })
      return
    }
    run.proc = child
    if (c.stdin !== null) child.stdin!.end(c.stdin)
    // writes queued in order; the task finishes after the last one lands
    let writes: Promise<void> = Promise.resolve()
    const onLine = (line: string) => {
      if (!line.trim()) return
      const entry = `${Date.now()}\t${line}\n`
      writes = writes.then(() => appendFile(run.logFile, entry)).catch(() => {})
      this.take(run, line)
    }
    child.stdout!.setEncoding('utf8')
    child.stdout!.on('data', (d: string) => {
      buf += d
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        onLine(buf.slice(0, i))
        buf = buf.slice(i + 1)
      }
    })
    child.stderr!.setEncoding('utf8')
    child.stderr!.on('data', (d: string) => (stderr = (stderr + d).slice(-2000)))
    child.on('error', (e) => this.finish(run, { ok: false, error: `无法启动：${e.message}` }))
    child.on('close', (code) => {
      if (buf.trim()) onLine(buf)
      void writes.then(() => this.finish(run, this.outcome(run, { code: code ?? -1, stopped: run.stopping, error: stderr.trim() })))
    })
  }

  // ---------------------------------------------------------------- task windows

  private laneDir(lane: string): string {
    return join(this.logDir, 'lanes', createHash('sha1').update(lane).digest('hex').slice(0, 12))
  }

  /**
   * The window's heartbeat, or null when it can't be read. The window replaces
   * the file every second, and a read that lands in the middle finds it locked
   * or half written: such a read is tried again, and a miss is no proof the
   * window is gone (see poll).
   */
  private async heartbeat(dir: string): Promise<Beat | null> {
    for (let i = 0; i < 3; i++) {
      try {
        const hb = JSON.parse(await readFile(join(dir, 'lane.json'), 'utf8'))
        return typeof hb?.pid === 'number' && typeof hb.at === 'number' ? hb : null
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
        await new Promise((r) => setTimeout(r, 40))
      }
    }
    return null
  }

  private async openWindow(
    run: Run,
    c: { cmd: string; args: string[]; verbatim: boolean; stdin: string | null; model: string | null },
    resume: boolean,
    note: string | null,
    prompt: string
  ): Promise<void> {
    const t = run.task
    const dir = this.laneDir(run.lane)
    run.laneDir = dir
    await mkdir(dir, { recursive: true })
    // a stop asked for after an earlier try ended must not stop this one
    await rm(join(dir, `stop-${t.id}`), { force: true })
    const script = join(this.logDir, 'runner.cjs')
    await writeFile(script, runnerSrc, 'utf8')
    const job = {
      id: t.id,
      tool: t.tool ?? 'claude',
      cmd: c.cmd,
      args: c.args,
      verbatim: c.verbatim,
      stdin: c.stdin,
      env: taskEnv(t),
      cwd: t.cwd || homedir(),
      log: run.logFile,
      title: short(flat(t.prompt), 80),
      prompt,
      model: c.model,
      folder: basename(t.cwd) || t.cwd,
      resume,
      autoCompact: t.autoCompact,
      compact: t.autoCompact === false ? '关' : compactText(t.compactAt),
      note
    }
    await writeFile(join(dir, 'job.json.tmp'), JSON.stringify(job), 'utf8')
    await rename(join(dir, 'job.json.tmp'), join(dir, 'job.json'))
    // a window for this folder that is still open and idle takes the job by itself
    const hb = await this.heartbeat(dir)
    if (!(hb && !hb.busy && Date.now() - hb.at < 4000 && alive(hb.pid))) this.launch(run)
    this.watch()
  }

  private launch(run: Run): void {
    const t = run.task
    run.launchedAt = Date.now()
    try {
      ;(this.deps.openTerminal ?? openTerminal)({
        node: this.nodePath!,
        script: join(this.logDir, 'runner.cjs'),
        laneDir: run.laneDir!,
        cwd: t.cwd || homedir(),
        title: `${t.tool === 'codex' ? 'Codex' : 'Claude'} · ${basename(t.cwd) || t.cwd}`
      })
    } catch (e) {
      this.finish(run, { ok: false, error: `没能打开任务窗口：${(e as Error).message}` })
    }
  }

  /** follows a task window again after a restart, from the start of the latest try */
  private follow(t: ScheduledTask): void {
    const lane = laneKey(t.tool, t.cwd)
    const logFile = join(this.logDir, `${t.id}.jsonl`)
    let offset = 0
    try {
      const raw = readFileSync(logFile)
      const at = raw.lastIndexOf('"type":"tp_try"')
      if (at > 0) offset = raw.lastIndexOf(10, at) + 1
    } catch {
      /* no log yet */
    }
    this.runs.set(t.id, {
      task: t,
      lane,
      mode: 'terminal',
      logFile,
      laneDir: this.laneDir(lane),
      stopping: false,
      lastText: null,
      offset,
      partial: '',
      launchedAt: Date.now(),
      seen: true,
      relaunched: true,
      sawSession: false
    })
    this.watch()
  }

  private watch(): void {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => void this.poll(), 700)
  }

  private async poll(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      const open = [...this.runs.values()].filter((r) => r.mode === 'terminal')
      if (!open.length && this.pollTimer) {
        clearInterval(this.pollTimer)
        this.pollTimer = null
      }
      for (const run of open) {
        // the window is done with it; the check after it runs here
        if (run.checked) continue
        await this.readNew(run)
        if (!this.runs.has(run.task.id)) continue
        const hb = await this.heartbeat(run.laneDir!)
        if (hb && (!run.beat || hb.at >= run.beat.at)) run.beat = hb
        const now = Date.now()
        if (!run.seen) {
          if (hb?.busy === run.task.id || !existsSync(join(run.laneDir!, 'job.json'))) run.seen = true
          else if (now - run.launchedAt > 20_000 && !run.relaunched) {
            // the idle window closed just before taking the job: open another
            run.relaunched = true
            this.launch(run)
          } else if (now - run.launchedAt > 45_000) {
            await rm(join(run.laneDir!, 'job.json'), { force: true })
            this.finish(run, { ok: false, error: '没能打开任务窗口（终端没有响应）' })
          }
          continue
        }
        if (now - run.launchedAt < 8000 || (run.beat && now - run.beat.at < 6000)) {
          run.gone = 0
          continue
        }
        // the heartbeat is late (or unreadable): the window, or the CLI it started, still running means the task is too
        const beat = run.beat
        const windowAlive = [beat?.pid, run.runnerPid].some((p) => !!p && alive(p))
        const cliAlive = !!beat?.child && beat.busy === run.task.id && alive(beat.child)
        if (windowAlive || cliAlive) {
          run.gone = 0
          continue
        }
        // gone on three polls in a row (about two seconds), with nothing more in the log
        if ((run.gone = (run.gone ?? 0) + 1) < 3) continue
        await this.readNew(run)
        if (this.runs.has(run.task.id)) this.finish(run, this.outcome(run, { code: -1, stopped: run.stopping, error: '任务窗口被关闭，任务中断' }))
      }
    } finally {
      this.polling = false
    }
  }

  /** reads what the task window appended to the log since last time */
  private async readNew(run: Run): Promise<void> {
    let size = 0
    try {
      size = (await stat(run.logFile)).size
    } catch {
      return
    }
    if (size <= run.offset) return
    const fh = await open(run.logFile, 'r')
    try {
      const buf = Buffer.alloc(size - run.offset)
      await fh.read(buf, 0, buf.length, run.offset)
      run.offset = size
      const text = run.partial + buf.toString('utf8')
      const lines = text.split('\n')
      run.partial = lines.pop() ?? ''
      for (const l of lines) {
        const m = /^(\d+)\t(.*)$/.exec(l.replace(/\r$/, ''))
        if (!m) continue
        const exit = this.take(run, m[2])
        if (exit) return this.finish(run, this.outcome(run, exit))
      }
    } finally {
      await fh.close()
    }
  }

  // ---------------------------------------------------------------- both

  /** one log line: activity, session id, result; returns the window's exit record */
  private take(run: Run, line: string): ExitRecord | undefined {
    const t = run.task
    if (line.startsWith('{"type":"tp_start"')) {
      const pid = Number(/"pid":(\d+)/.exec(line)?.[1])
      if (pid) run.runnerPid = pid
    }
    const { logs, result: r, session, exit } = parseStreamLine(line)
    // the id the CLI really uses (a carried-on conversation gets a new one)
    if (session) {
      t.sessionId = session
      run.sawSession = true
    }
    if (r) run.result = r
    run.seen = true
    for (const l of logs) {
      if (l.kind === 'text') run.lastText = l.text
      if (l.kind === 'tool') t.steps = (t.steps ?? 0) + 1
    }
    const last = logs[logs.length - 1]
    if (last && last.kind !== 'system' && !exit) {
      t.activity = last.kind === 'thinking' ? `思考：${last.text}` : last.text
      this.soon()
    }
    return exit
  }

  private outcome(run: Run, exit: ExitRecord): Outcome {
    const result = run.result
    if (run.timedOut) return { ok: false, error: `超过了 ${run.task.timeoutMin} 分钟的时限，已停下`, result, failure: 'timeout' }
    if (exit.stopped || run.stopping) return { ok: false, error: '已手动停止', result, failure: 'stopped' }
    if (result) return { ok: result.ok, error: result.ok ? null : short(result.text || SUBTYPE_TEXT[result.subtype ?? ''] || '任务没有成功完成', 300), result }
    return { ok: false, error: short(exit.error || `退出，代码 ${exit.code}`, 300) }
  }

  /** runs the task's check command in its folder; the result goes into the log */
  private check(run: Run): Promise<TaskCheck> {
    const t = run.task
    const cmd = t.verify!
    t.activity = `正在检查：${short(cmd, 80)}`
    this.emit('change', this.state())
    const record = (o: object) => appendFile(run.logFile, `${Date.now()}\t${JSON.stringify({ type: 'tp_check', ...o })}\n`).catch(() => {})
    void record({ phase: 'start', cmd })
    const started = Date.now()
    return new Promise((resolve) => {
      let out = ''
      let settled = false
      let timer: NodeJS.Timeout | undefined
      const end = (code: number, extra = '') => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        run.checkProc = undefined
        const c: TaskCheck = { code, tail: tailOf(out + extra), ms: Date.now() - started }
        void record({ phase: 'end', ...c }).then(() => resolve(c))
      }
      const win = process.platform === 'win32'
      let p: ChildProcess
      try {
        p = spawn(win ? process.env.ComSpec || 'cmd.exe' : '/bin/sh', win ? ['/d', '/s', '/c', `"${cmd}"`] : ['-c', cmd], {
          cwd: t.cwd || undefined,
          env: cleanEnv(process.env),
          windowsHide: true,
          windowsVerbatimArguments: win,
          stdio: ['ignore', 'pipe', 'pipe']
        })
      } catch (e) {
        return end(-1, `无法运行检查命令：${(e as Error).message}`)
      }
      run.checkProc = p
      const add = (d: string) => (out = (out + d).slice(-8000))
      p.stdout!.setEncoding('utf8')
      p.stdout!.on('data', add)
      p.stderr!.setEncoding('utf8')
      p.stderr!.on('data', add)
      timer = setTimeout(() => {
        if (p.pid) killTree(p.pid)
        end(-1, `\n检查超过 ${CHECK_TIMEOUT_MS / 60_000} 分钟，已停下`)
      }, CHECK_TIMEOUT_MS)
      p.on('error', (e) => end(-1, `\n无法运行检查命令：${e.message}`))
      p.on('close', (code) => end(code ?? -1))
    })
  }

  /** What comes after a failed try: when the next one starts and what it is told, or null to end the run */
  private nextTry(t: ScheduledTask, run: Run, failure: TaskFailure, o: Outcome, now: number): { at: number; pending: NonNullable<ScheduledTask['pending']>; note: string } | null {
    const attempts = t.attempts ?? []
    // waiting for the quota is not a try of its own
    const tries = attempts.filter((a) => a.kind !== 'resume').length
    const session = run.sawSession ? t.sessionId : null
    const tool = t.tool ?? 'claude'
    const say = (kind: TaskFailure) =>
      session
        ? retryPrompt(kind, { reason: o.error, verify: t.verify, check: o.check, timeoutMin: t.timeoutMin })
        : `${t.prompt}\n\n（这是第 ${attempts.length + 1} 次尝试：上一次${FAILURE_TEXT[kind]}${o.error ? `，${short(flat(o.error), 200)}` : ''}）`
    if (failure === 'stopped' || failure === 'setup' || failure === 'budget') return null
    if (failure === 'quota') {
      if ((t.quotaWaits ?? 0) >= QUOTA_WAITS) return null
      t.quotaWaits = (t.quotaWaits ?? 0) + 1
      const reset = computeNotBefore('reset', null, now, this.deps.window(tool))
      // no window known: look again in a quarter of an hour
      const at = reset > now ? reset : now + 15 * 60_000
      return { at, pending: { kind: 'resume', prompt: say('quota'), resumeId: session, model: run.model ?? t.model }, note: `额度用完了，${clock(at)} 刷新后接着做` }
    }
    if (tries > (t.retries ?? 0)) return null
    // network trouble backs off (30 s, 1 min, 2 min, …); anything else goes again right away
    const delay = this.deps.retryDelay?.(failure, tries) ?? (failure === 'transient' ? Math.min(10 * 60_000, 30_000 * 2 ** (tries - 1)) : 3000)
    const model = t.fallbackModel || run.model || t.model
    const kind: TaskAttempt['kind'] = failure === 'check' ? 'fix' : 'retry'
    const what = failure === 'check' ? '检查没通过，接着让它修正' : `${FAILURE_TEXT[failure]}，${delay >= 60_000 ? `${Math.round(delay / 60_000)} 分钟` : `${Math.round(delay / 1000)} 秒`}后重试`
    return {
      at: now + delay,
      pending: { kind, prompt: say(failure), resumeId: session, model },
      note: `第 ${tries} 次${what}（最多还会试 ${(t.retries ?? 0) - tries + 1} 次）${model && model !== (run.model ?? t.model) ? `，改用 ${model}` : ''}`
    }
  }

  /** writes how the latest try went into its record */
  private closeTry(t: ScheduledTask, run: Run, o: Outcome, now: number, failure: TaskFailure | null): void {
    const a = t.attempts?.[t.attempts.length - 1]
    if (!a || a.finishedAt) return
    const usage = o.result?.usage
    Object.assign(a, {
      finishedAt: now,
      ok: o.ok,
      reason: o.ok ? null : short(flat(o.error ?? ''), 200) || null,
      failure,
      model: run.model ?? a.model,
      costUsd: o.result?.costUsd ?? (usage && this.deps.price ? this.deps.price({ ...t, model: run.model ?? t.model }, usage) : null),
      check: o.check ?? null
    })
  }

  private finish(run: Run, o: Outcome): void {
    const t = run.task
    if (this.runs.get(t.id) !== run) return
    // a successful run is checked first, when the task has a check
    if (o.ok && t.verify && !run.checked && !run.stopping) {
      run.checked = true
      void this.check(run).then((c) => {
        if (run.stopping) return this.finish(run, { ...this.outcome(run, { code: -1, stopped: true, error: '' }), check: c })
        this.finish(run, c.code === 0 ? { ...o, check: c } : { ok: false, error: `检查没通过（${short(t.verify!, 60)}，退出 ${c.code}）`, result: o.result, check: c, failure: 'check' })
      })
      return
    }
    this.runs.delete(t.id)
    if (run.timer) clearTimeout(run.timer)
    const now = Date.now()
    // a Codex model the ChatGPT account refuses: remember it and go again with one it takes
    const refused = t.tool === 'codex' && !o.ok ? unsupportedModel(o.error ?? o.result?.text) : null
    if (refused) {
      this.codexRefused.add(refused)
      if (!run.model) this.codexDefaultRefused = true
      void writeFile(this.codexFile, JSON.stringify({ refused: [...this.codexRefused], defaultRefused: this.codexDefaultRefused }), 'utf8').catch(() => {})
      const next = this.codexModel({ ...t, model: run.model ?? null })
      if (next && next !== run.model) {
        // a setup problem TokenPulse fixed by itself: not a try that failed at the task
        this.closeTry(t, run, o, now, 'setup')
        Object.assign(t, {
          status: 'queued',
          notBefore: now,
          activity: null,
          error: null,
          pending: { kind: 'retry', prompt: null, resumeId: typeof run.resume === 'string' ? run.resume : null, model: next },
          note: `${refused} 不能用 ChatGPT 账号直接调用，已改用 ${next} 重试`
        })
        this.changed()
        setTimeout(() => void this.tick(), 300)
        return
      }
    }
    const failure = o.ok ? null : (o.failure ?? classifyFailure(o.error ?? o.result?.text, { subtype: o.result?.subtype, stopped: run.stopping }))
    this.closeTry(t, run, o, now, failure)
    // the answer of a run that got through (even when its check then failed), never an error message
    const text = o.ok || o.result?.ok ? o.result?.text?.trim() || run.lastText : null
    if (text) t.summary = short(text, 1200)
    // trial and error: carry on after the refresh, retry, or have the check fixed
    const again = failure ? this.nextTry(t, run, failure, o, now) : null
    if (again) {
      Object.assign(t, { status: 'queued', notBefore: again.at, pending: again.pending, error: o.error ?? null, note: again.note, activity: null })
      this.emit('retrying', { ...t })
      this.changed()
      // a later one is picked up by the regular tick
      setTimeout(() => void this.tick(), Math.min(60_000, Math.max(300, again.at - now + 50)))
      return
    }
    const tries = t.attempts ?? []
    const usage = o.result?.usage
    Object.assign(t, {
      status: o.ok ? 'done' : 'failed',
      finishedAt: now,
      doneAt: o.ok ? now : t.doneAt,
      error: o.error ?? null,
      // the whole run: every try's cost
      costUsd: tries.some((a) => a.costUsd !== null) ? tries.reduce((s, a) => s + (a.costUsd ?? 0), 0) : null,
      tokens: usage ? usage.input + usage.output : null,
      turns: o.result?.turns ?? null,
      activity: null,
      note: o.ok
        ? tries.slice(0, -1).some((a) => a.failure !== 'setup')
          ? `试了 ${tries.length} 次才完成：${triedText(tries.slice(0, -1))}之后成功`
          : t.note
        : tries.length > 1
          ? `试了 ${tries.length} 次都没有完成${triedText(tries) === '没有完成' ? '' : `（${triedText(tries)}）`}，可以点「调整」改改任务或设置再试`
          : t.note
    })
    this.emit('finished', { ...t })
    // a repeating task waits for the next refresh
    if (t.repeat && o.error !== '已手动停止') {
      Object.assign(t, { status: 'queued', notBefore: computeNotBefore('reset', null, now, this.deps.window(t.tool ?? 'claude')), queuedAt: now })
    }
    this.changed()
    setTimeout(() => void this.tick(), 1500)
  }
}
