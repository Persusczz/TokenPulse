import { existsSync } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type { CodexQuota, PromptMark, QuotaWindow, UsageEntry } from '@shared/types'
import { noteWeek, type LoggedWeek } from '../windowHistory'
import { PROMPT_CHARS } from './parser'
import { listJsonl } from './store'

const CHUNK = 4 << 20
/** a line's head is enough to tell its record type */
const HEAD = 220
const WANTED = ['"token_usage_record"', '"turn_context"', '"session_meta"', '"token_count"', '"user_message"']
/** a completed item names its type after the thread and turn ids */
const ITEM_HEAD = 420

/** Codex's home: CODEX_HOME, else ~/.codex */
export function codexRoot(): string {
  return resolve(process.env.CODEX_HOME || join(homedir(), '.codex'))
}

/** Session folders under the Codex home that exist */
export function codexDirs(root = codexRoot()): string[] {
  return ['sessions', 'archived_sessions'].map((d) => join(root, d)).filter((d) => existsSync(d))
}

export interface CodexLimit {
  pct: number
  windowMin: number
  resetsAt: number | null
}
export interface CodexLimits {
  /** when Codex wrote them */
  at: number
  plan: string | null
  primary: CodexLimit | null
  secondary: CodexLimit | null
  /** which limit: "codex" is the plan's 5-hour / 7-day one (newer Codex also logs others, e.g. "premium", often empty) */
  limitId?: string | null
  /** read from the session logs, or from the ChatGPT account's usage endpoint */
  origin?: 'logs' | 'api'
}

/** What a file has told us so far, kept between incremental reads */
export interface CodexFile {
  offset: number
  model: string
  cwd: string
  sessionId: string
  /** the file has per-response records (newer Codex); token_count totals are then ignored */
  records: boolean
  lastTotal: number
  /** entries taken from token_count totals before the first record appeared */
  fallback: string[]
}

export const newCodexFile = (sessionId = ''): CodexFile => ({ offset: 0, model: '', cwd: '', sessionId, records: false, lastTotal: 0, fallback: [] })

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

function toEntry(key: string, ts: number, u: Record<string, unknown>, f: CodexFile, sessionId?: string): UsageEntry {
  const cached = num(u.cached_input_tokens)
  const written = num(u.cache_write_input_tokens)
  return {
    key,
    ts,
    // before the first turn announces its model (older logs): priced as the main GPT line
    model: f.model || 'gpt-unknown',
    sessionId: sessionId || f.sessionId,
    project: f.cwd ? basename(f.cwd) : 'Codex',
    projectPath: f.cwd,
    // input_tokens includes the cached part
    input: Math.max(0, num(u.input_tokens) - cached - written),
    // includes reasoning
    output: num(u.output_tokens),
    cacheWrite5m: written,
    cacheWrite1h: 0,
    cacheRead: cached,
    webSearch: 0,
    speed: 'standard',
    geo: null,
    source: 'codex'
  }
}

function limitsOf(rl: Record<string, any>, ts: number): CodexLimits {
  const lim = (v: any): CodexLimit | null =>
    v && Number.isFinite(v.used_percent)
      ? {
          pct: v.used_percent,
          windowMin: num(v.window_minutes),
          resetsAt: Number.isFinite(v.resets_at) ? v.resets_at * 1000 : Number.isFinite(v.resets_in_seconds) ? ts + v.resets_in_seconds * 1000 : null
        }
      : null
  return { at: ts, plan: typeof rl.plan_type === 'string' ? rl.plan_type : null, primary: lim(rl.primary), secondary: lim(rl.secondary), limitId: typeof rl.limit_id === 'string' ? rl.limit_id : null }
}

export interface CodexLine {
  entry?: UsageEntry
  /** the entry came from a running total (older logs) */
  fallback?: boolean
  limits?: CodexLimits
  prompt?: PromptMark
  /** model_context_window reported with the token counts */
  window?: number
}

/** Text the user typed; Codex wraps replies to its own questions and context in tags */
export function codexUserText(text: string): string | null {
  const t = text.trim()
  if (!t || /^<(environment_context|user_instructions|turn_aborted|permissions)/.test(t)) return null
  if (t.startsWith('<send_user_message_question_reply>')) return `↩ ${t.replace(/<\/?send_user_message_question_reply>/g, '').trim()}`
  // attached files come first ("## name: path"), the request after "## My request…:"
  if (t.startsWith('# Files mentioned by the user')) {
    const m = /\n## My request[^\n]*:\s*\n([\s\S]*)$/.exec(t)
    const files = (t.match(/\n## (?!My request)[^\n]*: /g) ?? []).length
    const ask = m ? m[1].trim() : ''
    return ask ? (files ? `${ask}（附 ${files} 个文件）` : ask) : t
  }
  return t
}

function codexPrompt(text: string, ts: number, f: CodexFile, id: string): PromptMark | null {
  const t = codexUserText(text)
  if (!t) return null
  return {
    key: `codex:${f.sessionId}:${id}`,
    sessionId: f.sessionId,
    ts,
    text: t.replace(/\s+/g, ' ').slice(0, PROMPT_CHARS),
    project: f.cwd ? basename(f.cwd) : 'Codex',
    source: 'codex'
  }
}

/** One Codex log line; updates `f` with the session, folder and model it announces */
export function parseCodexLine(line: string, f: CodexFile): CodexLine | null {
  let j: any
  try {
    j = JSON.parse(line)
  } catch {
    return null
  }
  const p = j?.payload ?? {}
  const ts = Date.parse(j?.timestamp) || 0
  switch (j?.type) {
    case 'session_meta':
      f.sessionId = p.id ?? p.session_id ?? f.sessionId
      if (typeof p.cwd === 'string') f.cwd = p.cwd
      return null
    case 'turn_context':
      if (typeof p.model === 'string') f.model = p.model
      if (typeof p.cwd === 'string') f.cwd = p.cwd
      return null
    case 'token_usage_record': {
      if (!p.usage || !ts) return null
      f.records = true
      const id = p.response_id ?? `${p.turn_id ?? f.sessionId}:${j.ordinal ?? ts}`
      return { entry: toEntry(`codex:${id}`, ts, p.usage, f, p.session_id) }
    }
    case 'event_msg': {
      if (p.type === 'item_completed' && p.item?.type === 'UserMessage' && ts) {
        const text = Array.isArray(p.item.content)
          ? p.item.content
              .filter((c: any) => typeof c?.text === 'string')
              .map((c: any) => c.text)
              .join('\n')
          : ''
        const prompt = codexPrompt(text, ts, f, `${p.turn_id ?? ''}:${p.item.id ?? ts}`)
        return prompt ? { prompt } : null
      }
      // older logs
      if (p.type === 'user_message' && typeof p.message === 'string' && ts) {
        const prompt = codexPrompt(p.message, ts, f, String(j.ordinal ?? ts))
        return prompt ? { prompt } : null
      }
      if (p.type !== 'token_count') return null
      const out: CodexLine = {}
      if (p.rate_limits && ts) out.limits = limitsOf(p.rate_limits, ts)
      // the model's context window, as Codex sees it
      const win = num(p.info?.model_context_window)
      if (win > 0) out.window = win
      const total = num(p.info?.total_token_usage?.total_tokens)
      if (!f.records && p.info?.last_token_usage && total > f.lastTotal && ts) {
        f.lastTotal = total
        out.entry = toEntry(`codex:${f.sessionId}:t${total}`, ts, p.info.last_token_usage, f)
        out.fallback = true
      }
      return out
    }
    default:
      return null
  }
}

/**
 * Reads lines from `offset`, decoding only those whose head names a record we
 * use: response items can be megabytes each, and there may be a gigabyte of them.
 */
export async function readWanted(path: string, offset: number, size: number, onLine: (line: string) => void): Promise<number> {
  const fh = await open(path, 'r')
  let pos = offset
  let carry: Buffer = Buffer.alloc(0)
  const take = (data: Buffer, a: number, b: number) => {
    const head = data.toString('latin1', a, Math.min(b, a + HEAD))
    if (WANTED.some((w) => head.includes(w))) return onLine(data.toString('utf8', a, b))
    if (head.includes('"item_completed"') && data.toString('latin1', a, Math.min(b, a + ITEM_HEAD)).includes('"UserMessage"')) onLine(data.toString('utf8', a, b))
  }
  try {
    while (pos < size) {
      const len = Math.min(CHUNK, size - pos)
      const buf = Buffer.allocUnsafe(len)
      const { bytesRead } = await fh.read(buf, 0, len, pos)
      if (!bytesRead) break
      pos += bytesRead
      const data = carry.length ? Buffer.concat([carry, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead)
      let start = 0
      let nl: number
      while ((nl = data.indexOf(10, start)) !== -1) {
        if (nl > start) take(data, start, nl)
        start = nl + 1
      }
      carry = Buffer.from(data.subarray(start))
    }
  } finally {
    await fh.close()
  }
  if (carry.length) {
    const tail = carry.toString('utf8').trim()
    if (!tail) return pos
    try {
      JSON.parse(tail)
      take(carry, 0, carry.length)
      return pos
    } catch {
      return pos - carry.length
    }
  }
  return pos
}

const sessionOf = (path: string) => basename(path).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] ?? basename(path, '.jsonl')

/** One 5-hour window as Codex reported it over time */
export interface CodexWindow {
  end: number
  peak: number
  hitAt: number | null
  samples: { t: number; pct: number }[]
}

/** readings closer than this to a window's reset belong to it (resets_at wobbles by a second or two) */
const SAME_WINDOW_MS = 10 * 60_000

/** Usage from Codex session logs, read incrementally like the Claude store */
export class CodexStore {
  readonly entries = new Map<string, UsageEntry>()
  readonly prompts = new Map<string, PromptMark>()
  /** the 5-hour windows seen in rate_limits, oldest first */
  readonly windows: CodexWindow[] = []
  /** the 7-day windows seen in rate_limits, with their peaks, oldest first */
  readonly weeks: LoggedWeek[] = []
  /** context window per model, as Codex reports it */
  readonly contextWindows = new Map<string, number>()
  revision = 0
  limits: CodexLimits | null = null
  private files = new Map<string, CodexFile>()
  private lastPrompt = new Map<string, PromptMark>()

  /** Files are read in any order: find the window by its reset time */
  private recordWindow(l: CodexLimits): void {
    const s = l.secondary
    if (s?.resetsAt && (!s.windowMin || s.windowMin === 10080)) noteWeek(this.weeks, s.pct, s.resetsAt)
    const p = l.primary
    if (!p || !p.resetsAt || (p.windowMin && p.windowMin !== 300)) return
    let w = this.windows.find((x) => Math.abs(x.end - p.resetsAt!) < SAME_WINDOW_MS)
    if (!w) {
      w = { end: p.resetsAt, peak: 0, hitAt: null, samples: [] }
      this.windows.push(w)
      this.windows.sort((a, b) => a.end - b.end)
    }
    w.peak = Math.max(w.peak, p.pct)
    if (p.pct >= 100 && (w.hitAt === null || l.at < w.hitAt)) w.hitAt = l.at
    w.samples.push({ t: l.at, pct: p.pct })
  }

  /**
   * Takes a reading of the plan's limits (from a log line or the usage
   * endpoint). Readings of other limits, and empty ones, are left out: newer
   * Codex logs a "premium" limit with no windows after the real one, which
   * used to blank the quota.
   */
  noteLimits(l: CodexLimits): void {
    if ((!l.primary && !l.secondary) || (l.limitId && l.limitId !== 'codex')) return
    if (!this.limits || l.at >= this.limits.at) this.limits = l
    this.recordWindow(l)
  }

  get fileCount(): number {
    return this.files.size
  }

  /** the log a session was written to (one file per Codex session) */
  fileOf(sessionId: string): string | null {
    for (const [path, f] of this.files) if (f.sessionId === sessionId) return path
    return null
  }

  async readFile(path: string): Promise<UsageEntry[]> {
    let size: number
    try {
      size = (await stat(path)).size
    } catch {
      return []
    }
    let f = this.files.get(path)
    // rewritten from scratch: read again (keys keep it from double counting)
    if (f && size < f.offset) f = undefined
    if (!f) {
      f = newCodexFile(sessionOf(path))
      this.files.set(path, f)
    }
    if (size === f.offset) return []
    const file = f
    let added: UsageEntry[] = []
    file.offset = await readWanted(path, file.offset, size, (line) => {
      const r = parseCodexLine(line, file)
      if (!r) return
      if (r.prompt) {
        // the same message can be logged twice by some versions
        const prev = this.lastPrompt.get(path)
        if (!(prev && prev.text === r.prompt.text && Math.abs(prev.ts - r.prompt.ts) < 5000) && !this.prompts.has(r.prompt.key)) this.prompts.set(r.prompt.key, r.prompt)
        this.lastPrompt.set(path, r.prompt)
        return
      }
      if (r.limits) this.noteLimits(r.limits)
      if (r.window && file.model) this.contextWindows.set(file.model, r.window)
      const e = r.entry
      if (!e) return
      // per-response records arrived: drop what was taken from running totals
      if (!r.fallback && file.fallback.length) {
        const gone = new Set(file.fallback)
        for (const k of gone) if (this.entries.delete(k)) this.revision++
        added = added.filter((x) => !gone.has(x.key))
        file.fallback = []
      }
      if (this.entries.has(e.key)) return
      this.entries.set(e.key, e)
      this.revision++
      added.push(e)
      if (r.fallback) file.fallback.push(e.key)
    })
    return added
  }

  async scan(dirs: string[]): Promise<UsageEntry[]> {
    const added: UsageEntry[] = []
    for (const d of dirs) for (const f of await listJsonl(d)) added.push(...(await this.readFile(f)))
    return added
  }

  async changedFiles(dirs: string[]): Promise<string[]> {
    const out: string[] = []
    for (const d of dirs) {
      for (const path of await listJsonl(d)) {
        try {
          if ((await stat(path)).size !== this.files.get(path)?.offset) out.push(path)
        } catch {
          /* removed */
        }
      }
    }
    return out
  }
}

const windowLabel = (min: number) => (min === 300 ? '5 小时' : min === 10080 ? '7 天' : min >= 1440 ? `${Math.round(min / 1440)} 天` : `${Math.round(min / 60)} 小时`)

/**
 * The limits as quota windows. Codex only reports them while it runs, so a
 * window whose reset has passed since is shown as fresh (0%, reset unknown).
 */
export function codexQuota(l: CodexLimits | null, now: number, files: number): CodexQuota | null {
  if (!l) return null
  const win = (key: string, v: CodexLimit | null, fallbackMin: number): QuotaWindow[] => {
    if (!v) return []
    const over = v.resetsAt !== null && v.resetsAt <= now
    return [
      {
        key,
        label: `${windowLabel(v.windowMin || fallbackMin)}额度`,
        utilization: over ? 0 : v.pct,
        resetsAt: over || v.resetsAt === null ? null : new Date(v.resetsAt).toISOString(),
        severity: null
      }
    ]
  }
  return { plan: l.plan, updatedAt: l.at, windows: [...win('codex_5h', l.primary, 300), ...win('codex_7d', l.secondary, 10080)], files, origin: l.origin ?? 'logs' }
}
