import type { TarotDeck } from './types'

/**
 * The 22 Major Arcana of the 塔罗 page. Each card is a picture of one piece
 * of your usage drawn inside its classic scene; `draws` says what it draws.
 */

export interface Arcana {
  id: number
  numeral: string
  name: string
  en: string
  /** what the picture is made of, in one line */
  draws: string
  /** the card's own colour (its glow and tint) */
  hue: string
}

export const ARCANA: Arcana[] = [
  { id: 0, numeral: '0', name: '愚者', en: 'THE FOOL', draws: '一路走来：每块石头是一天，亮的是用过的', hue: '#f5c46b' },
  { id: 1, numeral: 'I', name: '魔术师', en: 'THE MAGICIAN', draws: '桌上四件法器：今天输入、输出、写缓存、读缓存各占多少', hue: '#e2574c' },
  { id: 2, numeral: 'II', name: '女祭司', en: 'THE HIGH PRIESTESS', draws: '两根柱子：今天的新输入与读缓存；新月填满的是命中率', hue: '#5a7bd8' },
  { id: 3, numeral: 'III', name: '皇后', en: 'THE EMPRESS', draws: '七根麦穗：最近 7 天每天写出的 token', hue: '#6fbf73' },
  { id: 4, numeral: 'IV', name: '皇帝', en: 'THE EMPEROR', draws: '权杖：5 小时额度用到哪了，横线是守卫线', hue: '#d9573b' },
  { id: 5, numeral: 'V', name: '教皇', en: 'THE HIEROPHANT', draws: '24 格光环：最近两周每个钟点平均用多少（你的作息）', hue: '#b8963e' },
  { id: 6, numeral: 'VI', name: '恋人', en: 'THE LOVERS', draws: '两个人的身高：这 7 天 Claude 与 Codex（或两个主力模型）各用多少', hue: '#e98aa8' },
  { id: 7, numeral: 'VII', name: '战车', en: 'THE CHARIOT', draws: '车篷速度表：现在每分钟的 token，满格是今天最快的一分钟', hue: '#6c8fd8' },
  { id: 8, numeral: 'VIII', name: '力量', en: 'STRENGTH', draws: '狮子的鬃毛：连续用了多少天，30 天长满一圈', hue: '#f0a24a' },
  { id: 9, numeral: 'IX', name: '隐士', en: 'THE HERMIT', draws: '灯笼的亮度：这 7 天深夜（22–5 点）的用量占比', hue: '#8b93b8' },
  { id: 10, numeral: 'X', name: '命运之轮', en: 'WHEEL OF FORTUNE', draws: '轮上每一格：这周的一个 5 小时窗口，颜色越实用得越多', hue: '#c98b3b' },
  { id: 11, numeral: 'XI', name: '正义', en: 'JUSTICE', draws: '天平：这 7 天和再前 7 天的花费，重的一边往下沉', hue: '#9c6bd8' },
  { id: 12, numeral: 'XII', name: '倒吊人', en: 'THE HANGED MAN', draws: '光环和绳子：5 小时窗口刷新时平均还剩多少没用，剩得越多吊得越低', hue: '#4fa0c9' },
  { id: 13, numeral: 'XIII', name: '死神', en: 'DEATH', draws: '旗上的玫瑰：今天每结束一段对话，多开一片花瓣', hue: '#8a8f9c' },
  { id: 14, numeral: 'XIV', name: '节制', en: 'TEMPERANCE', draws: '两只杯子：5 小时额度和 7 天额度的水位，水流是满一个 5 小时要倒掉多少周额度', hue: '#5cc3b5' },
  { id: 15, numeral: 'XV', name: '恶魔', en: 'THE DEVIL', draws: '火炬：今天最贵的提问是平均的几倍；每条锁链是一个贵过平均 3 倍的提问', hue: '#b03a48' },
  { id: 16, numeral: 'XVI', name: '高塔', en: 'THE TOWER', draws: '塔高：今天最快的一分钟，对比前两周的纪录；破纪录就被闪电劈中', hue: '#ff7a3d' },
  { id: 17, numeral: 'XVII', name: '星星', en: 'THE STAR', draws: '八颗星：这 7 天用得最多的 8 个项目，最大的那颗是第一名', hue: '#7fb8ff' },
  { id: 18, numeral: 'XVIII', name: '月亮', en: 'THE MOON', draws: '月相：7 天额度用了多少（满月就是用完）；每滴露水是离刷新的一天', hue: '#a98ef0' },
  { id: 19, numeral: 'XIX', name: '太阳', en: 'THE SUN', draws: '24 道光：今天每个小时的用量，正午在最上面', hue: '#ffcf4a' },
  { id: 20, numeral: 'XX', name: '审判', en: 'JUDGEMENT', draws: '号角唤醒的人：这 7 天的刷新任务，站起来的完成了，倒下的失败了', hue: '#e86a6a' },
  { id: 21, numeral: 'XXI', name: '世界', en: 'THE WORLD', draws: '花环的 30 片叶子：最近 30 天，越亮那天用得越多', hue: '#58b98a' }
]

const hm = (t: number) => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
const md = (t: number) => `${new Date(t).getMonth() + 1}/${new Date(t).getDate()}`
const tk = (n: number) => (n >= 1e8 ? `${(n / 1e8).toFixed(2)} 亿` : n >= 1e4 ? `${(n / 1e4).toFixed(n >= 1e7 ? 0 : 1)} 万` : String(Math.round(n)))
const pct = (n: number) => `${Math.round(n)}%`

/** the numbers behind a card, for its back */
export function cardStory(id: number, d: TarotDeck, money: (usd: number) => string): string[] {
  const t = d.today
  const lines = ((): string[] => {
    switch (id) {
      case 0: {
        const used = d.days.filter((x) => (d.firstDay === null || x.day >= d.firstDay) && x.tokens > 0)
        const best = used.reduce<(typeof used)[number] | null>((a, x) => (!a || x.tokens > a.tokens ? x : a), null)
        return [d.firstDay ? `从 ${md(d.firstDay)} 走到今天，最近 60 天里用了 ${used.length} 天` : '还没有用量', best ? `走得最远的一天：${md(best.day)}，${tk(best.tokens)} token` : '']
      }
      case 1: {
        const sum = t.input + t.output + t.cacheWrite + t.cacheRead || 1
        const row = (name: string, v: number) => `${name} ${tk(v)}（${pct((v / sum) * 100)}）`
        return [row('输入', t.input), row('输出', t.output), row('写缓存', t.cacheWrite), row('读缓存', t.cacheRead)]
      }
      case 2: {
        const fresh = t.input + t.cacheWrite
        const all = fresh + t.cacheRead
        return [`新输入 ${tk(fresh)} · 读缓存 ${tk(t.cacheRead)}`, all ? `命中率 ${((t.cacheRead / all) * 100).toFixed(1)}%` : '今天还没有输入']
      }
      case 3:
        return d.days.slice(-7).map((x) => `${md(x.day)}　写出 ${tk(x.output)}`)
      case 4:
        if (d.credits) return [`WorkBuddy 积分已用 ${pct(d.credits.usedPct)}`, `还剩 ${Math.round(d.credits.remaining)} / ${Math.round(d.credits.total)}`]
        return d.five ? [`5 小时额度 ${pct(d.five.pct)}，${hm(d.five.end)} 刷新`, d.guardAt !== null ? `守卫线 ${d.guardAt}%` : '守卫没有开（或这个工具不归守卫管）'] : ['没有 5 小时额度读数']
      case 5: {
        const top = d.usualHours
          .map((v, h) => [h, v] as const)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
        return top[0][1] > 0 ? [`最常工作的钟点：${top.map(([h]) => `${h} 点`).join('、')}`, `那个钟点平均 ${tk(top[0][1])} token`] : ['最近两周没有用量']
      }
      case 6:
        return d.lovers ? [`${d.lovers.a.name} ${tk(d.lovers.a.tokens)}`, d.lovers.b ? `${d.lovers.b.name} ${tk(d.lovers.b.tokens)}` : '只有一位'] : ['这 7 天还没有用量']
      case 7:
        return [`现在每分钟 ${tk(d.tpm)} token`, t.peak ? `今天最快 ${tk(t.peak.tokens)}（${hm(t.peak.at)}）` : '今天还没有用量']
      case 8:
        return [`已经连续 ${d.streak} 天`, `最近 60 天里最长连续 ${d.bestStreak} 天`]
      case 9:
        return [`这 7 天深夜用了 ${tk(d.night.tokens)}`, `占全部的 ${pct(d.night.share * 100)}`]
      case 10: {
        const full = d.wheel.filter((w) => w.peak >= 100).length
        return d.wheel.length ? [`这周 ${d.wheel.length} 个 5 小时窗口`, `其中 ${full} 个用满了`, `平均用到 ${pct(d.wheel.reduce((a, w) => a + w.peak, 0) / d.wheel.length)}`] : ['还没有窗口记录']
      }
      case 11:
        return [`这 7 天 ${money(d.week.now)}`, `再前 7 天 ${money(d.week.prev)}`, d.week.prev ? `${d.week.now >= d.week.prev ? '多' : '少'}了 ${pct((Math.abs(d.week.now - d.week.prev) / d.week.prev) * 100)}` : '']
      case 12:
        if (d.credits) return [`积分还剩 ${pct(100 - d.credits.usedPct)}`, d.credits.daysLeft !== null ? `照日均约还能用 ${Math.round(d.credits.daysLeft)} 天` : '还算不出能用多久']
        return d.unused ? [`这 7 天结束了 ${d.unused.n} 个 5 小时窗口`, `刷新时平均还剩 ${pct(d.unused.avg)} 没用`] : ['这 7 天还没有结束的 5 小时窗口']
      case 13:
        return d.endedCount ? [`今天结束了 ${d.endedCount} 段对话`, ...d.ended.slice(0, 3).map((s) => `${hm(s.end)} ${s.project} · ${tk(s.tokens)}`)] : ['今天还没有结束的对话']
      case 14:
        if (d.credits) return [`积分已用 ${pct(d.credits.usedPct)}`, `今日 ${d.credits.today !== null ? Math.round(d.credits.today) : '—'} 积分 · 日均 ${d.credits.dailyAvg !== null ? Math.round(d.credits.dailyAvg) : '—'}`]
        return [
          `5 小时额度 ${d.five ? pct(d.five.pct) : '—'} · 7 天额度 ${d.seven ? pct(d.seven.pct) : '—'}`,
          d.full ? `用满一个 5 小时窗口 ≈ 7 天额度的 ${d.full.toFixed(1)}%，一周约能装下 ${(100 / d.full).toFixed(1)} 个` : '读数还不够，算不出换算'
        ]
      case 15:
        return d.devil ? [`最贵：${money(d.devil.cost)}，平均 ${money(d.devil.avg)}`, `「${d.devil.text.replace(/\s+/g, ' ').slice(0, 40)}」`, `贵过平均 3 倍的提问 ${d.devil.over3} 个`] : ['今天还没有提问']
      case 16:
        return [t.peak ? `今天最快 ${tk(t.peak.tokens)}/分（${hm(t.peak.at)}）` : '今天还没有用量', `前两周纪录 ${tk(d.record)}/分`]
      case 17:
        return d.projects.length ? d.projects.map((p, i) => `${i + 1}. ${p.name}　${tk(p.tokens)}`) : ['这 7 天还没有项目']
      case 18:
        if (d.credits) return [`积分已用 ${pct(d.credits.usedPct)}`, d.credits.daysLeft !== null ? `照日均约 ${Math.round(d.credits.daysLeft)} 天用完` : '还算不出能用多久']
        return d.seven ? [`7 天额度 ${pct(d.seven.pct)}`, `${md(d.seven.end)} ${hm(d.seven.end)} 刷新`] : ['没有 7 天额度读数']
      case 19: {
        const best = t.hours.reduce((b, v, h) => (v > t.hours[b] ? h : b), 0)
        return t.hours[best] > 0 ? [`最亮的一道：${best}:00–${best + 1}:00，${tk(t.hours[best])}`, `今天有 ${t.hours.filter((v) => v > 0).length} 个小时在用`] : ['今天还没有用量']
      }
      case 20: {
        const name: Record<string, string> = { done: '完成', failed: '失败', running: '进行中', queued: '排队', cancelled: '取消' }
        return d.tasks.length ? d.tasks.map((k) => `${name[k.status] ?? k.status} · ${k.title}`) : ['这 7 天没有刷新任务']
      }
      case 21: {
        const days = d.days.slice(-30)
        return [`30 天里用了 ${days.filter((x) => x.tokens > 0).length} 天`, `一共 ${tk(days.reduce((a, x) => a + x.tokens, 0))} token，${money(days.reduce((a, x) => a + x.cost, 0))}`]
      }
    }
    return []
  })()
  return lines.filter(Boolean)
}
