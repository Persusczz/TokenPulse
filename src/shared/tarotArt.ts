import { ARCANA } from './tarot'
import type { TarotDeck } from './types'

/**
 * The Major Arcana as gold line art on a dark card (200 × 340), each drawing
 * one piece of your usage inside its classic picture: the Sun's 24 rays are
 * today's hours, the Moon's phase is the week's quota, the Wheel's spokes are
 * the week's 5-hour windows… One SVG string per card, shared by the 塔罗 page
 * and the Telegram picture.
 */

const f = (n: number) => Math.round(n * 10) / 10
const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0)
/** v against the largest, 0–1 */
const share = (v: number, max: number) => (max > 0 ? clamp01(v / max) : 0)
const rad = (deg: number) => (deg * Math.PI) / 180
const at = (cx: number, cy: number, r: number, deg: number) => [f(cx + r * Math.cos(rad(deg))), f(cy + r * Math.sin(rad(deg)))] as const
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** a star with `n` points */
function star(cx: number, cy: number, R: number, r: number, n: number, rot = -90): string {
  const pts: string[] = []
  for (let i = 0; i < n * 2; i++) {
    const a = rad(rot + (180 / n) * i)
    const k = i % 2 ? r : R
    pts.push(`${f(cx + k * Math.cos(a))} ${f(cy + k * Math.sin(a))}`)
  }
  return `M${pts.join('L')}Z`
}

/** straight rays between two radii */
function rays(cx: number, cy: number, r1: number, r2: number, n: number, from = 0, to = 360): string {
  let d = ''
  const full = to - from >= 360
  for (let i = 0; i < n; i++) {
    const a = from + ((to - from) * (i + (full ? 0 : 0.5))) / n
    const [x1, y1] = at(cx, cy, r1, a)
    const [x2, y2] = at(cx, cy, r2, a)
    d += `M${x1} ${y1}L${x2} ${y2}`
  }
  return d
}

/** an arc of a circle from one angle to another (degrees, clockwise) */
function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = at(cx, cy, r, a0)
  const [x1, y1] = at(cx, cy, r, a1)
  return `M${x0} ${y0}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`
}

/** a little flame or drop, point up */
const drop = (x: number, y: number, s = 1) => `M${f(x)} ${f(y)}q${f(-3 * s)} ${f(5 * s)} 0 ${f(8 * s)}q${f(3 * s)} ${f(-3 * s)} 0 ${f(-8 * s)}Z`

/** the lemniscate ∞, centred, `w` wide */
function infinity(cx: number, cy: number, w: number): string {
  const h = w / 4
  return `M${cx} ${cy}C${f(cx - h)} ${f(cy - h * 1.3)} ${f(cx - w / 2)} ${f(cy - h * 1.3)} ${f(cx - w / 2)} ${cy}C${f(cx - w / 2)} ${f(cy + h * 1.3)} ${f(cx - h)} ${f(cy + h * 1.3)} ${cx} ${cy}C${f(cx + h)} ${f(cy - h * 1.3)} ${f(cx + w / 2)} ${f(cy - h * 1.3)} ${f(cx + w / 2)} ${cy}C${f(cx + w / 2)} ${f(cy + h * 1.3)} ${f(cx + h)} ${f(cy + h * 1.3)} ${cx} ${cy}Z`
}

interface Ink {
  gold: string
  hue: string
  dark: string
}

const tint = (k: Ink, o = 0.2) => `fill="${k.hue}" fill-opacity="${o}"`
const solid = (k: Ink) => `fill="${k.gold}" stroke="none"`
/** small writing on the card: what a mark stands for */
const note = (k: Ink, x: number, y: number, s: string, size = 6.5, anchor = 'middle') =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" fill="${k.gold}" fill-opacity=".8" stroke="none" font-family="'Microsoft YaHei UI','PingFang SC',sans-serif">${esc(s)}</text>`
const glyph = (k: Ink, x: number, y: number, ch: string, size = 11) =>
  `<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}" fill="${k.gold}" stroke="none" font-family="'Segoe UI Symbol','Noto Sans Symbols',serif">${ch}︎</text>`
const fourCorners = (k: Ink) => glyph(k, 34, 64, '♒') + glyph(k, 166, 64, '♏') + glyph(k, 34, 258, '♉') + glyph(k, 166, 258, '♌')

/** a hanging cup of water filled to `p` (0–1), its rim at (x, y) */
function cup(k: Ink, x: number, y: number, p: number, id: string): string {
  const w = 30
  const h = 38
  const body = `M${x - w / 2} ${y}h${w}l-4 ${h}h-${w - 8}Z`
  return `<clipPath id="${id}"><path d="${body}"/></clipPath>
  <rect x="${x - w / 2}" y="${f(y + h * (1 - clamp01(p)))}" width="${w}" height="${f(h * clamp01(p))}" fill="${k.hue}" fill-opacity=".75" stroke="none" clip-path="url(#${id})"/>
  <path d="${body}"/><path d="M${x} ${y + h}v6M${x - 7} ${y + h + 6}h14"/>`
}

type Art = (k: Ink, d: TarotDeck, u: string) => string

const ART: Art[] = [
  // 0 the Fool: the road since your first day; every stone is a day, lit when you used it, and you at the cliff's edge today
  (k, d) => {
    const days = d.days.filter((x) => d.firstDay === null || x.day >= d.firstDay)
    const n = Math.max(1, days.length)
    const max = Math.max(...days.map((x) => x.tokens), 1)
    const pt = (t: number) => [f(30 + 112 * t), f(250 - 146 * t + 12 * Math.sin(3 * Math.PI * t))] as const
    let road = ''
    let stones = ''
    days.forEach((x, i) => {
      const [px, py] = pt(n === 1 ? 1 : i / (n - 1))
      road += `${i ? 'L' : 'M'}${px} ${py}`
      stones += x.tokens > 0 ? `<circle cx="${px}" cy="${py}" r="${f(1.4 + 3.4 * Math.sqrt(x.tokens / max))}" ${solid(k)}/>` : `<circle cx="${px}" cy="${py}" r="1" stroke-opacity=".35" stroke-width=".8"/>`
    })
    const [ex, ey] = pt(1)
    return `
  <circle cx="58" cy="80" r="14" ${tint(k, 0.4)}/><path d="${rays(58, 80, 19, 26, 12)}"/>
  <path d="M146 112L178 104L178 262L156 262Q148 190 146 112Z" fill="${k.dark}"/>
  <path d="${road}" stroke-opacity=".3" stroke-width="5"/>
  ${stones}
  <circle cx="${ex}" cy="${f(ey - 19)}" r="4.5"/><path d="M${ex} ${f(ey - 14)}L${f(ex - 6)} ${f(ey - 2)}L${f(ex + 7)} ${f(ey - 2)}Z" ${tint(k, 0.45)}/>
  <path d="M${f(ex + 2)} ${f(ey - 11)}L${f(ex + 14)} ${f(ey - 25)}"/><circle cx="${f(ex + 15)}" cy="${f(ey - 27)}" r="3.4" ${tint(k, 0.55)}/>
  ${note(k, 34, 262, `${n} 天`, 6.5, 'start')}`
  },
  // I the Magician: the four tools on the table, each as big as its share of today's tokens
  (k, d) => {
    const t = d.today
    const sum = t.input + t.output + t.cacheWrite + t.cacheRead
    const s = (v: number) => f(0.55 + 1.1 * Math.sqrt(sum ? v / sum : 0.25))
    const tool = (x: number, v: number, body: string, label: string) => `<g transform="translate(${x} 202) scale(${s(v)})">${body}</g>${note(k, x, 226, label)}`
    return `
  <path d="${infinity(100, 72, 60)}"/>
  <circle cx="100" cy="128" r="32" ${tint(k, 0.14)} stroke="none"/>
  <path d="M100 94L100 164" stroke-width="3"/><circle cx="100" cy="94" r="3.5" ${solid(k)}/><circle cx="100" cy="164" r="3.5" ${solid(k)}/>
  <path d="${rays(100, 94, 7, 13, 8)}" stroke-opacity=".7"/>
  <path d="M30 204L170 204"/><rect x="34" y="204" width="132" height="28" ${tint(k, 0.18)}/>
  ${tool(46, t.cacheRead, `<path d="M-8 -18h16q0 11 -8 13q-8 -2 -8 -13ZM0 -5v5M-5 0h10" ${tint(k, 0.35)}/>`, '读缓存')}
  ${tool(80, t.cacheWrite, `<circle cx="0" cy="-10" r="9" ${tint(k, 0.3)}/><path d="${star(0, -10, 7, 2.7, 5)}"/>`, '写缓存')}
  ${tool(118, t.output, `<path d="M0 -28L0 0M-6 -20L6 -20"/><circle cx="0" cy="-30" r="2"/>`, '输出')}
  ${tool(152, t.input, `<path d="M-6 0L6 -26M5 -24q5 -3 4 -8"/>`, '输入')}`
  },
  // II the High Priestess: pillar B is fresh input, pillar J is what was read from the cache; the moon below fills with the hit rate
  (k, d) => {
    const fresh = d.today.input + d.today.cacheWrite
    const read = d.today.cacheRead
    const max = Math.max(fresh, read, 1)
    const hB = f(40 + 130 * Math.sqrt(fresh / max))
    const hJ = f(40 + 130 * Math.sqrt(read / max))
    const hit = fresh + read ? read / (fresh + read) : 0
    const c = 2 * Math.PI * 15
    return `
  <rect x="32" y="${f(240 - hB)}" width="22" height="${hB}" rx="2" fill="${k.dark}"/><rect x="146" y="${f(240 - hJ)}" width="22" height="${hJ}" rx="2" ${tint(k, 0.3)}/>
  <path d="M28 240h30M142 240h30"/>
  ${note(k, 43, f(254), '新输入')}${note(k, 157, f(254), '读缓存')}
  <text x="43" y="${f(255 - hB)}" text-anchor="middle" font-size="12" font-family="Georgia,serif" fill="${k.gold}" stroke="none">B</text>
  <text x="157" y="${f(255 - hJ)}" text-anchor="middle" font-size="12" font-family="Georgia,serif" fill="${k.gold}" stroke="none">J</text>
  <path d="M54 ${f(246 - hB)}Q100 ${f(262 - Math.min(hB, hJ) + 4)} 146 ${f(246 - hJ)}" stroke-opacity=".7"/>
  <circle cx="100" cy="72" r="7"/><path d="M85 65a7 7 0 0 0 0 14a5 5 0 0 1 0 -14Z" ${solid(k)}/><path d="M115 65a7 7 0 0 1 0 14a5 5 0 0 0 0 -14Z" ${solid(k)}/>
  <rect x="86" y="128" width="28" height="36" rx="3" ${tint(k, 0.22)}/><path d="M86 134h28M86 158h28"/>
  <text x="100" y="150" text-anchor="middle" font-size="7" font-family="Georgia,serif" fill="${k.gold}" stroke="none">TORA</text>
  <circle cx="100" cy="206" r="15" stroke-opacity=".25" stroke-width="5"/>
  <circle cx="100" cy="206" r="15" stroke="${k.hue}" stroke-width="5" stroke-dasharray="${f(c * hit)} ${f(c)}" transform="rotate(-90 100 206)"/>
  <text x="100" y="209" text-anchor="middle" font-size="8" font-weight="700" fill="${k.gold}" stroke="none">${Math.round(hit * 100)}%</text>`
  },
  // III the Empress: seven ears of wheat, each as tall as one day's output this week, today's in her colour
  (k, d) => {
    const week = d.days.slice(-7)
    const max = Math.max(...week.map((x) => x.output), 1)
    const stalks = week
      .map((x, i) => {
        const cx = 40 + i * 20
        const h = f(18 + 122 * Math.sqrt(x.output / max))
        const top = 252 - h
        const grains = Math.round(2 + 5 * (x.output / max))
        const today = i === week.length - 1
        let g = ''
        for (let j = 0; j < grains; j++) {
          const y = f(top + 4 + j * 7)
          g += `<path d="M${cx} ${y}q-5 -2 -4 -8q4 2 4 8ZM${cx} ${y}q5 -2 4 -8q-4 2 -4 8Z" ${today ? `fill="${k.hue}" fill-opacity=".85"` : tint(k, 0.5)}/>`
        }
        return `<path d="M${cx} 252L${cx} ${f(top)}"${today ? ` stroke="${k.hue}"` : ''}/>${g}`
      })
      .join('')
    return `
  ${Array.from({ length: 12 }, (_, i) => {
    const [x, y] = at(100, 118, 52, 200 + (140 * i) / 11)
    return `<path d="${star(x, y, 4, 1.6, 5)}" ${solid(k)}/>`
  }).join('')}
  <circle cx="100" cy="88" r="7"/><path d="M100 95v9M95 100h10"/>
  ${stalks}
  ${note(k, 40, 262, '7 天前')}${note(k, 160, 262, '今天')}`
  },
  // IV the Emperor: his sceptre is the 5-hour quota, filled as far as it is used, with the guard's line across it
  (k, d, u) => {
    const p = d.five ? clamp01(d.five.pct / 100) : 0
    const top = 112
    const bottom = 228
    const y = f(bottom - (bottom - top) * p)
    const g = d.guardAt !== null ? f(bottom - ((bottom - top) * d.guardAt) / 100) : null
    return `
  <path d="M22 112L44 88L60 100L82 76L100 92L120 72L140 96L156 84L178 110" stroke-opacity=".4"/>
  <rect x="50" y="122" width="100" height="116" rx="4" ${tint(k, 0.16)}/>
  <path d="M48 122a10 10 0 1 1 10 10a6 6 0 1 1 -6 -6"/><path d="M152 122a10 10 0 1 0 -10 10a6 6 0 1 0 6 -6"/>
  <path d="M84 104L88 90L94 100L100 84L106 100L112 90L116 104Z" ${solid(k)}/>
  <clipPath id="${u}s"><rect x="92" y="${top}" width="16" height="${bottom - top}" rx="8"/></clipPath>
  <rect x="92" y="${y}" width="16" height="${f(bottom - y)}" fill="${p >= 0.9 ? '#ff5d6c' : k.hue}" fill-opacity=".85" stroke="none" clip-path="url(#${u}s)"/>
  <rect x="92" y="${top}" width="16" height="${bottom - top}" rx="8"/>
  ${g !== null ? `<path d="M84 ${g}h32" stroke="#ff8a8a" stroke-width="1.6" stroke-dasharray="3 2"/>${note(k, 128, f(g + 2.5), '守卫', 6.5, 'start')}` : ''}
  <text x="100" y="${f(Math.min(y, bottom - 6) - 6)}" text-anchor="middle" font-size="10" font-weight="700" fill="${k.gold}" stroke="none">${d.five ? `${Math.round(d.five.pct)}%` : '—'}</text>
  ${note(k, 100, 252, `${d.tool === 'codex' ? 'Codex' : 'Claude'} 5 小时额度`)}`
  },
  // V the Hierophant: the 24-hour halo round his crown, each hour as long as your usual use at that hour
  (k, d) => {
    const max = Math.max(...d.usualHours, 1)
    const halo = d.usualHours
      .map((v, h) => {
        const a = -90 + h * 15
        const [x1, y1] = at(100, 140, 48, a)
        const [x2, y2] = at(100, 140, 50 + 26 * (v / max), a)
        return `<path d="M${x1} ${y1}L${x2} ${y2}" stroke-width="4.2"${v / max > 0.6 ? ` stroke="${k.hue}"` : ''} stroke-opacity="${f(0.3 + 0.7 * (v / max))}"/>`
      })
      .join('')
    return `
  <circle cx="100" cy="140" r="46" stroke-opacity=".3"/>
  ${halo}
  ${note(k, 100, 58, '0 点')}${note(k, 100, 228, '12 点')}${note(k, 26, 142, '18', 6.5, 'start')}${note(k, 174, 142, '6', 6.5, 'end')}
  <path d="M84 162Q84 118 100 108Q116 118 116 162Z" ${tint(k, 0.28)}/><path d="M85 150h30M87 137h26M92 124h16M100 108v-9M95 103h10"/>
  <path d="M82 230L118 254M118 230L82 254"/><circle cx="78" cy="227" r="5"/><circle cx="122" cy="227" r="5"/>`
  },
  // VI the Lovers: two figures, each as tall as its share of the week (Claude and Codex, or your two main models)
  (k, d) => {
    const l = d.lovers
    const max = Math.max(l?.a.tokens ?? 0, l?.b?.tokens ?? 0, 1)
    const person = (x: number, v: number, name: string) => {
      const h = f(40 + 62 * Math.sqrt(v / max))
      const top = 244 - h
      return `<circle cx="${x}" cy="${f(top)}" r="7"/><path d="M${x} ${f(top + 7)}Q${x - 9} ${f(top + h * 0.55)} ${x - 6} 244L${x + 6} 244Q${x + 9} ${f(top + h * 0.55)} ${x} ${f(top + 7)}Z" ${tint(k, 0.4)}/>${note(k, x, 256, cut(name, 9))}`
    }
    return `
  <circle cx="100" cy="68" r="11" ${solid(k)}/><path d="${rays(100, 68, 15, 22, 12)}"/>
  <circle cx="100" cy="100" r="6"/>
  <path d="M96 106Q74 82 36 88Q52 96 58 108Q46 108 42 118Q64 116 76 122Q86 116 96 112" ${tint(k, 0.2)}/>
  <path d="M104 106Q126 82 164 88Q148 96 142 108Q154 108 158 118Q136 116 124 122Q114 116 104 112" ${tint(k, 0.2)}/>
  <path d="M84 214L100 152L116 214" stroke-opacity=".5"/>
  ${l ? person(l.b ? 60 : 100, l.a.tokens, l.a.name) + (l.b ? person(140, l.b.tokens, l.b.name) : '') : note(k, 100, 200, '还没有用量', 8)}`
  },
  // VII the Chariot: the canopy is a speedometer: tokens per minute right now against today's fastest minute
  (k, d) => {
    const peak = Math.max(d.today.peak?.tokens ?? 0, d.tpm, 1)
    const p = share(d.tpm, peak)
    const a = 200 + 140 * p
    const [nx, ny] = at(100, 132, 46, a)
    return `
  <path d="${arc(100, 132, 54, 200, 340)}" stroke-width="7" stroke-opacity=".25"/>
  ${p > 0.01 ? `<path d="${arc(100, 132, 54, 200, a)}" stroke-width="7" stroke="${k.hue}"/>` : ''}
  <path d="M100 132L${nx} ${ny}" stroke-width="2"/><circle cx="100" cy="132" r="4" ${solid(k)}/>
  ${note(k, 52, 146, '0', 6.5)}${note(k, 148, 146, '今日最快', 6.5)}
  <text x="100" y="152" text-anchor="middle" font-size="9" font-weight="700" fill="${k.gold}" stroke="none">${esc(fmtShort(d.tpm))}/分</text>
  <path d="M54 140L54 170M146 140L146 170"/>
  <rect x="50" y="168" width="100" height="38" rx="3" ${tint(k, 0.2)}/>
  <circle cx="100" cy="187" r="5" ${solid(k)}/><path d="M95 187Q84 179 74 185M105 187Q116 179 126 185"/>
  <circle cx="62" cy="212" r="10"/><circle cx="138" cy="212" r="10"/><path d="M62 202v20M52 212h20M138 202v20M128 212h20" stroke-opacity=".6"/>
  <path d="M48 254L48 240Q50 230 58 232L60 226L66 230Q72 232 72 240L86 242L86 254Z" fill="${k.dark}"/>
  <path d="M152 254L152 240Q150 230 142 232L140 226L134 230Q128 232 128 240L114 242L114 254Z" ${tint(k, 0.5)}/>`
  },
  // VIII Strength: the lion's mane, one lock for each day in a row you have used it (thirty make a full mane)
  (k, d) => {
    const n = Math.min(30, d.streak)
    let mane = ''
    for (let i = 0; i < 30; i++) {
      const a = -90 + (i * 360) / 30
      const [x, y] = at(100, 156, 40, a)
      mane +=
        i < n
          ? `<path d="${drop(0, -6, 1.6)}" transform="translate(${x} ${y}) rotate(${f(a + 90)})" fill="${k.hue}" fill-opacity=".75" stroke="${k.gold}" stroke-width=".6"/>`
          : `<circle cx="${x}" cy="${y}" r="1.4" stroke-opacity=".3" stroke-width=".7"/>`
    }
    return `
  <path d="${infinity(100, 74, 40)}"/>
  ${mane}
  <circle cx="100" cy="160" r="27" ${tint(k, 0.16)}/>
  <path d="M80 140q-4 -10 6 -10M120 140q4 -10 -6 -10M88 156q4 -4 8 0M104 156q4 -4 8 0M100 174v4M92 180q8 6 16 0"/>
  <path d="M96 168L104 168L100 174Z" ${solid(k)}/>
  <text x="100" y="226" text-anchor="middle" font-size="10" font-weight="700" fill="${k.gold}" stroke="none">连续 ${d.streak} 天</text>
  ${note(k, 100, 240, `最长 ${d.bestStreak} 天`)}`
  },
  // IX the Hermit: his lantern shines as bright as the share of the week you worked at night (22:00–05:00)
  (k, d) => {
    const s = clamp01(d.night.share * 2.5)
    return `
  <circle cx="136" cy="134" r="${f(14 + 44 * s)}" fill="${k.hue}" fill-opacity="${f(0.12 + 0.4 * s)}" stroke="none"/>
  <circle cx="136" cy="134" r="${f(8 + 18 * s)}" fill="#fff6d0" fill-opacity="${f(0.08 + 0.35 * s)}" stroke="none"/>
  <path d="M22 262L22 228L74 176L94 192L124 156L178 222L178 262Z" fill="${k.dark}"/>
  <path d="M66 184L74 176L82 184M116 164L124 156L134 166" stroke="#f4efe4" stroke-opacity=".8"/>
  <path d="M90 104Q76 142 70 236L120 236Q114 150 106 104Q98 94 90 104Z" ${tint(k, 0.28)}/><path d="M90 104Q98 118 106 104"/>
  <path d="M74 118L66 246" stroke-width="2.4"/><path d="M108 126L132 122M132 120v4"/>
  <rect x="126" y="124" width="20" height="24" rx="3" ${tint(k, 0.55)}/>
  <path d="M136 128L142 140L130 140ZM136 144L130 132L142 132Z" fill="${k.gold}" fill-opacity="${f(0.35 + 0.65 * s)}" stroke="none"/>
  <text x="136" y="${f(196)}" text-anchor="middle" font-size="9" font-weight="700" fill="${k.gold}" stroke="none">${Math.round(d.night.share * 100)}%</text>
  ${note(k, 136, 208, '深夜用量')}`
  },
  // X the Wheel of Fortune: one cell of the wheel for each 5-hour window of this week, filled as far as it went
  (k, d) => {
    const w = d.wheel
    const n = w.length
    const cells = n === 1
      ? `<circle cx="100" cy="152" r="47" stroke-width="12" stroke="${w[0].peak >= 100 ? '#ff5d6c' : w[0].peak >= 90 ? '#ffb547' : k.hue}" stroke-opacity="${f(0.18 + 0.82 * clamp01(w[0].peak / 100))}" stroke-dasharray="3 1.5"/>`
      : w
      .map((x, i) => {
        const a0 = -90 + (i * 360) / n + (n > 1 ? 1.5 : 0)
        const a1 = -90 + ((i + 1) * 360) / n - (n > 1 ? 1.5 : 0)
        const p = clamp01(x.peak / 100)
        const color = x.peak >= 100 ? '#ff5d6c' : x.peak >= 90 ? '#ffb547' : k.hue
        return `<path d="${arc(100, 152, 47, a0, Math.max(a0 + 0.5, a1))}" stroke-width="12" stroke="${color}" stroke-opacity="${f(0.18 + 0.82 * p)}"${x.current ? ' stroke-dasharray="3 1.5"' : ''}/>`
      })
      .join('')
    return `
  <circle cx="100" cy="152" r="56"/><circle cx="100" cy="152" r="38"/>
  ${cells}
  <circle cx="100" cy="152" r="12" ${tint(k, 0.5)}/><path d="${rays(100, 152, 12, 38, 8)}" stroke-opacity=".5"/>
  <text x="100" y="155" text-anchor="middle" font-size="8" font-weight="700" fill="${k.gold}" stroke="none">${n}</text>
  <path d="M92 94L100 80L108 94Z" ${solid(k)}/><path d="M100 80v-10M96 75h8"/>
  <path d="M40 104q-8 14 0 28q8 14 0 28q-8 14 0 28"/>
  ${note(k, 100, 226, n ? `这周 ${n} 个 5 小时窗口` : '还没有窗口记录')}
  ${fourCorners(k)}`
  },
  // XI Justice: the scales weigh this week's cost against last week's; the heavier side sinks
  (k, d) => {
    const { now, prev } = d.week
    const max = Math.max(now, prev, 1e-9)
    const tilt = Math.max(-18, Math.min(18, ((now - prev) / max) * 18))
    const [lx, ly] = at(100, 160, 52, 180 - tilt)
    const [rx, ry] = at(100, 160, 52, -tilt)
    const pan = (x: number, y: number, v: number, label: string) => {
      const w = f(12 + 14 * Math.sqrt(v / max))
      return `<path d="M${x} ${y}L${f(x - w)} ${f(y + 30)}M${x} ${y}L${f(x + w)} ${f(y + 30)}"/><path d="M${f(x - w - 3)} ${f(y + 30)}Q${x} ${f(y + 46)} ${f(x + w + 3)} ${f(y + 30)}Z" ${tint(k, 0.45)}/>${note(k, x, f(y + 56), label)}`
    }
    return `
  <path d="M34 80v170M166 80v170M34 90Q100 112 166 90" stroke-opacity=".35"/>
  <path d="M100 62L104 72L104 136L96 136L96 72Z" ${tint(k, 0.4)}/><path d="M86 136h28M100 136v12"/>
  <path d="M${lx} ${ly}L${rx} ${ry}" stroke-width="2.2"/><circle cx="100" cy="160" r="4"/><path d="M100 164v74M86 238h28"/>
  ${pan(lx, ly, now, '这 7 天')}${pan(rx, ry, prev, '再前 7 天')}`
  },
  // XII the Hanged Man: the halo is what the 5-hour windows left unused this week; the more is left, the lower he hangs
  (k, d) => {
    const p = d.unused ? clamp01(d.unused.avg / 100) : 0
    const dy = f(26 * p)
    return `
  <path d="M44 74L156 74M54 74L54 258M146 74L146 258" stroke-width="3"/>
  ${[70, 92, 114, 136].map((x) => `<path d="M${x} 74q-4 -8 2 -11q2 6 -2 11Z" ${tint(k, 0.7)}/>`).join('')}
  <path d="M100 74L100 ${f(92 + +dy)}"/>
  <g transform="translate(0 ${dy})">
    <path d="M100 92L100 150M100 150L80 128L98 116" stroke-width="3"/>
    <path d="M92 150L108 150L106 192L94 192Z" ${tint(k, 0.38)}/>
    <path d="M94 158L86 176L100 186M106 158L114 176L100 186"/>
    <circle cx="100" cy="206" r="${f(10 + 26 * p)}" fill="${k.hue}" fill-opacity=".3" stroke="none"/><circle cx="100" cy="204" r="10" ${tint(k, 0.3)}/>
  </g>
  <text x="100" y="${f(250)}" text-anchor="middle" font-size="9" font-weight="700" fill="${k.gold}" stroke="none">${d.unused ? `平均剩 ${Math.round(d.unused.avg)}%` : '—'}</text>`
  },
  // XIII Death: the rose on his banner has a petal for each conversation that ended today; the sun rises behind
  (k, d) => {
    const n = Math.min(12, d.endedCount)
    let rose = ''
    for (let i = 0; i < n; i++) {
      const [x, y] = at(100, 96, n > 1 ? 8 : 0, -90 + (i * 360) / Math.max(1, n))
      rose += `<circle cx="${x}" cy="${y}" r="${n > 6 ? 5 : 6.5}" fill="#f4efe4" fill-opacity=".92"/>`
    }
    return `
  <path d="M22 208h156"/>
  <path d="M76 208A24 24 0 0 1 124 208Z" ${tint(k, 0.45)}/><path d="${rays(100, 208, 30, 38, 7, 190, 350)}"/>
  <rect x="44" y="164" width="18" height="44" ${tint(k, 0.2)}/><rect x="138" y="164" width="18" height="44" ${tint(k, 0.2)}/>
  <path d="M44 164v-6h5v6h4v-6h5v6M138 164v-6h5v6h4v-6h5v6"/>
  <path d="M58 58L58 154" stroke-width="2.4"/>
  <path d="M58 62L142 62L142 132Q122 124 100 132Q78 140 58 132Z" fill="${k.dark}"/>
  ${rose || '<circle cx="100" cy="96" r="4" stroke-opacity=".5"/>'}
  ${n ? `<circle cx="100" cy="96" r="4" ${solid(k)}/>` : ''}
  <text x="100" y="124" text-anchor="middle" font-size="8" fill="${k.gold}" stroke="none">${d.endedCount} 段对话结束</text>
  <path d="M22 226q20 -6 40 0t40 0t40 0t36 0M22 242q20 -6 40 0t40 0t40 0t36 0" stroke-opacity=".5"/>`
  },
  // XIV Temperance: the left cup is the 5-hour quota, the right the 7-day one; the stream between is how much of the week a full 5 hours pours away
  (k, d, u) => {
    const five = d.five ? d.five.pct / 100 : 0
    const seven = d.seven ? d.seven.pct / 100 : 0
    const w = d.full ? f(1 + Math.min(5, d.full / 4)) : 1.5
    return `
  <path d="M100 116Q70 80 40 92Q60 104 66 122M100 116Q130 80 160 92Q140 104 134 122" stroke-opacity=".45"/>
  <rect x="90" y="124" width="20" height="20"/><path d="M100 128L107 140L93 140Z" ${solid(k)}/>
  ${cup(k, 60, 126, five, `${u}a`)}${cup(k, 140, 176, seven, `${u}b`)}
  <path d="M74 132Q118 140 128 178" stroke="${k.hue}" stroke-width="${w}" stroke-dasharray="4 3" stroke-linecap="round"/>
  ${note(k, 60, 182, `5 小时 ${d.five ? Math.round(d.five.pct) : '—'}%`)}${note(k, 140, 232, `7 天 ${d.seven ? Math.round(d.seven.pct) : '—'}%`)}
  ${d.full ? note(k, 100, 252, `一个满的 5 小时 ≈ 7 天的 ${d.full >= 10 ? Math.round(d.full) : d.full.toFixed(1)}%`) : ''}`
  },
  // XV the Devil: the torch burns as many times brighter as today's costliest question cost over the average; a chain for each question that cost three times the average
  (k, d) => {
    const r = d.devil && d.devil.avg > 0 ? d.devil.cost / d.devil.avg : 0
    const fl = f(8 + 26 * clamp01(Math.log(1 + r) / Math.log(11)))
    const chains = Math.min(6, d.devil?.over3 ?? 0)
    let links = ''
    for (let c = 0; c < chains; c++) {
      const side = c % 2 ? 1 : -1
      const off = Math.floor(c / 2) * 12
      for (let i = 0; i < 4; i++) links += `<ellipse cx="${f(100 + side * (22 + off + i * 5.5))}" cy="${f(202 + i * 7)}" rx="2.3" ry="3.8"/>`
    }
    return `
  <path d="${star(100, 76, 18, 6.9, 5, 90)}"/><circle cx="100" cy="76" r="20" stroke-opacity=".5"/>
  <path d="M92 120Q66 94 32 106Q44 114 42 128Q54 122 60 136Q70 126 82 138Q86 128 94 128" ${tint(k, 0.22)}/>
  <path d="M108 120Q134 94 168 106Q156 114 158 128Q146 122 140 136Q130 126 118 138Q114 128 106 128" ${tint(k, 0.22)}/>
  <circle cx="100" cy="120" r="11" ${tint(k, 0.38)}/><path d="M92 112Q84 98 90 90M108 112Q116 98 110 90"/>
  <path d="M122 138L140 176" stroke-width="2.4"/>
  <path d="M140 176q${f(-fl * 0.35)} ${f(fl * 0.6)} 0 ${f(fl)}q${f(fl * 0.35)} ${f(-fl * 0.4)} 0 ${f(-fl)}Z" fill="${k.hue}" fill-opacity=".85" stroke="${k.gold}" transform="rotate(180 140 ${f(176 + fl / 2)})"/>
  <rect x="76" y="166" width="48" height="30" rx="2" ${tint(k, 0.25)}/><circle cx="100" cy="180" r="4"/>
  ${links}
  <text x="100" y="${f(256)}" text-anchor="middle" font-size="9" font-weight="700" fill="${k.gold}" stroke="none">${r ? `最贵的是平均的 ${r >= 10 ? Math.round(r) : r.toFixed(1)} 倍` : '今天还没有提问'}</text>`
  },
  // XVI the Tower: as tall as today's fastest minute against the two weeks before; struck by lightning when today broke that record
  (k, d) => {
    const peak = d.today.peak?.tokens ?? 0
    const broke = peak > 0 && peak > d.record
    const h = f(40 + 96 * (d.record > 0 ? clamp01(peak / d.record) : peak > 0 ? 1 : 0))
    const top = f(214 - h)
    const windows = Math.max(1, Math.floor(h / 34))
    let ws = ''
    for (let i = 0; i < windows; i++) ws += `<rect x="${i % 2 ? 103 : 91}" y="${f(top + 14 + i * 30)}" width="7" height="11" rx="3.5" fill="${k.hue}" fill-opacity=".8"/>`
    return `
  <path d="M40 262L66 222L84 232L100 210L118 228L138 216L160 262Z" fill="${k.dark}"/>
  <path d="M82 214L86 ${top}L114 ${top}L118 214Z" ${tint(k, 0.25)}/><path d="M86 ${top}v-7h6v7h5v-7h6v7h5v-7h6v7"/>
  ${ws}
  ${
    broke
      ? `<path d="M128 ${f(top - 22)}L132 ${f(top - 34)}L137 ${f(top - 26)}L142 ${f(top - 38)}L146 ${f(top - 26)}L151 ${f(top - 32)}L150 ${f(top - 18)}Z" ${solid(k)} transform="rotate(24 140 ${f(top - 28)})"/>
  <path d="M172 50L138 ${f(top + 10)}L152 ${f(top + 12)}L114 ${f(top + 44)}" stroke="${k.hue}" stroke-width="7" stroke-opacity=".35"/>
  <path d="M172 50L138 ${f(top + 10)}L152 ${f(top + 12)}L114 ${f(top + 44)}" stroke="#fff6d0" stroke-width="2.6"/>`
      : `<path d="M84 ${f(top - 12)}L88 ${f(top - 24)}L94 ${f(top - 16)}L100 ${f(top - 28)}L106 ${f(top - 16)}L112 ${f(top - 24)}L116 ${f(top - 12)}Z" ${solid(k)}/>`
  }
  <text x="100" y="${f(Math.max(62, +top - (broke ? 8 : 34)))}" text-anchor="middle" font-size="9" font-weight="700" fill="${k.gold}" stroke="none">${peak ? `${esc(fmtShort(peak))}/分` : '—'}</text>
  ${note(k, 100, 256, broke ? '今天破了两周纪录' : d.record ? `两周纪录 ${fmtShort(d.record)}/分` : '')}`
  },
  // XVII the Star: the eight stars are your eight busiest projects this week, the great one the busiest
  (k, d) => {
    const ps = d.projects
    const max = Math.max(...ps.map((p) => p.tokens), 1)
    const spots = [
      [46, 72],
      [154, 72],
      [36, 120],
      [164, 120],
      [56, 158],
      [144, 158],
      [100, 150]
    ]
    const big = ps[0]
    const R = big ? f(14 + 16 * Math.sqrt(big.tokens / max)) : 10
    const small = ps
      .slice(1)
      .map((p, i) => {
        const [x, y] = spots[i]
        const r = f(3 + 8 * Math.sqrt(p.tokens / max))
        return `<path d="${star(x, y, r, r * 0.32, 8)}" ${solid(k)}/>`
      })
      .join('')
    return `
  <circle cx="100" cy="96" r="${f(R + 10)}" fill="${k.hue}" fill-opacity=".3" stroke="none"/>
  <path d="${star(100, 96, R, R * 0.3, 8)}" ${solid(k)}/><path d="${star(100, 96, R * 0.66, R * 0.22, 8, -67.5)}" ${tint(k, 0.6)}/>
  ${small}
  ${big ? note(k, 100, f(96 + R + 14), cut(big.name, 14), 7) : note(k, 100, 140, '还没有项目', 8)}
  <ellipse cx="96" cy="236" rx="60" ry="13" ${tint(k, 0.28)}/><path d="M60 236q8 -3 16 0M100 240q8 -3 16 0" stroke-opacity=".6"/>
  <path d="M60 196q-2 11 6 16q9 0 11 -9l-4 -11Z" ${tint(k, 0.45)}/><path d="M77 204Q84 216 84 230" stroke-dasharray="2 3"/>
  <path d="M128 192q-2 11 6 16q9 0 11 -9l-4 -11Z" ${tint(k, 0.45)}/><path d="M145 200Q154 212 156 226"/>`
  },
  // XVIII the Moon: its phase is how much of the 7-day quota is used (full moon, all gone); one drop of dew for each day to the reset
  (k, d) => {
    const p = d.seven ? clamp01(d.seven.pct / 100) : 0
    const r = 26
    const cx = 100
    const cy = 90
    const rx = f(r * Math.abs(1 - 2 * p))
    const lit = p <= 0 ? '' : `M${cx} ${cy - r}A${r} ${r} 0 0 1 ${cx} ${cy + r}A${rx} ${r} 0 0 ${p > 0.5 ? 1 : 0} ${cx} ${cy - r}Z`
    const left = d.seven ? Math.max(0, Math.ceil((d.seven.end - d.at) / 86_400_000)) : 0
    const drops = Array.from({ length: Math.min(7, left) }, (_, i) => `<path d="${drop(100 + (i - (Math.min(7, left) - 1) / 2) * 11, 128 + (i % 2) * 6)}" ${solid(k)}/>`).join('')
    return `
  <circle cx="${cx}" cy="${cy}" r="42" fill="${k.hue}" fill-opacity="${f(0.1 + 0.25 * p)}" stroke="none"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${k.dark}"/>
  ${lit ? `<path d="${lit}" fill="${p >= 0.95 ? '#ffd0d6' : '#f4ecd2'}" fill-opacity=".92" stroke="none"/>` : ''}
  <circle cx="${cx}" cy="${cy}" r="${r}"/>
  <path d="${rays(cx, cy, 31, 40, 16)}" stroke-opacity=".6"/>
  ${drops}
  <path d="M30 222L34 150L48 150L52 222Z" ${tint(k, 0.22)}/><path d="M148 222L152 150L166 150L170 222Z" ${tint(k, 0.22)}/>
  <path d="M100 254Q86 236 102 222Q118 208 96 194Q84 184 100 168" stroke-opacity=".6"/>
  <path d="M62 216L64 200L70 208L76 200L78 216Q70 224 62 216Z" ${tint(k, 0.5)}/><path d="M122 216L124 200L130 208L136 200L138 216Q130 224 122 216Z" fill="${k.dark}"/>
  <ellipse cx="100" cy="252" rx="46" ry="8" ${tint(k, 0.3)}/>
  <text x="100" y="${f(164)}" text-anchor="middle" font-size="9" font-weight="700" fill="${k.gold}" stroke="none">${d.seven ? `${Math.round(d.seven.pct)}%` : '—'}</text>
  ${note(k, 100, 176, d.seven ? `${left} 天后刷新` : '没有 7 天额度读数')}`
  },
  // XIX the Sun: 24 rays, one for each hour of today, as long as that hour's use (noon at the top)
  (k, d) => {
    const hrs = d.today.hours
    const max = Math.max(...hrs, 1)
    const nowH = new Date(d.at).getHours()
    const rs = hrs
      .map((v, h) => {
        const a = -90 + (h - 12) * 15
        const [x1, y1] = at(100, 118, 29, a)
        const [x2, y2] = at(100, 118, 32 + 34 * Math.sqrt(v / max), a)
        const cur = h === nowH
        return `<path d="M${x1} ${y1}L${x2} ${y2}" stroke-width="${cur ? 4 : 3.2}" stroke="${cur ? '#ff8a4c' : '#fff3cf'}" stroke-opacity="${v > 0 || cur ? 1 : 0.3}"/>`
      })
      .join('')
    return `
  <circle cx="100" cy="118" r="60" fill="${k.hue}" fill-opacity=".1" stroke="none"/>
  ${rs}
  <circle cx="100" cy="118" r="25" ${solid(k)}/>
  <path d="M90 112q4 -4 8 0M102 112q4 -4 8 0M91 126q9 7 18 0" stroke="${k.dark}" stroke-width="1.8"/>
  ${note(k, 100, 48, '12 点')}${note(k, 100, 192, '0 点')}${note(k, 26, 121, '6', 6.5, 'start')}${note(k, 174, 121, '18', 6.5, 'end')}
  <rect x="22" y="212" width="156" height="20" ${tint(k, 0.2)}/>
  <path d="M22 222h156M40 212v10M70 212v10M100 212v10M130 212v10M160 212v10M55 222v10M85 222v10M115 222v10M145 222v10" stroke-opacity=".5"/>
  ${[44, 78, 122, 156].map((x) => `<path d="M${x} 212L${x} 204"/><path d="${star(x, 198, 8, 4, 10)}" ${tint(k, 0.65)}/><circle cx="${x}" cy="198" r="3.2" ${solid(k)}/>`).join('')}
  ${note(k, 100, 250, '每道光是今天的一个小时')}`
  },
  // XX Judgement: the trumpet calls your refresh tasks: those that finished stand up, failed ones lie in their coffins
  (k, d) => {
    const ts = d.tasks.slice(0, 6)
    const n = ts.length
    const fig = ts
      .map((t, i) => {
        const x = f(n === 1 ? 100 : 38 + (124 * i) / (n - 1))
        const coffin = `<rect x="${f(x - 12)}" y="222" width="24" height="12" rx="2" fill="${k.dark}"/>`
        if (t.status === 'done') return `${coffin}<path d="M${x} 222L${x} 206M${x} 208L${f(x - 9)} 193M${x} 208L${f(x + 9)} 193"/><circle cx="${x}" cy="200" r="4.5" ${tint(k, 0.6)}/>`
        if (t.status === 'running') return `${coffin}<path d="M${x} 222L${x} 214M${x} 216L${f(x - 7)} 208M${x} 216L${f(x + 7)} 208"/><circle cx="${x}" cy="210" r="4"/>`
        if (t.status === 'failed') return `${coffin}<path d="M${f(x - 9)} 220h18" stroke="#ff8a8a"/><circle cx="${f(x - 11)}" cy="219" r="2.6" stroke="#ff8a8a"/>`
        return `${coffin}<path d="M${f(x - 12)} 222h24" stroke-opacity=".6"/>`
      })
      .join('')
    const done = ts.filter((t) => t.status === 'done').length
    return `
  <path d="M70 78L60 54M100 72V50M130 78L140 54" stroke-opacity=".5"/>
  <circle cx="100" cy="70" r="7"/><path d="M94 74Q76 58 58 64Q72 70 76 80M106 74Q124 58 142 64Q128 70 124 80"/>
  <path d="M30 96q6 -14 20 -10q8 -14 24 -6q10 -10 24 0q10 -8 22 2q14 -4 18 10q12 0 14 10Z" ${tint(k, 0.22)}/>
  <path d="M104 84L134 122L144 116L108 80Z" ${tint(k, 0.55)}/>
  <rect x="114" y="120" width="22" height="18" ${tint(k, 0.4)}/><path d="M125 120v18M114 129h22" stroke="${k.hue}" stroke-width="2.2"/>
  <path d="M22 178L46 156L66 170L90 148L112 172L136 154L160 170L178 160" stroke-opacity=".35"/>
  ${fig || note(k, 100, 210, '这 7 天没有刷新任务', 7.5)}
  <path d="M22 246q12 -5 24 0t24 0t24 0t24 0t24 0t24 0t12 0" stroke-opacity=".5"/>
  ${n ? note(k, 100, 258, `${n} 个任务 · ${done} 个完成`) : ''}`
  },
  // XXI the World: the laurel has a leaf for each of the last 30 days, brighter the more you used that day
  (k, d) => {
    const days = d.days.slice(-30)
    const max = Math.max(...days.map((x) => x.tokens), 1)
    const leaves = days
      .map((x, i) => {
        const a = -90 + (i * 360) / 30
        const t = rad(a)
        const lx = f(100 + 44 * Math.cos(t))
        const ly = f(156 + 70 * Math.sin(t))
        const deg = f((Math.atan2(70 * Math.cos(t), -44 * Math.sin(t)) * 180) / Math.PI)
        const v = x.tokens / max
        const today = i === days.length - 1
        return `<ellipse cx="${lx}" cy="${ly}" rx="${today ? 3.4 : 2.6}" ry="${today ? 7 : 5.5}" transform="rotate(${deg} ${lx} ${ly})" fill="${today ? '#fff6d0' : k.hue}" fill-opacity="${f(x.tokens > 0 ? 0.25 + 0.75 * Math.sqrt(v) : 0.06)}" stroke-width=".6"/>`
      })
      .join('')
    return `
  <ellipse cx="100" cy="156" rx="44" ry="70" stroke-width="1.6" stroke-opacity=".6"/>
  ${leaves}
  <path d="${infinity(100, 86, 22)}" fill="${k.hue}" fill-opacity=".6"/><path d="${infinity(100, 226, 22)}" fill="${k.hue}" fill-opacity=".6"/>
  <circle cx="100" cy="120" r="6"/><path d="M100 126Q96 150 102 172M102 172L112 198M100 176L90 194L104 202"/>
  <path d="M88 134Q114 150 92 176Q84 188 108 196" stroke="${k.hue}" stroke-width="2.2"/>
  <path d="M100 134L80 146M100 134L122 122"/>
  ${note(k, 100, 248, `30 天里用了 ${days.filter((x) => x.tokens > 0).length} 天`)}
  ${fourCorners(k)}`
  }
]

/** "1.2M" style, short enough for a card */
export function fmtShort(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`
  return String(Math.round(n))
}

/** a few stars on the card's sky, the same for the same card */
function sky(id: number): string {
  let s = 1 + id * 7919
  const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
  let out = ''
  for (let i = 0; i < 16; i++) out += `<circle cx="${f(18 + rand() * 164)}" cy="${f(46 + rand() * 220)}" r="${f(0.4 + rand() * 0.9)}" fill="#fff" opacity="${f(0.25 + rand() * 0.5)}"/>`
  return out
}

/** mixes a hex colour toward `to` */
function mix(hex: string, to: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const [a, b] = [p(hex), p(to)]
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`
}

const NAME_FONT = "'KaiTi','STKaiti','Kaiti SC','Noto Serif SC',serif"

/** a deck with nothing in it yet (cards still draw, empty) */
export function emptyDeck(at = Date.now()): TarotDeck {
  return {
    source: 'claude',
    tool: 'claude',
    at,
    firstDay: null,
    days: Array.from({ length: 60 }, (_, i) => ({ day: at - (59 - i) * 86_400_000, tokens: 0, output: 0, cost: 0 })),
    today: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, hours: Array(24).fill(0), peak: null },
    usualHours: Array(24).fill(0),
    record: 0,
    tpm: 0,
    lovers: null,
    streak: 0,
    bestStreak: 0,
    night: { tokens: 0, share: 0 },
    five: null,
    seven: null,
    guardAt: null,
    wheel: [],
    week: { now: 0, prev: 0 },
    unused: null,
    ended: [],
    endedCount: 0,
    devil: null,
    full: null,
    projects: [],
    tasks: []
  }
}

/** One card face drawing the deck's data; `uid` keeps its ids apart from other cards on the page */
export function cardFace(id: number, uid: string, opts: { deck?: TarotDeck; frame?: string } = {}): string {
  const a = ARCANA[id] ?? ARCANA[0]
  const gold = `url(#gd${uid})`
  const ink: Ink = { gold, hue: a.hue, dark: '#07080f' }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 340" width="200" height="340">
<defs>
  <linearGradient id="gd${uid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbe9b7"/><stop offset=".5" stop-color="#d7ab5e"/><stop offset="1" stop-color="#f4d995"/></linearGradient>
  <linearGradient id="bg${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(a.hue, '#0b0d1a', 0.72)}"/><stop offset=".55" stop-color="#0b0c18"/><stop offset="1" stop-color="#07080f"/></linearGradient>
  <radialGradient id="gl${uid}"><stop offset="0" stop-color="${a.hue}" stop-opacity=".42"/><stop offset="1" stop-color="${a.hue}" stop-opacity="0"/></radialGradient>
</defs>
<rect x="2" y="2" width="196" height="336" rx="14" fill="url(#bg${uid})" stroke="${opts.frame ?? a.hue}" stroke-opacity=".55" stroke-width="1.5"/>
<ellipse cx="100" cy="156" rx="92" ry="112" fill="url(#gl${uid})"/>
${sky(id)}
<rect x="10" y="10" width="180" height="320" rx="9" fill="none" stroke="${gold}" stroke-width="1.2"/>
<rect x="14" y="14" width="172" height="312" rx="7" fill="none" stroke="${gold}" stroke-width=".5" opacity=".6"/>
${[
  [20, 20],
  [180, 20],
  [20, 320],
  [180, 320]
]
  .map(([x, y]) => `<path d="${star(x, y, 4, 1, 4)}" fill="${gold}"/>`)
  .join('')}
<path d="M56 31h24M120 31h24" stroke="${gold}" stroke-width=".8"/>
<text x="100" y="36" text-anchor="middle" font-family="'Times New Roman',Georgia,serif" font-size="16" letter-spacing="1.5" fill="${gold}">${a.numeral}</text>
<g fill="none" stroke="${gold}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ART[a.id](ink, opts.deck ?? emptyDeck(), uid)}</g>
<path d="M34 274h132" stroke="${gold}" stroke-width=".6" opacity=".7"/>
<text x="100" y="298" text-anchor="middle" font-family="${NAME_FONT}" font-size="20" fill="${gold}">${a.name}</text>
<text x="100" y="314" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="7.2" letter-spacing="2.2" fill="${gold}" opacity=".85">${a.en}</text>
</svg>`
}

/** The back of every card: a starry seal in the tool's colour */
export function cardBack(uid: string, accent: string): string {
  const gold = `url(#bgd${uid})`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 340" width="200" height="340">
<defs>
  <linearGradient id="bgd${uid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbe9b7"/><stop offset=".5" stop-color="#d7ab5e"/><stop offset="1" stop-color="#f4d995"/></linearGradient>
  <radialGradient id="bbg${uid}" cx=".5" cy=".5" r=".7"><stop offset="0" stop-color="${mix(accent, '#0b0d1a', 0.55)}"/><stop offset="1" stop-color="#07080f"/></radialGradient>
</defs>
<rect x="2" y="2" width="196" height="336" rx="14" fill="url(#bbg${uid})" stroke="${accent}" stroke-opacity=".6" stroke-width="1.5"/>
${sky(99)}${sky(57)}
<rect x="10" y="10" width="180" height="320" rx="9" fill="none" stroke="${gold}" stroke-width="1.2"/>
<g fill="none" stroke="${gold}" stroke-width="1">
  <circle cx="100" cy="170" r="70" opacity=".5"/><circle cx="100" cy="170" r="56"/><circle cx="100" cy="170" r="30" opacity=".7"/>
  <path d="${rays(100, 170, 30, 56, 24)}" opacity=".45"/>
  <path d="${star(100, 170, 70, 30, 8)}" opacity=".35"/>
  <path d="M100 20v40M100 280v40M30 170h-12M170 170h12" opacity=".6"/>
</g>
<circle cx="100" cy="170" r="22" fill="${accent}" fill-opacity=".35"/>
<path d="${star(100, 170, 24, 6, 8)}" fill="${gold}"/>
<path d="${star(100, 60, 8, 2, 4)}${star(100, 280, 8, 2, 4)}" fill="${gold}"/>
</svg>`
}
