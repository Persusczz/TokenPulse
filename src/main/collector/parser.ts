import { basename } from 'node:path'
import type { PromptMark, ToolAction, UsageEntry } from '@shared/types'
import { claudeActions } from './actions'

export interface CostState {
  sessionId: string
  totalCostUSD: number
}

export type ParsedLine = { kind: 'usage'; entry: UsageEntry; actions: ToolAction[] } | { kind: 'cost'; state: CostState } | { kind: 'prompt'; prompt: PromptMark }

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** prompts are kept this long, enough for a list and a tooltip */
export const PROMPT_CHARS = 280

/** "/compact focus on x" from Claude Code's slash-command markup; null for other markup */
function promptText(raw: string): string | null {
  const t = raw.trim()
  if (!t || t.startsWith('[Request interrupted')) return null
  const cmd = /<command-name>([^<]*)<\/command-name>/.exec(t)
  if (cmd) {
    const args = /<command-args>([^<]*)<\/command-args>/.exec(t)?.[1]?.trim()
    return `${cmd[1].trim()}${args ? ` ${args}` : ''}`
  }
  // command output, caveats, hook reminders, background-task notices: not something the user typed
  if (/^<[a-z][\w-]*[\s>]/i.test(t)) return null
  return t
}

/** The full text of a message the user typed: a user line that is not a tool result, a subagent's prompt or injected meta text */
export function userPromptText(obj: any): string | null {
  if (obj.isSidechain === true || obj.isMeta === true || obj.isCompactSummary === true || obj.message?.role !== 'user') return null
  const c = obj.message.content
  let raw = ''
  if (typeof c === 'string') raw = c
  else if (Array.isArray(c)) {
    if (c.some((b: any) => b?.type === 'tool_result')) return null
    raw = c
      .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text)
      .join('\n')
    if (!raw && c.some((b: any) => b?.type === 'image')) raw = '[图片]'
  }
  return promptText(raw)
}

function parsePrompt(obj: any, fallbackProject: string): PromptMark | null {
  const text = userPromptText(obj)
  const ts = Date.parse(obj.timestamp)
  if (!text || Number.isNaN(ts) || typeof obj.sessionId !== 'string') return null
  const cwd = typeof obj.cwd === 'string' && obj.cwd ? obj.cwd : ''
  return {
    key: `${obj.sessionId}:${typeof obj.promptId === 'string' ? obj.promptId : (obj.uuid ?? ts)}`,
    sessionId: obj.sessionId,
    ts,
    text: text.replace(/\s+/g, ' ').slice(0, PROMPT_CHARS),
    project: cwd ? basename(cwd.replace(/[\\/]+$/, '')) || cwd : fallbackProject,
    source: 'claude'
  }
}

/**
 * Parse one transcript line. Assistant messages with usage (and the tool
 * calls on them), cost-state
 * snapshots and the user's own prompts matter; everything else is skipped
 * without a JSON.parse.
 */
export function parseLine(line: string, fallbackProject: string): ParsedLine | null {
  const isCost = line.startsWith('{"type":"cost-state"')
  // tool results are user lines too, often huge: their marker shows up early
  const isUser = !isCost && line.includes('"type":"user"') && !line.includes('"tool_use_id"') && !line.includes('"isSidechain":true')
  if (!isCost && !isUser && !line.includes('"usage"')) return null
  let obj: any
  try {
    obj = JSON.parse(line)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null

  if (obj.type === 'cost-state') {
    if (typeof obj.sessionId !== 'string') return null
    return { kind: 'cost', state: { sessionId: obj.sessionId, totalCostUSD: num(obj.totalCostUSD) } }
  }

  if (obj.type === 'user') {
    const prompt = parsePrompt(obj, fallbackProject)
    return prompt ? { kind: 'prompt', prompt } : null
  }
  if (obj.type !== 'assistant') return null
  const msg = obj.message
  const u = msg?.usage
  const model: unknown = msg?.model
  if (!u || typeof model !== 'string' || !model || model === '<synthetic>') return null
  const ts = Date.parse(obj.timestamp)
  if (Number.isNaN(ts)) return null

  const cacheTotal = num(u.cache_creation_input_tokens)
  let w5 = cacheTotal
  let w1h = 0
  if (u.cache_creation && typeof u.cache_creation === 'object') {
    w5 = num(u.cache_creation.ephemeral_5m_input_tokens)
    w1h = num(u.cache_creation.ephemeral_1h_input_tokens)
    if (w5 + w1h < cacheTotal) w5 += cacheTotal - w5 - w1h
  }

  const id = typeof msg.id === 'string' ? msg.id : ''
  const req = typeof obj.requestId === 'string' ? obj.requestId : ''
  const key = id || req ? `${id}:${req}` : String(obj.uuid ?? `${ts}:${model}`)
  const cwd = typeof obj.cwd === 'string' && obj.cwd ? obj.cwd : ''
  const project = cwd ? basename(cwd.replace(/[\\/]+$/, '')) || cwd : fallbackProject

  return {
    kind: 'usage',
    actions: claudeActions(obj, ts, project),
    entry: {
      key,
      ts,
      model,
      sessionId: typeof obj.sessionId === 'string' ? obj.sessionId : '',
      project,
      projectPath: cwd || fallbackProject,
      input: num(u.input_tokens),
      output: num(u.output_tokens),
      cacheWrite5m: w5,
      cacheWrite1h: w1h,
      cacheRead: num(u.cache_read_input_tokens),
      webSearch: num(u.server_tool_use?.web_search_requests),
      speed: u.speed === 'fast' ? 'fast' : 'standard',
      geo: typeof u.inference_geo === 'string' ? u.inference_geo : null,
      ...(obj.isSidechain === true ? { side: true } : {})
    }
  }
}
