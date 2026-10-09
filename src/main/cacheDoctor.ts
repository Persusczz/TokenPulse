import { fmtTokens } from '@shared/format'
import type { CacheReport, RangeKey, SourceView } from '@shared/types'
import type { CostedEntry } from './aggregate'

/** $/MTok */
export interface CachePrices {
  input: number
  cacheRead: number
  cacheWrite5m: number
  cacheWrite1h: number
}

const MIN = 60_000
const GAPS = [
  { label: '5–10 分钟', max: 10 * MIN },
  { label: '10–30 分钟', max: 30 * MIN },
  { label: '30–60 分钟', max: 60 * MIN },
  { label: '1 小时以上', max: Infinity }
]
/** a rewrite this small is ordinary growth, not a lost cache */
const MIN_WRITE = 20_000
/** OpenAI keeps a prompt prefix cached for about 5–10 minutes of inactivity */
const CODEX_TTL = 10 * MIN

/**
 * Prompt caches expire. Claude's lives 5 minutes (1 hour for 1h writes): a
 * request after a longer pause writes the whole context again at 1.25x the
 * input price instead of reading it at 0.1x. OpenAI (Codex) caches by itself
 * without a write charge, but after a pause the prefix is billed at the full
 * input price instead of the cached one. Counts those misses in [from, to)
 * and what they cost beyond a cache hit. Entries sorted by time.
 */
export function diagnoseCache(
  entries: CostedEntry[],
  range: RangeKey,
  source: SourceView,
  from: number,
  to: number,
  price: (model: string) => CachePrices | null,
  money: (usd: number) => string
): CacheReport {
  const last = new Map<string, CostedEntry>()
  const gaps = GAPS.map((g) => ({ label: g.label, count: 0, extra: 0 }))
  const sessions = new Map<string, CacheReport['sessions'][number]>()
  let rebuilds = 0
  let extra = 0
  let total = 0
  let writeCost = 0
  let rebuildTokens = 0
  let read = 0
  let prompt = 0
  let cacheUnreported = 0

  for (const e of entries) {
    const codex = e.source === 'codex'
    if ((source !== 'all' && (e.source ?? 'claude') !== source) || e.side) continue
    const prev = e.sessionId ? last.get(e.sessionId) : undefined
    if (e.sessionId) last.set(e.sessionId, e)
    if (e.ts < from || e.ts >= to) continue
    total += e.cost.total
    writeCost += e.cost.cacheWrite
    if (e.cacheReadKnown === false) cacheUnreported++
    else {
      read += e.cacheRead
      prompt += e.input + e.cacheWrite5m + e.cacheWrite1h + e.cacheRead
    }
    // WorkBuddy has model-specific cache policies; logs do not report a cache TTL.
    if (e.source === 'workbuddy') continue
    if (!prev) continue
    // mostly written (Claude) or billed at full price (Codex), not read: the cached prefix was gone
    const missed = codex ? e.input + e.cacheWrite5m : e.cacheWrite5m + e.cacheWrite1h
    if (missed < MIN_WRITE || missed < (missed + e.cacheRead) * 0.5) continue
    const gap = e.ts - prev.ts
    const ttl = codex ? CODEX_TTL : e.cacheWrite1h > 0 || prev.cacheWrite1h > 0 ? 60 * MIN : 5 * MIN
    if (gap <= ttl) continue
    const p = price(e.model)
    if (!p) continue
    const x = codex
      ? (missed * Math.max(0, p.input - p.cacheRead)) / 1e6
      : (e.cacheWrite5m * (p.cacheWrite5m - p.cacheRead) + e.cacheWrite1h * (p.cacheWrite1h - p.cacheRead)) / 1e6
    rebuilds++
    extra += x
    rebuildTokens += missed
    const g = gaps[GAPS.findIndex((b) => gap <= b.max)]
    g.count++
    g.extra += x
    const s = sessions.get(e.sessionId) ?? { sessionId: e.sessionId, project: e.project, rebuilds: 0, extra: 0, last: 0 }
    s.rebuilds++
    s.extra += x
    s.last = e.ts
    sessions.set(e.sessionId, s)
  }

  const avg = rebuilds ? rebuildTokens / rebuilds : 0
  const share = total > 0 ? extra / total : 0
  const writeShare = total > 0 ? writeCost / total : 0
  const who = source === 'workbuddy' ? 'WorkBuddy' : source === 'codex' ? 'Codex' : source === 'claude' ? 'Claude' : ''
  const tips: string[] = []
  if (cacheUnreported) tips.push(`有 ${cacheUnreported} 次 Harness 响应未报告缓存字段，命中率只按报告了缓存的响应计算。`)
  if (source === 'workbuddy') tips.push('WorkBuddy 只统计日志中的实际缓存命中；各模型未报告缓存有效期，不估算过期费用。')
  else if (!rebuilds) tips.push(total > 0 ? '这段时间没有发现缓存过期后的重写，继续保持。' : `这段时间没有${who ? ` ${who} ` : ''}用量。`)
  else {
    if (gaps[0].count >= 2) {
      tips.push(
        source === 'codex'
          ? `有 ${gaps[0].count} 次离开 5–10 分钟后回来：OpenAI 的提示缓存闲置几分钟就会清掉，回来后整段上下文按全价输入计费，命中缓存只要 1/10。`
          : `有 ${gaps[0].count} 次只离开了 5–10 分钟：缓存默认只保留 5 分钟，回来后的第一条消息会把整段上下文按 1.25 倍输入价重新写入，而命中缓存只要 0.1 倍。`
      )
    }
    if (avg >= 100_000) tips.push(`每次重写平均 ${fmtTokens(avg, 1)} token：会话越长，过期一次越贵。要离开较久时，先 /compact 压缩上下文或开新会话，重写量会小很多。`)
    if (gaps[3].count >= 2) tips.push(`有 ${gaps[3].count} 次隔了 1 小时以上才回到原会话：话题已经换了的话，开新会话比在长上下文里继续更省。`)
    if (share >= 0.12) tips.push(`过期重写占${who ? ` ${who} ` : ''}费用的 ${(share * 100).toFixed(0)}%：同时开着几个长会话来回切换时，切走超过 5 分钟的会话回来都要重写一次。`)
    if (source !== 'codex' && writeShare >= 0.3) tips.push(`缓存写入占了费用的 ${(writeShare * 100).toFixed(0)}%：连续提问时尽量在 5 分钟内跟进，长时间离开前先 /compact。`)
    if (!tips.length) tips.push(`重写一共多花了 ${money(extra)}，占比不高，不用特别在意。`)
  }
  return {
    range,
    source,
    rebuilds,
    extraCost: extra,
    totalCost: total,
    writeCost,
    hitRate: prompt > 0 ? read / prompt : 0,
    ...(cacheUnreported ? { cacheUnreported } : {}),
    avgRebuildTokens: avg,
    gaps,
    sessions: [...sessions.values()].sort((a, b) => b.extra - a.extra).slice(0, 5),
    tips
  }
}
