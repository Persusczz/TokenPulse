import type { ActionKind, ToolAction } from '@shared/types'

/**
 * Tool calls in the logs. Claude Code writes each tool_use block on an
 * assistant line (already decoded for its usage); Codex logs a completed
 * item per command, file change, search or MCP call. An edit also carries
 * how many lines it wrote and took out, counted from its own input.
 */

const CLAUDE_KIND: Record<string, ActionKind> = {
  Bash: 'run',
  PowerShell: 'run',
  BashOutput: 'run',
  Read: 'read',
  Grep: 'read',
  Glob: 'read',
  LS: 'read',
  NotebookRead: 'read',
  Edit: 'edit',
  MultiEdit: 'edit',
  Write: 'edit',
  NotebookEdit: 'edit',
  WebFetch: 'web',
  WebSearch: 'web',
  Task: 'agent',
  Agent: 'agent'
}

export const claudeKind = (name: string): ActionKind => CLAUDE_KIND[name] ?? (name.startsWith('mcp__') ? 'mcp' : 'other')

/** "mcp__server__tool" → "server · tool" */
const claudeName = (name: string) => {
  const m = /^mcp__(.+?)__(.+)$/.exec(name)
  return m ? `${m[1]} · ${m[2]}` : name
}

const linesOf = (s: string): string[] => {
  if (!s) return []
  const l = s.replace(/\r/g, '').split('\n')
  if (l[l.length - 1] === '') l.pop()
  return l
}

/** lines in `after` that `before` didn't have, and the other way round (as multisets, so moved lines don't count) */
export function lineDiff(before: string, after: string): [added: number, removed: number] {
  const left = new Map<string, number>()
  for (const l of linesOf(before)) left.set(l, (left.get(l) ?? 0) + 1)
  let added = 0
  for (const l of linesOf(after)) {
    const n = left.get(l) ?? 0
    if (n > 0) left.set(l, n - 1)
    else added++
  }
  let removed = 0
  for (const n of left.values()) removed += n
  return [added, removed]
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** the lines and file of one Claude edit tool's input */
function claudeEdit(name: string, input: any): Pick<ToolAction, 'added' | 'removed' | 'files'> {
  if (!input || typeof input !== 'object') return {}
  const file = str(input.file_path) || str(input.notebook_path)
  let added = 0
  let removed = 0
  if (name === 'Edit') [added, removed] = lineDiff(str(input.old_string), str(input.new_string))
  else if (name === 'MultiEdit' && Array.isArray(input.edits))
    for (const e of input.edits) {
      const [a, r] = lineDiff(str(e?.old_string), str(e?.new_string))
      added += a
      removed += r
    }
  else if (name === 'Write') added = linesOf(str(input.content)).length
  else if (name === 'NotebookEdit') added = linesOf(str(input.new_source)).length
  return { added, removed, ...(file ? { files: [{ path: file, added, removed }] } : {}) }
}

/** the tool calls on one decoded Claude assistant line */
export function claudeActions(obj: any, ts: number, project: string): ToolAction[] {
  const content = obj?.message?.content
  if (!Array.isArray(content)) return []
  const out: ToolAction[] = []
  for (const b of content) {
    if (b?.type !== 'tool_use' || typeof b.name !== 'string' || typeof b.id !== 'string') continue
    const kind = claudeKind(b.name)
    out.push({
      key: b.id,
      ts,
      sessionId: typeof obj.sessionId === 'string' ? obj.sessionId : '',
      project,
      source: 'claude',
      kind,
      name: claudeName(b.name),
      ...(kind === 'edit' ? claudeEdit(b.name, b.input) : {})
    })
  }
  return out
}

// ---------------------------------------------------------------- Codex

/** completed item types that are tool calls, by how they are shown */
const CODEX_ITEM: Record<string, { kind: ActionKind; name: string }> = {
  CommandExecution: { kind: 'run', name: 'Shell' },
  FileChange: { kind: 'edit', name: 'apply_patch' },
  McpToolCall: { kind: 'mcp', name: 'MCP' },
  WebSearch: { kind: 'web', name: 'web_search' },
  Extension: { kind: 'other', name: '扩展' },
  ImageView: { kind: 'read', name: 'view_image' },
  ImageGeneration: { kind: 'other', name: 'image_gen' },
  SubAgentActivity: { kind: 'agent', name: '子代理' },
  CollabAgentToolCall: { kind: 'agent', name: '子代理' },
  Plan: { kind: 'other', name: 'update_plan' }
}

/** a completed item's type, when it is a tool call (from the line's head) */
export function codexItemType(head: string): string | null {
  const m = /"item":\{"type":"(\w+)"/.exec(head)
  return m && CODEX_ITEM[m[1]] ? m[1] : null
}

const field = (head: string, name: string) => new RegExp(`"${name}":"((?:[^"\\\\]|\\\\.)*)"`).exec(head)?.[1] ?? ''

/**
 * A tool call read from the first few hundred bytes of its line: commands
 * and MCP calls carry their whole output, which is never decoded.
 */
export function codexHeadAction(head: string, sessionId: string, project: string): ToolAction | null {
  const type = codexItemType(head)
  if (!type || type === 'FileChange') return null
  const ts = Date.parse(field(head, 'timestamp'))
  const item = head.slice(head.indexOf('"item":{'))
  const id = field(item, 'id')
  if (!ts || !id) return null
  const kind = field(item, 'kind')
  // a subagent is counted once, when it starts
  if (type === 'SubAgentActivity' && kind && kind !== 'started') return null
  const def = CODEX_ITEM[type]
  const web = type === 'Extension' && kind === 'web.search'
  const server = field(item, 'server')
  const tool = field(item, 'tool')
  return {
    key: `codex:${id}`,
    ts,
    sessionId,
    project,
    source: 'codex',
    kind: web ? 'web' : def.kind,
    name: web ? 'web_search' : type === 'McpToolCall' && tool ? (server ? `${server} · ${tool}` : tool) : type === 'Extension' && kind ? kind : def.name
  }
}

/** a decoded FileChange item: the files and the lines its diffs add and remove */
export function codexFileChange(j: any, sessionId: string, project: string): ToolAction | null {
  const it = j?.payload?.item
  const ts = Date.parse(j?.timestamp)
  if (it?.type !== 'FileChange' || typeof it.id !== 'string' || !ts) return null
  const files: { path: string; added: number; removed: number }[] = []
  for (const [path, c] of Object.entries<any>(it.changes && typeof it.changes === 'object' ? it.changes : {})) {
    const f = { path, added: 0, removed: 0 }
    if (c?.type === 'add') f.added = linesOf(str(c.content)).length
    else if (c?.type === 'delete') f.removed = linesOf(str(c.content)).length
    else
      for (const l of linesOf(str(c?.unified_diff))) {
        if (l.startsWith('+') && !l.startsWith('+++')) f.added++
        else if (l.startsWith('-') && !l.startsWith('---')) f.removed++
      }
    files.push(f)
  }
  const sum = (k: 'added' | 'removed') => files.reduce((n, f) => n + f[k], 0)
  return { key: `codex:${it.id}`, ts, sessionId, project, source: 'codex', kind: 'edit', name: 'apply_patch', added: sum('added'), removed: sum('removed'), files }
}
