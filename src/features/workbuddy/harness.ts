import { existsSync } from 'node:fs'
import { open, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { zstdDecompress } from 'node:zlib'
import type { PromptMark } from '@shared/types'
import { claudeActions } from '../../main/collector/actions'
import { PROMPT_CHARS } from '../../main/collector/parser'
import type { WorkBuddyLine } from './collector'

export const isHarnessFile = (path: string): boolean => basename(path) === 'session.v3.jsonl.zstd'
export const isHarnessSession = (id: string): boolean => id.startsWith('workbuddy:harness:')

const harnessAppData = (): string => process.env.APPDATA || (process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support') : process.env.XDG_CONFIG_HOME || join(homedir(), '.config'))

export function harnessDirs(roots = [
  join(homedir(), '.dsh'),
  join(harnessAppData(), 'dsh-desktop', 'harness'),
  join(harnessAppData(), '@deepseek-ai', 'dsh-desktop', 'dsh-home'),
  join(harnessAppData(), 'HarnessXiaoxi', 'engine')
]): string[] {
  return [...new Set(roots.flatMap((p) => existsSync(join(p, 'sessions')) ? [resolve(p, 'sessions')] : basename(p) === 'sessions' && existsSync(p) ? [resolve(p)] : []))]
}

export async function listWorkBuddyLogs(dir: string): Promise<string[]> {
  try { return (await readdir(dir, { recursive: true })).filter((p) => p.endsWith('.jsonl') || isHarnessFile(p)).map((p) => join(dir, p)) }
  catch { return [] }
}

/** Check block boundaries first: Node's Zstd decoder accepts incomplete frames without throwing. */
function frameEnd(data: Buffer, start: number): number | null {
  if (data.length - start < 5 || data.readUInt32LE(start) !== 0xfd2fb528) return null
  const desc = data[start + 4]
  if (desc & 8) return null
  const single = !!(desc & 32)
  const fcs = desc >> 6
  let pos = start + 5 + (single ? 0 : 1) + [0, 1, 2, 4][desc & 3] + (fcs === 0 ? (single ? 1 : 0) : [0, 2, 4, 8][fcs])
  for (;;) {
    if (data.length - pos < 3) return null
    const block = data.readUIntLE(pos, 3)
    const kind = (block >> 1) & 3
    if (kind === 3) return null
    pos += 3 + (kind === 1 ? 1 : block >> 3)
    if (pos > data.length) return null
    if (block & 1) {
      pos += desc & 4 ? 4 : 0
      return pos <= data.length ? pos : null
    }
  }
}

/** DSH appends one complete Zstd frame per event. Keep a torn frame for the next read. */
export async function readHarnessEvents(path: string, offset: number, onEvent: (event: any) => void): Promise<number> {
  const fh = await open(path, 'r')
  let data: Buffer
  try {
    const size = (await fh.stat()).size
    if (size <= offset) return offset
    data = Buffer.allocUnsafe(size - offset)
    const { bytesRead } = await fh.read(data, 0, data.length, offset)
    data = data.subarray(0, bytesRead)
  } finally { await fh.close() }
  let pos = 0
  while (pos < data.length) {
    const end = frameEnd(data, pos)
    if (end === null) break
    let decoded: Buffer
    try {
      decoded = await new Promise((res, rej) => zstdDecompress(data.subarray(pos, end), (err, result) => err ? rej(err) : res(result)))
    } catch { break }
    for (const line of decoded.toString('utf8').split('\n')) {
      let event: any
      try { event = JSON.parse(line) } catch { continue }
      onEvent(event)
    }
    pos = end
  }
  return offset + pos
}

export interface HarnessState {
  sessionId?: string
  cwd?: string
  side?: boolean
  prompt?: PromptMark
  requestWindows?: Map<string, number>
}
const num = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
export const harnessText = (content: unknown): string => typeof content === 'string' ? content : Array.isArray(content) ? content.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n') : ''

/** Recognize individual receipts, never all historical traffic of a provider that changed upstreams. */
export function isHarnessWorkBuddySource(source: any, providers: readonly string[], auto: boolean): boolean {
  if (typeof source?.provider !== 'string') return false
  if (providers.includes(source.provider)) return true
  return auto && source.provider !== 'workbuddy-ai' && typeof source.replayState?.response?.responseId === 'string' && /^cmb-[A-Za-z0-9_-]+$/.test(source.replayState.response.responseId)
}

/** DSH inputTokens already excludes cacheReadTokens. */
export function parseHarnessEvent(event: any, state: HarnessState, providers: readonly string[] = ['workbuddy'], auto = true): WorkBuddyLine | null {
  if (event?.type === 'session') {
    if (typeof event.id === 'string') state.sessionId = `workbuddy:harness:${event.id}`
    state.cwd = typeof event.cwd === 'string' ? event.cwd : ''
    state.side = num(event.delegationDepth) > 0
    return null
  }
  const ts = event?.time
  if (!state.sessionId || typeof ts !== 'number' || !Number.isFinite(ts)) return null
  const sessionId = state.sessionId
  const project = basename((state.cwd || '').replace(/[\\/]+$/, '')) || 'Harness'
  const d = event.data ?? {}
  if (event.type === 'request/context') {
    if (typeof d.provider === 'string' && typeof d.model === 'string' && typeof d.contextWindow === 'number' && Number.isFinite(d.contextWindow) && d.contextWindow > 0) {
      (state.requestWindows ??= new Map()).set(d.provider + ':' + d.model, d.contextWindow)
    }
    return null
  }
  if (event.type === 'user/message') {
    if (d.source?.kind && d.source.kind !== 'user') return null
    const text = harnessText(d.content).trim()
    if (text && !state.side) state.prompt = { key: `${sessionId}:${d.id ?? event.seq}`, sessionId, ts, project, source: 'workbuddy', text: text.replace(/\s+/g, ' ').slice(0, PROMPT_CHARS) }
    return null
  }
  const compact = event.type === 'compaction/summary'
  const source = compact ? d : d.message?.source
  if ((!compact && event.type !== 'assistant/message') || !isHarnessWorkBuddySource(source, providers, auto) || typeof source.model !== 'string') return null
  const id = source.replayState?.response?.responseId
  const key = typeof id === 'string' && id ? `workbuddy:harness:response:${id}` : `${sessionId}:${compact ? 'compact:' + d.compactionId : d.message?.id ?? event.seq}`
  // DSH's lower-case tools take WorkBuddy's names, so read and Read count as one tool
  const toolNames: Record<string, string> = { pwsh: 'PowerShell', bash: 'Bash', read: 'Read', grep: 'Grep', glob: 'Glob', read_image: 'Read', edit: 'Edit', write: 'Write', web_search: 'WebSearch', web_fetch: 'WebFetch', subagent: 'Agent' }
  const calls = (Array.isArray(d.message?.content) ? d.message.content : []).filter((b: any) => b?.type === 'tool-call' && typeof b.id === 'string' && typeof b.name === 'string')
  const actions = calls.flatMap((b: any) => {
    let input = b.arguments
    if (typeof input === 'string') { try { input = JSON.parse(input) } catch { input = {} } }
    return claudeActions({ sessionId, message: { content: [{ type: 'tool_use', id: `${key}:${b.id}`, name: toolNames[b.name] ?? b.name, input }] } }, ts, project).map((a) => ({ ...a, source: 'workbuddy' as const }))
  })
  const out: WorkBuddyLine = { actions, ...(state.prompt ? { prompt: state.prompt } : {}) }
  state.prompt = undefined
  const u = d.usage
  if (!u || typeof u.inputTokens !== 'number' || typeof u.outputTokens !== 'number' || !Number.isFinite(u.inputTokens) || !Number.isFinite(u.outputTokens) || u.inputTokens < 0 || u.outputTokens < 0) return out
  out.entry = {
    key, sessionId, ts, model: source.model, project, projectPath: state.cwd || '',
    input: u.inputTokens, output: u.outputTokens, cacheRead: num(u.cacheReadTokens),
    ...(typeof u.cacheReadTokens === 'number' && Number.isFinite(u.cacheReadTokens) && u.cacheReadTokens >= 0 ? {} : { cacheReadKnown: false }),
    cacheWrite5m: num(u.cacheWriteTokens), cacheWrite1h: 0, webSearch: 0, speed: 'standard', geo: null,
    source: 'workbuddy', ...(state.side ? { side: true } : {})
  }
  return out
}
