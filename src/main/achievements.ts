import type { Achievement, AchievementGroup, Remnant, RemnantKind, SpectralClass } from '@shared/types'
import { dayKey, tokensOf, type CostedEntry } from './aggregate'
import { REMNANTS, sessionStars } from './cosmos'

interface Def {
  id: string
  title: string
  desc: string
  icon: string
  group: AchievementGroup
  /** 1 bronze, 2 silver, 3 gold, 4 legendary */
  tier: 1 | 2 | 3 | 4
  /** a secret until earned: the page shows only a question mark */
  hidden?: boolean
}

const DEFS: Def[] = [
  // volume
  { id: 'day-1m', title: '百万起步', desc: '单日用量突破 100 万 Token', icon: '✦', group: 'volume', tier: 1 },
  { id: 'day-10m', title: '千万俱乐部', desc: '单日用量突破 1000 万 Token', icon: '✷', group: 'volume', tier: 2 },
  { id: 'day-100m', title: '单日破亿', desc: '单日用量突破 1 亿 Token', icon: '✺', group: 'volume', tier: 3 },
  { id: 'day-500m', title: '吞星者', desc: '单日用量突破 5 亿 Token', icon: '☄', group: 'volume', tier: 4 },
  { id: 'hour-10m', title: '疾风骤雨', desc: '一个小时内用掉 1000 万 Token', icon: 'ϟ', group: 'volume', tier: 2 },
  { id: 'total-100m', title: '亿级旅程', desc: '累计用量突破 1 亿 Token', icon: '◌', group: 'volume', tier: 1 },
  { id: 'total-1b', title: '十亿里程', desc: '累计用量突破 10 亿 Token', icon: '∞', group: 'volume', tier: 2 },
  { id: 'total-10b', title: '百亿星河', desc: '累计用量突破 100 亿 Token', icon: '✧', group: 'volume', tier: 3 },
  { id: 'total-100b', title: '千亿宇宙', desc: '累计用量突破 1000 亿 Token', icon: '❂', group: 'volume', tier: 4 },
  { id: 'output-1m', title: '妙笔生花', desc: '累计输出 100 万 Token', icon: '✎', group: 'volume', tier: 1 },
  { id: 'output-10m', title: '著作等身', desc: '累计输出 1000 万 Token', icon: '✒', group: 'volume', tier: 3 },
  // persistence
  { id: 'streak-3', title: '三日不辍', desc: '连续 3 天都在用 Claude Code', icon: '3', group: 'streak', tier: 1 },
  { id: 'streak-7', title: '连续 7 天', desc: '连续 7 天都在用 Claude Code', icon: '7', group: 'streak', tier: 2 },
  { id: 'streak-30', title: '月度常驻', desc: '连续 30 天都在用 Claude Code', icon: '30', group: 'streak', tier: 3 },
  { id: 'streak-100', title: '百日筑基', desc: '连续 100 天都在用 Claude Code', icon: '百', group: 'streak', tier: 4 },
  { id: 'active-50', title: '半百之约', desc: '累计 50 天用过 Claude Code', icon: '50', group: 'streak', tier: 2 },
  { id: 'weekend', title: '周末不打烊', desc: '累计 10 个周末日用过 Claude Code', icon: '☼', group: 'streak', tier: 1 },
  // time of day
  { id: 'night-owl', title: '深夜战士', desc: '凌晨 0–5 点之间完成 50 次响应', icon: '☾', group: 'time', tier: 1 },
  { id: 'early-bird', title: '早起鸟', desc: '清晨 5–7 点之间完成 20 次响应', icon: '☀', group: 'time', tier: 1 },
  { id: 'round-clock', title: '日以继夜', desc: '同一天里 16 个不同的小时都有用量', icon: '◷', group: 'time', tier: 2 },
  { id: 'all-hours', title: '全天候', desc: '一天 24 个小时，每个小时都留下过用量', icon: '⊛', group: 'time', tier: 3 },
  // efficiency and spend
  { id: 'cache-master', title: '缓存大师', desc: '某天缓存命中率达到 95%（当天至少 100 万 Token）', icon: '◎', group: 'efficiency', tier: 2 },
  { id: 'saver', title: '省钱高手', desc: '缓存累计为你省下 $100', icon: '$', group: 'efficiency', tier: 1 },
  { id: 'saver-1k', title: '精打细算', desc: '缓存累计为你省下 $1,000', icon: '¢', group: 'efficiency', tier: 2 },
  { id: 'saver-10k', title: '缓存富翁', desc: '缓存累计为你省下 $10,000', icon: '♛', group: 'efficiency', tier: 4 },
  { id: 'big-day', title: '一掷千金', desc: '单日 API 等价费用超过 $100', icon: '◆', group: 'efficiency', tier: 2 },
  { id: 'day-500', title: '挥金如土', desc: '单日 API 等价费用超过 $500', icon: '◈', group: 'efficiency', tier: 3 },
  { id: 'month-1k', title: '月度千刀', desc: '单月 API 等价费用超过 $1,000', icon: '▲', group: 'efficiency', tier: 2 },
  { id: 'month-5k', title: '算力巨鲸', desc: '单月 API 等价费用超过 $5,000', icon: '◭', group: 'efficiency', tier: 4 },
  // sessions
  { id: 'marathon', title: '马拉松', desc: '单个会话超过 500 次响应', icon: '⚑', group: 'sessions', tier: 2 },
  { id: 'ultra', title: '超级马拉松', desc: '单个会话超过 2000 次响应', icon: '⚐', group: 'sessions', tier: 3 },
  { id: 'multi-3', title: '多线并进', desc: '10 分钟内 3 个会话同时在工作', icon: '⫴', group: 'sessions', tier: 1 },
  { id: 'multi-5', title: '分身有术', desc: '10 分钟内 5 个会话同时在工作', icon: '⧉', group: 'sessions', tier: 3 },
  { id: 'responses-10k', title: '万次回响', desc: '累计 1 万次响应', icon: '◉', group: 'sessions', tier: 2 },
  // exploring
  { id: 'polyglot', title: '多面手', desc: '用过 3 种以上的模型', icon: '❖', group: 'explore', tier: 1 },
  { id: 'collector', title: '模型收藏家', desc: '用过 6 种以上的模型', icon: '✥', group: 'explore', tier: 2 },
  { id: 'projects-5', title: '多项目并行', desc: '在 5 个项目里用过 Claude Code', icon: '▦', group: 'explore', tier: 1 },
  { id: 'projects-20', title: '项目达人', desc: '在 20 个项目里用过 Claude Code', icon: '▩', group: 'explore', tier: 2 },
  { id: 'web', title: '联网侦探', desc: '第一次让 Claude 上网搜索', icon: '⌕', group: 'explore', tier: 1 },
  { id: 'fast', title: '极速模式', desc: '用过 fast 极速模式', icon: '➹', group: 'explore', tier: 1 },
  // TokenPulse itself
  { id: 'guardian', title: '守卫出动', desc: '额度守卫第一次替你暂停任务', icon: '⏸', group: 'guardian', tier: 1 },
  { id: 'guard-10', title: '固若金汤', desc: '额度守卫累计暂停 10 次', icon: '⛨', group: 'guardian', tier: 2 },
  { id: 'limit', title: '冲线', desc: '5 小时额度第一次用到 90%', icon: '⚠', group: 'guardian', tier: 1 },
  { id: 'task-1', title: '物尽其用', desc: '第一个刷新任务顺利完成', icon: '⏱', group: 'guardian', tier: 1 },
  { id: 'task-10', title: '刷新不浪费', desc: '累计完成 10 个刷新任务', icon: '↻', group: 'guardian', tier: 3 },
  { id: 'rescue-1', title: '屡败屡战', desc: '一个刷新任务失败后，靠自动重试或修正检查最终完成', icon: '↺', group: 'guardian', tier: 1 },
  { id: 'rescue-10', title: '百折不挠', desc: '累计 10 个刷新任务靠试错救了回来', icon: '⟳', group: 'guardian', tier: 3 },
  { id: 'check-10', title: '一丝不苟', desc: '10 个刷新任务完成时都通过了你设的检查命令', icon: '⚗', group: 'guardian', tier: 2 },
  { id: 'remote', title: '千里之外', desc: '第一次用 Telegram 遥控 TokenPulse', icon: '✈', group: 'guardian', tier: 1 },
  { id: 'sentinel', title: '火眼金睛', desc: '失控检测第一次发现异常会话', icon: '◬', group: 'guardian', tier: 1 },
  { id: 'palette', title: '指挥官', desc: '用 Ctrl+K 快捷面板执行了 10 次操作', icon: '⌘', group: 'guardian', tier: 1 },
  // the quota as stars: every 5-hour window is a star's life, and leaves a remnant
  { id: 'supernova', title: '第一颗超新星', desc: '一个 5 小时窗口的额度用到 100%：恒星爆发了', icon: '✹', group: 'cosmos', tier: 1 },
  { id: 'blackhole-5', title: '黑洞收集者', desc: '累计 5 个 5 小时窗口坍缩成黑洞（用到 100%）', icon: '◉', group: 'cosmos', tier: 2 },
  { id: 'neutron-10', title: '中子星工厂', desc: '累计 10 个窗口留下中子星（峰值 50–90%）', icon: '✦', group: 'cosmos', tier: 2 },
  { id: 'dwarf-30', title: '白矮星星团', desc: '累计 30 个窗口安静燃尽成白矮星（峰值不到 50%）', icon: '∴', group: 'cosmos', tier: 1 },
  { id: 'quasar', title: '类星体', desc: '一天之内 3 个窗口都用到 100%', icon: '✺', group: 'cosmos', tier: 3, hidden: true },
  { id: 'speedrun', title: '极速坍缩', desc: '一个 5 小时窗口在 1 小时之内用完', icon: 'ϟ', group: 'cosmos', tier: 3, hidden: true },
  { id: 'giant-session', title: '红超巨星', desc: '一个会话活跃 6 小时以上、用掉 1 亿 Token', icon: '◍', group: 'cosmos', tier: 3 },
  { id: 'binary', title: '双星系统', desc: '在 10 个不同的日子里，同一个小时内 Claude Code 和 Codex 都在工作', icon: '⚭', group: 'cosmos', tier: 2 },
  { id: 'light-minute', title: '一光分', desc: '累计 1800 万 Token：每个算 1 公里，光要飞 1 分钟', icon: '☄', group: 'cosmos', tier: 1 },
  { id: 'light-hour', title: '一光时', desc: '累计 10.8 亿 Token：光要飞整整 1 小时', icon: '☄', group: 'cosmos', tier: 2 },
  { id: 'voyager', title: '追上旅行者 1 号', desc: '累计 250 亿 Token，和人类飞得最远的探测器一样远', icon: '⍟', group: 'cosmos', tier: 4 },
  { id: 'habitable-5', title: '宜居行星', desc: '5 个 5 小时窗口刚好用到 80–99%：不浪费，也没用光', icon: '⊕', group: 'cosmos', tier: 2 },
  { id: 'meteor-storm', title: '流星暴', desc: '一个小时之内提问 30 次（星空页的今日流星雨）', icon: '☄', group: 'cosmos', tier: 2 },
  { id: 'dark-energy', title: '暗能量主导', desc: '某天缓存读取占了全部 Token 的 90% 以上（当天至少 1000 万）', icon: '◐', group: 'cosmos', tier: 2 },
  { id: 'eight-planets', title: '八大行星', desc: '一周之内在 8 个不同的项目里干活', icon: '♃', group: 'cosmos', tier: 2 },
  // collections: gather every piece of a set
  { id: 'spectrum', title: '光谱收藏家', desc: '集齐 O B A F G K M 七种光谱型的会话（星空页的赫罗图）', icon: '◈', group: 'collect', tier: 3 },
  { id: 'remnant-set', title: '星骸图鉴', desc: '集齐四种星骸：白矮星、中子星、行星状星云、黑洞', icon: '❂', group: 'collect', tier: 2 },
  { id: 'weekdays', title: '七曜', desc: '周一到周日，每一天都用过', icon: '☷', group: 'collect', tier: 1 },
  { id: 'shichen', title: '十二时辰', desc: '子丑寅卯辰巳午未申酉戌亥，每个时辰都留下过用量', icon: '☯', group: 'collect', tier: 2 },
  { id: 'two-tools', title: '双剑合璧', desc: 'Claude Code 和 Codex 都用过', icon: '⚔', group: 'collect', tier: 1 },
  { id: 'packs-8', title: '换装达人', desc: '试过 8 个主题包', icon: '❋', group: 'collect', tier: 2 },
  { id: 'packs-16', title: '衣橱满载', desc: '试过 16 个主题包', icon: '❖', group: 'collect', tier: 3 },
  { id: 'worlds', title: '穿越者', desc: '去过诡秘世界、赛博朋克和云海仙山三个幻境', icon: '⟁', group: 'collect', tier: 2 },
  { id: 'seasons', title: '四季轮回', desc: '春夏秋冬，四个季节都用过', icon: '❀', group: 'collect', tier: 3 },
  // moments: secrets until they happen
  { id: 'midnight', title: '午夜钟声', desc: '在 0:00 整的那一分钟收到一次响应', icon: '♫', group: 'time', tier: 2, hidden: true },
  { id: 'palindrome', title: '回文时刻', desc: '在 12:21、13:31 这样的回文时刻收到响应', icon: '⟲', group: 'time', tier: 1, hidden: true },
  { id: 'day-1024', title: '程序员节', desc: '10 月 24 日也在写代码', icon: '⌨', group: 'time', tier: 2, hidden: true },
  { id: 'comeback', title: '王者归来', desc: '离开 7 天以上之后又回来了', icon: '↺', group: 'streak', tier: 1, hidden: true },
  { id: 'one-shot', title: '百万一击', desc: '单次响应用掉 90 万 Token 以上，几乎塞满 1M 上下文', icon: '◎', group: 'volume', tier: 2 }
]

const SHICHEN = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const SEASONS = ['春', '夏', '秋', '冬']
const CLASSES: SpectralClass[] = ['O', 'B', 'A', 'F', 'G', 'K', 'M']
const KINDS: RemnantKind[] = ['dwarf', 'neutron', 'nebula', 'blackhole']
/** a palindromic clock time such as 12:21 or 23:32 */
const palindrome = (h: number, m: number) => {
  const s = `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`
  return s === [...s].reverse().join('')
}

/** What computeAchievements reads besides the logs */
export interface AchievementExtra {
  /** 5-hour windows, closed and running */
  remnants?: Remnant[]
  /** theme packs tried, with when */
  packs?: { key: string; at: number }[]
  /** when each prompt was typed */
  prompts?: number[]
  now?: number
}

/** Things TokenPulse itself counts (kept in state.json, so their badges never re-lock) */
export interface Counter {
  n: number
  first: number
  /** when the 10th happened */
  at10?: number
}
export type Counters = Partial<Record<'guard' | 'limit' | 'tasks' | 'remote' | 'runaway' | 'palette' | 'rescued' | 'checked', Counter>>

const fmtM = (n: number) => (n >= 1e8 ? `${(n / 1e8).toFixed(n >= 1e9 ? 0 : 1)} 亿` : `${Math.round(n / 1e4)} 万`)
const usd = (n: number) => `$${n >= 1000 ? Math.round(n).toLocaleString('en-US') : n.toFixed(0)}`
const bits = (n: number) => {
  let c = 0
  for (; n; n &= n - 1) c++
  return c
}

/**
 * Badges earned from usage history and TokenPulse's own counters. `at` is when
 * the condition was first met (entries must be sorted by time); locked badges
 * carry progress toward it.
 */
/** the three fantasy-world packs */
const WORLDS = ['mystic', 'cyber', 'xianxia']

export function computeAchievements(entries: CostedEntry[], counters: Counters = {}, extra: AchievementExtra = {}): Achievement[] {
  const dayTokens = new Map<string, number>()
  const dayCost = new Map<string, number>()
  const monthCost = new Map<string, number>()
  const hourTokens = new Map<number, number>()
  const dayCache = new Map<string, { read: number; prompt: number }>()
  const dayHours = new Map<string, number>()
  const night = new Map<string, number>()
  const morning = new Map<string, number>()
  const sessions = new Map<string, number>()
  const slots = new Map<number, Set<string>>()
  const models = new Set<string>()
  const projects = new Set<string>()
  const weekendDays = new Set<string>()
  const at: Record<string, number> = {}
  const hit = (id: string, t: number) => (at[id] ??= t)
  let total = 0
  let output = 0
  let responses = 0
  let savings = 0
  let hoursSeen = 0
  let webs = 0
  const best = { day: 0, hour: 0, cost: 0, month: 0, session: 0, night: 0, morning: 0, cacheRate: 0, dayHours: 0, parallel: 0, single: 0 }
  const activeDays: string[] = []
  // collections: what was seen
  const seen = { weekdays: new Set<number>(), shichen: new Set<number>(), seasons: new Set<number>(), tools: new Set<string>() }
  const hourTools = new Map<number, number>()
  const binaryDays = new Set<string>()
  const dayProjects = new Map<string, Set<string>>()
  let darkBest = 0
  let planetsBest = 0

  for (const e of entries) {
    const tk = tokensOf(e)
    if (tk <= 0) continue
    const d = new Date(e.ts)
    const k = dayKey(e.ts)
    if (activeDays[activeDays.length - 1] !== k) activeDays.push(k)
    responses++
    if (responses >= 10_000) hit('responses-10k', e.ts)

    const dt = (dayTokens.get(k) ?? 0) + tk
    dayTokens.set(k, dt)
    best.day = Math.max(best.day, dt)
    if (dt >= 1e6) hit('day-1m', e.ts)
    if (dt >= 1e7) hit('day-10m', e.ts)
    if (dt >= 1e8) hit('day-100m', e.ts)
    if (dt >= 5e8) hit('day-500m', e.ts)
    const hk = Math.floor(e.ts / 3600_000)
    const ht = (hourTokens.get(hk) ?? 0) + tk
    hourTokens.set(hk, ht)
    best.hour = Math.max(best.hour, ht)
    if (ht >= 1e7) hit('hour-10m', e.ts)
    total += tk
    if (total >= 1e8) hit('total-100m', e.ts)
    if (total >= 1e9) hit('total-1b', e.ts)
    if (total >= 1e10) hit('total-10b', e.ts)
    if (total >= 1e11) hit('total-100b', e.ts)
    output += e.output
    if (output >= 1e6) hit('output-1m', e.ts)
    if (output >= 1e7) hit('output-10m', e.ts)

    const dc = (dayCost.get(k) ?? 0) + e.cost.total
    dayCost.set(k, dc)
    best.cost = Math.max(best.cost, dc)
    if (dc >= 100) hit('big-day', e.ts)
    if (dc >= 500) hit('day-500', e.ts)
    const mk = k.slice(0, 7)
    const mc = (monthCost.get(mk) ?? 0) + e.cost.total
    monthCost.set(mk, mc)
    best.month = Math.max(best.month, mc)
    if (mc >= 1000) hit('month-1k', e.ts)
    if (mc >= 5000) hit('month-5k', e.ts)

    savings += e.cost.cacheSavings
    if (savings >= 100) hit('saver', e.ts)
    if (savings >= 1000) hit('saver-1k', e.ts)
    if (savings >= 10_000) hit('saver-10k', e.ts)

    const c = dayCache.get(k) ?? { read: 0, prompt: 0 }
    c.read += e.cacheRead
    c.prompt += e.input + e.cacheWrite5m + e.cacheWrite1h + e.cacheRead
    dayCache.set(k, c)
    if (dt >= 1e6 && c.prompt > 0) {
      const rate = c.read / c.prompt
      best.cacheRate = Math.max(best.cacheRate, rate)
      if (rate >= 0.95) hit('cache-master', e.ts)
    }

    const h = d.getHours()
    const mask = (dayHours.get(k) ?? 0) | (1 << h)
    dayHours.set(k, mask)
    best.dayHours = Math.max(best.dayHours, bits(mask))
    if (bits(mask) >= 16) hit('round-clock', e.ts)
    hoursSeen |= 1 << h
    if (hoursSeen === 0xffffff) hit('all-hours', e.ts)
    if (h < 5) {
      const n = (night.get(k) ?? 0) + 1
      night.set(k, n)
      best.night = Math.max(best.night, n)
      if (n >= 50) hit('night-owl', e.ts)
    } else if (h < 7) {
      const n = (morning.get(k) ?? 0) + 1
      morning.set(k, n)
      best.morning = Math.max(best.morning, n)
      if (n >= 20) hit('early-bird', e.ts)
    }
    if (d.getDay() === 0 || d.getDay() === 6) {
      weekendDays.add(k)
      if (weekendDays.size >= 10) hit('weekend', e.ts)
    }

    if (e.sessionId) {
      const n = (sessions.get(e.sessionId) ?? 0) + 1
      sessions.set(e.sessionId, n)
      best.session = Math.max(best.session, n)
      if (n >= 500) hit('marathon', e.ts)
      if (n >= 2000) hit('ultra', e.ts)
      const slot = Math.floor(e.ts / 600_000)
      const set = slots.get(slot) ?? new Set<string>()
      set.add(e.sessionId)
      slots.set(slot, set)
      best.parallel = Math.max(best.parallel, set.size)
      if (set.size >= 3) hit('multi-3', e.ts)
      if (set.size >= 5) hit('multi-5', e.ts)
    }

    models.add(e.model)
    if (models.size >= 3) hit('polyglot', e.ts)
    if (models.size >= 6) hit('collector', e.ts)
    projects.add(e.projectPath || e.project)
    if (projects.size >= 5) hit('projects-5', e.ts)
    if (projects.size >= 20) hit('projects-20', e.ts)
    if (e.webSearch > 0) {
      webs += e.webSearch
      hit('web', e.ts)
    }
    if (e.speed === 'fast') hit('fast', e.ts)

    best.single = Math.max(best.single, tk)
    if (tk >= 900_000) hit('one-shot', e.ts)
    const m = d.getMinutes()
    if (h === 0 && m === 0) hit('midnight', e.ts)
    if (palindrome(h, m)) hit('palindrome', e.ts)
    if (d.getMonth() === 9 && d.getDate() === 24) hit('day-1024', e.ts)
    seen.weekdays.add(d.getDay())
    if (seen.weekdays.size === 7) hit('weekdays', e.ts)
    seen.shichen.add(Math.floor(((h + 1) % 24) / 2))
    if (seen.shichen.size === 12) hit('shichen', e.ts)
    seen.seasons.add(Math.floor(((d.getMonth() + 10) % 12) / 3))
    if (seen.seasons.size === 4) hit('seasons', e.ts)
    const tool = e.source ?? 'claude'
    seen.tools.add(tool)
    if (seen.tools.size === 2) hit('two-tools', e.ts)
    const both = (hourTools.get(hk) ?? 0) | (tool === 'codex' ? 2 : 1)
    hourTools.set(hk, both)
    if (both === 3) {
      binaryDays.add(k)
      if (binaryDays.size >= 10) hit('binary', e.ts)
    }
    // cache reads as dark energy: most of the day's mass, unseen
    if (dt >= 1e7) {
      const share = c.read / dt
      darkBest = Math.max(darkBest, share)
      if (share >= 0.9) hit('dark-energy', e.ts)
    }
    // eight planets: projects in any 7 days running
    const proj = e.projectPath || e.project
    const set = dayProjects.get(k) ?? new Set<string>()
    if (!set.has(proj)) {
      set.add(proj)
      dayProjects.set(k, set)
      const week = new Set<string>()
      for (let i = 0; i < 7; i++) for (const p of dayProjects.get(dayKey(e.ts - i * 86_400_000)) ?? []) week.add(p)
      planetsBest = Math.max(planetsBest, week.size)
      if (week.size >= 8) hit('eight-planets', e.ts)
    }
    if (total >= 18_000_000) hit('light-minute', e.ts)
    if (total >= 1_080_000_000) hit('light-hour', e.ts)
    if (total >= 25_000_000_000) hit('voyager', e.ts)
  }

  // streaks over calendar days
  let run = 0
  let bestRun = 0
  let prev: number | null = null
  for (const [i, k] of activeDays.entries()) {
    const t = new Date(`${k}T00:00:00`).getTime()
    run = prev !== null && Math.round((t - prev) / 86_400_000) === 1 ? run + 1 : 1
    prev = t
    bestRun = Math.max(bestRun, run)
    if (run >= 3) hit('streak-3', t)
    if (run >= 7) hit('streak-7', t)
    if (run >= 30) hit('streak-30', t)
    if (run >= 100) hit('streak-100', t)
    if (i + 1 >= 50) hit('active-50', t)
  }
  // back after a week or more away
  let longest = 0
  for (let i = 1; i < activeDays.length; i++) {
    const a = new Date(`${activeDays[i - 1]}T00:00:00`).getTime()
    const b = new Date(`${activeDays[i]}T00:00:00`).getTime()
    const gap = Math.round((b - a) / 86_400_000)
    longest = Math.max(longest, gap)
    if (gap >= 8) hit('comeback', b)
  }

  // the quota as stars
  const now = extra.now ?? Date.now()
  const kinds = new Map<RemnantKind, number>()
  const hitsByDay = new Map<string, number>()
  let blackholes = 0
  let neutrons = 0
  let dwarfs = 0
  let fastest = Infinity
  for (const w of extra.remnants ?? []) {
    if (w.kind === 'blackhole') {
      const t = w.hitAt ?? w.end
      blackholes++
      hit('supernova', t)
      if (blackholes >= 5) hit('blackhole-5', t)
      const dk = dayKey(t)
      const n = (hitsByDay.get(dk) ?? 0) + 1
      hitsByDay.set(dk, n)
      if (n >= 3) hit('quasar', t)
      if (w.hitAt) {
        fastest = Math.min(fastest, w.hitAt - w.start)
        if (w.hitAt - w.start <= 3_600_000) hit('speedrun', w.hitAt)
      }
    }
    // a running window has not left its remnant yet (a black hole is final at once)
    if (w.end > now && w.kind !== 'blackhole') continue
    if (!kinds.has(w.kind)) kinds.set(w.kind, w.end)
    if (kinds.size === 4) hit('remnant-set', w.end)
    if (w.kind === 'neutron' && ++neutrons >= 10) hit('neutron-10', w.end)
    if (w.kind === 'dwarf' && ++dwarfs >= 30) hit('dwarf-30', w.end)
  }

  // windows used just right: 80–99% and never run dry
  let habitable = 0
  for (const w of extra.remnants ?? []) {
    if (w.end > now || w.kind === 'blackhole' || w.peak < 80) continue
    if (++habitable >= 5) hit('habitable-5', w.end)
  }
  // a meteor storm: the densest hour of prompts
  let storm = 0
  const pts = [...(extra.prompts ?? [])].sort((a, b) => a - b)
  for (let i = 0, j = 0; i < pts.length; i++) {
    while (pts[i] - pts[j] > 3_600_000) j++
    storm = Math.max(storm, i - j + 1)
    if (i - j + 1 >= 30) hit('meteor-storm', pts[i])
  }

  // sessions as stars: the spectral classes collected, and the biggest giant
  const stars = sessionStars(entries, now, 3650, Infinity)
  const classes = new Set<SpectralClass>()
  let giant = 0
  for (const st of [...stars].sort((a, b) => a.end - b.end)) {
    classes.add(st.cls)
    if (classes.size === 7) hit('spectrum', st.end)
    if (st.minutes >= 360) giant = Math.max(giant, st.tokens)
    if (st.minutes >= 360 && st.tokens >= 1e8) hit('giant-session', st.end)
  }

  // packs tried
  const packs = extra.packs ?? []
  const tried = [...packs].sort((a, b) => a.at - b.at)
  if (tried.length >= 8) hit('packs-8', tried[7].at)
  if (tried.length >= 16) hit('packs-16', tried[15].at)
  const worlds = tried.filter((p) => WORLDS.includes(p.key))
  if (worlds.length >= WORLDS.length) hit('worlds', worlds[WORLDS.length - 1].at)

  // TokenPulse's own events
  const count = (k: keyof Counters) => counters[k]?.n ?? 0
  const once = (id: string, k: keyof Counters) => counters[k] && counters[k]!.n > 0 && hit(id, counters[k]!.first)
  const ten = (id: string, k: keyof Counters) => (counters[k]?.n ?? 0) >= 10 && hit(id, counters[k]!.at10 ?? counters[k]!.first)
  once('guardian', 'guard')
  ten('guard-10', 'guard')
  once('limit', 'limit')
  once('task-1', 'tasks')
  ten('task-10', 'tasks')
  once('rescue-1', 'rescued')
  ten('rescue-10', 'rescued')
  ten('check-10', 'checked')
  once('remote', 'remote')
  once('sentinel', 'runaway')
  ten('palette', 'palette')

  const days = activeDays.length
  const firstTime = (n: number, yes: string, no: string): [number, string] => [n > 0 ? 1 : 0, n > 0 ? yes : no]
  const progress: Record<string, [number, string]> = {
    'day-1m': [best.day / 1e6, `单日最高 ${fmtM(best.day)}`],
    'day-10m': [best.day / 1e7, `单日最高 ${fmtM(best.day)}`],
    'day-100m': [best.day / 1e8, `单日最高 ${fmtM(best.day)}`],
    'day-500m': [best.day / 5e8, `单日最高 ${fmtM(best.day)}`],
    'hour-10m': [best.hour / 1e7, `一小时最高 ${fmtM(best.hour)}`],
    'total-100m': [total / 1e8, `累计 ${fmtM(total)}`],
    'total-1b': [total / 1e9, `累计 ${fmtM(total)}`],
    'total-10b': [total / 1e10, `累计 ${fmtM(total)}`],
    'total-100b': [total / 1e11, `累计 ${fmtM(total)}`],
    'output-1m': [output / 1e6, `已输出 ${fmtM(output)}`],
    'output-10m': [output / 1e7, `已输出 ${fmtM(output)}`],
    'streak-3': [bestRun / 3, `最长连续 ${bestRun} 天`],
    'streak-7': [bestRun / 7, `最长连续 ${bestRun} 天`],
    'streak-30': [bestRun / 30, `最长连续 ${bestRun} 天`],
    'streak-100': [bestRun / 100, `最长连续 ${bestRun} 天`],
    'active-50': [days / 50, `已用 ${days} 天`],
    weekend: [weekendDays.size / 10, `周末用过 ${weekendDays.size} 天`],
    'night-owl': [best.night / 50, `单晚最多 ${best.night} 次`],
    'early-bird': [best.morning / 20, `单日清晨最多 ${best.morning} 次`],
    'round-clock': [best.dayHours / 16, `单日最多 ${best.dayHours} 个小时`],
    'all-hours': [bits(hoursSeen) / 24, `已覆盖 ${bits(hoursSeen)} / 24 个小时`],
    'cache-master': [best.cacheRate / 0.95, `最高命中率 ${Math.round(best.cacheRate * 100)}%`],
    saver: [savings / 100, `已省 ${usd(savings)}`],
    'saver-1k': [savings / 1000, `已省 ${usd(savings)}`],
    'saver-10k': [savings / 10_000, `已省 ${usd(savings)}`],
    'big-day': [best.cost / 100, `单日最高 ${usd(best.cost)}`],
    'day-500': [best.cost / 500, `单日最高 ${usd(best.cost)}`],
    'month-1k': [best.month / 1000, `单月最高 ${usd(best.month)}`],
    'month-5k': [best.month / 5000, `单月最高 ${usd(best.month)}`],
    marathon: [best.session / 500, `最长会话 ${best.session} 次`],
    ultra: [best.session / 2000, `最长会话 ${best.session} 次`],
    'multi-3': [best.parallel / 3, `最多 ${best.parallel} 个会话同时工作`],
    'multi-5': [best.parallel / 5, `最多 ${best.parallel} 个会话同时工作`],
    'responses-10k': [responses / 10_000, `累计 ${responses.toLocaleString('en-US')} 次`],
    polyglot: [models.size / 3, `已用 ${models.size} 种模型`],
    collector: [models.size / 6, `已用 ${models.size} 种模型`],
    'projects-5': [projects.size / 5, `已在 ${projects.size} 个项目里用过`],
    'projects-20': [projects.size / 20, `已在 ${projects.size} 个项目里用过`],
    web: firstTime(webs, `已搜索 ${webs} 次`, '还没有联网搜索过'),
    fast: firstTime(at.fast ? 1 : 0, '已体验', '还没有用过 fast 模式'),
    guardian: firstTime(count('guard'), `已暂停 ${count('guard')} 次`, '还没有暂停过'),
    'guard-10': [count('guard') / 10, `已暂停 ${count('guard')} 次`],
    limit: firstTime(count('limit'), `已冲线 ${count('limit')} 次`, '还没有用到过 90%'),
    'task-1': firstTime(count('tasks'), `已完成 ${count('tasks')} 个`, '还没有完成过刷新任务'),
    'task-10': [count('tasks') / 10, `已完成 ${count('tasks')} 个`],
    'rescue-1': firstTime(count('rescued'), `已救回 ${count('rescued')} 个`, '还没有任务靠重试完成过'),
    'rescue-10': [count('rescued') / 10, `已救回 ${count('rescued')} 个`],
    'check-10': [count('checked') / 10, `已通过 ${count('checked')} 次检查`],
    remote: firstTime(count('remote'), `已遥控 ${count('remote')} 次`, '在设置里打开 Telegram 遥控'),
    sentinel: firstTime(count('runaway'), `已发现 ${count('runaway')} 次`, '还没有发现过异常会话'),
    palette: [count('palette') / 10, `已用 ${count('palette')} 次`],
    supernova: firstTime(blackholes, `已爆发 ${blackholes} 次`, '还没有窗口用到 100%'),
    'blackhole-5': [blackholes / 5, `已有 ${blackholes} 个黑洞`],
    'neutron-10': [neutrons / 10, `已有 ${neutrons} 颗中子星`],
    'dwarf-30': [dwarfs / 30, `已有 ${dwarfs} 颗白矮星`],
    quasar: [Math.max(0, ...hitsByDay.values()) / 3, '？？？'],
    speedrun: [fastest < Infinity ? Math.min(0.99, 3_600_000 / fastest) : 0, '？？？'],
    'giant-session': [giant / 1e8, giant ? `6 小时以上的会话最多 ${fmtM(giant)}` : '还没有活跃 6 小时以上的会话'],
    binary: [binaryDays.size / 10, `已有 ${binaryDays.size} 天`],
    'light-minute': [total / 18_000_000, `已飞 ${fmtM(total)} 公里`],
    'light-hour': [total / 1_080_000_000, `已飞 ${fmtM(total)} 公里`],
    voyager: [total / 25_000_000_000, `已飞 ${fmtM(total)} 公里`],
    'habitable-5': [habitable / 5, `已有 ${habitable} 个`],
    'meteor-storm': [storm / 30, `一小时最多 ${storm} 次`],
    'dark-energy': [darkBest / 0.9, `最高 ${Math.round(darkBest * 100)}%`],
    'eight-planets': [planetsBest / 8, `一周最多 ${planetsBest} 个项目`],
    spectrum: [classes.size / 7, `已集 ${classes.size} / 7 种`],
    'remnant-set': [kinds.size / 4, `已集 ${kinds.size} / 4 种`],
    weekdays: [seen.weekdays.size / 7, `已集 ${seen.weekdays.size} / 7 天`],
    shichen: [seen.shichen.size / 12, `已集 ${seen.shichen.size} / 12 个时辰`],
    'two-tools': [seen.tools.size / 2, `已用 ${seen.tools.size} / 2 个`],
    'packs-8': [packs.length / 8, `已试 ${packs.length} / 8 个`],
    'packs-16': [packs.length / 16, `已试 ${packs.length} / 16 个`],
    worlds: [worlds.length / WORLDS.length, `已去 ${worlds.length} / ${WORLDS.length} 个`],
    seasons: [seen.seasons.size / 4, `已集 ${seen.seasons.size} / 4 季`],
    midnight: [0, '？？？'],
    palindrome: [0, '？？？'],
    'day-1024': [0, '？？？'],
    comeback: [Math.min(0.99, longest / 8), '？？？'],
    'one-shot': [best.single / 900_000, `单次最多 ${fmtM(best.single)}`]
  }
  // the pieces of each collection, for the page to show
  const items: Record<string, { label: string; got: boolean }[]> = {
    spectrum: CLASSES.map((c) => ({ label: c, got: classes.has(c) })),
    'remnant-set': KINDS.map((k) => ({ label: REMNANTS[k].name, got: kinds.has(k) })),
    weekdays: [1, 2, 3, 4, 5, 6, 0].map((d) => ({ label: WEEKDAYS[d], got: seen.weekdays.has(d) })),
    shichen: SHICHEN.map((c, i) => ({ label: c, got: seen.shichen.has(i) })),
    'two-tools': ['claude', 'codex'].map((t) => ({ label: t === 'claude' ? 'Claude' : 'Codex', got: seen.tools.has(t) })),
    seasons: SEASONS.map((c, i) => ({ label: c, got: seen.seasons.has(i) }))
  }

  return DEFS.map((d) => {
    const [p, hint] = progress[d.id]
    const kind: Achievement['kind'] = items[d.id] ? 'collect' : d.hidden ? 'secret' : 'tier'
    return { ...d, kind, items: items[d.id], unlocked: at[d.id] !== undefined, at: at[d.id] ?? null, progress: Math.max(0, Math.min(1, p)), hint }
  })
}
