import type { UsageSource } from '@shared/types'
import { escapeHtml, type Button } from './telegram'
import { esc, lighten, level, rng, SANS, toolMark } from './tgCard'

/**
 * Publishing a task from Telegram: one message, like the app's task form. A
 * picture of the tool's quota and its next refresh on top, the task as its
 * caption, and buttons that change the tool, the start, the folder and the
 * options in place before it is queued.
 */

export type DraftTrigger = 'reset' | 'now' | 'manual'

export interface TaskDraft {
  id: string
  prompt: string
  tool: UsageSource
  trigger: DraftTrigger
  cwd: string
  /** the folders offered as buttons */
  folders: string[]
  /** null: the default in settings */
  model: string | null
  retries: number
  cont: boolean
  /** the message carries the picture, so taps edit its caption */
  photo: boolean
}

/** One tool as the panel shows it: its quota, its next refresh, its queue */
export interface ToolGlance {
  tool: UsageSource
  /** "Claude Code" */
  name: string
  accent: string
  /** the quota windows, 5 hours first */
  windows: { label: string; pct: number; reset: string | null }[]
  /** the next 5-hour refresh; null while no window is open */
  nextReset: number | null
  /** WorkBuddy's credits instead of windows */
  credits?: { remaining: number | null; total: number | null; today: number | null; dailyAvg: number | null; daysLeft: number | null; plan: string }
  queued: number
  /** queued tasks that start at the next refresh */
  atReset: number
  running: number
  /** why a task due now would wait */
  waiting: string | null
  cli: boolean
  /** "守卫 90%" */
  guard: string | null
}

export interface DraftEnv {
  now: number
  /** the tools a task can go to */
  tools: UsageSource[]
  /** when a task queued now would start */
  startAt: (tool: UsageSource, trigger: DraftTrigger) => number
  /** models to step through after the default */
  models: (tool: UsageSource) => string[]
  /** the model in settings (null: the CLI's own) */
  defaultModel: (tool: UsageSource) => string | null
  /** "自动", "可写工作区" */
  permission: (tool: UsageSource) => string
  /** the account refused this model for tasks before, and it won't be swapped */
  refused?: (tool: UsageSource, model: string | null) => boolean
  glance: ToolGlance
}

const TOOL_NAME: Record<UsageSource, string> = { claude: 'Claude', codex: 'Codex', workbuddy: 'WorkBuddy' }
const MODEL_NAME: Record<string, string> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' }
const hhmm = (t: number) => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
const folderName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const num = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: v >= 100 ? 0 : 2 })
/** rough width of a line: CJK a full em, the rest a bit over half */
const widthOf = (s: string, size: number) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) >= 0x2e80 ? 1 : 0.56), 0) * size

/** "2 小时 13 分", "45 分钟" */
export function span(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000))
  return m >= 60 ? `${Math.floor(m / 60)} 小时 ${m % 60} 分` : `${m} 分钟`
}

/** what the start choice means right now */
export function planText(d: Pick<TaskDraft, 'tool' | 'trigger'>, env: Pick<DraftEnv, 'now' | 'startAt'>): string {
  const paid = d.tool === 'workbuddy' ? ' · 按积分计费' : ''
  if (d.trigger === 'manual') return `先放着，点「现在开始」才执行${paid}`
  const at = env.startAt(d.tool, d.trigger)
  if (d.trigger === 'now' || at <= env.now + 5000) return `${d.trigger === 'now' ? '' : '额度空闲，'}加入后马上开始${paid}`
  return `${hhmm(at)} 刷新后开始 · 还有 ${span(at - env.now)}`
}

const modelOf = (d: TaskDraft, env: DraftEnv) => d.model ?? env.defaultModel(d.tool)
const modelLabel = (m: string | null) => (m ? (MODEL_NAME[m] ?? m) : '默认模型')

/** the quota in a line or two, for a panel sent without its picture */
function glanceLines(g: ToolGlance, now: number): string[] {
  if (g.credits) {
    const c = g.credits
    return [`💳 剩余 ${c.remaining !== null ? num(c.remaining) : '—'} 积分${c.today !== null ? ` · 今日 ${num(c.today)}` : ''}${c.daysLeft !== null ? ` · 约 ${Math.round(c.daysLeft)} 天` : ''}`]
  }
  const ws = g.windows.map((w) => `${w.label} <b>${Math.round(w.pct)}%</b>`).join(' · ')
  return [`📊 ${ws || '额度暂无数据'}${g.nextReset ? ` · ${span(g.nextReset - now)}后刷新` : ''}`]
}

export function draftCaption(d: TaskDraft, env: DraftEnv): string {
  const g = env.glance
  const opts = [
    d.tool === 'workbuddy' ? null : modelLabel(modelOf(d, env)),
    env.permission(d.tool),
    d.retries ? `失败重试 ${d.retries} 次` : '失败不重试',
    d.cont ? '接着上次对话' : '新对话'
  ].filter(Boolean)
  return [
    `📝 <b>发布任务</b> · ${escapeHtml(g.name)}`,
    `<blockquote>${escapeHtml(cut(d.prompt, 480))}</blockquote>`,
    `📁 <code>${escapeHtml(cut(d.cwd, 80))}</code>`,
    `▶️ ${escapeHtml(planText(d, env))}`,
    `⚙️ ${escapeHtml(opts.join(' · '))}`,
    ...(d.photo ? [] : glanceLines(g, env.now)),
    ...(g.cli ? [] : [`⚠️ 没有找到 ${escapeHtml(g.name)} 命令，排上也不会执行`]),
    ...(env.refused?.(d.tool, modelOf(d, env)) ? [`⚠️ ${escapeHtml(modelOf(d, env) ?? '默认模型')} 被 ChatGPT 账号拒绝过，点 🧠 换一个`] : [])
  ].join('\n')
}

export function draftButtons(d: TaskDraft, env: DraftEnv): Button[][] {
  const on = (yes: boolean, text: string) => (yes ? `✓ ${text}` : text)
  const go = (action: string) => `e:draft ${d.id} ${action}`
  const rows: Button[][] = []
  if (env.tools.length > 1) rows.push(env.tools.map((t) => ({ text: on(t === d.tool, TOOL_NAME[t]), data: go(`tool ${t}`) })))
  const starts: { v: DraftTrigger; text: string }[] = [
    ...(d.tool === 'workbuddy' ? [] : [{ v: 'reset' as const, text: '⏭ 下次刷新' }]),
    { v: 'now', text: '⚡ 立即' },
    { v: 'manual', text: '📌 先放着' }
  ]
  rows.push(starts.map((s) => ({ text: on(s.v === d.trigger, s.text), data: go(`when ${s.v}`) })))
  if (d.folders.length > 1) rows.push(d.folders.map((f, i) => ({ text: on(f === d.cwd, `📁 ${cut(folderName(f), 12)}`), data: go(`cwd ${i}`) })))
  rows.push([
    ...(d.tool === 'workbuddy' ? [] : [{ text: `🧠 ${cut(modelLabel(modelOf(d, env)), 14)}`, data: go('model') }]),
    { text: `🔁 重试 ${d.retries}`, data: go('retry') },
    { text: `💬 ${d.cont ? '续上次 ✓' : '新对话'}`, data: go('cont') }
  ])
  rows.push([
    { text: '✅ 加入队列', data: go('go') },
    { text: '✕ 不用了', data: go('no') },
    { text: '🔄', data: go('redraw') }
  ])
  return rows
}

/**
 * A tapped option, applied to the draft. `picture`: the quota picture shows
 * something else now (another tool, or a fresh look), so it is drawn again.
 */
export function draftStep(d: TaskDraft, action: string, arg: string | undefined, env: Pick<DraftEnv, 'tools' | 'models' | 'defaultModel'>): { picture: boolean } {
  switch (action) {
    case 'tool': {
      const tool = env.tools.find((t) => t === arg)
      if (!tool || tool === d.tool) return { picture: false }
      d.tool = tool
      d.model = null
      if (tool === 'workbuddy' && d.trigger === 'reset') d.trigger = 'manual'
      return { picture: true }
    }
    case 'when':
      if ((arg === 'reset' && d.tool !== 'workbuddy') || arg === 'now' || arg === 'manual') d.trigger = arg
      return { picture: false }
    case 'cwd': {
      const f = d.folders[Number(arg)]
      if (f) d.cwd = f
      return { picture: false }
    }
    case 'model': {
      // the default, then each model; the default is skipped where it names one of them
      const def = env.defaultModel(d.tool)
      const list: (string | null)[] = [null, ...env.models(d.tool).filter((m) => m !== def)]
      const at = list.indexOf(d.model)
      d.model = list[(at + 1) % list.length]
      return { picture: false }
    }
    case 'retry':
      d.retries = (d.retries + 1) % 4
      return { picture: false }
    case 'cont':
      d.cont = !d.cont
      return { picture: false }
    default:
      return { picture: action === 'redraw' }
  }
}

// ---------------------------------------------------------------- the picture

export const PANEL_W = 1080
export const PANEL_H = 680

/** the quota and the next refresh of one tool, the way the task page shows it */
export function taskPanelSvg(g: ToolGlance, plan: string, now: number): string {
  const W = PANEL_W
  const H = PANEL_H
  const accent = g.accent
  const hi = lighten(accent, 0.45)
  const rand = rng(`${g.tool}${new Date(now).toDateString()}`)
  let stars = ''
  for (let i = 0; i < 80; i++) {
    const k = rand()
    stars += `<circle cx="${(rand() * W).toFixed(1)}" cy="${(rand() * H).toFixed(1)}" r="${(0.6 + k * 1.5).toFixed(2)}" fill="#fff" opacity="${(0.15 + k * 0.5).toFixed(2)}"/>`
  }
  const d = new Date(now)

  // the ring: how far the 5-hour window has run (WorkBuddy: the credits left)
  const cx = 250
  const cy = 372
  const r = 136
  const c = 2 * Math.PI * r
  let frac: number
  let big: string
  let small: string
  let under: string
  let ringColor = accent
  if (g.credits) {
    const k = g.credits
    frac = k.remaining !== null && k.total ? Math.max(0, Math.min(1, k.remaining / k.total)) : 0
    big = k.remaining !== null ? num(k.remaining) : '—'
    small = '剩余积分'
    under = k.daysLeft !== null ? `按日均够用约 ${Math.round(k.daysLeft)} 天` : cut(k.plan || '积分套餐', 16)
    ringColor = frac < 0.15 ? '#ff5d6c' : frac < 0.35 ? '#ffb547' : accent
  } else if (g.nextReset && g.nextReset > now) {
    const left = g.nextReset - now
    frac = Math.max(0.01, Math.min(1, 1 - left / (5 * 3_600_000)))
    const m = Math.ceil(left / 60_000)
    big = m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : `${m} 分`
    small = '后刷新'
    under = `${hhmm(g.nextReset)} 刷新`
  } else {
    frac = 1
    big = '就绪'
    small = '额度空闲'
    under = '没有进行中的 5 小时窗口'
    ringColor = '#3ddc97'
  }
  const bigSize = big.length > 6 ? 54 : big.length > 4 ? 66 : 84

  // the windows on the right: a bar each
  let right = ''
  if (g.credits) {
    const k = g.credits
    const tiles = [
      { v: k.today !== null ? num(k.today) : '—', l: '今日消耗' },
      { v: k.dailyAvg !== null ? num(k.dailyAvg) : '—', l: '近 30 天日均' },
      { v: k.total !== null ? num(k.total) : '—', l: cut(k.plan || '套餐总额', 10) }
    ]
    right = tiles
      .map(
        (t, i) => `<rect x="480" y="${206 + i * 104}" width="540" height="88" rx="22" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.08)"/>
  <text x="508" y="${258 + i * 104}" font-size="26" fill="rgba(255,255,255,0.6)">${esc(t.l)}</text>
  <text x="992" y="${262 + i * 104}" text-anchor="end" font-size="44" font-weight="700" fill="#fff">${esc(t.v)}</text>`
      )
      .join('')
  } else if (g.windows.length) {
    right = g.windows
      .slice(0, 2)
      .map((w, i) => {
        const y = 222 + i * 158
        const [deep, light] = level(w.pct)
        const p = Math.max(0, Math.min(1, w.pct / 100))
        return `<text x="480" y="${y}" font-size="28" fill="rgba(255,255,255,0.7)">${esc(w.label)}</text>
  <text x="1010" y="${y + 6}" text-anchor="end" font-size="58" font-weight="800" fill="${light}">${Math.round(w.pct)}<tspan font-size="28" fill="rgba(255,255,255,0.6)" dx="4">%</tspan></text>
  <rect x="480" y="${y + 30}" width="530" height="20" rx="10" fill="rgba(255,255,255,0.08)"/>
  ${p > 0 ? `<rect x="480" y="${y + 30}" width="${Math.max(20, 530 * p).toFixed(1)}" height="20" rx="10" fill="${deep}" opacity="0.55" filter="url(#glow)"/><rect x="480" y="${y + 30}" width="${Math.max(20, 530 * p).toFixed(1)}" height="20" rx="10" fill="url(#bar${i})"/>` : ''}
  <linearGradient id="bar${i}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${deep}"/><stop offset="1" stop-color="${light}"/></linearGradient>
  ${w.reset ? `<text x="480" y="${y + 88}" font-size="23" fill="rgba(255,255,255,0.5)">${esc(w.reset)}</text>` : ''}`
      })
      .join('')
  } else right = `<text x="480" y="330" font-size="28" fill="rgba(255,255,255,0.55)">额度：暂无数据</text>`

  // the queue, the guard, and when this task would start
  const queue = [g.running ? `执行中 ${g.running}` : '', g.queued ? `排队 ${g.queued}` : '还没有排队的任务', g.atReset && g.nextReset ? `其中 ${g.atReset} 个在这次刷新时开始` : '']
    .filter(Boolean)
    .join(' · ')
  const note = !g.cli ? `没有找到 ${g.name} 命令` : g.waiting ? `现在开始会等：${g.waiting}` : g.guard
  // the start on the left of the strip, the queue in what room is left on the right
  const planLine = cut(plan, 26)
  let queueLine = queue
  while (queueLine.length > 4 && widthOf(planLine, 25) + widthOf(queueLine, 22) > W - 200) queueLine = `${queueLine.slice(0, -2)}…`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${SANS}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="#060a18"/><stop offset="0.55" stop-color="#0c1230"/><stop offset="1" stop-color="#170d2e"/></linearGradient>
  <radialGradient id="neb1"><stop offset="0" stop-color="${accent}" stop-opacity="0.5"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
  <radialGradient id="neb2"><stop offset="0" stop-color="#5b6cff" stop-opacity="0.35"/><stop offset="1" stop-color="#5b6cff" stop-opacity="0"/></radialGradient>
  <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${lighten(ringColor, 0.5)}"/><stop offset="1" stop-color="${ringColor}"/></linearGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<ellipse cx="240" cy="380" rx="380" ry="320" fill="url(#neb1)"/>
<ellipse cx="900" cy="120" rx="460" ry="300" fill="url(#neb2)"/>
${stars}
<rect x="20" y="20" width="${W - 40}" height="${H - 40}" rx="40" fill="none" stroke="rgba(255,255,255,0.09)" stroke-width="2"/>

${toolMark(g.tool, 96, 96, 30, accent, hi)}
<text x="146" y="92" font-size="38" font-weight="700" fill="#fff">发布任务</text>
<text x="146" y="130" font-size="24" fill="${hi}">${esc(g.name)}${g.credits ? ' · 积分' : ' · 下一次 5h 刷新'}</text>
<text x="1010" y="92" text-anchor="end" font-size="28" font-weight="600" fill="rgba(255,255,255,0.85)">${d.getMonth() + 1}/${d.getDate()} ${hhmm(now)}</text>
<text x="1010" y="128" text-anchor="end" font-size="22" fill="rgba(255,255,255,0.45)">TokenPulse</text>

<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="24"/>
<circle cx="${cx}" cy="${cy}" r="${r - 30}" fill="rgba(255,255,255,0.025)"/>
<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${ringColor}" stroke-opacity="0.5" stroke-width="24" stroke-linecap="round" stroke-dasharray="${(c * frac).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})" filter="url(#glow)"/>
<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#ring)" stroke-width="24" stroke-linecap="round" stroke-dasharray="${(c * frac).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>
<text x="${cx}" y="${cy + bigSize * 0.3}" text-anchor="middle" font-size="${bigSize}" font-weight="800" fill="#fff">${esc(big)}</text>
<text x="${cx}" y="${cy + bigSize * 0.3 + 40}" text-anchor="middle" font-size="25" fill="rgba(255,255,255,0.55)">${esc(small)}</text>
<text x="${cx}" y="${cy + r + 52}" text-anchor="middle" font-size="26" font-weight="600" fill="rgba(255,255,255,0.85)">${esc(under)}</text>

${right}

<rect x="60" y="${H - 104}" width="${W - 120}" height="62" rx="20" fill="rgba(255,255,255,0.055)" stroke="rgba(255,255,255,0.08)"/>
<path d="M90 ${H - 84}l16 11l-16 11z" fill="${hi}"/>
<text x="120" y="${H - 63}" font-size="25" font-weight="600" fill="${hi}">${esc(planLine)}</text>
<text x="${W - 84}" y="${H - 63}" text-anchor="end" font-size="22" fill="rgba(255,255,255,0.55)">${esc(queueLine)}</text>
${note ? `<text x="480" y="${H - 134}" font-size="22" fill="${g.waiting || !g.cli ? '#ffd88f' : 'rgba(255,255,255,0.45)'}">${esc(cut(note, 22))}</text>` : ''}
</svg>`
}
