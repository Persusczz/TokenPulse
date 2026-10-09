import { open, stat } from 'node:fs/promises'
import type { Dialogue, DialogueItem, UsageSource } from '@shared/types'
import { codexUserText } from './collector/codex'
import { userPromptText } from './collector/parser'
import { readLinesFrom } from './collector/store'

/**
 * A conversation read back from its log for the galaxy view: what the user
 * typed, what the assistant answered, the tools it reached for in between
 * (counted by name), and where the context was compacted.
 */

/** texts longer than this are cut */
const TEXT_MAX = 2400
/** a very long conversation keeps its latest steps */
const ITEMS_MAX = 800
const CHUNK = 4 << 20

export class Steps {
  items: DialogueItem[] = []
  private replyId: string | null = null

  private text(t: string): { text: string; cut?: boolean } {
    const s = t.trim()
    return s.length > TEXT_MAX ? { text: `${s.slice(0, TEXT_MAX)}…`, cut: true } : { text: s }
  }

  prompt(ts: number, t: string): void {
    const last = this.items[this.items.length - 1]
    // some versions log the same message twice
    if (last?.kind === 'prompt' && last.text === this.text(t).text && Math.abs(last.ts - ts) < 5000) return
    this.items.push({ kind: 'prompt', ts, ...this.text(t) })
    this.replyId = null
  }

  /** an answer; pieces of one message (same id) join into one */
  reply(ts: number, t: string, id: string | null = null): void {
    if (!t.trim()) return
    const last = this.items[this.items.length - 1]
    if (last?.kind === 'reply' && id && id === this.replyId) {
      const joined = this.text(`${last.text}\n\n${t}`)
      last.text = joined.text
      if (joined.cut) last.cut = true
      return
    }
    if (last?.kind === 'reply' && last.text === this.text(t).text && Math.abs(last.ts - ts) < 5000) return
    this.items.push({ kind: 'reply', ts, ...this.text(t) })
    this.replyId = id
  }

  tool(ts: number, name: string, n = 1): void {
    const last = this.items[this.items.length - 1]
    if (last?.kind === 'tools') {
      const t = last.tools!.find((x) => x.name === name)
      if (t) t.n += n
      else last.tools!.push({ name, n })
      return
    }
    this.items.push({ kind: 'tools', ts, tools: [{ name, n }] })
    this.replyId = null
  }

  compact(ts: number): void {
    this.items.push({ kind: 'compact', ts })
    this.replyId = null
  }

  done(sessionId: string, source: UsageSource): Dialogue {
    for (const it of this.items) if (it.tools) it.tools.sort((a, b) => b.n - a.n)
    const skipped = Math.max(0, this.items.length - ITEMS_MAX)
    return { sessionId, source, items: skipped ? this.items.slice(skipped) : this.items, skipped }
  }
}

/** Claude Code's tool names, shortened: MCP tools by their own name, subagents as such */
function claudeTool(name: string): string {
  if (name === 'Task' || name === 'Agent') return '子代理'
  return name.startsWith('mcp__') ? (name.split('__').pop() ?? name) : name
}

/** A Claude Code session: its own lines from each log it was written to, oldest first */
export async function claudeDialogue(files: string[], sessionId: string): Promise<Dialogue> {
  const marker = `"sessionId":"${sessionId}"`
  const lines: { ts: number; i: number; obj: any }[] = []
  const seen = new Set<string>()
  let i = 0
  for (const path of files) {
    let size: number
    try {
      size = (await stat(path)).size
    } catch {
      continue
    }
    await readLinesFrom(path, 0, size, (line) => {
      if (!line.includes(marker) || line.includes('"isSidechain":true')) return
      const user = line.includes('"type":"user"')
      if (!user && !line.includes('"type":"assistant"') && !line.includes('"compact_boundary"')) return
      // tool results: the answer to a tool, not a step of the conversation
      if (user && line.includes('"tool_use_id"')) return
      let obj: any
      try {
        obj = JSON.parse(line)
      } catch {
        return
      }
      if (obj?.sessionId !== sessionId) return
      const id = typeof obj.uuid === 'string' ? obj.uuid : ''
      if (id) {
        if (seen.has(id)) return
        seen.add(id)
      }
      const ts = Date.parse(obj.timestamp)
      if (!Number.isNaN(ts)) lines.push({ ts, i: i++, obj })
    })
  }
  lines.sort((a, b) => a.ts - b.ts || a.i - b.i)
  const steps = new Steps()
  for (const { ts, obj } of lines) {
    if (obj.type === 'system') {
      if (obj.subtype === 'compact_boundary') steps.compact(ts)
      continue
    }
    if (obj.type === 'user') {
      const t = userPromptText(obj)
      if (t) steps.prompt(ts, t)
      continue
    }
    const msg = obj.message
    if (obj.type !== 'assistant' || !msg || msg.model === '<synthetic>' || !Array.isArray(msg.content)) continue
    for (const b of msg.content) {
      if (b?.type === 'text' && typeof b.text === 'string') steps.reply(ts, b.text, typeof msg.id === 'string' ? msg.id : null)
      else if (b?.type === 'tool_use' && typeof b.name === 'string') steps.tool(ts, claudeTool(b.name))
    }
  }
  return steps.done(sessionId, 'claude')
}

const texts = (content: unknown): string =>
  Array.isArray(content)
    ? content
        .filter((c: any) => typeof c?.text === 'string')
        .map((c: any) => c.text)
        .join('\n')
    : ''

/** Codex's completed items, by the name shown for them */
const CODEX_TOOL: Record<string, string> = {
  CommandExecution: '命令',
  FileChange: '改文件',
  ImageView: '看图',
  WebSearch: '搜索',
  ImageGeneration: '生成图片'
}

/** a line's head names its record; items name their type after the thread and turn ids */
const HEAD = 220
const ITEM_HEAD = 420

/** A Codex session (one log per session): only the lines that are steps are decoded */
export async function codexDialogue(path: string, sessionId: string): Promise<Dialogue> {
  const steps = new Steps()
  const take = (line: string) => {
    let j: any
    try {
      j = JSON.parse(line)
    } catch {
      return
    }
    if (j?.type !== 'event_msg') return
    const p = j.payload ?? {}
    const ts = Date.parse(j.timestamp) || 0
    if (p.type === 'user_message' && typeof p.message === 'string') {
      const t = codexUserText(p.message)
      if (t) steps.prompt(ts, t)
      return
    }
    if (p.type === 'agent_message' && typeof p.message === 'string') return steps.reply(ts, p.message)
    if (p.type !== 'item_completed' || !p.item) return
    const it = p.item
    switch (it.type) {
      case 'UserMessage': {
        const t = codexUserText(texts(it.content))
        if (t) steps.prompt(ts, t)
        return
      }
      case 'AgentMessage':
        return steps.reply(ts, texts(it.content), typeof it.id === 'string' ? it.id : null)
      case 'McpToolCall':
        return steps.tool(ts, typeof it.tool === 'string' ? it.tool : 'MCP')
      case 'Extension':
        return steps.tool(ts, it.kind === 'web.search' ? '搜索' : typeof it.kind === 'string' ? it.kind : '扩展')
      case 'SubAgentActivity':
        if (it.kind === 'started') steps.tool(ts, '子代理')
        return
      case 'FileChange':
        return steps.tool(ts, '改文件', Math.max(1, it.changes && typeof it.changes === 'object' ? Object.keys(it.changes).length : 1))
      case 'ContextCompaction':
        return steps.compact(ts)
      default:
        if (CODEX_TOOL[it.type]) steps.tool(ts, CODEX_TOOL[it.type])
    }
  }
  let size: number
  try {
    size = (await stat(path)).size
  } catch {
    return steps.done(sessionId, 'codex')
  }
  const fh = await open(path, 'r')
  let pos = 0
  let carry: Buffer = Buffer.alloc(0)
  const consider = (data: Buffer, a: number, b: number) => {
    const head = data.toString('latin1', a, Math.min(b, a + HEAD))
    if (head.includes('"user_message"') || head.includes('"agent_message"')) return take(data.toString('utf8', a, b))
    if (head.includes('"item_completed"')) {
      const h2 = data.toString('latin1', a, Math.min(b, a + ITEM_HEAD))
      if (!h2.includes('"Reasoning"')) take(data.toString('utf8', a, b))
    }
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
        if (nl > start) consider(data, start, nl)
        start = nl + 1
      }
      carry = Buffer.from(data.subarray(start))
    }
    if (carry.length) consider(carry, 0, carry.length)
  } finally {
    await fh.close()
  }
  return steps.done(sessionId, 'codex')
}
