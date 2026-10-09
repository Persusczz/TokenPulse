import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type { PromptMark, ToolAction, UsageEntry } from '@shared/types'
import { claudeActions } from '../../main/collector/actions'
import { PROMPT_CHARS } from '../../main/collector/parser'
import { readLinesFrom } from '../../main/collector/store'
import { normalizeModelId } from '../../main/pricing/resolve'
import { isHarnessFile, listWorkBuddyLogs, parseHarnessEvent, readHarnessEvents, type HarnessState } from './harness'

export const workbuddyRoot = (): string => resolve(process.env.WORKBUDDY_CONFIG_DIR || join(homedir(), '.workbuddy'))

export function workbuddyDirs(root = workbuddyRoot(), extra: string[] = []): string[] {
  return [...new Set([join(root, 'projects'), ...extra.map((p) => existsSync(join(p, 'projects')) ? join(p, 'projects') : existsSync(join(p, 'sessions')) ? join(p, 'sessions') : resolve(p))])].filter(existsSync)
}

export interface WorkBuddyLine {
  entry?: UsageEntry
  prompt?: PromptMark
  actions: ToolAction[]
}

const num = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
export const workbuddySession = (id: string): string => `workbuddy:${id}`
export const nativeSession = (id: string): string => id.replace(/^workbuddy:/, '')
export const workbuddyTimestamp = (v: unknown): number => typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN
/** WorkBuddy writes input_text (user) and output_text (assistant) blocks; plain text blocks also occur. */
const TEXT_BLOCKS = new Set(['text', 'input_text', 'output_text'])
export const workbuddyText = (content: unknown): string => typeof content === 'string' ? content : Array.isArray(content) ? content.filter((b) => TEXT_BLOCKS.has(b?.type) && typeof b.text === 'string').map((b) => b.text).join('\n') : ''
export const isSubagentLog = (path: string): boolean => /[\\/]subagents[\\/]/.test(path)

/**
 * What the user typed. WorkBuddy wraps it in <user_query> after injected context; other user rows
 * (reminders, task notices, teammate messages, compaction summaries) were not typed by the user.
 */
export function workbuddyPromptText(obj: any): string | null {
  const data = obj?.providerData ?? {}
  if (obj?.isMeta || data.isMeta || data.isSubAgent || data.teammateMessage || data.isCompactInternal || data.isSummary) return null
  const raw = workbuddyText(obj.content)
  const image = Array.isArray(obj.content) && obj.content.some((b: any) => /image/.test(b?.type ?? ''))
  const queries = [...raw.matchAll(/<user_query>([\s\S]*?)<\/user_query>/g)].map((m) => m[1].trim()).filter(Boolean)
  if (queries.length) return queries.join('\n')
  const text = raw.trim()
  if (raw.includes('<user_query>') || !text) return image ? '[图片]' : null
  return /^<[a-z][\w-]*[\s>]/i.test(text) ? null : text
}

/** Native WorkBuddy JSONL: top-level messages/tool calls, inclusive input, and provider response ids. */
export function parseWorkBuddyLine(line: string, fallbackProject: string, subagent = false): WorkBuddyLine | null {
  if (!line.includes('"message"') && !line.includes('"function_call"')) return null
  let obj: any
  try { obj = JSON.parse(line) } catch { return null }
  if (!obj || !['message', 'function_call'].includes(obj.type) || typeof obj.sessionId !== 'string') return null
  const ts = workbuddyTimestamp(obj.timestamp)
  if (!Number.isFinite(ts)) return null
  const sessionId = workbuddySession(obj.sessionId)
  const cwd = typeof obj.cwd === 'string' ? obj.cwd : ''
  const project = cwd ? basename(cwd.replace(/[\\/]+$/, '')) || cwd : fallbackProject
  const out: WorkBuddyLine = { actions: [] }
  const data = obj.providerData ?? {}
  if (obj.type === 'message' && obj.role === 'user') {
    // a subagent transcript opens with its task from the parent agent
    const text = subagent ? null : workbuddyPromptText(obj)
    if (!text) return null
    out.prompt = { key: `${sessionId}:${obj.id ?? ts}`, sessionId, ts, project, source: 'workbuddy', text: text.replace(/\s+/g, ' ').slice(0, PROMPT_CHARS) }
    return out
  }
  if (obj.type === 'function_call' && typeof obj.name === 'string' && typeof obj.callId === 'string') {
    let input = obj.arguments
    if (typeof input === 'string') { try { input = JSON.parse(input) } catch { input = {} } }
    out.actions = claudeActions({ sessionId, message: { content: [{ type: 'tool_use', id: `${sessionId}:${obj.callId}`, name: obj.name, input }] } }, ts, project).map((a) => ({ ...a, source: 'workbuddy' }))
  }
  const raw = data.rawUsage ?? {}
  const u = obj.message?.usage ?? (typeof raw.credit === 'number' && Number.isFinite(raw.credit) && raw.credit >= 0 ? {} : null)
  const model = data.model || data.requestModelId
  if (!u || typeof model !== 'string' || !model || (obj.type === 'message' && obj.role !== 'assistant')) return out.actions.length ? out : null
  const cached = num(u.cache_read_input_tokens ?? raw.cache_read_input_tokens ?? raw.prompt_cache_hit_tokens ?? raw.prompt_tokens_details?.cached_tokens ?? raw.cached_tokens)
  const written = num(u.cache_creation_input_tokens ?? raw.cache_creation_input_tokens ?? raw.prompt_cache_write_tokens)
  const id = data.messageId || obj.id
  if (typeof id !== 'string' || !id) return out.actions.length ? out : null
  out.entry = {
    key: `${sessionId}:${id}`, sessionId, ts, model, project, projectPath: cwd,
    input: Math.max(0, (num(u.input_tokens) || num(raw.prompt_tokens)) - cached - written), output: num(u.output_tokens) || num(raw.completion_tokens),
    cacheRead: cached, cacheWrite5m: written, cacheWrite1h: 0, webSearch: 0, speed: 'standard', geo: null,
    source: 'workbuddy', ...(data.isSubAgent === true ? { side: true } : {}),
    ...(typeof raw.credit === 'number' && Number.isFinite(raw.credit) && raw.credit >= 0 ? { credit: raw.credit } : {})
  }
  return out
}

interface FileState { offset: number; keys: Set<string>; prompts: Set<string>; actions: Set<string>; harness?: HarnessState }

/** Uses the same incremental line reader as Claude, keeping WorkBuddy ids and ownership separate. */
export class WorkBuddyStore {
  readonly entries = new Map<string, UsageEntry>()
  readonly prompts = new Map<string, PromptMark>()
  readonly actions = new Map<string, ToolAction>()
  readonly contextWindows = new Map<string, number>()
  readonly harnessWindows = new Map<string, Map<string, number>>()
  readonly harnessProviders = new Set<string>()
  revision = 0
  private files = new Map<string, FileState>()
  private owners = new Map<string, string>()
  private sessionFiles = new Map<string, Set<string>>()

  constructor(readonly harnessProviderIds: string[] = ['workbuddy'], readonly harnessAuto = true, readonly harnessEnabled = true) {}

  get fileCount(): number { return this.files.size }
  filesOf(id: string): string[] { return [...(this.sessionFiles.get(id) ?? [])] }

  async readFile(path: string, dir: string): Promise<UsageEntry[]> {
    if (!this.harnessEnabled && isHarnessFile(path)) return []
    let size: number
    try { size = (await stat(path)).size } catch { return [] }
    let st = this.files.get(path)
    if (st && size < st.offset) {
      for (const k of st.keys) if (this.owners.get(k) === path) { this.entries.delete(k); this.owners.delete(k); this.revision++ }
      for (const k of st.prompts) if (this.owners.get(k) === path && this.prompts.delete(k)) { this.owners.delete(k); this.revision++ }
      for (const k of st.actions) if (this.owners.get(k) === path && this.actions.delete(k)) { this.owners.delete(k); this.revision++ }
      st = undefined
    }
    if (!st) { st = { offset: 0, keys: new Set(), prompts: new Set(), actions: new Set() }; this.files.set(path, st) }
    if (size === st.offset) return []
    const changed = new Map<string, UsageEntry>()
    const state = st
    const accept = (p: WorkBuddyLine | null) => {
      if (!p) return
      const sid = p.entry?.sessionId ?? p.prompt?.sessionId ?? p.actions[0]?.sessionId
      if (sid) { const files = this.sessionFiles.get(sid) ?? new Set<string>(); files.add(path); this.sessionFiles.set(sid, files) }
      if (p.prompt && !this.prompts.has(p.prompt.key)) { this.prompts.set(p.prompt.key, p.prompt); this.owners.set(p.prompt.key, path); state.prompts.add(p.prompt.key); this.revision++ }
      for (const a of p.actions) if (!this.actions.has(a.key)) { this.actions.set(a.key, a); this.owners.set(a.key, path); state.actions.add(a.key); this.revision++ }
      if (!p.entry) return
      let e = p.entry
      const prev = this.entries.get(e.key)
      if (prev) {
        const credit = e.credit === undefined ? prev.credit : prev.credit === undefined ? e.credit : Math.max(prev.credit, e.credit)
        e = { ...(prev.output >= e.output ? prev : e), ...(credit !== undefined ? { credit } : {}) }
        if (prev.output === e.output && prev.credit === e.credit) return
      }
      this.entries.set(e.key, e); this.owners.set(e.key, path); state.keys.add(e.key); this.revision++
      changed.set(e.key, e)
    }
    if (isHarnessFile(path)) {
      const hs = state.harness ??= {}
      state.offset = await readHarnessEvents(path, state.offset, (event) => {
        const provider = event?.data?.message?.source?.provider
        if (event?.type === 'assistant/message' && typeof provider === 'string') this.harnessProviders.add(provider)
        const parsed = parseHarnessEvent(event, hs, this.harnessProviderIds, this.harnessAuto)
        const source = event?.type === 'request/context' && this.harnessProviderIds.includes(event.data?.provider) ? event.data : parsed ? event.data?.message?.source ?? event.data : null
        const window = source && hs.requestWindows?.get(source.provider + ':' + source.model)
        if (hs.sessionId && source && window) {
          const model = normalizeModelId(source.model)
          const windows = this.harnessWindows.get(hs.sessionId) ?? new Map<string, number>()
          windows.set(model, window); this.harnessWindows.set(hs.sessionId, windows)
          if (!this.contextWindows.has(model)) this.contextWindows.set(model, window)
        }
        accept(parsed)
      })
    } else {
      const subagent = isSubagentLog(path)
      state.offset = await readLinesFrom(path, state.offset, size, (line) => accept(parseWorkBuddyLine(line, basename(dir), subagent)))
    }
    return [...changed.values()]
  }

  async scan(dirs: string[]): Promise<UsageEntry[]> {
    for (const dir of dirs) {
      const dbPath = join(dir, '..', 'workbuddy.db')
      if (!existsSync(dbPath)) continue
      try {
        const { DatabaseSync } = await import('node:sqlite')
        const db = new DatabaseSync(dbPath, { readOnly: true })
        try {
          for (const r of db.prepare('SELECT model, context_window FROM sessions WHERE context_window > 0').all()) {
            if (typeof r.model === 'string' && typeof r.context_window === 'number') this.contextWindows.set(normalizeModelId(r.model), r.context_window)
          }
        } finally { db.close() }
      } catch { /* older databases: transcript usage still works */ }
    }
    const added: UsageEntry[] = []
    for (const dir of dirs) for (const f of await listWorkBuddyLogs(dir)) added.push(...await this.readFile(f, dir))
    return added
  }

  async changedFiles(dirs: string[]): Promise<[string, string][]> {
    const changed: [string, string][] = []
    for (const dir of dirs) for (const f of await listWorkBuddyLogs(dir)) {
      if (!this.harnessEnabled && isHarnessFile(f)) continue
      try { if (this.files.get(f)?.offset !== (await stat(f)).size) changed.push([f, dir]) } catch { /* removed */ }
    }
    return changed
  }
}
