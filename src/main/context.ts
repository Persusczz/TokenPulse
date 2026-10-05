import type { ContextAlert, SessionContext, UsageSource } from '@shared/types'
import type { CostedEntry } from './aggregate'
import { lowerBound } from './rate'

/** Everything sent with a request: new input plus what was read from or written to the cache */
export const contextOf = (e: CostedEntry): number => e.input + e.cacheRead + e.cacheWrite5m + e.cacheWrite1h

/** a drop to under this share of the previous request, from a sizeable context, is a compaction */
const COMPACT_RATIO = 0.55
const COMPACT_FROM = 30_000
const MAX_POINTS = 240

/** Requests of the session itself (subagents run in their own, smaller contexts) */
const own = (e: CostedEntry) => !e.side

/**
 * The context size of every request in a session, the compactions that shrank
 * it, and how fast it grows per request since the last one. `entries` must be
 * the session's entries, sorted by time.
 */
export function sessionContext(entries: CostedEntry[], warnAt: number | WarnFor): Omit<SessionContext, 'prompts'> | null {
  const list = entries.filter(own)
  if (!list.length) return null
  const first = list[0]
  const sizes = list.map(contextOf)
  const compactions: number[] = []
  let since = 0
  for (let i = 1; i < sizes.length; i++) {
    if (sizes[i - 1] >= COMPACT_FROM && sizes[i] < sizes[i - 1] * COMPACT_RATIO) {
      compactions.push(list[i].ts)
      since = i
    }
  }
  const n = sizes.length - since
  const growth = n > 1 ? (sizes[sizes.length - 1] - sizes[since]) / (n - 1) : 0
  // thin evenly, but keep the peaks and the drops visible
  const step = Math.max(1, Math.ceil(list.length / MAX_POINTS))
  const points: { t: number; tokens: number }[] = []
  for (let i = 0; i < list.length; i += step) {
    let k = i
    for (let j = i; j < Math.min(list.length, i + step); j++) if (sizes[j] > sizes[k]) k = j
    points.push({ t: list[k].ts, tokens: sizes[k] })
  }
  const last = list[list.length - 1]
  if (points[points.length - 1]?.t !== last.ts) points.push({ t: last.ts, tokens: sizes[sizes.length - 1] })
  const models = new Map<string, number>()
  for (const e of list) models.set(e.model, (models.get(e.model) ?? 0) + 1)
  const source = first.source ?? 'claude'
  const line = typeof warnAt === 'number' ? { window: 0, warnAt } : warnAt(last.model, source)
  return {
    sessionId: first.sessionId,
    project: first.project,
    source,
    model: [...models].sort((a, b) => b[1] - a[1])[0][0],
    points,
    latest: sizes[sizes.length - 1],
    peak: Math.max(...sizes),
    compactions,
    growthPerRequest: growth,
    requests: list.length,
    warnAt: line.warnAt,
    window: line.window || undefined
  }
}

/** Claude's standard window, and the long one some models offer */
export const CLAUDE_WINDOW = 200_000
export const CLAUDE_LONG_WINDOW = 1_000_000
/** when Codex has not said (gpt-5.x reports 258,400) */
export const CODEX_WINDOW = 258_400
/** automatic lines: worth compacting soon, and close to the automatic compaction */
export const CONTEXT_SOON = 0.7
export const CONTEXT_NEAR = 0.88

/**
 * The context window a model works with. Codex reports it in its logs; a
 * Claude model that has ever carried more than 200k tokens is a 1M one.
 */
export function windowOf(model: string, source: UsageSource, seenMax: number, codexWindows?: Map<string, number>): number {
  if (source === 'codex') return codexWindows?.get(model) ?? CODEX_WINDOW
  if (/\[1m\]|-1m$/i.test(model) || seenMax > CLAUDE_WINDOW) return CLAUDE_LONG_WINDOW
  return CLAUDE_WINDOW
}

/** The window and warning line for a session's model */
export type WarnFor = (model: string, source: UsageSource) => { window: number; warnAt: number }

/**
 * Every session active in the last `activeMs`, with the context of its
 * latest request against its own window and warning line.
 */
export function activeContexts(entries: CostedEntry[], now: number, warnFor: WarnFor, activeMs = 20 * 60_000): ContextAlert[] {
  const by = new Map<string, CostedEntry[]>()
  for (let i = lowerBound(entries, now - activeMs); i < entries.length && entries[i].ts <= now; i++) {
    const e = entries[i]
    if (!own(e) || !e.sessionId) continue
    const list = by.get(e.sessionId)
    if (list) list.push(e)
    else by.set(e.sessionId, [e])
  }
  const out: ContextAlert[] = []
  for (const list of by.values()) {
    const last = list[list.length - 1]
    const tokens = contextOf(last)
    const first = list[0]
    const source = last.source ?? 'claude'
    const { window, warnAt } = warnFor(last.model, source)
    out.push({
      sessionId: last.sessionId,
      project: last.project,
      source,
      tokens,
      warnAt,
      window,
      model: last.model,
      growthPerRequest: list.length > 1 ? Math.max(0, (tokens - contextOf(first)) / (list.length - 1)) : 0,
      at: last.ts
    })
  }
  return out.sort((a, b) => b.tokens - a.tokens)
}

/** Sessions active in the last `activeMs` whose latest request reached their warning line */
export function contextAlerts(entries: CostedEntry[], now: number, warnFor: WarnFor, activeMs = 20 * 60_000): ContextAlert[] {
  return activeContexts(entries, now, warnFor, activeMs).filter((a) => a.tokens >= a.warnAt)
}

/** 0 under the line, 1 past it, 2 close to the window (automatic compaction) or 1.5× a fixed line */
export function contextLevel(a: Pick<ContextAlert, 'tokens' | 'warnAt' | 'window'>, auto: boolean): 0 | 1 | 2 {
  if (a.tokens < a.warnAt) return 0
  return a.tokens >= (auto ? a.window * CONTEXT_NEAR : a.warnAt * 1.5) ? 2 : 1
}
