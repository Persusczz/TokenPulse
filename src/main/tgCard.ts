import { cn } from './report'

/** The "today" card sent to Telegram as a picture: an SVG drawn here, turned into a JPEG by cardRender */

export const CARD_W = 1080
export const CARD_H = 1400

export interface CardQuota {
  /** "Claude 5h" */
  label: string
  pct: number
  /** "23:17 重置" */
  reset: string | null
}

export interface CardData {
  /** "10/5 周日" */
  date: string
  /** "21:34" */
  time: string
  /** "Claude", "Codex" or "Claude + Codex" */
  view: string
  accent: string
  tokens: number
  /** formatted, "$106.06" */
  cost: string
  /** the same in USD, for counting up in the animation */
  costUsd: number
  messages: number
  sessions: number
  /** 0–1 */
  cacheHit: number
  /** today's tokens by hour, 0–23 */
  hours: number[]
  nowHour: number
  quotas: CardQuota[]
  /** the 5h window as a star */
  star: { name: string; pct: number; color: string; desc: string } | null
  model: string | null
  /** "♌ 狮子座 · 点亮 5/9 颗星 · 编码星座「夜猫子」" */
  sign: string | null
  /** "12.3 万 tokens/分" while working, else null */
  rate: string | null
}

const SANS = "'Segoe UI Variable Display','Segoe UI','Microsoft YaHei UI','Microsoft YaHei','PingFang SC',sans-serif"

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
/** rough width of a line: CJK a full em, the rest a bit over half */
const widthOf = (s: string, size: number) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) >= 0x2e80 ? 1 : 0.56), 0) * size

/** same stars for the same day */
function rng(seed: string): () => number {
  let h = 1779033703
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** a star with `n` points (the spark mark, flares) */
function starPath(cx: number, cy: number, outer: number, inner: number, n: number): string {
  const pts: string[] = []
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? inner : outer
    const a = (Math.PI * i) / n - Math.PI / 2
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`)
  }
  return `M${pts.join('L')}Z`
}

/** mixes a hex colour toward white (t > 0) */
function lighten(hex: string, t: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const ch = (v: number) => Math.round(v + (255 - v) * t)
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`
}

const FLARE_SPOTS = [
  [600, 70],
  [720, 225],
  [560, 448],
  [1046, 580],
  [36, 760],
  [1046, 980],
  [880, 1350],
  [470, 1352],
  [40, 210]
]

const level = (pct: number) => (pct >= 90 ? ['#ff5d6c', '#ff9aa5'] : pct >= 70 ? ['#ffb547', '#ffd88f'] : ['#3ddc97', '#9ff5cf'])

/** where an animation stands: `p` runs 0 → 1 through the opening, `tw` loops 0 → 1 for the twinkle */
export interface CardMoment {
  p: number
  tw: number
  money: (usd: number) => string
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
/** ease out, cubic */
const ease = (v: number) => 1 - Math.pow(1 - clamp01(v), 3)

function ring(q: CardQuota, cx: number, cy: number, r: number, i: number, grow = 1): string {
  const c = 2 * Math.PI * r
  const p = Math.max(0, Math.min(1, (q.pct / 100) * grow))
  const [deep, hi] = level(q.pct * grow)
  const pct = Math.round(q.pct * grow)
  return `
  <linearGradient id="ring${i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset="1" stop-color="${deep}"/></linearGradient>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="22"/>
  <circle cx="${cx}" cy="${cy}" r="${r - 26}" fill="rgba(255,255,255,0.025)"/>
  ${p > 0 ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${deep}" stroke-opacity="0.55" stroke-width="22" stroke-linecap="round" stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})" filter="url(#glow)"/>` : ''}
  ${p > 0 ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#ring${i})" stroke-width="22" stroke-linecap="round" stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>` : ''}
  <text x="${cx}" y="${cy + 20}" text-anchor="middle" font-size="${r > 100 ? 64 : 54}" font-weight="700" fill="#fff">${pct}<tspan font-size="${r > 100 ? 30 : 26}" fill="rgba(255,255,255,0.6)" dx="4">%</tspan></text>
  <text x="${cx}" y="${cy + r + 52}" text-anchor="middle" font-size="27" font-weight="600" fill="rgba(255,255,255,0.88)">${esc(q.label)}</text>
  ${q.reset ? `<text x="${cx}" y="${cy + r + 86}" text-anchor="middle" font-size="22" fill="rgba(255,255,255,0.5)">${esc(q.reset)}</text>` : ''}`
}

export function cardSvg(d: CardData, at?: CardMoment): string {
  const W = CARD_W
  const H = CARD_H
  const rand = rng(`${d.date}${d.view}`)
  const p = at ? at.p : 1
  const twinkle = (k: number) => (at ? 0.55 + 0.45 * Math.sin(2 * Math.PI * (at.tw + k)) : 1)
  const accent = d.accent
  const accentHi = lighten(accent, 0.45)

  // a sky of the day: small stars, a few with flares
  let stars = ''
  for (let i = 0; i < 150; i++) {
    const x = rand() * W
    const y = rand() * H
    const k = rand()
    stars += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.6 + k * 1.7).toFixed(2)}" fill="#fff" opacity="${(0.18 + k * 0.6).toFixed(2)}"/>`
  }
  // flares only where no text runs
  for (const [fx, fy] of FLARE_SPOTS) {
    if (rand() < 0.3) continue
    const x = fx + (rand() - 0.5) * 30
    const y = fy + (rand() - 0.5) * 24
    const s = 7 + rand() * 9
    const o = (0.45 + rand() * 0.4) * twinkle(rand())
    stars += `<path d="${starPath(x, y, s, s * 0.16, 4)}" fill="#fff" opacity="${o.toFixed(2)}"/>`
  }

  // the number and its unit ("2.68 亿")
  const big = cn(d.tokens * ease(p / 0.7))
  const cost = at ? at.money(d.costUsd * ease(p / 0.7)) : d.cost
  const [num, unit] = big.includes(' ') ? big.split(' ') : [big, '']

  // quota rings, evenly across
  const n = Math.min(4, d.quotas.length)
  const r = n <= 2 ? 112 : 88
  const gap = n <= 2 ? 380 : 245
  const rings = n
    ? d.quotas
        .slice(0, 4)
        .map((q, i) => ring(q, Math.round(W / 2 + (i - (n - 1) / 2) * gap), 650, r, i, ease((p - 0.1 - i * 0.08) / 0.6)))
        .join('')
    : `<text x="${W / 2}" y="660" text-anchor="middle" font-size="28" fill="rgba(255,255,255,0.55)">额度：暂无数据（开启订阅额度监控后显示）</text>`

  // 24 hours of today
  const max = Math.max(...d.hours, 1)
  const slot = 896 / 24
  const base = 1052
  let bars = ''
  let busiest = -1
  d.hours.forEach((v, h) => {
    if (v > 0 && (busiest < 0 || v > d.hours[busiest])) busiest = h
  })
  for (let h = 0; h < 24; h++) {
    const v = d.hours[h] ?? 0
    const x = 92 + h * slot + (slot - 22) / 2
    if (h > d.nowHour) {
      bars += `<rect x="${x.toFixed(1)}" y="${base - 4}" width="22" height="4" rx="2" fill="rgba(255,255,255,0.07)"/>`
      continue
    }
    if (v <= 0) {
      bars += `<rect x="${x.toFixed(1)}" y="${base - 4}" width="22" height="4" rx="2" fill="rgba(255,255,255,0.16)"/>`
      continue
    }
    // the bars rise from left to right through the opening
    const grow = ease((p * 1.6 - 0.25 - (h / 24) * 0.7) / 0.45)
    if (grow <= 0) continue
    const hgt = Math.max(8, (v / max) * 124 * grow)
    const now = h === d.nowHour
    const rect = (extra: string) => `<rect x="${x.toFixed(1)}" y="${(base - hgt).toFixed(1)}" width="22" height="${hgt.toFixed(1)}" rx="7" ${extra}/>`
    // the hour now glows
    if (now) bars += rect(`fill="${accentHi}" opacity="${(0.7 * twinkle(0.25)).toFixed(2)}" filter="url(#glow)"`)
    bars += rect(`fill="${now ? 'url(#barNow)' : 'url(#bar)'}"`)
  }
  const ticks = [0, 6, 12, 18, 24].map((h) => `<text x="${(92 + h * slot).toFixed(1)}" y="1086" text-anchor="middle" font-size="20" fill="rgba(255,255,255,0.4)">${h}</text>`).join('')

  // four small tiles
  const tiles = [
    { v: String(d.messages), l: '次响应' },
    { v: String(d.sessions), l: '个会话' },
    { v: `${(d.cacheHit * 100).toFixed(1)}%`, l: '缓存命中' },
    { v: cut(d.model ?? '—', 11), l: '主力模型' }
  ]
    .map((t, i) => {
      const x = 60 + i * 245
      const small = t.v.length > 7
      return `<rect x="${x}" y="1124" width="225" height="112" rx="26" fill="rgba(255,255,255,0.055)" stroke="rgba(255,255,255,0.08)"/>
  <text x="${x + 24}" y="${small ? 1178 : 1182}" font-size="${small ? 28 : 42}" font-weight="700" fill="#fff">${esc(t.v)}</text>
  <text x="${x + 24}" y="1216" font-size="21" fill="rgba(255,255,255,0.5)">${t.l}</text>`
    })
    .join('')

  // the 5h window as a star
  const st = d.star
  const starBlock = st
    ? `<circle cx="104" cy="1292" r="46" fill="${st.color}" opacity="0.18" filter="url(#soft)"/>
  <path d="${starPath(104, 1292, 40, 6, 4)}" fill="${st.color}" opacity="0.55"/>
  <circle cx="104" cy="1292" r="20" fill="url(#starCore)"/>
  <text x="160" y="1284" font-size="30" font-weight="700" fill="#fff">5h 恒星 · ${esc(st.name)}<tspan font-size="24" font-weight="400" fill="rgba(255,255,255,0.55)" dx="10">${Math.round(st.pct)}%</tspan></text>
  <text x="160" y="1322" font-size="22" fill="rgba(255,255,255,0.55)">${esc(cut(st.desc, 34))}</text>`
    : ''
  const sign = d.sign ? `<text x="${st ? 1000 : W / 2}" y="${st ? 1284 : 1300}" text-anchor="${st ? 'end' : 'middle'}" font-size="22" fill="rgba(255,255,255,0.5)">${esc(cut(d.sign, st ? 18 : 40))}</text>` : ''

  const statusText = d.rate ? `正在工作 · ${d.rate}` : '空闲中'
  const dot = (1000 - widthOf(statusText, 23) - 20).toFixed(1)
  const status = d.rate
    ? `<circle cx="${dot}" cy="404" r="${(10 + 6 * twinkle(0.5)).toFixed(1)}" fill="#3ddc97" opacity="0.5" filter="url(#glow)"/><circle cx="${dot}" cy="404" r="7" fill="#3ddc97"/><text x="1000" y="412" text-anchor="end" font-size="23" fill="#9ff5cf">${esc(statusText)}</text>`
    : `<circle cx="${dot}" cy="404" r="7" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="2"/><text x="1000" y="412" text-anchor="end" font-size="23" fill="rgba(255,255,255,0.55)">${statusText}</text>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${SANS}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="#060a18"/><stop offset="0.5" stop-color="#0c1230"/><stop offset="1" stop-color="#170d2e"/></linearGradient>
  <radialGradient id="neb1"><stop offset="0" stop-color="${accent}" stop-opacity="0.55"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
  <radialGradient id="neb2"><stop offset="0" stop-color="#5b6cff" stop-opacity="0.45"/><stop offset="1" stop-color="#5b6cff" stop-opacity="0"/></radialGradient>
  <radialGradient id="neb3"><stop offset="0" stop-color="#2fd3c5" stop-opacity="0.22"/><stop offset="1" stop-color="#2fd3c5" stop-opacity="0"/></radialGradient>
  <linearGradient id="num" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="${accentHi}"/></linearGradient>
  <linearGradient id="bar" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${accent}" stop-opacity="0.55"/><stop offset="1" stop-color="${accentHi}"/></linearGradient>
  <linearGradient id="barNow" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${accentHi}"/><stop offset="1" stop-color="#ffffff"/></linearGradient>
  <radialGradient id="starCore"><stop offset="0" stop-color="#ffffff"/><stop offset="0.45" stop-color="${st?.color ?? '#fff'}"/><stop offset="1" stop-color="${st?.color ?? '#fff'}" stop-opacity="0.2"/></radialGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
  <filter id="soft" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="16"/></filter>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<ellipse cx="900" cy="170" rx="520" ry="420" fill="url(#neb1)"/>
<ellipse cx="120" cy="1150" rx="560" ry="460" fill="url(#neb2)"/>
<ellipse cx="560" cy="640" rx="620" ry="300" fill="url(#neb3)"/>
${stars}
<rect x="24" y="24" width="${W - 48}" height="${H - 48}" rx="46" fill="none" stroke="rgba(255,255,255,0.09)" stroke-width="2"/>

<path d="${starPath(98, 112, 34, 9, 8)}" fill="${accent}" filter="url(#glow)" opacity="0.8"/>
<path d="${starPath(98, 112, 32, 9, 8)}" fill="${accentHi}"/>
<text x="150" y="116" font-size="40" font-weight="700" fill="#fff">TokenPulse</text>
<text x="150" y="154" font-size="25" fill="${accentHi}">今日卡片 · ${esc(d.view)}</text>
<text x="1000" y="108" text-anchor="end" font-size="30" font-weight="600" fill="rgba(255,255,255,0.85)">${esc(d.date)}</text>
<text x="1000" y="146" text-anchor="end" font-size="24" fill="rgba(255,255,255,0.45)">${esc(d.time)} 更新</text>

<text x="80" y="262" font-size="25" letter-spacing="5" fill="rgba(255,255,255,0.5)">今日 TOKENS</text>
<text x="74" y="408" font-size="156" font-weight="800" fill="url(#num)" letter-spacing="-3">${esc(num)}<tspan font-size="64" font-weight="600" dx="14" fill="${accentHi}">${esc(unit)}</tspan></text>
<text x="1000" y="318" text-anchor="end" font-size="66" font-weight="700" fill="#fff">${esc(cost)}</text>
<text x="1000" y="356" text-anchor="end" font-size="23" fill="rgba(255,255,255,0.45)">API 等价费用</text>
${status}

<text x="80" y="492" font-size="25" letter-spacing="5" fill="rgba(255,255,255,0.5)">额度</text>
<rect x="150" y="483" width="850" height="1.5" fill="rgba(255,255,255,0.09)"/>
${rings}

<rect x="60" y="868" width="960" height="236" rx="30" fill="rgba(255,255,255,0.045)" stroke="rgba(255,255,255,0.08)"/>
<text x="92" y="914" font-size="25" letter-spacing="3" fill="rgba(255,255,255,0.6)">24 小时</text>
${busiest >= 0 ? `<text x="988" y="914" text-anchor="end" font-size="22" fill="rgba(255,255,255,0.45)">最忙 ${busiest}:00–${busiest + 1}:00</text>` : ''}
${bars}
${ticks}

${tiles}
${starBlock}
${sign}
</svg>`
}

/** the opening and a breath of twinkle after it, as frames for a looping animation */
export function cardFrames(d: CardData, money: (usd: number) => string, fps = 25): string[] {
  const opening = Math.round(fps * 2.2)
  const hold = Math.round(fps * 1.6)
  return Array.from({ length: opening + hold }, (_, i) => cardSvg(d, { p: Math.min(1, i / opening), tw: i / (opening + hold), money }))
}

// ---------------------------------------------------------------- the quota alert, animated

export const GAUGE_W = 720
export const GAUGE_H = 420

export interface GaugeAlert {
  /** "Claude 5 小时额度" */
  title: string
  accent: string
  /** where the needle starts and where it lands, percent */
  from: number
  to: number
  /** "23:17 重置" */
  note: string
  /** a reset drains the ring and lights it up again */
  reset?: boolean
}

/** one moment of the alert: the ring sweeps from `from` to `to` through t = 0 → 0.75, then breathes */
export function gaugeSvg(g: GaugeAlert, t: number): string {
  const W = GAUGE_W
  const H = GAUGE_H
  const k = ease(t / 0.75)
  const v = g.from + (g.to - g.from) * k
  const [deep, hi] = level(v)
  const cx = 220
  const cy = 210
  const r = 128
  const c = 2 * Math.PI * r
  const frac = clamp01(v / 100)
  const pulse = 0.5 + 0.5 * Math.sin(2 * Math.PI * t * 2)
  const flash = g.reset && t > 0.75 ? clamp01((t - 0.75) / 0.25) : 0
  const rand = rng(g.title)
  let stars = ''
  for (let i = 0; i < 60; i++) stars += `<circle cx="${(rand() * W).toFixed(1)}" cy="${(rand() * H).toFixed(1)}" r="${(0.6 + rand() * 1.4).toFixed(2)}" fill="#fff" opacity="${(0.15 + rand() * 0.5).toFixed(2)}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${SANS}">
<defs>
  <linearGradient id="gbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#070b1a"/><stop offset="1" stop-color="#170d2e"/></linearGradient>
  <radialGradient id="gneb"><stop offset="0" stop-color="${deep}" stop-opacity="${(0.35 + 0.25 * pulse * (v >= 90 ? 1 : 0.4)).toFixed(2)}"/><stop offset="1" stop-color="${deep}" stop-opacity="0"/></radialGradient>
  <linearGradient id="garc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset="1" stop-color="${deep}"/></linearGradient>
  <filter id="gglow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="12"/></filter>
</defs>
<rect width="${W}" height="${H}" fill="url(#gbg)"/>
<ellipse cx="${cx}" cy="${cy}" rx="260" ry="220" fill="url(#gneb)"/>
${stars}
<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="26"/>
${frac > 0.003 ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${deep}" stroke-opacity="0.6" stroke-width="26" stroke-linecap="round" stroke-dasharray="${(c * frac).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})" filter="url(#gglow)"/>
<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#garc)" stroke-width="26" stroke-linecap="round" stroke-dasharray="${(c * frac).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>` : ''}
${flash > 0 ? `<circle cx="${cx}" cy="${cy}" r="${(r + 40 * flash).toFixed(1)}" fill="none" stroke="#9ff5cf" stroke-width="${(10 * (1 - flash) + 1).toFixed(1)}" opacity="${(1 - flash).toFixed(2)}"/>` : ''}
<text x="${cx}" y="${cy + 26}" text-anchor="middle" font-size="76" font-weight="800" fill="#fff">${Math.round(v)}<tspan font-size="34" fill="rgba(255,255,255,0.6)" dx="4">%</tspan></text>
<text x="400" y="150" font-size="34" font-weight="700" fill="#fff">${esc(g.title)}</text>
<text x="400" y="205" font-size="28" fill="${hi}">${g.reset ? (t > 0.75 ? '已重置，满格出发' : '正在重置…') : v >= 100 ? '已经用完' : v >= 90 ? '快用完了' : '用得有点快'}</text>
<text x="400" y="255" font-size="24" fill="rgba(255,255,255,0.55)">${esc(g.note)}</text>
<path d="${starPath(420, 330, 16, 4, 8)}" fill="${g.accent}" opacity="0.9"/>
<text x="446" y="339" font-size="24" font-weight="700" fill="rgba(255,255,255,0.75)">TokenPulse</text>
</svg>`
}

export function gaugeFrames(g: GaugeAlert, fps = 25): string[] {
  const n = Math.round(fps * 2.6)
  return Array.from({ length: n }, (_, i) => gaugeSvg(g, i / (n - 1)))
}
