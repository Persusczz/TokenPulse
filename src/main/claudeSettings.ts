import { copyFile, readFile, writeFile } from 'node:fs/promises'

/** Hook timeout in seconds; a paused task waits at most one 5h window */
export const GUARD_TIMEOUT_S = 6 * 3600
const GUARD_RE = /tokenpulse[\\/]+guard\.cjs/i
const BRIDGE_RE = /tokenpulse[\\/]+statusline\.cjs/i

type Json = Record<string, any>

const mentions = (h: any, re: RegExp): boolean =>
  !!h && typeof h === 'object' && [h.command, ...(Array.isArray(h.args) ? h.args : [])].some((s) => typeof s === 'string' && re.test(s))

export function hasGuardHooks(cfg: Json): boolean {
  const pre = cfg?.hooks?.PreToolUse
  return Array.isArray(pre) && pre.some((g: any) => Array.isArray(g?.hooks) && g.hooks.some((h: any) => mentions(h, GUARD_RE)))
}

/** Removes every hook handler that runs the guard script, dropping groups and events left empty */
export function withoutGuardHooks(cfg: Json): Json {
  if (!cfg.hooks || typeof cfg.hooks !== 'object') return cfg
  const hooks: Json = {}
  for (const [event, groups] of Object.entries(cfg.hooks)) {
    if (!Array.isArray(groups)) {
      hooks[event] = groups
      continue
    }
    const kept = groups
      .map((g: any) => (Array.isArray(g?.hooks) ? { ...g, hooks: g.hooks.filter((h: any) => !mentions(h, GUARD_RE)) } : g))
      .filter((g: any) => !Array.isArray(g?.hooks) || g.hooks.length > 0)
    if (kept.length) hooks[event] = kept
  }
  const next: Json = { ...cfg, hooks }
  if (!Object.keys(hooks).length) delete next.hooks
  return next
}

/** Adds the guard before every tool call and every new prompt (exec form, no shell involved) */
export function withGuardHooks(cfg: Json, node: string, script: string): Json {
  const next = withoutGuardHooks(cfg)
  const handler = { type: 'command', command: node, args: [script], timeout: GUARD_TIMEOUT_S, statusMessage: 'TokenPulse 额度守卫' }
  const hooks = { ...(next.hooks ?? {}) }
  const list = (v: unknown) => (Array.isArray(v) ? v : [])
  hooks.PreToolUse = [...list(hooks.PreToolUse), { matcher: '*', hooks: [handler] }]
  hooks.UserPromptSubmit = [...list(hooks.UserPromptSubmit), { hooks: [handler] }]
  return { ...next, hooks }
}

export function hasBridgeStatusline(cfg: Json): boolean {
  return mentions(cfg?.statusLine, BRIDGE_RE)
}

/**
 * Points the statusline at the bridge. Returns the statusline that was there
 * before (unless it already was the bridge) so the bridge can keep running it.
 */
export function withBridgeStatusline(cfg: Json, node: string, script: string): { next: Json; prev: Json | null } {
  const cur = cfg.statusLine
  const prev = cur && typeof cur === 'object' && !hasBridgeStatusline(cfg) ? cur : null
  const statusLine: Json = { type: 'command', command: `"${node}" "${script}"` }
  const interval = (prev ?? cur)?.refreshInterval
  if (typeof interval === 'number') statusLine.refreshInterval = interval
  return { next: { ...cfg, statusLine }, prev }
}

export function withoutBridgeStatusline(cfg: Json, prev: Json | null): Json {
  if (!hasBridgeStatusline(cfg)) return cfg
  const next = { ...cfg }
  if (prev) next.statusLine = prev
  else delete next.statusLine
  return next
}

/** Read-modify-write of Claude Code's settings.json, keeping a backup of the previous content */
export async function editClaudeSettings(path: string, fn: (cfg: Json) => Json): Promise<Json> {
  let text: string | null = null
  try {
    text = await readFile(path, 'utf8')
  } catch {
    /* no settings yet */
  }
  let cfg: Json = {}
  if (text && text.trim()) {
    const parsed = JSON.parse(text.replace(/^﻿/, ''))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('settings.json 不是 JSON 对象')
    cfg = parsed
  }
  const next = fn(cfg)
  if (JSON.stringify(next) === JSON.stringify(cfg)) return cfg
  if (text !== null) await copyFile(path, `${path}.tokenpulse.bak`)
  await writeFile(path, JSON.stringify(next, null, 2) + '\n', 'utf8')
  return next
}

export async function readClaudeSettings(path: string): Promise<Json> {
  try {
    const v = JSON.parse((await readFile(path, 'utf8')).replace(/^﻿/, ''))
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}
