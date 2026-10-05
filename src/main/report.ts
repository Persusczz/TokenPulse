import type { Achievement, CodingSign, RangeSummary, ScheduledTask, ValueReport, WeeklyForecast } from '@shared/types'
import { escapeHtml } from './telegram'

export interface ReportInput {
  now: number
  today: RangeSummary
  five: { pct: number; resetsAt: number | null } | null
  week: { pct: number; resetsAt: number | null } | null
  forecast: WeeklyForecast | null
  value: ValueReport | null
  unlockedToday: Achievement[]
  /** refresh tasks that finished today */
  tasks?: ScheduledTask[]
  sign?: CodingSign
  /** today's quota remnants and your star, in one line */
  star?: string
  money: (usd: number) => string
}

const WEEK = '日一二三四五六'
export const cn = (n: number) => (n >= 1e8 ? `${(n / 1e8).toFixed(2)} 亿` : n >= 1e4 ? `${(n / 1e4).toFixed(n >= 1e7 ? 0 : 1)} 万` : String(Math.round(n)))
const hm = (t: number) => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
const mdw = (t: number) => {
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()} 周${WEEK[d.getDay()]}`
}

/** The day's report as Telegram HTML */
export function buildReport(r: ReportInput): string {
  const t = r.today.totals
  const lines: string[] = [`🌙 <b>TokenPulse 晚报</b> · ${mdw(r.now)}`, '']
  if (!t.messages) {
    lines.push('今天还没有使用 Claude Code，好好休息 ☕')
  } else {
    lines.push(`今日 <b>${cn(t.tokens)}</b> tokens · ${r.money(t.cost)}（API 等价）`)
    lines.push(`响应 ${t.messages} 次 · 会话 ${t.sessions} 个 · 缓存命中 ${(r.today.cacheHitRate * 100).toFixed(1)}%（省 ${r.money(t.costParts.cacheSavings)}）`)
    const busiest = r.today.buckets.reduce((a, b) => (b.tokens > a.tokens ? b : a), r.today.buckets[0])
    const extras: string[] = []
    if (busiest?.tokens) extras.push(`最忙 ${new Date(busiest.t).getHours()}:00–${new Date(busiest.t).getHours() + 1}:00`)
    if (r.today.byModel[0]) extras.push(`主力模型 ${escapeHtml(r.today.byModel[0].name)}`)
    if (r.today.byProject[0]) extras.push(`项目 ${escapeHtml(r.today.byProject[0].name)}`)
    if (extras.length) lines.push(extras.join(' · '))
  }
  lines.push('')
  if (r.five) lines.push(`5h 额度 ${Math.round(r.five.pct)}%${r.five.resetsAt ? `（${hm(r.five.resetsAt)} 重置）` : ''}`)
  if (r.week) {
    let w = `7 天额度 ${Math.round(r.week.pct)}%`
    const f = r.forecast
    if (f?.available) w += f.projectedPct >= 100 && f.etaFull ? ` · ⚠️ 按当前速度 ${mdw(f.etaFull)} ${hm(f.etaFull)} 用完` : ` · 预计重置时 ${Math.round(f.projectedPct)}%`
    lines.push(w)
    if (f?.available) lines.push(`建议每天 ≤ ${f.suggestPctPerDay.toFixed(1)}%`)
  }
  if (r.value && r.value.planPrice > 0) lines.push(`订阅回本：本月 ${r.value.multiple.toFixed(1)} 倍（${r.money(r.value.monthCost)} / ${r.money(r.value.planPrice)}）`)
  const done = r.tasks?.filter((t) => t.status === 'done' || (t.repeat && t.doneAt && t.doneAt >= r.now - 86_400_000)) ?? []
  const failed = r.tasks?.filter((t) => t.status === 'failed') ?? []
  if (done.length || failed.length) {
    const spent = done.reduce((a, t) => a + (t.costUsd ?? 0), 0)
    lines.push('', `🧩 刷新任务：完成 ${done.length} 个${failed.length ? ` · 没完成 ${failed.length} 个` : ''}${spent ? ` · ${r.money(spent)}` : ''}`)
    for (const t of [...done, ...failed].slice(0, 4)) lines.push(`${t.status === 'failed' ? '❌' : '✅'} ${escapeHtml(t.prompt.replace(/\s+/g, ' ').slice(0, 30))}`)
  }
  if (r.unlockedToday.length) lines.push('', `🏆 今日解锁：${r.unlockedToday.map((a) => escapeHtml(a.title)).join('、')}`)
  if (r.star) lines.push('', `⭐ ${r.star}`)
  if (r.sign) lines.push(...(r.star ? [] : ['']), `${r.sign.zodiac.symbol} 今日星座 ${r.sign.zodiac.name}：点亮 ${r.sign.zodiac.lit}/${r.sign.zodiac.stars} 颗星 · 编码星座「${escapeHtml(r.sign.name)}」`)
  return lines.join('\n')
}
