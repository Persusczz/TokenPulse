import type { Achievement, Cosmos, PromptReport, QuotaStar, RemnantKind, StarStage } from '@shared/types'
import { addDays, startOfDay, tokensOf, type CostedEntry } from './aggregate'
import { REMNANTS, STAGES } from './cosmos'
import { habitability } from '@shared/habitable'
import { escapeHtml } from './telegram'

/** Telegram text for the quota stars, the week, the costliest prompts and the achievements */

const STAGE_ICON: Record<StarStage, string> = { nebula: '🌫', protostar: '🟤', main: '🟡', giant: '🟠', supergiant: '🔴', supernova: '💥' }
const REMNANT_ICON: Record<RemnantKind, string> = { dwarf: '⚪', neutron: '🔵', nebula: '🟣', blackhole: '⚫' }
const hm = (t: number) => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
const WEEK = '日一二三四五六'
export const cnum = (n: number) => (n >= 1e8 ? `${(n / 1e8).toFixed(2)} 亿` : n >= 1e4 ? `${(n / 1e4).toFixed(n >= 1e7 ? 0 : 1)} 万` : String(Math.round(n)))

/** ▁▂▃▄▅▆▇█ for a row of values */
export function spark(values: number[]): string {
  const BARS = '▁▂▃▄▅▆▇█'
  const max = Math.max(...values, 0)
  return values.map((v) => (max > 0 && v > 0 ? BARS[Math.max(0, Math.min(7, Math.ceil((v / max) * 8) - 1))] : '·')).join('')
}

/** ▰▰▰▱▱ for a share 0–1 */
export const bar = (p: number, n = 10) => {
  const k = Math.round(Math.max(0, Math.min(1, p)) * n)
  return '▰'.repeat(k) + '▱'.repeat(n - k)
}

function starLine(s: QuotaStar): string[] {
  const stage = STAGES.find((x) => x.key === s.stage)!
  const tool = s.source === 'codex' ? 'Codex' : 'Claude'
  const out = [`${STAGE_ICON[s.stage]} <b>${tool} 5h 恒星：${stage.name}</b>（${Math.round(s.pct)}%）`]
  if (s.stage === 'supernova') out.push(`   已经爆发，${hm(s.end)} 刷新后从星云重生`)
  else {
    const nova = s.next.find((n) => n.stage === 'supernova')
    const giant = s.next.find((n) => n.stage === 'giant')
    if (nova?.at) out.push(`   照最近的速度 ${hm(nova.at)} 变成超新星（${hm(s.end)} 刷新）`)
    else if (giant?.at) out.push(`   照最近的速度 ${hm(giant.at)} 膨胀成红巨星，${hm(s.end)} 刷新`)
    else out.push(`   ${hm(s.end)} 刷新，会留下一颗${REMNANTS[s.fate].name}`)
  }
  const zone = (pct: number, rate: number, end: number) => {
    const h = habitability(pct, rate, end, Date.now())
    return h.zone === 'hot' ? `🔥 太热（${rate.toFixed(1)}%/时，宜居 ≤ ${h.ideal.toFixed(1)}%/时）` : h.zone === 'cold' ? `🧊 太冷（会浪费，可以多用）` : h.zone === 'empty' ? '⚫ 已燃尽' : '🌍 在宜居带里'
  }
  if (s.stage !== 'supernova') out.push(`   宜居带：${zone(s.pct, s.pctPerHour, s.end)}`)
  if (s.week) {
    const time = (Date.now() - s.week.start) / (s.week.end - s.week.start)
    const lead = Math.round(s.week.pct - s.week.ideal)
    out.push(`🪐 7 天轨道：已用 ${Math.round(s.week.pct)}%，时间过去 ${Math.round(time * 100)}% · ${lead > 0 ? `比匀速快 ${lead}%` : `比匀速慢 ${-lead}%`}`)
    const hoursLeft = Math.max(1 / 60, (s.week.end - Date.now()) / 3_600_000)
    out.push(`   宜居带：${zone(s.week.pct, Math.max(0, (s.week.projected - s.week.pct) / hoursLeft), s.week.end)}`)
  }
  return out
}

/** /star: the quota stars, the remnants of the last two weeks and the kind of star you are */
export function starLines(c: Cosmos): string[] {
  const lines = ['⭐ <b>额度星空</b>', '']
  if (c.stars.length) for (const s of c.stars) lines.push(...starLine(s))
  else lines.push('还没有额度数据：开启订阅额度监控后，每个 5 小时窗口都是一颗恒星')
  const count = (k: RemnantKind) => c.remnants.filter((r) => r.kind === k).length
  if (c.remnants.length) {
    lines.push('', `🌌 <b>最近 14 天的星骸</b>（${c.remnants.length} 个窗口）`)
    lines.push((['blackhole', 'nebula', 'neutron', 'dwarf'] as const).map((k) => `${REMNANT_ICON[k]} ${REMNANTS[k].name} ${count(k)}`).join(' · '))
  }
  if (c.meteors.length) {
    const bright = c.meteors.reduce((a, m) => (m.cost > a.cost ? m : a), c.meteors[0])
    lines.push('', `☄️ 今日流星雨：${c.meteors.length} 颗${c.zhr.at ? `，最密集的一小时（${hm(c.zhr.at)} 起）${c.zhr.rate} 颗` : ''}`, `   最亮的一颗：「${escapeHtml(bright.text.slice(0, 30))}」`)
  }
  if (c.projects.length) lines.push('', `🪐 项目星系：${c.projects.length} 颗行星，最大的是 ${escapeHtml(c.projects[0].project)}（${cnum(c.projects[0].tokens)}）`)
  lines.push('', `✨ 你是一颗 <b>${escapeHtml(c.me.name)}</b>（${escapeHtml(c.me.code)}）`, escapeHtml(c.me.desc))
  return lines
}

/** one line for the evening report: today's remnants and your star */
export function starSummary(c: Cosmos, now: number): string {
  const today = c.remnants.filter((r) => r.start >= startOfDay(now))
  const parts = (['blackhole', 'nebula', 'neutron', 'dwarf'] as const).map((k) => [k, today.filter((r) => r.kind === k).length] as const).filter(([, n]) => n)
  const rem = parts.length ? `今天的窗口留下了 ${parts.map(([k, n]) => `${REMNANT_ICON[k]}${REMNANTS[k].name}×${n}`).join(' ')}` : ''
  const shower = c.meteors.length ? `落下 ${c.meteors.length} 颗流星（提问）` : ''
  return [rem, shower, `你是一颗${c.me.name}（${c.me.code}）`].filter(Boolean).join(' · ')
}

/** /week: the last 7 days, day by day, with a sparkline */
export function weekLines(entries: CostedEntry[], now: number, money: (usd: number) => string): string[] {
  const days = Array.from({ length: 7 }, (_, i) => addDays(startOfDay(now), i - 6))
  const tokens = days.map(() => 0)
  const cost = days.map(() => 0)
  for (const e of entries) {
    if (e.ts < days[0] || e.ts > now) continue
    const i = Math.min(6, Math.floor((startOfDay(e.ts) - days[0]) / 86_400_000 + 0.5))
    tokens[i] += tokensOf(e)
    cost[i] += e.cost.total
  }
  const max = Math.max(...tokens, 1)
  const sum = tokens.reduce((a, b) => a + b, 0)
  const lines = ['📈 <b>最近 7 天</b>', `<code>${spark(tokens)}</code>  共 ${cnum(sum)} tokens · ${money(cost.reduce((a, b) => a + b, 0))}`, '']
  days.forEach((d, i) => {
    const t = new Date(d)
    const blocks = Math.round((tokens[i] / max) * 12)
    lines.push(`<code>周${WEEK[t.getDay()]} ${String(t.getMonth() + 1).padStart(2, ' ')}/${String(t.getDate()).padEnd(2, ' ')} ${'█'.repeat(blocks).padEnd(12, '░')}</code> ${tokens[i] ? `${cnum(tokens[i])} · ${money(cost[i])}` : '—'}`)
  })
  const best = tokens.indexOf(Math.max(...tokens))
  if (tokens[best] > 0) lines.push('', `最忙的是周${WEEK[new Date(days[best]).getDay()]}；日均 ${cnum(sum / Math.max(1, tokens.filter(Boolean).length))}`)
  return lines
}

/** /top: today's costliest prompts */
export function topLines(r: PromptReport, money: (usd: number) => string): string[] {
  if (!r.top.length) return ['💸 今天还没有提问']
  const lines = [`💸 <b>今天最贵的提问</b>（共 ${r.count} 次，平均 ${money(r.avgCost)}）`, '']
  r.top.slice(0, 5).forEach((p, i) => {
    const text = p.text.replace(/\s+/g, ' ').slice(0, 40)
    lines.push(`${i + 1}. <b>${money(p.cost)}</b> · ${cnum(p.tokens)} · ${escapeHtml(p.project)}`, `   「${escapeHtml(text)}」 ${hm(p.ts)}`)
  })
  return lines
}

/** /ach: how many, the latest, and the closest ones */
export function achLines(list: Achievement[]): string[] {
  const done = list.filter((a) => a.unlocked)
  const recent = [...done].sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, 3)
  const next = list
    .filter((a) => !a.unlocked && a.kind !== 'secret')
    .sort((a, b) => b.progress - a.progress)
    .slice(0, 4)
  const secrets = list.filter((a) => a.kind === 'secret')
  const lines = [`🏆 <b>成就</b> ${done.length} / ${list.length}`, `<code>${bar(done.length / Math.max(1, list.length), 16)}</code>`]
  if (recent.length) lines.push('', '最近解锁：', ...recent.map((a) => `${a.icon} <b>${escapeHtml(a.title)}</b> — ${escapeHtml(a.desc)}`))
  if (next.length) lines.push('', '最接近的：', ...next.map((a) => `${a.icon} ${escapeHtml(a.title)} <code>${bar(a.progress, 8)}</code> ${escapeHtml(a.hint)}`))
  lines.push('', `🔒 隐藏成就已找到 ${secrets.filter((a) => a.unlocked).length} / ${secrets.length}`)
  return lines
}
