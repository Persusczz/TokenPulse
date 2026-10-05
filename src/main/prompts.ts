import type { PromptCost, PromptMark, PromptReport, RangeKey } from '@shared/types'
import { tokensOf, type CostedEntry } from './aggregate'

/** a response logged a moment before its prompt line still belongs to it */
const SKEW_MS = 2000

/** Prompts by session, oldest first */
export function indexPrompts(prompts: Iterable<PromptMark>): Map<string, PromptMark[]> {
  const by = new Map<string, PromptMark[]>()
  for (const p of prompts) {
    const list = by.get(p.sessionId)
    if (list) list.push(p)
    else by.set(p.sessionId, [p])
  }
  for (const list of by.values()) list.sort((a, b) => a.ts - b.ts)
  return by
}

/** The prompt an entry answers: the session's latest prompt at or before it */
function ownerOf(list: PromptMark[] | undefined, ts: number): PromptMark | null {
  if (!list?.length) return null
  let lo = 0
  let hi = list.length - 1
  if (list[0].ts > ts + SKEW_MS) return null
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (list[mid].ts <= ts + SKEW_MS) lo = mid
    else hi = mid - 1
  }
  return list[lo]
}

/**
 * Adds up everything each prompt set off (subagents included: they log under
 * the parent session) until the next prompt in the same session. Entries in
 * [from, to) count; a prompt is listed when any of its usage falls inside.
 */
export function costByPrompt(
  entries: CostedEntry[],
  index: Map<string, PromptMark[]>,
  from: number,
  to: number,
  modelLabel: (m: string) => string = (m) => m
): { list: PromptCost[]; unattributed: number } {
  const acc = new Map<string, PromptCost & { modelSet: Set<string> }>()
  let unattributed = 0
  for (const e of entries) {
    if (e.ts < from || e.ts >= to) continue
    const p = ownerOf(index.get(e.sessionId), e.ts)
    if (!p) {
      unattributed += e.cost.total
      continue
    }
    let c = acc.get(p.key)
    if (!c) {
      c = {
        key: p.key,
        sessionId: p.sessionId,
        project: p.project || e.project,
        source: p.source,
        ts: p.ts,
        text: p.text,
        cost: 0,
        tokens: 0,
        output: 0,
        requests: 0,
        durationMs: 0,
        models: [],
        modelSet: new Set()
      }
      acc.set(p.key, c)
    }
    c.cost += e.cost.total
    c.tokens += tokensOf(e)
    c.output += e.output
    c.requests++
    c.durationMs = Math.max(c.durationMs, e.ts - p.ts)
    c.modelSet.add(modelLabel(e.model))
  }
  const list = [...acc.values()].map(({ modelSet, ...c }) => ({ ...c, models: [...modelSet] }))
  return { list, unattributed }
}

export function promptReport(
  entries: CostedEntry[],
  index: Map<string, PromptMark[]>,
  range: RangeKey,
  from: number,
  to: number,
  modelLabel?: (m: string) => string,
  n = 10
): PromptReport {
  const { list, unattributed } = costByPrompt(entries, index, from, to, modelLabel)
  const costs = list.map((p) => p.cost).sort((a, b) => a - b)
  const total = costs.reduce((s, c) => s + c, 0)
  const mid = costs.length >> 1
  const median = !costs.length ? 0 : costs.length % 2 ? costs[mid] : (costs[mid - 1] + costs[mid]) / 2
  return {
    range,
    count: list.length,
    totalCost: total,
    avgCost: list.length ? total / list.length : 0,
    medianCost: median,
    top: list.sort((a, b) => b.cost - a.cost || b.tokens - a.tokens).slice(0, n),
    unattributedCost: unattributed
  }
}
