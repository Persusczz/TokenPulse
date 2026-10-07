import { watch, type FSWatcher } from 'node:fs'
import { appendFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  Notification,
  safeStorage,
  screen,
  shell,
  Tray,
  type BrowserWindowConstructorOptions,
  type MenuItemConstructorOptions
} from 'electron'
import { homedir } from 'node:os'
import { accentHex } from '@shared/accents'
import { fmtMoney, fmtTokens } from '@shared/format'
import { HOTKEYS } from '@shared/hotkeys'
import type {
  Achievement,
  CodexQuota,
  CodexResets,
  Cosmos,
  ContextAlert,
  LoadState,
  Pace,
  PausedTask,
  PromptMark,
  ToolAction,
  QuotaInfo,
  QuotaCycles,
  QuotaRate,
  RangeKey,
  RunawayAlert,
  Settings,
  SourceView,
  TarotDeck,
  TelegramResult,
  TitleCorner,
  UpdateEvent,
  UsageSource,
  WasteAlert
} from '@shared/types'
import { computeAchievements } from './achievements'
import { computeLive, computeRanges, computeSessions, computeSummary, dayKey, rangeBounds, startOfDay, startOfMonth, tokensOf, type CostedEntry } from './aggregate'
import { AppState } from './appState'
import { UsageArchive } from './archive'
import { checkBudgets, pruneFired } from './budget'
import { diagnoseCache } from './cacheDoctor'
import { codexDirs, codexQuota, codexRoot, CodexStore } from './collector/codex'
import { CodexUsageService } from './codexUsage'
import { effectOf, ResetWatchService, type ResetNews } from './resetWatch'
import { Updater } from './updater'
import { claudeRoots, credentialsPath, projectsDirs } from './collector/paths'
import { UsageStore } from './collector/store'
import { computePace, wasteDue, wasteRule } from './pace'
import { activeContexts, CODEX_WINDOW, CONTEXT_SOON, contextAlerts, contextLevel, contextOf, sessionContext, windowOf, type WarnFor } from './context'
import { findNode, GuardService, type GuardExtra } from './guard'
import { chatgptPlan, computeValue, forecastWeekly, PLAN_PRICES } from './insights'
import { costByPrompt, indexPrompts, promptReport } from './prompts'
import { buildHistory, ClaudeWindowLog, estimateClaudeWindows } from './windowHistory'
import { buildCycles, CYCLE_MS, type KnownWindow } from './cycles'
import { contains, dockedPosition, hiddenPosition, MINI_MARGIN, miniSize, miniPlace, restorePosition, snapToEdge, type Dock, type Rect } from './miniGeometry'
import { PricingService } from './pricing'
import { computeCost } from './pricing/cost'
import { fiveHourWindow, QuotaService, sevenDayWindow } from './quota'
import { quotaEvents, type QuotaSnapshot } from './quotaEvents'
import { blockWindow, computeRate, spendBetween } from './rate'
import { buildReport, cn } from './report'
import { detectRunaway, runawayBaseline } from './runaway'
import { SettingsStore } from './settings'
import { codingSign } from './stars'
import { computePatterns, dayNightPhase } from './patterns'
import { achLines, bar, spark, starLines, starSummary, topLines, weekLines } from './sky'
import { cosmicCalendar, meteors, projectPlanets, quotaStar, remnants, sessionStars, STAGES, stellarType, zhr } from './cosmos'
import { placeOf } from '@shared/astro'
import { PACKS } from '@shared/packs'
import { raceSeries, starMap } from './race'
import { claudeDialogue, codexDialogue } from './dialogue'
import { findClaude, findCodex, TaskService, type WindowInfo } from './tasks'
import { escapeHtml, fold, TelegramBot, TelegramNotifier, type Button, type Command, type Effect, type KeyboardMode, type Message, type Reply } from './telegram'
import { CARD_H, CARD_W, cardFrames, cardSvg, GAUGE_H, GAUGE_W, gaugeFrames, type CardData, type CardQuota, type GaugeAlert } from './tgCard'
import { svgsToMp4, svgToJpeg } from './cardRender'
import { stageInfo } from '@shared/stages'
import { ARCANA, cardStory } from '@shared/tarot'
import { cardFace } from '@shared/tarotArt'
import { buildDeck } from './tarot'
import { calendarDays, modelRows, todaySessions } from './overviewData'
import { actionStats, personalRecords } from './activity'
import { pauseBadge, trayBitmap } from './trayIcon'
import { attachToDesktop, hwndOf, refreshDesktop } from './wallpaper'

const RANGES: RangeKey[] = ['today', '7d', '30d', 'month', 'all']
const LIGHT = { bg: '#FAF9F5', fg: '#3D3D3A' }
const DARK = { bg: '#262624', fg: '#C2C0B6' }
const TITLEBAR_H = 44
const TRANSPARENT = '#00000000'
const MINI_SCALES: [number, string][] = [
  [0.85, '小'],
  [1, '中'],
  [1.25, '大'],
  [1.5, '特大']
]

// screenshot runs get their own profile and Claude folder so they never touch the real ones
const shotDir = process.env.TP_SCREENSHOT
if (shotDir) app.setPath('userData', join(shotDir, 'userdata'))

const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()
app.setAppUserModelId(app.isPackaged ? 'com.tokenpulse.app' : process.execPath)

const userData = app.getPath('userData')
const settings = new SettingsStore(join(userData, 'settings.json'))
const pricing = new PricingService(join(userData, 'pricing.json'), (url, init) => net.fetch(url, init))
const archive = new UsageArchive(join(userData, 'archive.jsonl'))
const guard = new GuardService(shotDir ? join(shotDir, 'claude') : (claudeRoots()[0] ?? join(homedir(), '.claude')))
const quota = new QuotaService(
  credentialsPath,
  (url, init) => net.fetch(url, init as RequestInit),
  guard.statuslinePath,
  join(userData, 'quota-calibration.json'),
  {
    // the Claude quota only ever counts Claude Code's own usage
    spend: (start, end) => spendBetween(claudeCosted, start, end),
    window: (now) => blockWindow(claudeCosted, now)
  }
)
const appState = new AppState(join(userData, 'state.json'))
const windowLog = new ClaudeWindowLog(join(userData, 'window-history.json'))
const tasks = new TaskService(join(userData, 'tasks.json'), join(userData, 'tasks'), {
  window: taskWindow,
  blocker: taskBlocker,
  claude: findClaude,
  codex: findCodex,
  node: findNode,
  terminal: () => settings.value.taskTerminal,
  lastSession: lastSessionIn,
  // a compaction point given as a share: of the window Codex reports for the model (or its latest one)
  codexWindow: (model) => (model ? windowOf(model, 'codex', 0, codex.contextWindows) : ([...codex.contextWindows.values()].pop() ?? CODEX_WINDOW)),
  // Codex reports tokens: priced like its logs, with the model it ran
  price: (t, u) => {
    let model = t.model
    if (!model && t.sessionId) for (let i = codexCosted.length - 1; i >= 0 && !model; i--) if (codexCosted[i].sessionId === t.sessionId) model = codexCosted[i].model
    const row = model ? pricing.resolve(model)?.row : null
    return row ? ((u.input - u.cached) * row.input + u.cached * row.cacheRead + u.output * row.output) / 1e6 : null
  }
})
const firedAlerts = appState.firedAlerts
const telegram = new TelegramNotifier((url, init) => net.fetch(url, init as RequestInit))
/** Codex's limits from the ChatGPT account; the login is kept sealed with the system's data protection */
const codexUsage = new CodexUsageService((url, init) => net.fetch(url, init as RequestInit), join(app.getPath('userData'), 'codex-login.dat'), codexRoot(), {
  available: () => safeStorage.isEncryptionAvailable(),
  seal: (s) => safeStorage.encryptString(s),
  open: (b) => safeStorage.decryptString(b)
})
/** Tibo's Codex reset posts, through codex-resets.com */
const resetWatch = new ResetWatchService((url, init) => net.fetch(url, init as RequestInit), join(app.getPath('userData'), 'codex-resets.json'), process.env.TP_RESETS_API)

let store = new UsageStore()
let codex = new CodexStore()
/** every entry, Claude Code and Codex, priced and sorted */
let costed: CostedEntry[] = []
let claudeCosted: CostedEntry[] = []
let codexCosted: CostedEntry[] = []
let costedRev = ''
let dirs: string[] = []
let codexFolders: string[] = []
let codexQ: CodexQuota | null = null
let loading = true
let mainWin: BrowserWindow | null = null
let miniWin: BrowserWindow | null = null
let tray: Tray | null = null
let islandWin: BrowserWindow | null = null
let stageWin: BrowserWindow | null = null
let wallWin: BrowserWindow | null = null
let quitting = false
let activeHotkey: string | null = null
let achievements: Achievement[] = []
let lastQuota: QuotaSnapshot | null = null
let watchers: FSWatcher[] = []
let pollTimer: NodeJS.Timeout | null = null

// ---------- data ----------

function modelLabel(model: string): string {
  const r = pricing.resolve(model)
  return r && !r.estimated ? r.row.name.replace(/^Claude\s+/, '') : model
}

const dataRev = () => `${store.revision}:${codex.revision}`

function rebuild(): void {
  const opts = { webSearchPer1k: pricing.webSearchPer1k, usGeoMultiplier: pricing.usGeoMultiplier }
  costed = [...store.entries.values(), ...codex.entries.values()]
    .map((e) => ({ ...e, cost: computeCost(e, pricing.resolve(e.model)?.row ?? null, opts) }))
    .sort((a, b) => a.ts - b.ts)
  claudeCosted = costed.filter((e) => e.source !== 'codex')
  codexCosted = costed.filter((e) => e.source === 'codex')
  costedRev = dataRev()
  if (settings.value.archiveEnabled) void archive.save(store.entries.values()).catch(() => {})
}

/** the tool on view: Claude, Codex, or both; Codex only when its logs are read */
function source(): SourceView {
  const f = settings.value.sourceFilter
  return f === 'codex' && !settings.value.codexEnabled ? 'claude' : f
}

/** the tools on view, one by one */
const sources = (): UsageSource[] => {
  const s = source()
  return s === 'all' ? (settings.value.codexEnabled && codex.fileCount > 0 ? ['claude', 'codex'] : ['claude']) : [s]
}

/** what the overview, sessions, tray and floating window show: all tools, or one */
function view(): CostedEntry[] {
  const f = source()
  return f === 'claude' ? claudeCosted : f === 'codex' ? codexCosted : costed
}

/** prompts by session, rebuilt when new ones were read */
let promptIdx: Map<string, PromptMark[]> = new Map()
let promptKey = ''
function prompts(): Map<string, PromptMark[]> {
  const key = `${store.prompts.size}:${codex.prompts.size}:${store.revision}:${codex.revision}`
  if (key !== promptKey) {
    promptKey = key
    promptIdx = indexPrompts([...store.prompts.values(), ...codex.prompts.values()])
  }
  return promptIdx
}

/** the prompts typed in the tools on view */
function promptMarks(): PromptMark[] {
  const f = source()
  return [...store.prompts.values(), ...codex.prompts.values()].filter((p) => f === 'all' || p.source === f)
}

/** the tool calls made in the tools on view */
function actionList(): ToolAction[] {
  const f = source()
  return [...(f !== 'codex' ? store.actions.values() : []), ...(f !== 'claude' ? codex.actions.values() : [])]
}

function quotaConfig() {
  const s = settings.value
  return { enabled: s.quotaEnabled, source: s.quotaSource, limitUsd: s.local5hLimitUsd, pauseAt: s.guardPauseAt, guardOn: s.guardEnabled }
}

/** every model in the logs, with its tool and the last 30 days of use */
function models(): { model: string; source: UsageSource; tokens: number; cost: number; lastSeen: number }[] {
  const from = Date.now() - 30 * 86_400_000
  const by = new Map<string, { model: string; source: UsageSource; tokens: number; cost: number; lastSeen: number }>()
  for (const e of costed) {
    let m = by.get(e.model)
    if (!m) by.set(e.model, (m = { model: e.model, source: e.source ?? 'claude', tokens: 0, cost: 0, lastSeen: 0 }))
    if (e.ts >= from) {
      m.tokens += tokensOf(e)
      m.cost += e.cost.total
    }
    if (e.ts > m.lastSeen) m.lastSeen = e.ts
  }
  return [...by.values()]
}

function loadState(): LoadState {
  return { loading, files: store.fileCount, dirs, codexDirs: codexFolders, codexFiles: codex.fileCount }
}

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload)
}

function live() {
  return computeLive(view(), Date.now(), settings.value.dailyBudget)
}

function afterDataChange(ev: UpdateEvent): void {
  if (process.env.TP_SCREENSHOT) void appendFile(join(process.env.TP_SCREENSHOT, 'events.log'), JSON.stringify(ev) + '\n').catch(() => {})
  broadcast('data:update', ev)
  // the local estimate follows the logs
  if (settings.value.quotaSource === 'local' || quota.info.origin === 'local') quota.recompute()
  refreshTray()
  runBudgetCheck()
  if (!loading) {
    checkAchievementsSoon()
    checkRunaway()
    checkContext()
  }
}

let achTimer: NodeJS.Timeout | null = null
let achAt = 0
/** achievements take a full pass over the history: at most every 30 s while new usage streams in */
function checkAchievementsSoon(): void {
  const wait = achAt + 30_000 - Date.now()
  if (wait <= 0) {
    achAt = Date.now()
    checkAchievements()
  } else if (!achTimer) {
    achTimer = setTimeout(() => {
      achTimer = null
      achAt = Date.now()
      checkAchievements()
    }, wait)
  }
}

const money = (usd: number) => fmtMoney(usd, settings.value)

function guardExtra(s: Settings = settings.value): GuardExtra {
  return { weeklyAt: s.guardWeeklyAt, resumeFrom: s.guardResumeFrom, resumeTo: s.guardResumeTo }
}

// ---------- telegram ----------

type PushKind = 'guard' | 'quota' | 'budget' | 'achievement' | 'runaway' | 'tasks'

const telegramReady = (s: Settings = settings.value) => s.telegramEnabled && !!s.telegramToken && !!s.telegramChatId

/** inside the quiet hours pushes arrive without a sound */
const quietNow = (s: Settings = settings.value) => !!s.telegramQuietFrom && !!s.telegramQuietTo && inHours(new Date(), s.telegramQuietFrom, s.telegramQuietTo)

/** an effect, when they are switched on */
const fx = (effect: Effect): Effect | undefined => (settings.value.telegramEffects ? effect : undefined)

/** animations, when they are switched on */
const animated = () => settings.value.telegramAnimations

/** Sends a notice to Telegram when it is set up and this kind is switched on; a gauge comes as an animation */
function push(kind: PushKind, html: string, effect?: Effect, gauge?: GaugeAlert): void {
  const s = settings.value
  const on = { guard: s.pushGuard, quota: s.pushQuota, budget: s.pushBudget, achievement: s.pushAchievement, runaway: s.pushRunaway, tasks: s.pushTasks }[kind]
  if (!telegramReady() || !on) return
  const msg = { text: `<b>TokenPulse</b>\n${html}`, silent: quietNow(s), effect: effect && fx(effect) }
  if (!gauge || !animated()) {
    void telegram.send(s.telegramToken, s.telegramChatId, msg)
    return
  }
  void svgsToMp4(gaugeFrames(gauge, 20), GAUGE_W, GAUGE_H, 20)
    .then((animation) => telegram.send(s.telegramToken, s.telegramChatId, { ...msg, animation }))
    .catch(() => telegram.send(s.telegramToken, s.telegramChatId, msg))
}

/** a quota alert's gauge: the needle from the last reading to this one */
function quotaGauge(title: string, tool: UsageSource, from: number, to: number, resetsAt: number | null, reset = false): GaugeAlert {
  return {
    title,
    accent: accentHex({ accent: settings.value.accent, sourceFilter: tool }),
    from,
    to,
    note: reset ? '新的窗口刚刚开始' : resetsAt ? `${clockOf(resetsAt)} 重置` : '',
    reset
  }
}

/** the waiting frames of an animated reply: the moon turns while it reads */
const MOONS = ['🌑', '🌒', '🌓', '🌔', '🌕']
const readingFrame = (title: string, i: number) => `${title}\n${MOONS.slice(0, i + 2).join('')} 读取中…`

// ---------- telegram commands ----------

const bot = new TelegramBot(telegram, onCommand)

/** bump when the button keyboard changes, so the chat gets the new one once */
const KEYBOARD_REV = '6'

const keyboardMode = (s: Settings = settings.value): KeyboardMode => (s.telegramKeyboard === 'off' ? 'remove' : s.telegramKeyboard)

function keyboardNote(style: Settings['telegramKeyboard']): string {
  const how =
    style === 'off'
      ? '输入框下面的按钮已经收起：点左下角的「菜单」选指令，或者发送 /panel 打开控制面板'
      : style === 'fold'
        ? '输入框下面只留一行按钮，点一下就自动收起；要再用时点输入框旁边的 ⌨️ 图标展开'
        : '输入框下面只留一行按钮，点输入框旁边的 ⌨️ 图标可以随时收起、展开'
  return `🎛 <b>TokenPulse 遥控已连接</b>\n${how}\n\n🎛 面板在一条消息里翻看状态、今日、7 天、任务、星空、成就，看完点「收起」只剩一行。发送 /help 看全部指令`
}

function syncBot(): void {
  const s = settings.value
  if (telegramReady() && s.telegramCommands && !shotDir) {
    bot.start(s.telegramToken, s.telegramChatId)
    // hand the chat the keyboard (or take the old one away) once per revision and style
    const rev = `${KEYBOARD_REV}:${s.telegramKeyboard}`
    if (appState.tgKeyboard !== rev) {
      void telegram.send(s.telegramToken, s.telegramChatId, { text: keyboardNote(s.telegramKeyboard), keyboard: keyboardMode(s) }).then((r) => {
        if (!r.ok) return
        appState.tgKeyboard = rev
        appState.save()
      })
    }
  } else bot.stop()
  void syncBoard(true)
}

const HELP = fold(
  [
    '<b>TokenPulse 指令</b>',
    '🎛 /panel 控制面板：一条消息里翻页，看完点「收起」只剩一行',
    '🃏 /card 今日卡片：一张图看完用量、额度和 24 小时',
    '',
    '/status 额度与运行状态',
    '/today 今日用量',
    '/week 最近 7 天的用量，逐日柱状和走势',
    '/pause 暂停所有 Claude Code 任务（下一次工具调用时停住）',
    '/resume 恢复暂停的任务',
    '/guard 额度守卫开关',
    '/report 立即发送今日晚报',
    '/task 任务内容 排到下一次 5h 额度刷新时自动执行（/task codex 任务内容 交给 Codex）',
    '/tasks 查看刷新任务队列，可以直接开始、停止、取消',
    '/log 正在执行（或最近一个）任务的日志',
    '/star 额度星空：5 小时额度是一颗恒星（星云→主序星→红巨星→超新星），7 天额度是它的轨道，用过的窗口留下星骸',
    '/top 今天最贵的 5 次提问',
    '/ach 成就进度：最近解锁、最接近的几个、隐藏成就',
    '/sign 你最近的编码星座和今天的星座进度',
    '/luck 摇一把今日额度运势 🎰',
    '/tarot 你的牌：太阳是今天的 24 小时、月亮是 7 天额度、命运之轮是这周的 5 小时窗口……每张牌画的都是你的用量 🔮',
    '/board on 置顶实时看板：聊天顶部一直显示额度（/board off 取消）',
    '/keys 拿回输入框下面的按钮 · /hide 收起它们',
    '',
    '直接发文字也行：「状态」「卡片」「面板」这类词会当成指令，其他的话可以一键排成任务',
    '任务开始后会发一张进度卡，每半分钟自己更新一次，结束时变成结果；卡片上能停止、看日志、再次排队'
  ],
  3
)

const guardButton = (): Button => (settings.value.guardEnabled ? { text: '🛡 关闭守卫', data: 'guard off' } : { text: '🛡 开启守卫', data: 'guard on' })
const holdButton = (): Button => (guard.state.manualHold || guard.state.paused.length ? { text: '▶️ 恢复任务', data: 'resume' } : { text: '⏸ 暂停全部', data: 'pause' })

/** `p` (0–1) is how far an animated reply has counted up */
function quotaLine(p = 1): string[] {
  const five = fiveHourWindow(quota.info.windows)
  const week = sevenDayWindow(quota.info.windows)
  const out: string[] = []
  if (five) out.push(`5h 额度 <b>${Math.round(five.utilization * p)}%</b> <code>${bar((five.utilization / 100) * p, 10)}</code>${five.resetsAt ? `（${clockOf(Date.parse(five.resetsAt))} 重置）` : ''}`)
  if (week) out.push(`7 天额度 ${Math.round(week.utilization * p)}% <code>${bar((week.utilization / 100) * p, 10)}</code>${week.resetsAt ? `（${clockOf(Date.parse(week.resetsAt))} 重置）` : ''}`)
  return out.length ? out : ['额度：暂无数据']
}

function codexLine(p = 1): string[] {
  if (!codexQ?.windows.length) return []
  const parts = codexQ.windows.map((w) => `${w.label.replace('额度', '')} <b>${Math.round(w.utilization * p)}%</b>`)
  return [`Codex${codexQ.plan ? `（${escapeHtml(codexQ.plan)}）` : ''}：${parts.join(' · ')}`]
}

/** a reply that counts up over a few frames before it settles (when animations are on) */
function counting(title: string, body: (p: number) => string): { frames?: { text: string }[]; text: string } {
  if (!animated()) return { text: body(1) }
  return { frames: [{ text: readingFrame(title, 0) }, { text: body(0.35) }, { text: body(0.75) }], text: body(1) }
}

function statusText(p = 1): string {
  const l = computeLive(costed, Date.now(), settings.value.dailyBudget)
  const g = guard.state
  const rate = computeRate(claudeCosted, Date.now())
  const ago = l.lastEntryAt ? Math.round((Date.now() - l.lastEntryAt) / 60_000) : null
  const claude = claudeWorking() ? `🟢 正在工作（${fmtTokens(rate.tokensPerMin)} tokens/分）` : ago !== null ? `空闲（${ago} 分钟前有活动）` : '还没有活动'
  const guardText = g.manualHold
    ? '已手动暂停所有任务（/resume 恢复）'
    : g.paused.length
      ? `暂停中 ${g.paused.length} 个任务`
      : settings.value.guardEnabled
        ? `开启（5h ${settings.value.guardPauseAt}% 暂停）`
        : '关闭'
  return [
    '📊 <b>TokenPulse 状态</b>',
    ...quotaLine(p),
    ...codexLine(p),
    `今日 ${cn(l.today.tokens * p)} tokens · ${money(l.today.cost * p)}`,
    `Claude：${claude}`,
    `守卫：${guardText}`,
    ...taskLine(),
    ...(runaways.length ? [`⚠️ 失控会话 ${runaways.length} 个`] : [])
  ].join('\n')
}

function taskLine(): string[] {
  const running = tasks.tasks.filter((t) => t.status === 'running')
  const queued = tasks.tasks.filter((t) => t.status === 'queued').length
  if (!running.length && !queued) return []
  return [`🧩 任务：${running.length ? `执行中 ${running.length}（${running.map((t) => escapeHtml(taskTitle(t.prompt).slice(0, 14))).join('、')}）` : '没有在执行'} · 排队 ${queued}`]
}

/** one line: the quota and today, for the folded panel and the pinned board */
function glance(): string {
  const parts: string[] = []
  const five = fiveHourWindow(quota.info.windows)
  const week = sevenDayWindow(quota.info.windows)
  if (five) parts.push(`5h ${Math.round(five.utilization)}%`)
  if (week) parts.push(`7d ${Math.round(week.utilization)}%`)
  const cx = codexQ?.windows.find((w) => w.key === 'codex_5h')
  if (cx) parts.push(`Codex ${Math.round(cx.utilization)}%`)
  parts.push(`今日 ${cn(computeLive(costed, Date.now(), settings.value.dailyBudget).today.tokens)}`)
  return parts.join(' · ')
}

// ---------- tasks in Telegram: a card per run that keeps itself up to date ----------

const shortId = (id: string) => id.slice(0, 8)
const findTask = (arg: string | undefined) => (arg ? tasks.tasks.find((t) => t.id.startsWith(arg)) : undefined)
const LOG_GLYPH: Record<string, string> = { system: '·', thinking: '✻', text: '💬', tool: '🔧', result: '✅', error: '⚠️' }
/** a running card turns through the moon's phases, one step per update */
const MOON = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘']

function taskCard(t: (typeof tasks.tasks)[number]): Message {
  const id = shortId(t.id)
  const icon = t.status === 'running' ? MOON[Math.floor(Date.now() / 30_000) % MOON.length] : { done: '✅', failed: '❌', queued: '⏳', cancelled: '⏹' }[t.status]
  const elapsed = t.startedAt ? Math.max(0, Math.round(((t.finishedAt ?? Date.now()) - t.startedAt) / 60_000)) : 0
  const lines = [
    `${icon} <b>${toolLabel(t.tool)} 任务</b>：${escapeHtml(taskTitle(t.prompt))}`,
    `📁 ${escapeHtml(t.cwd.split(/[\\/]/).filter(Boolean).pop() ?? t.cwd)} · ${t.mode === 'terminal' ? '终端窗口' : '后台'}${t.model ? ` · ${escapeHtml(t.model)}` : ''}${t.continue ? ' · 接着上次对话' : ''}`
  ]
  const tries = t.attempts?.length ?? 0
  if (tries > 1 || t.pending) lines.push(`🔁 第 ${tries + (t.pending ? 1 : 0)} 次尝试${t.retries ? `（最多 ${t.retries + 1} 次）` : ''}${t.verify ? ` · 检查：${escapeHtml(t.verify.slice(0, 40))}` : ''}`)
  else if (t.verify) lines.push(`🧪 完成后检查：${escapeHtml(t.verify.slice(0, 60))}`)
  if (t.status === 'running') {
    lines.push(`⏱ 已运行 ${elapsed} 分钟 · 已做 ${t.steps ?? 0} 步`)
    if (t.activity) lines.push(`${t.activity.startsWith('思考：') ? '✻' : '💬'} ${escapeHtml(t.activity.slice(0, 160))}`)
  } else if (t.status === 'done') {
    lines.push(`用时 ${Math.max(1, elapsed)} 分钟${t.costUsd !== null ? ` · ${money(t.costUsd)}` : ''}${t.turns ? ` · ${t.turns} 轮` : ''}${t.steps ? ` · ${t.steps} 步` : ''}`)
  } else if (t.status === 'failed' && t.error) lines.push(`原因：${escapeHtml(t.error.slice(0, 200))}`)
  if (t.note) lines.push(`ℹ️ ${escapeHtml(t.note)}`)
  const buttons: Button[][] =
    t.status === 'running'
      ? [[{ text: '⏹ 停止', data: `taskstop ${id}` }, { text: '📜 日志', data: `tasklog ${id}` }, { text: '🔄', data: `e:taskcard ${id}` }]]
      : t.status === 'queued'
        ? [[{ text: '▶️ 现在开始', data: `taskstart ${id}` }, { text: '✕ 取消', data: `taskcancel ${id}` }]]
        : [[{ text: '📜 日志', data: `tasklog ${id}` }, { text: '🔁 再次排队', data: `taskrequeue ${id}` }]]
  return { text: lines.join('\n'), buttons }
}

/** message id of each running task's card, and when it was last edited */
const taskCards = new Map<string, { id: number; at: number }>()

async function postTaskCard(t: (typeof tasks.tasks)[number]): Promise<void> {
  const s = settings.value
  if (!telegramReady() || !s.pushTasks) return
  const r = await telegram.send(s.telegramToken, s.telegramChatId, { ...taskCard(t), silent: quietNow(s) })
  if (r.ok && r.messageId) taskCards.set(t.id, { id: r.messageId, at: Date.now() })
}

/** edits the cards of running tasks, at most every 30 s each (and right away when one ends) */
function refreshTaskCards(force?: string): void {
  const s = settings.value
  if (!telegramReady()) return
  for (const [taskId, card] of taskCards) {
    const t = tasks.tasks.find((x) => x.id === taskId)
    if (!t) {
      taskCards.delete(taskId)
      continue
    }
    // a try that failed and waits for the next one keeps its card
    const ended = t.status !== 'running' && !(t.status === 'queued' && t.pending)
    if (!ended && force !== taskId && Date.now() - card.at < 30_000) continue
    card.at = Date.now()
    void telegram.edit(s.telegramToken, s.telegramChatId, card.id, taskCard(t), true)
    if (ended) taskCards.delete(taskId)
  }
}

async function taskLogText(t: (typeof tasks.tasks)[number] | undefined, n = 14): Promise<Reply> {
  if (!t) return '还没有执行过任务'
  const lines = (await tasks.log(t.id)).filter((l) => l.kind !== 'system').slice(-n)
  const rows = lines.map((l) => `${LOG_GLYPH[l.kind] ?? '·'} ${escapeHtml(l.text.replace(/\s+/g, ' ').slice(0, 220))}`)
  // the older lines fold away, the newest stay in sight
  const older = rows.slice(0, -4)
  const body = rows.length ? `${older.length ? `<blockquote expandable>${older.join('\n')}</blockquote>\n` : ''}${rows.slice(-4).join('\n')}` : '还没有输出'
  return {
    text: `📜 <b>${escapeHtml(taskTitle(t.prompt))}</b>\n${body}`,
    buttons: t.status === 'running' ? [[{ text: '🔄 刷新', data: `e:tasklog ${shortId(t.id)}` }, { text: '⏹ 停止', data: `taskstop ${shortId(t.id)}` }]] : undefined
  }
}

function signLines(): string[] {
  const sign = codingSign(costed, Date.now())
  const z = sign.zodiac
  return [
    `✨ <b>你的编码星座：${escapeHtml(sign.name)}</b> ${sign.symbol}`,
    escapeHtml(sign.desc),
    sign.traits.length ? sign.traits.map((x) => `· ${escapeHtml(x)}`).join('\n') : '',
    '',
    `${z.symbol} 今天的星座是 <b>${z.name}</b>：今日用量点亮了 ${z.lit}/${z.stars} 颗星${z.lit >= z.stars ? '，整座星座都亮了 🌟' : ''}`
  ].filter((l) => l !== '')
}

function todayText(p = 1): string {
  const s = computeSummary(costed, 'today', Date.now(), modelLabel)
  const t = s.totals
  if (!t.messages) return codexCosted.length ? '今天还没有使用 Claude Code 和 Codex' : '今天还没有使用 Claude Code'
  const cx = codexCosted.length ? computeSummary(codexCosted, 'today', Date.now(), modelLabel).totals : null
  // the sparkline fills in hour by hour while it counts up
  const line = spark(s.buckets.map((b) => b.tokens)).split('')
  const shown = Math.ceil(line.length * p)
  return [
    `📅 <b>今日用量</b>`,
    `${cn(t.tokens * p)} tokens · ${money(t.cost * p)}（API 等价）`,
    `<code>${line.map((ch, i) => (i < shown ? ch : '·')).join('')}</code> 0 → 24 时`,
    cx && cx.messages ? `其中 Claude ${cn(t.tokens - cx.tokens)} · Codex ${cn(cx.tokens)}` : '',
    `响应 ${t.messages} 次 · 会话 ${t.sessions} 个`,
    `缓存命中 ${(s.cacheHitRate * 100).toFixed(1)}% · 省下 ${money(t.costParts.cacheSavings)}`,
    s.byModel[0] ? `主力模型 ${escapeHtml(s.byModel[0].name)}` : '',
    s.byProject[0] ? `项目 ${escapeHtml(s.byProject[0].name)}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

const starText = () => fold(starLines(cosmos()), 7)
const weekText = () => weekLines(costed, Date.now(), money).join('\n')
function topText(): string {
  const now = Date.now()
  return fold(topLines(promptReport(costed, prompts(), 'today', startOfDay(now), now + 1, modelLabel), money), 4)
}
function achText(): string {
  if (!achievements.length) checkAchievements()
  const lines = achLines(achievements)
  const closest = lines.indexOf('最接近的：')
  return fold(lines, closest > 0 ? closest : lines.length)
}

// ---------- the panel: one message that turns its pages and folds to a line ----------

type PanelPage = 'status' | 'today' | 'week' | 'tasks' | 'star' | 'ach' | 'top' | 'sign'
const PANEL_TABS: { page: PanelPage; icon: string; name: string }[] = [
  { page: 'status', icon: '📊', name: '状态' },
  { page: 'today', icon: '📅', name: '今日' },
  { page: 'week', icon: '📈', name: '7 天' },
  { page: 'tasks', icon: '📋', name: '任务' },
  { page: 'star', icon: '⭐', name: '星空' },
  { page: 'ach', icon: '🏆', name: '成就' },
  { page: 'top', icon: '💸', name: '最贵' },
  { page: 'sign', icon: '✨', name: '星座' }
]

function panelBody(page: PanelPage): string {
  switch (page) {
    case 'status':
      return statusText()
    case 'today':
      return todayText()
    case 'week':
      return weekText()
    case 'tasks':
      return tasksText()
    case 'star':
      return starText()
    case 'ach':
      return achText()
    case 'top':
      return topText()
    case 'sign':
      return signLines().join('\n')
  }
}

/** a button on a page that acts and then redraws the page in place */
async function panelAction(action: string): Promise<string | undefined> {
  if (action === 'pause') return (await pauseAll()).toast
  if (action === 'resume') return (await resumeAll()).toast
  if (action === 'guardon' || action === 'guardoff') {
    await applySettings({ guardEnabled: action === 'guardon' })
    return action === 'guardon' ? `🛡 守卫已开启（5h ${settings.value.guardPauseAt}%）` : '守卫已关闭'
  }
  return undefined
}

async function panel(arg: string | undefined, action?: string): Promise<Reply> {
  const toast = action ? await panelAction(action) : undefined
  if (arg === 'min') return { text: `🎛 <b>TokenPulse</b> · ${glance()}`, buttons: [[{ text: '▾ 展开面板', data: 'e:panel status' }, { text: '🔄', data: 'e:panel min' }]], toast }
  const page: PanelPage = PANEL_TABS.some((t) => t.page === arg) ? (arg as PanelPage) : 'status'
  const tabs = PANEL_TABS.map((t) => ({ text: t.page === page ? `「${t.name}」` : `${t.icon} ${t.name}`, data: `e:panel ${t.page}` }))
  const held = guard.state.manualHold || guard.state.paused.length > 0
  const actions: Button[] =
    page === 'status'
      ? [
          held ? { text: '▶️ 恢复任务', data: 'e:panel status resume' } : { text: '⏸ 暂停全部', data: 'e:panel status pause' },
          settings.value.guardEnabled ? { text: '🛡 关闭守卫', data: 'e:panel status guardoff' } : { text: '🛡 开启守卫', data: 'e:panel status guardon' }
        ]
      : page === 'today'
        ? [{ text: '📰 发晚报', data: 'report' }]
        : page === 'tasks'
          ? [{ text: '📜 日志', data: 'log' }, { text: '🗂 管理任务', data: 'tasks' }]
          : []
  return {
    text: panelBody(page),
    buttons: [
      ...(actions.length ? [actions] : []),
      tabs.slice(0, 4),
      tabs.slice(4),
      [
        { text: '🃏 卡片', data: 'card' },
        { text: '🔄 刷新', data: `e:panel ${page}` },
        { text: '▴ 收起', data: 'e:panel min' }
      ]
    ],
    toast
  }
}

// ---------- the picture card ----------

const WEEKDAY = '日一二三四五六'
const hhmm = (t: number) => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })

/** "23:17" today, "10/9 08:00" on another day */
function whenLabel(t: number, now: number): string {
  const d = new Date(t)
  return startOfDay(t) === startOfDay(now) ? hhmm(t) : `${d.getMonth() + 1}/${d.getDate()} ${hhmm(t)}`
}

function cardData(v: SourceView, now = Date.now()): CardData {
  const list = v === 'claude' ? claudeCosted : v === 'codex' ? codexCosted : costed
  const s = computeSummary(list, 'today', now, modelLabel)
  const d = new Date(now)
  const reset = (iso: string | null | undefined) => (iso ? `${whenLabel(Date.parse(iso), now)} 重置` : null)
  const quotas: CardQuota[] = []
  if (v !== 'codex') {
    const five = fiveHourWindow(quota.info.windows)
    const week = sevenDayWindow(quota.info.windows)
    if (five) quotas.push({ label: 'Claude 5h', pct: five.utilization, reset: reset(five.resetsAt) })
    if (week) quotas.push({ label: 'Claude 7 天', pct: week.utilization, reset: reset(week.resetsAt) })
  }
  if (v !== 'claude' && settings.value.codexEnabled) {
    for (const w of codexQ?.windows ?? []) quotas.push({ label: w.key === 'codex_5h' ? 'Codex 5h' : w.key === 'codex_7d' ? 'Codex 7 天' : w.label, pct: w.utilization, reset: reset(w.resetsAt) })
  }
  // the first 5-hour window, as a star
  const five = quotas.find((q) => q.label.endsWith('5h'))
  const st = five ? stageInfo(five.pct) : null
  const working = v === 'codex' ? codexWorking() : v === 'claude' ? claudeWorking() : claudeWorking() || codexWorking()
  const sign = codingSign(list, now)
  return {
    date: `${d.getMonth() + 1}/${d.getDate()} 周${WEEKDAY[d.getDay()]}`,
    time: hhmm(now),
    view: v === 'all' ? (codexCosted.length ? 'Claude + Codex' : 'Claude') : toolLabel(v),
    accent: accentHex({ accent: settings.value.accent, sourceFilter: v }),
    tokens: s.totals.tokens,
    cost: money(s.totals.cost),
    costUsd: s.totals.cost,
    messages: s.totals.messages,
    sessions: s.totals.sessions,
    cacheHit: s.cacheHitRate,
    hours: s.buckets.map((b) => b.tokens),
    nowHour: d.getHours(),
    quotas,
    star: st && five ? { name: st.name, pct: five.pct, color: st.color, desc: st.desc } : null,
    model: s.byModel[0]?.name ?? null,
    sign: `${sign.zodiac.symbol} ${sign.zodiac.name} · 点亮 ${sign.zodiac.lit}/${sign.zodiac.stars} 颗星`,
    rate: working ? `${cn(computeRate(list, now).tokensPerMin)} tokens/分` : null
  }
}

const cardPhoto = (v: SourceView) => svgToJpeg(cardSvg(cardData(v)), CARD_W, CARD_H)

/** the today card as a looping animation: the numbers count up, the rings fill, the hours rise */
const cardAnimation = (v: SourceView) => svgsToMp4(cardFrames(cardData(v), money, 20), 720, 934, 20)

async function cardReply(arg: string | undefined): Promise<Reply> {
  const v: SourceView = arg === 'claude' || arg === 'codex' || arg === 'all' ? arg : source()
  let photo: Buffer | undefined
  let animation: Buffer | undefined
  try {
    if (animated()) animation = await cardAnimation(v).catch(() => undefined)
    if (!animation) photo = await cardPhoto(v)
  } catch (e) {
    return `卡片没画出来：${escapeHtml(e instanceof Error ? e.message : String(e))}`
  }
  const views: { v: SourceView; text: string }[] = codexCosted.length
    ? [
        { v: 'claude', text: 'Claude' },
        { v: 'codex', text: 'Codex' },
        { v: 'all', text: '全部' }
      ]
    : []
  return {
    text: `🃏 <b>今日卡片</b> · ${escapeHtml(glance())}`,
    photo,
    animation,
    buttons: [[{ text: '🔄 刷新', data: `e:card ${v}` }, ...views.filter((x) => x.v !== v).map((x) => ({ text: `🔀 ${x.text}`, data: `e:card ${x.v}` }))]],
    toast: '🃏 卡片已更新'
  }
}

// ---------- the pinned board ----------

let boardKey = ''
let boardAt = 0
let boardBusy = false

function boardText(): Message {
  const now = Date.now()
  // the first line is what the pinned bar at the top of the chat shows
  const lines = [`📌 ${glance()}`]
  const row = (name: string, pct: number, resetsAt: string | null | undefined) =>
    `<code>${bar(pct / 100, 12)}</code> ${name} <b>${Math.round(pct)}%</b>${resetsAt ? ` · ${whenLabel(Date.parse(resetsAt), now)} 重置` : ''}`
  const five = fiveHourWindow(quota.info.windows)
  const week = sevenDayWindow(quota.info.windows)
  if (five) lines.push(row('Claude 5h', five.utilization, five.resetsAt))
  if (week) lines.push(row('Claude 7 天', week.utilization, week.resetsAt))
  if (settings.value.codexEnabled) for (const w of codexQ?.windows ?? []) lines.push(row(w.key === 'codex_5h' ? 'Codex 5h' : w.key === 'codex_7d' ? 'Codex 7 天' : w.label, w.utilization, w.resetsAt))
  const g = guard.state
  lines.push(
    `${claudeWorking() || codexWorking() ? '🟢 正在工作' : '⚪ 空闲'} · 守卫${g.manualHold ? '已暂停全部' : settings.value.guardEnabled ? `开（${settings.value.guardPauseAt}%）` : '关'}${taskLine().length ? ` · ${tasks.tasks.filter((t) => t.status === 'running').length} 个任务在跑` : ''}`
  )
  lines.push(`<i>${hhmm(now)} 更新 · 每分钟自动刷新</i>`)
  return { text: lines.join('\n'), buttons: [[{ text: '🔄', data: 'e:boardnow' }, { text: '🎛 面板', data: 'panel' }, { text: '🃏 卡片', data: 'card' }]] }
}

/** keeps the pinned board up to date (edits are silent), or takes it down when it is switched off */
async function syncBoard(force = false): Promise<void> {
  const s = settings.value
  if (boardBusy || shotDir) return
  const id = appState.tgBoard
  const want = telegramReady(s) && s.telegramBoard
  if (!want && id === null) return
  boardBusy = true
  try {
    if (!want) {
      if (telegramReady(s)) {
        await telegram.call(s.telegramToken, 'unpinChatMessage', { chat_id: s.telegramChatId, message_id: id }).catch(() => {})
        await telegram.call(s.telegramToken, 'deleteMessage', { chat_id: s.telegramChatId, message_id: id }).catch(() => {})
      }
      appState.tgBoard = null
      appState.save()
      return
    }
    const r = boardText()
    const key = r.text.replace(/<i>.*<\/i>/, '')
    if (id !== null && !force && key === boardKey && Date.now() - boardAt < 10 * 60_000) return
    if (id !== null) {
      try {
        await telegram.update(s.telegramToken, s.telegramChatId, id, r)
        boardKey = key
        boardAt = Date.now()
        return
      } catch (e) {
        // only a board that is gone is posted anew (a network hiccup waits for the next minute)
        if (!/not found|can't be edited|MESSAGE_ID_INVALID/i.test(e instanceof Error ? e.message : '')) return
      }
    }
    const sent = await telegram.send(s.telegramToken, s.telegramChatId, { ...r, silent: true })
    if (!sent.ok || !sent.messageId) return
    appState.tgBoard = sent.messageId
    appState.save()
    boardKey = key
    boardAt = Date.now()
    await telegram.call(s.telegramToken, 'pinChatMessage', { chat_id: s.telegramChatId, message_id: sent.messageId, disable_notification: true }).catch(() => {})
  } finally {
    boardBusy = false
  }
}

// ---------- luck ----------

const LUCK_DO = ['重构一个老函数', '先写测试', '删掉没用的代码', '开个新会话', '让 Haiku 跑杂活', '读一遍报错日志', '提交一次', '让 Claude 补文档', '排一个刷新任务', '早点睡']
const LUCK_AVOID = ['无限循环', '把整个仓库贴进去', '凌晨改线上', '跳过测试', '让上下文涨到 1M', '一句话需求', '同一个问题问三遍', '不看 diff 就提交']

/** the 🎰 lands on 1–64: 64 is 777, 1 / 22 / 43 are three of a kind */
function luckText(v: number | null): Reply {
  const n = v ?? 1 + Math.floor(Math.random() * 64)
  const tier = n === 64 ? '🎉 大吉 · 777' : [1, 22, 43].includes(n) ? '✨ 上吉 · 三连' : ['🌤 中吉', '🍀 小吉', '☁️ 吉', '🌙 末吉'][n % 4]
  const five = fiveHourWindow(quota.info.windows)
  const left = five ? Math.max(0, 100 - Math.round(five.utilization)) : null
  const quotaLine =
    left === null
      ? ''
      : left >= 60
        ? `5h 额度还剩 ${left}%，弹药充足`
        : left >= 25
          ? `5h 额度还剩 ${left}%，省着点花`
          : `5h 额度只剩 ${left}%${five?.resetsAt ? `，${clockOf(Date.parse(five.resetsAt))} 回血` : ''}`
  const day = new Date()
  const seed = n + day.getDate() * 7
  return {
    text: [`🎰 <b>今日额度运势</b>：${tier}`, quotaLine, `宜：${LUCK_DO[seed % LUCK_DO.length]}`, `忌：${LUCK_AVOID[(seed * 3) % LUCK_AVOID.length]}`].filter(Boolean).join('\n'),
    effect: n === 64 || [1, 22, 43].includes(n) ? 'party' : undefined,
    react: n === 64 ? '🏆' : undefined
  }
}

// ---------- actions shared by commands and buttons ----------

async function pauseAll(): Promise<{ text: string; toast: string }> {
  const g = await guard.setManualHold(true)
  if (g.error) return { text: `暂停失败：${escapeHtml(g.error)}`, toast: '暂停失败' }
  return {
    text: `⏸ 已暂停所有 Claude Code 任务，它们会在下一次工具调用时停住等待${g.hookFresh ? '\n注意：守卫钩子刚刚安装，只对之后新开的 Claude Code 会话生效' : ''}\n回复 /resume 继续`,
    toast: '⏸ 已暂停所有 Claude Code 任务'
  }
}

async function resumeAll(): Promise<{ text: string; toast: string }> {
  await guard.setManualHold(false)
  await guard.releaseSessions()
  runaways = runaways.map((r) => ({ ...r, held: false }))
  broadcast('runaway:update', runaways)
  return { text: '▶️ 已恢复，暂停中的任务会继续执行', toast: '▶️ 已恢复' }
}

function queueTask(tool: UsageSource, prompt: string): string {
  const cwd = settings.value.taskCwd || homedir()
  const s = settings.value
  const t = tasks.add({
    prompt,
    cwd,
    tool,
    trigger: 'reset',
    permission: tool === 'codex' ? s.codexTaskPermission : s.taskPermission,
    model: tool === 'codex' ? s.codexTaskModel : s.taskModel,
    continue: s.taskContinue,
    autoCompact: s.taskAutoCompact,
    compactAt: s.taskCompactAt,
    retries: s.taskRetries,
    timeoutMin: s.taskTimeoutMin
  })
  return `📥 已排队${tool === 'codex' ? ' Codex 任务' : ''}：<b>${escapeHtml(taskTitle(prompt))}</b>\n${t.notBefore <= Date.now() + 5000 ? '额度空闲，马上开始' : `将在 ${clockOf(t.notBefore)} 额度刷新后开始`}\n目录：${escapeHtml(cwd)}`
}

/** plain messages offered as tasks, by a short id (button data holds 64 bytes) */
const offered = new Map<string, string>()
let offerSeq = 0

async function onCommand(cmd: Command): Promise<Reply> {
  let reply: Reply
  switch (cmd.name) {
    case 'start':
    case 'help':
      reply = { text: HELP, keyboard: keyboardMode() }
      break
    case 'panel':
      reply = await panel(cmd.args[0], cmd.args[1])
      break
    case 'card':
      reply = await cardReply(cmd.args[0])
      break
    case 'status':
      reply = { ...counting('📊 <b>TokenPulse 状态</b>', statusText), buttons: [[{ text: '🔄 刷新', data: 'e:status' }, holdButton(), guardButton()]] }
      break
    case 'today':
      reply = { ...counting('📅 <b>今日用量</b>', todayText), buttons: [[{ text: '🔄 刷新', data: 'e:today' }, { text: '🃏 卡片', data: 'card' }, { text: '📰 晚报', data: 'report' }]] }
      break
    case 'report': {
      const r = await sendReport()
      reply = r.ok ? { text: '', skip: true, toast: '📰 晚报已发送' } : `晚报没发出去：${escapeHtml(r.error ?? '')}`
      break
    }
    case 'tasks': {
      // a button per running task (stop) and the first queued ones (start now)
      const running = tasks.tasks.filter((t) => t.status === 'running')
      const queued = tasks.tasks.filter((t) => t.status === 'queued').sort((a, b) => a.order - b.order).slice(0, 4)
      const rows: Button[][] = [
        ...running.map((t) => [
          { text: `⏹ 停止「${taskTitle(t.prompt).slice(0, 10)}」`, data: `taskstop ${shortId(t.id)}` },
          { text: '📜 日志', data: `tasklog ${shortId(t.id)}` }
        ]),
        ...queued.map((t) => [
          { text: `▶️ 开始「${taskTitle(t.prompt).slice(0, 10)}」`, data: `taskstart ${shortId(t.id)}` },
          { text: '✕', data: `taskcancel ${shortId(t.id)}` }
        ]),
        [{ text: '🔄 刷新', data: 'e:tasks' }]
      ]
      reply = { text: tasksText(), buttons: rows }
      break
    }
    case 'log': {
      const t = tasks.tasks.find((x) => x.status === 'running') ?? [...tasks.tasks].filter((x) => x.startedAt).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0]
      reply = await taskLogText(t, Math.min(40, Math.max(5, Number(cmd.args[0]) || 14)))
      break
    }
    case 'tasklog':
      reply = await taskLogText(findTask(cmd.args[0]))
      break
    case 'taskcard': {
      const t = findTask(cmd.args[0])
      reply = t ? taskCard(t) : '找不到这个任务（可能已经删除）'
      break
    }
    case 'taskstop':
    case 'taskstart':
    case 'taskcancel':
    case 'taskrequeue': {
      const t = findTask(cmd.args[0])
      const action = ({ taskstop: 'stop', taskstart: 'start', taskcancel: 'cancel', taskrequeue: 'requeue' } as const)[cmd.name]
      if (!t) reply = '找不到这个任务（可能已经删除）'
      else {
        await tasks.action(t.id, action)
        const done = { stop: '⏹ 已要求停止', start: '▶️ 已开始（同一文件夹有任务在跑时会排在它后面）', cancel: '✕ 已取消', requeue: '🔁 已重新排到下次刷新' }[action]
        reply = { text: `${done}：<b>${escapeHtml(taskTitle(t.prompt))}</b>`, toast: done.split('（')[0] }
      }
      break
    }
    case 'sign':
      reply = { text: signLines().join('\n'), buttons: [[{ text: '🔄 刷新', data: 'e:sign' }]] }
      break
    case 'star':
    case 'sky':
      reply = { text: starText(), buttons: [[{ text: '🔄 刷新', data: 'e:star' }, { text: '📈 本周', data: 'week' }]] }
      break
    case 'week':
      reply = { text: weekText(), buttons: [[{ text: '🔄 刷新', data: 'e:week' }, { text: '💸 最贵的提问', data: 'top' }]] }
      break
    case 'top':
      reply = { text: topText(), buttons: [[{ text: '🔄 刷新', data: 'e:top' }]] }
      break
    case 'ach':
      reply = { text: achText(), buttons: [[{ text: '🔄 刷新', data: 'e:ach' }]] }
      break
    case 'tarot':
      reply = await tarotReply()
      break
    case 'luck': {
      const s = settings.value
      const v = await telegram.dice(s.telegramToken, s.telegramChatId, '🎰')
      // the reels stop after about two seconds
      if (v !== null) await new Promise((r) => setTimeout(r, 2300))
      reply = luckText(v)
      break
    }
    case 'task': {
      // "/task codex …" queues a Codex task
      const first = cmd.args[0]?.toLowerCase()
      const tool: UsageSource = first === 'codex' ? 'codex' : 'claude'
      const prompt = (first === 'codex' || first === 'claude' ? cmd.args.slice(1) : cmd.args).join(' ').trim()
      reply = prompt ? { text: queueTask(tool, prompt), react: '✍' } : '用法：/task 任务内容（Codex 任务：/task codex 任务内容）\n例如 /task 把 tests 里失败的用例修好并跑一遍测试'
      break
    }
    case 'plain': {
      const text = cmd.plain ?? ''
      if (!text) {
        reply = '发送 /help 查看可用指令'
        break
      }
      const id = (++offerSeq).toString(36)
      offered.set(id, text)
      if (offered.size > 20) offered.delete(offered.keys().next().value!)
      const tools: Button[] = [{ text: '📥 排成 Claude 任务', data: `e:offer ${id} claude` }]
      if (settings.value.codexEnabled) tools.push({ text: '📥 Codex 任务', data: `e:offer ${id} codex` })
      reply = {
        text: `💭 「${escapeHtml(text.length > 120 ? `${text.slice(0, 119)}…` : text)}」\n要把这句话排成任务吗？下一次额度刷新时自动执行。\n想看状态的话点 🎛 面板，或者发 /help`,
        buttons: [tools, [{ text: '✕ 不用了', data: `e:offer ${id} no` }, { text: '🎛 面板', data: 'e:panel status' }]]
      }
      break
    }
    case 'offer': {
      const [id, tool] = cmd.args
      const text = offered.get(id ?? '')
      if (tool === 'no') {
        offered.delete(id ?? '')
        reply = { text: '👌 好的，没有排队', toast: '已忽略' }
      } else if (!text) reply = '这条消息找不到了（TokenPulse 重启过），重新发一次吧'
      else {
        offered.delete(id)
        reply = { text: queueTask(tool === 'codex' ? 'codex' : 'claude', text), toast: '📥 已排队' }
      }
      break
    }
    case 'pause': {
      const r = await pauseAll()
      reply = { text: r.text, buttons: [[{ text: '▶️ 恢复', data: 'resume' }]], react: '🫡', toast: r.toast }
      break
    }
    case 'resume': {
      const r = await resumeAll()
      reply = { text: r.text, react: '⚡', toast: r.toast }
      break
    }
    case 'guard': {
      const on = cmd.args[0]?.toLowerCase()
      if (on !== 'on' && on !== 'off') {
        reply = {
          text: `🛡 额度守卫现在<b>${settings.value.guardEnabled ? `开启（5h ${settings.value.guardPauseAt}% 暂停）` : '关闭'}</b>`,
          buttons: [[guardButton()]]
        }
      } else {
        await applySettings({ guardEnabled: on === 'on' })
        reply = on === 'on' ? `🛡 额度守卫已开启：5h 达到 ${settings.value.guardPauseAt}% 时暂停任务` : '额度守卫已关闭'
      }
      break
    }
    case 'board': {
      const on = cmd.args[0]?.toLowerCase()
      if (on === 'on' || on === 'off') {
        await applySettings({ telegramBoard: on === 'on' })
        reply = on === 'on' ? { text: '📌 实时看板已置顶：聊天顶部会一直显示额度，每分钟悄悄更新一次', toast: '📌 已置顶' } : { text: '已取消置顶看板', toast: '已取消' }
      } else {
        const now = settings.value.telegramBoard
        reply = {
          text: `📌 置顶实时看板现在<b>${now ? '开启' : '关闭'}</b>\n开启后聊天顶部一直显示 5h / 7 天额度和今日用量，每分钟编辑一次（不会响铃）`,
          buttons: [[now ? { text: '取消置顶', data: 'board off' } : { text: '📌 置顶看板', data: 'board on' }]]
        }
      }
      break
    }
    case 'boardnow':
      reply = { ...boardText(), toast: '已刷新' }
      break
    case 'hide':
      reply = { text: '⌨️ 按钮已收起。要用时发送 /keys，或点左下角的「菜单」', keyboard: 'remove' }
      break
    case 'keys':
      reply = { text: '⌨️ 按钮在输入框下面了：点输入框旁边的 ⌨️ 图标可以收起、展开', keyboard: settings.value.telegramKeyboard === 'keep' ? 'keep' : 'fold' }
      break
    default:
      reply = `不认识的指令 /${escapeHtml(cmd.name)}，发送 /help 查看可用指令`
  }
  // effects and reactions only when they are switched on
  if (typeof reply !== 'string' && !settings.value.telegramEffects) reply = { ...reply, effect: undefined, react: undefined }
  const text = typeof reply === 'string' ? reply : reply.text
  broadcast('remote:command', { command: cmd.name, reply: text.replace(/<[^>]+>/g, '').split('\n')[0] })
  appState.bump('remote')
  checkAchievements()
  return reply
}

// ---------- refresh tasks ----------

/** A tool's 5h window as the task queue sees it */
function taskWindow(tool: UsageSource): WindowInfo {
  if (tool === 'codex') {
    const w = codexQ?.windows.find((x) => x.key === 'codex_5h')
    return { five: w ? { pct: w.utilization, resetsAt: w.resetsAt ? Date.parse(w.resetsAt) : null } : null, localEnd: null }
  }
  const five = fiveHourWindow(quota.info.windows)
  return {
    five: five ? { pct: five.utilization, resetsAt: five.resetsAt ? Date.parse(five.resetsAt) : null } : null,
    localEnd: blockWindow(claudeCosted, Date.now())?.end ?? null
  }
}

/** The folder's latest conversation of a tool in the logs (for tasks that carry on) */
function lastSessionIn(tool: UsageSource, cwd: string): { id: string; at: number } | null {
  const norm = (p: string) => p.replace(/[\\/]+$/, '').toLowerCase()
  const want = norm(cwd)
  const list = tool === 'codex' ? codexCosted : claudeCosted
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i]
    if (!e.side && e.projectPath && norm(e.projectPath) === want) return { id: e.sessionId, at: e.ts }
  }
  return null
}

/** Why a due task must wait: the queue is held, every task is paused, or the guard line is reached */
function taskBlocker(tool: UsageSource = 'claude'): string | null {
  const s = settings.value
  if (s.taskQueuePaused) return '任务队列已暂停'
  if (tool === 'codex') {
    // the guard can't hold Codex; a full window would only fail the task
    const w = codexQ?.windows.find((x) => x.key === 'codex_5h')
    const reset = w?.resetsAt ? Date.parse(w.resetsAt) : NaN
    return w && reset > Date.now() && w.utilization >= 99 ? `Codex 5h 额度已用完，${clockOf(reset)} 刷新后开始` : null
  }
  if (guard.state.manualHold) return '所有任务已手动暂停'
  const five = fiveHourWindow(quota.info.windows)
  const reset = five?.resetsAt ? Date.parse(five.resetsAt) : NaN
  if (s.guardEnabled && five && reset > Date.now() && five.utilization >= s.guardPauseAt) {
    return `5h 额度 ${Math.round(five.utilization)}% 已到守卫线，${clockOf(reset)} 刷新后开始`
  }
  // the guard's "only resume in these hours" also keeps unattended tasks to them
  if (s.guardEnabled && s.guardResumeFrom && s.guardResumeTo && !inHours(new Date(), s.guardResumeFrom, s.guardResumeTo)) {
    return `守卫设定只在 ${s.guardResumeFrom}–${s.guardResumeTo} 自动续跑，到时再开始`
  }
  return null
}

/** "HH:MM"–"HH:MM", possibly across midnight */
function inHours(d: Date, from: string, to: string): boolean {
  const m = d.getHours() * 60 + d.getMinutes()
  const [a, b] = [from, to].map((x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5)))
  return a <= b ? m >= a && m < b : m >= a || m < b
}

const taskTitle = (prompt: string) => (prompt.length > 40 ? `${prompt.slice(0, 39)}…` : prompt)

const toolLabel = (tool: UsageSource | undefined) => (tool === 'codex' ? 'Codex' : 'Claude')

tasks.on('change', (s) => {
  broadcast('tasks:update', s)
  refreshTaskCards()
})
tasks.on('retrying', (t) => refreshTaskCards(t.id)).on('started', (t) => {
  // one card per run, edited as it goes (a retry with another model keeps the same card)
  if (!taskCards.has(t.id)) void postTaskCard(t)
  // fresh numbers for the new window
  if (t.tool !== 'codex') setTimeout(() => void quota.refresh(), 90_000)
})
tasks.on('finished', (t) => {
  const mins = t.startedAt && t.finishedAt ? Math.max(1, Math.round((t.finishedAt - t.startedAt) / 60_000)) : 0
  const cost = t.costUsd !== null ? ` · ${money(t.costUsd)}` : ''
  const name = `${toolLabel(t.tool)} 任务`
  refreshTaskCards(t.id)
  if (t.status === 'done') {
    appState.bump('tasks')
    // trial and error that paid off, and checks that passed
    if ((t.attempts ?? []).slice(0, -1).some((a: { ok: boolean | null; failure?: string | null }) => !a.ok && a.failure !== 'setup')) appState.bump('rescued')
    if (t.verify) appState.bump('checked')
    checkAchievements()
    notify(`${name}完成`, `${taskTitle(t.prompt)}（${mins} 分钟${cost}）`)
    const tried = (t.attempts?.length ?? 0) > 1 && t.note ? `\n🔁 ${escapeHtml(t.note)}` : ''
    // the summary folds into a quote that opens with a tap
    const summary = t.summary ? `\n<blockquote expandable>${escapeHtml(t.summary.slice(0, 1500))}</blockquote>` : ''
    push('tasks', `✅ ${name}完成：<b>${escapeHtml(taskTitle(t.prompt))}</b>\n用时 ${mins} 分钟${cost}${t.turns ? ` · ${t.turns} 轮` : ''}${tried}${summary}`, 'like')
  } else {
    const tries = t.attempts?.length ?? 0
    notify(`${name}未完成`, `${taskTitle(t.prompt)}：${t.error ?? ''}${tries > 1 ? `（试了 ${tries} 次）` : ''}`)
    push('tasks', `❌ ${name}未完成：<b>${escapeHtml(taskTitle(t.prompt))}</b>\n${escapeHtml(t.error ?? '')}${tries > 1 ? `\n🔁 一共试了 ${tries} 次` : ''}`)
  }
})

function tasksText(): string {
  const s = tasks.state()
  const list = s.tasks.filter((t) => t.status === 'queued' || t.status === 'running').sort((a, b) => a.order - b.order)
  if (!list.length) return '队列里没有任务。发送 /task 任务内容 就能排到下一次额度刷新'
  const parentOf = (t: (typeof list)[number]) => (t.parentId ? s.tasks.find((x) => x.id === t.parentId) : undefined)
  const both = list.some((t) => t.tool === 'codex') && list.some((t) => t.tool !== 'codex')
  return [
    '📋 <b>刷新任务</b>',
    ...list.map((t) => {
      const tag = both ? `[${toolLabel(t.tool)}] ` : ''
      const parent = parentOf(t)
      if (t.status === 'running') return `▶️ ${tag}执行中：${escapeHtml(taskTitle(t.prompt))}${t.activity ? `\n   ${escapeHtml(t.activity.slice(0, 80))}` : ''}`
      if (t.pending) return `🔁 ${tag}第 ${(t.attempts?.length ?? 0) + 1} 次尝试 · ${clockOf(t.notBefore)}：${escapeHtml(taskTitle(t.prompt))}${t.note ? `\n   ${escapeHtml(t.note.slice(0, 80))}` : ''}`
      const when = parent && parent.status !== 'done' ? `接在「${escapeHtml(taskTitle(parent.prompt))}」之后` : t.trigger === 'manual' ? '等你手动开始' : clockOf(t.notBefore)
      return `⏳ ${tag}${when}：${escapeHtml(taskTitle(t.prompt))}${t.repeat ? '（每次刷新）' : ''}${t.verify ? ' 🧪' : ''}`
    }),
    ...(s.tools.claude.waiting ? [`Claude 等待原因：${escapeHtml(s.tools.claude.waiting)}`] : []),
    ...(s.tools.codex.waiting ? [`Codex 等待原因：${escapeHtml(s.tools.codex.waiting)}`] : [])
  ].join('\n')
}

// ---------- subscription value ----------

/** Claude's plan against Claude usage, ChatGPT's against Codex usage, or both summed up */
function valueFor(src: SourceView) {
  const now = Date.now()
  const month = startOfMonth(now)
  const claudeHits = appState.hitsSince(month)
  const codexHits = codex.windows.filter((w) => w.end > month && w.peak >= 90).length
  const codexPlan = chatgptPlan(codexQ?.plan)
  if (src === 'codex') return computeValue(codexCosted, now, { plan: codexPlan, priceSetting: null, quotaHits: codexHits, money, source: 'codex' })
  if (src === 'all' && codexCosted.length) {
    const claudePlan = quota.info.plan ?? 'Pro'
    const chatgpt = codexPlan ?? 'ChatGPT Plus'
    const own = settings.value.planPrice
    return computeValue(costed, now, {
      plan: `${claudePlan} + ${chatgpt}`,
      priceSetting: own !== null ? own + (PLAN_PRICES[chatgpt] ?? 20) : null,
      quotaHits: claudeHits + codexHits,
      money,
      source: 'all'
    })
  }
  return computeValue(claudeCosted, now, { plan: quota.info.plan ?? null, priceSetting: settings.value.planPrice, quotaHits: claudeHits, money, source: 'claude' })
}

// ---------- evening report ----------

function reportText(): string {
  const now = Date.now()
  const pick = (w: ReturnType<typeof fiveHourWindow>) => (w ? { pct: w.utilization, resetsAt: w.resetsAt ? Date.parse(w.resetsAt) : null } : null)
  const week = pick(sevenDayWindow(quota.info.windows))
  return buildReport({
    now,
    today: computeSummary(costed, 'today', now, modelLabel),
    five: pick(fiveHourWindow(quota.info.windows)),
    week,
    forecast: forecastWeekly(claudeCosted, week, now),
    value: valueFor('claude'),
    unlockedToday: achievements.filter((a) => a.unlocked && a.at !== null && a.at >= startOfDay(now)),
    tasks: tasks.tasks.filter((t) => t.finishedAt && t.finishedAt >= startOfDay(now)),
    sign: codingSign(costed, now),
    star: starSummary(cosmos(now), now),
    money
  })
}

/** the report, as a picture card with the report as its caption when that is on */
async function sendReport(): Promise<TelegramResult> {
  const s = settings.value
  if (!telegramReady(s)) return { ok: false, error: '先配置并开启 Telegram 推送' }
  const text = reportText()
  const silent = quietNow(s)
  if (s.telegramCardReport) {
    const photo = await cardPhoto(source()).catch(() => null)
    // a caption holds 1024 characters (tags not counted)
    if (photo && text.replace(/<[^>]+>/g, '').length <= 1000) {
      const r = await telegram.send(s.telegramToken, s.telegramChatId, { text, photo, silent })
      if (r.ok) return r
    } else if (photo) await telegram.send(s.telegramToken, s.telegramChatId, { text: '🌙 <b>今日卡片</b>', photo, silent })
  }
  return telegram.send(s.telegramToken, s.telegramChatId, { text, silent })
}

// ---------- tarot: 22 cards, each drawing a piece of your usage ----------

function readDeck(now = Date.now()): TarotDeck {
  const v = source()
  // the quota cards draw Claude's quota in 全部 (the guard is Claude's too)
  const tool: UsageSource = v === 'codex' ? 'codex' : 'claude'
  const ps = paces(now)
  const p5 = ps.find((p) => p.key === `${tool}_5h`)
  const p7 = ps.find((p) => p.key === `${tool}_7d`)
  return buildDeck({
    now,
    view: v,
    entries: view(),
    label: modelLabel,
    tool,
    five: p5 ? { pct: p5.pct, end: p5.end } : null,
    seven: p7 ? { pct: p7.pct, start: p7.start, end: p7.end } : null,
    guardAt: tool === 'claude' && settings.value.guardEnabled ? settings.value.guardPauseAt : null,
    windows: windowRecords(8, [tool], now).map((w) => ({ start: w.start, end: w.end, peak: w.peak })),
    prompts: costByPrompt(view(), prompts(), startOfDay(now), now + 1, modelLabel).list,
    tasks: tasks.tasks.filter((t) => (t.tool ?? 'claude') === tool || v === 'all').map((t) => ({ prompt: t.prompt, status: t.status, finishedAt: t.finishedAt ?? null, startedAt: t.startedAt ?? null })),
    tpm: computeRate(view(), now).tokensPerMin
  })
}

/** six cards for Telegram: the day, the quota and the week */
const TG_CARDS = [19, 18, 10, 16, 17, 14]

function tarotSvg(d: TarotDeck): string {
  const W = 1080
  const H = 1240
  const accent = accentHex({ accent: settings.value.accent, sourceFilter: d.source })
  const head = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 340" width="200" height="340">'
  const cards = TG_CARDS.map((id, i) => {
    const x = 60 + (i % 3) * 340
    const y = 150 + Math.floor(i / 3) * 540
    const svg = cardFace(id, `t${i}`, { deck: d, frame: accent }).replace(head, `<svg x="${x}" y="${y}" width="280" height="476" viewBox="0 0 200 340">`)
    const line = cardStory(id, d, money)[0] ?? ''
    return `${svg}<text x="${x + 140}" y="${y + 508}" text-anchor="middle" font-size="20" fill="rgba(255,255,255,0.8)">${escapeHtml(clip(line, 22))}</text>`
  }).join('')
  const day = new Date(d.at)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="'Microsoft YaHei UI','Microsoft YaHei',sans-serif">
<defs>
  <radialGradient id="tbg" cx=".5" cy=".3" r=".9"><stop offset="0" stop-color="#241a3a"/><stop offset=".6" stop-color="#0d0c1c"/><stop offset="1" stop-color="#06060d"/></radialGradient>
  <radialGradient id="tglow"><stop offset="0" stop-color="${accent}" stop-opacity=".3"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#tbg)"/>
<ellipse cx="540" cy="520" rx="560" ry="480" fill="url(#tglow)"/>
<text x="540" y="76" text-anchor="middle" font-size="40" font-weight="700" fill="#f4e3b5" font-family="'KaiTi','STKaiti',serif">你的牌</text>
<text x="540" y="112" text-anchor="middle" font-size="20" fill="rgba(255,255,255,0.5)">${day.getMonth() + 1}/${day.getDate()} ${clockOf(d.at).split(' ').pop()} · 每张牌画的都是你自己的用量</text>
${cards}
</svg>`
}

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

async function tarotReply(): Promise<Reply> {
  const d = readDeck()
  const text = [
    '🔮 <b>你的牌</b>',
    ...TG_CARDS.map((id) => `<b>${ARCANA[id].numeral} ${ARCANA[id].name}</b>：${escapeHtml(cardStory(id, d, money).slice(0, 2).join('，'))}`),
    '<i>22 张牌全在 TokenPulse 的「塔罗」页</i>'
  ].join('\n')
  try {
    const photo = await svgToJpeg(tarotSvg(d), 1080, 1240)
    // a caption holds 1024 characters
    return { text: text.replace(/<[^>]+>/g, '').length > 1000 ? '🔮 <b>你的牌</b>' : text, photo, buttons: [[{ text: '🔄 刷新', data: 'e:tarot' }]], toast: '🔮 已刷新' }
  } catch {
    return text
  }
}

// ---------- the quota as stars ----------

/** 5-hour windows of the tools on `on` over `days` (official readings, Codex logs, and estimates from the logs) */
function windowRecords(days: number, on: UsageSource[], now = Date.now()) {
  const limit = settings.value.local5hLimitUsd ?? quota.calibratedLimit
  const est = limit && on.includes('claude') ? estimateClaudeWindows(claudeCosted, limit, now - days * 86_400_000, now) : []
  return buildHistory({ days, now, sources: on, claude: windowLog.windows, claudeEstimated: est, codex: codex.windows }).windows
}

/** the quota stars, their remnants, the sessions as stars and you as a star, for the tools on view */
function cosmos(now = Date.now()): Cosmos {
  const on = sources()
  const ps = paces(now)
  const stars = on.flatMap((src) => {
    const five = ps.find((p) => p.key === `${src}_5h`)
    return five ? [quotaStar(five, ps.find((p) => p.key === `${src}_7d`) ?? null, now)] : []
  })
  const rem = remnants(windowRecords(14, on, now), { claude: claudeCosted, codex: codexCosted }, now)
  const today = meteors(costByPrompt(view(), prompts(), startOfDay(now), now + 1, modelLabel).list)
  if (!achievements.length) checkAchievements()
  return {
    stars,
    remnants: rem,
    sessions: sessionStars(view(), now, 30, 300, modelLabel),
    me: stellarType(view(), rem, now),
    projects: projectPlanets(view(), now, 30, modelLabel),
    meteors: today,
    zhr: zhr(today),
    calendar: cosmicCalendar(view(), achievements.filter((a) => a.unlocked), now)
  }
}

/** what each 5-hour window bought: closed ones and the running one */
function quotaRates(days: number, now = Date.now()): QuotaRate[] {
  const on = sources()
  const out: QuotaRate[] = remnants(windowRecords(days, on, now), { claude: claudeCosted, codex: codexCosted }, now).map((r) => ({
    source: r.source,
    start: r.start,
    end: r.end,
    pct: r.peak,
    tokens: r.tokens,
    cost: r.cost,
    current: false
  }))
  for (const p of paces(now)) {
    if (!p.key.endsWith('_5h') || !on.includes(p.source)) continue
    let tokens = 0
    let cost = 0
    for (const e of p.source === 'codex' ? codexCosted : claudeCosted) {
      if (e.ts < p.start || e.ts > now) continue
      tokens += tokensOf(e)
      cost += e.cost.total
    }
    out.push({ source: p.source, start: p.start, end: p.end, pct: p.pct, tokens, cost, current: true })
  }
  return out
}

/** each tool on view: its 5-hour windows of the last week and its 7-day windows of the last ten, with the usage in each */
function quotaCycles(now = Date.now()): QuotaCycles[] {
  const ps = paces(now)
  return sources().map((src) => {
    const open = (k: '5h' | '7d'): KnownWindow | null => {
      const p = ps.find((x) => x.key === `${src}_${k}`)
      return p ? { start: p.start, end: p.end, pct: p.pct, hitAt: null } : null
    }
    const five = (src === 'codex' ? codex.windows : windowLog.windows).map((w) => ({ start: w.end - CYCLE_MS['5h'], end: w.end, pct: w.peak, hitAt: w.hitAt }))
    const weeks = (src === 'codex' ? codex.weeks : windowLog.weeks).map((w) => ({ start: w.end - CYCLE_MS['7d'], end: w.end, pct: w.peak, hitAt: null }))
    const entries = src === 'codex' ? codexCosted : claudeCosted
    const base = { entries, now, label: modelLabel }
    return {
      source: src,
      five: buildCycles({ ...base, kind: '5h', known: five, current: open('5h'), from: now - 7 * 86_400_000 }),
      seven: buildCycles({ ...base, kind: '7d', known: weeks, current: open('7d'), from: now - 70 * 86_400_000 })
    }
  })
}

/** the star a 5-hour reading turns into, for the quota notices */
function stageNote(pct: number): string {
  const st = [...STAGES].reverse().find((x) => pct >= x.from)
  if (!st) return ''
  const icon = { nebula: '🌫', protostar: '🟤', main: '🟡', giant: '🟠', supergiant: '🔴', supernova: '💥' }[st.key]
  return `\n${icon} 你的 5h 恒星${st.key === 'supernova' ? '爆发成了超新星' : `进入${st.name}阶段`}：${st.desc}`
}

// ---------- sunrise / sunset theme ----------

const skyPlace = () => placeOf(settings.value.skyPlace)

/** at sunrise and sunset, switches to the day or night pack once; a pack picked by hand stays until the next one */
function checkDayNight(force = false): void {
  const s = settings.value
  if (!s.dayNight) return
  const ph = dayNightPhase(Date.now(), skyPlace())
  if (!force && appState.dayNightPhase === ph.id) return
  appState.dayNightPhase = ph.id
  appState.save()
  const key = ph.day ? s.dayPack : s.nightPack
  const p = PACKS[key]
  const theme = p.theme === 'system' ? (ph.day ? 'light' : 'dark') : p.theme
  if (s.themePack === key && s.theme === theme && s.backdrop === p.backdrop) return
  void applySettings({ themePack: key, theme, backdrop: p.backdrop, accent: p.accent, ...(key === 'none' ? {} : { glassCards: true }) })
}

/** Sends the report once a day at the set time (or as soon as TokenPulse runs after it) */
function checkReport(): void {
  const s = settings.value
  if (!telegramReady() || !s.reportTime || loading) return
  const now = new Date()
  const [h, m] = s.reportTime.split(':').map(Number)
  const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime()
  const today = dayKey(now.getTime())
  if (now.getTime() < due || appState.lastReportDay === today) return
  appState.lastReportDay = today
  appState.save()
  void sendReport()
}

// ---------- runaway sessions ----------

let runaways: RunawayAlert[] = []
const runawayAt = new Map<string, number>()
const dismissed = new Map<string, number>()
let baseline = { at: 0, value: 0 }

/** Looks for sessions burning far faster than usual (or looping) and acts on them */
function checkRunaway(): void {
  const s = settings.value
  if (!s.runawayDetect || loading) return
  const now = Date.now()
  if (now - baseline.at > 10 * 60_000) baseline = { at: now, value: runawayBaseline(costed, now) }
  const before = runaways.length
  runaways = runaways.filter((r) => now - r.at < 30 * 60_000 && !((dismissed.get(r.sessionId) ?? 0) > now))
  // refresh tasks are meant to burn through a fresh window unattended: not runaways
  const taskSessions = new Set(tasks.tasks.map((t) => t.sessionId).filter(Boolean))
  const fresh = detectRunaway(costed, now, { baseline: baseline.value, sensitivity: s.runawaySensitivity }).filter(
    (a) => !taskSessions.has(a.sessionId) && !((dismissed.get(a.sessionId) ?? 0) > now) && now - (runawayAt.get(a.sessionId) ?? 0) > 15 * 60_000
  )
  for (const a of fresh) {
    runawayAt.set(a.sessionId, now)
    appState.bump('runaway')
    // the guard hook can only hold Claude Code sessions
    const isCodex = codex.entries.size > 0 && codexCosted.some((e) => e.sessionId === a.sessionId)
    const held = s.runawayAction === 'pause' && !isCodex
    if (held) void guard.holdSession(a.sessionId)
    runaways = [...runaways.filter((r) => r.sessionId !== a.sessionId), { ...a, held }]
    const what =
      a.kind === 'loop'
        ? `疑似陷入循环：连续 ${a.repeats} 次相同的响应`
        : `消耗异常：5 分钟 ${money(a.cost5)} / ${cn(a.tokens5)} tokens${a.ratio ? `（平时的 ${a.ratio.toFixed(1)} 倍）` : ''}`
    const who = `${isCodex ? 'Codex ' : ''}会话 ${a.project || a.sessionId.slice(0, 8)}`
    notify(`${who} ${a.kind === 'loop' ? '疑似死循环' : '消耗异常'}`, `${what}${held ? '，已暂停该会话' : ''}`)
    push('runaway', `⚠️ ${escapeHtml(who)} ${escapeHtml(what)}\n${held ? '已暂停这个会话，回复 /resume 继续' : isCodex ? '守卫无法暂停 Codex，请到 Codex 里手动停止' : '回复 /pause 暂停所有任务'}`)
  }
  if (fresh.length || runaways.length !== before) broadcast('runaway:update', runaways)
}

// ---------- context growth ----------

/** the level each session was last warned at (1 past the line, 2 close to the window) */
const contextWarned = new Map<string, number>()

/** largest context each Claude model has carried, recomputed when the data changes */
let modelPeaks = new Map<string, number>()
let modelPeaksRev = ''
function modelPeak(model: string): number {
  if (modelPeaksRev !== costedRev) {
    modelPeaksRev = costedRev
    modelPeaks = new Map()
    for (const e of claudeCosted) {
      if (e.side) continue
      const c = contextOf(e)
      if (c > (modelPeaks.get(e.model) ?? 0)) modelPeaks.set(e.model, c)
    }
  }
  return modelPeaks.get(model) ?? 0
}

/** a session's window and warning line: a share of the model's own window, or the fixed line */
const warnFor: WarnFor = (model, source) => {
  const window = windowOf(model, source, modelPeak(model), codex.contextWindows)
  return { window, warnAt: settings.value.contextAuto ? Math.round(window * CONTEXT_SOON) : settings.value.contextWarnK * 1000 }
}

/**
 * Sessions whose context has grown big for their model: one reminder when it
 * passes the line, one more close to the automatic compaction; a compaction
 * (the context falling back under the line) starts over.
 */
function checkContext(): void {
  if (!settings.value.contextAlert || loading) return
  const now = Date.now()
  const auto = settings.value.contextAuto
  for (const a of activeContexts(costed, now, warnFor, 5 * 60_000)) {
    const level = contextLevel(a, auto)
    if (!level) {
      contextWarned.delete(a.sessionId)
      continue
    }
    if ((contextWarned.get(a.sessionId) ?? 0) >= level) continue
    contextWarned.set(a.sessionId, level)
    broadcast('context:alert', a)
    const who = `${a.source === 'codex' ? 'Codex ' : ''}会话 ${a.project || a.sessionId.slice(0, 8)}`
    const share = Math.round((a.tokens / a.window) * 100)
    notify(
      `${who} 上下文 ${fmtTokens(a.tokens, 0)} / ${fmtTokens(a.window, 0)}（${share}%）`,
      level === 2
        ? `快到${a.source === 'codex' ? '上下文上限' : '自动压缩'}了：在合适的节点自己 /compact，比被动压缩更能留住要点`
        : `每次请求都要带上这么多 token${a.growthPerRequest > 500 ? `，还在以每次约 ${fmtTokens(a.growthPerRequest, 0)} 的速度增长` : ''}。告一段落时 /compact 一下`
    )
  }
}

function contextList(): ContextAlert[] {
  const on = sources()
  return contextAlerts(costed, Date.now(), warnFor).filter((a) => on.includes(a.source))
}

// ---------- achievements ----------

function checkAchievements(): void {
  const now = Date.now()
  achievements = computeAchievements(costed, appState.counters, {
    remnants: remnants(windowRecords(60, ['claude', 'codex'], now), { claude: claudeCosted, codex: codexCosted }, now),
    packs: appState.packsTried,
    prompts: [...store.prompts.values(), ...codex.prompts.values()].map((p) => p.ts),
    now
  })
  // half-scanned data would make the baseline (and the "new" badges) wrong
  if (loading) return
  const unlocked = achievements.filter((a) => a.unlocked)
  // the first run only records what is already earned
  if (!appState.seenAchievements) {
    appState.seenAchievements = new Set(unlocked.map((a) => a.id))
    appState.save()
    return
  }
  const fresh = unlocked.filter((a) => !appState.seenAchievements!.has(a.id))
  if (!fresh.length) return
  fresh.forEach((a) => appState.seenAchievements!.add(a.id))
  appState.save()
  broadcast('achievement:new', fresh)
  // a batch (e.g. Codex history read for the first time) is announced once
  if (fresh.length > 2) {
    const names = fresh.map((a) => a.title).join('、')
    notify(`一次解锁 ${fresh.length} 个成就`, names)
    push('achievement', `🏆 一次解锁 <b>${fresh.length}</b> 个成就\n${escapeHtml(names)}`, 'party')
    return
  }
  for (const a of fresh) {
    notify(`解锁成就 · ${a.title}`, a.desc)
    push('achievement', `🏆 解锁成就：<b>${escapeHtml(a.title)}</b>\n${escapeHtml(a.desc)}`, 'party')
  }
}

// ---------- quota events ----------

const clockOf = (t: number | null) => (t ? new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

function onQuotaReading(q: QuotaInfo): void {
  if (q.status === 'loading' || q.status === 'disabled' || !q.windows.length) return
  const pick = (w: ReturnType<typeof fiveHourWindow>) => (w ? { pct: w.utilization, resetsAt: w.resetsAt ? Date.parse(w.resetsAt) : null } : null)
  const cur: QuotaSnapshot = { five: pick(fiveHourWindow(q.windows)), week: pick(sevenDayWindow(q.windows)) }
  const prev = lastQuota
  const events = quotaEvents(lastQuota, cur)
  lastQuota = cur
  for (const ev of events) {
    if (appState.quotaKeys.has(ev.key)) continue
    appState.quotaKeys.add(ev.key)
    appState.save()
    const name = ev.window === 'five' ? '5 小时额度' : '7 天额度'
    const was = (ev.window === 'five' ? prev?.five?.pct : prev?.week?.pct) ?? 0
    if (ev.kind === 'cross') {
      if (ev.window === 'five' && ev.mark! >= 90) appState.recordHit(Date.now())
      const icon = ev.mark! >= 90 ? '🔴' : '🟠'
      push(
        'quota',
        `${icon} ${name}已用 <b>${Math.round(ev.pct)}%</b>\n重置时间：${clockOf(ev.resetsAt)}${ev.window === 'five' ? stageNote(ev.pct) : ''}`,
        ev.mark! >= 100 ? 'fire' : undefined,
        quotaGauge(`Claude ${name}`, 'claude', Math.min(was, ev.pct), ev.pct, ev.resetsAt)
      )
    } else {
      push('quota', `🔄 ${name}已重置，可以继续了${ev.window === 'five' ? '\n🌫 新的星云正在聚拢，一颗新恒星要诞生了' : ''}`, undefined, quotaGauge(`Claude ${name}`, 'claude', Math.max(was, 20), 0, null, true))
    }
  }
}

// ---------- Codex quota ----------

let lastCodexQuota: QuotaSnapshot | null = null

/** Codex limits as quota windows; announces changes and threshold crossings */
function syncCodexQuota(): void {
  const next = settings.value.codexEnabled ? codexQuota(codex.limits, Date.now(), codex.fileCount) : null
  if (JSON.stringify(next) === JSON.stringify(codexQ)) return
  codexQ = next
  broadcast('codex:quota', codexQ)
  // a Codex refresh may let queued Codex tasks start
  void tasks.tick()
  if (!next) return
  const pick = (key: string) => {
    const w = next.windows.find((x) => x.key === key)
    return w ? { pct: w.utilization, resetsAt: w.resetsAt ? Date.parse(w.resetsAt) : null } : null
  }
  const cur: QuotaSnapshot = { five: pick('codex_5h'), week: pick('codex_7d') }
  const prev = lastCodexQuota
  const events = quotaEvents(lastCodexQuota, cur)
  lastCodexQuota = cur
  for (const ev of events) {
    const key = `codex:${ev.key}`
    if (appState.quotaKeys.has(key)) continue
    appState.quotaKeys.add(key)
    appState.save()
    const name = ev.window === 'five' ? 'Codex 5 小时额度' : 'Codex 7 天额度'
    const was = (ev.window === 'five' ? prev?.five?.pct : prev?.week?.pct) ?? 0
    if (ev.kind === 'cross')
      push(
        'quota',
        `${ev.mark! >= 90 ? '🔴' : '🟠'} ${name}已用 <b>${Math.round(ev.pct)}%</b>\n重置时间：${clockOf(ev.resetsAt)}${ev.window === 'five' ? stageNote(ev.pct) : ''}`,
        ev.mark! >= 100 ? 'fire' : undefined,
        quotaGauge(name, 'codex', Math.min(was, ev.pct), ev.pct, ev.resetsAt)
      )
    else push('quota', `🔄 ${name}已重置`, undefined, quotaGauge(name, 'codex', Math.max(was, 20), 0, null, true))
  }
}

// ---------- updates from GitHub ----------

const updater = new Updater((url, init) => net.fetch(url, init as RequestInit), {
  current: app.getVersion(),
  kind: !app.isPackaged ? 'dev' : process.env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'installer',
  portable: process.env.PORTABLE_EXECUTABLE_FILE ?? null,
  dir: join(app.getPath('userData'), 'updates'),
  // a walkthrough can point the updater at a local stand-in for GitHub
  api: shotDir ? process.env.TP_UPDATE_API : undefined
})
let updateAnnounced = ''
updater.on('state', (s) => {
  broadcast('update:state', s)
  // finished downloading while TokenPulse was in the background
  if (s.status === 'ready' && s.latest && updateAnnounced !== s.latest.version && !mainWin?.isFocused()) {
    updateAnnounced = s.latest.version
    notify(`TokenPulse ${s.latest.version} 已下载`, '点侧边栏的「重启并更新」即可完成更新')
  }
})

/** each launch looks for a newer release; the main window then shows what's new and asks before downloading */
async function checkForUpdate(): Promise<void> {
  // walkthroughs only check against a local stand-in for GitHub
  if ((shotDir && !process.env.TP_UPDATE_API) || !settings.value.autoUpdate) return
  await updater.check()
}

/** reads Codex's limits from the account (every minute, and on demand) */
async function pollCodexUsage(): Promise<void> {
  const s = settings.value
  if (!s.codexEnabled || !s.codexUsageApi || shotDir) {
    codexUsage.idle()
    return
  }
  const l = await codexUsage.poll()
  if (!l) return
  codex.noteLimits(l)
  syncCodexQuota()
}
codexUsage.on('state', (st) => broadcast('codex:usage', st))

/** Tibo's reset posts: read every 10 minutes (every 3 while one is hinted at), news told once */
async function pollResets(force = false): Promise<void> {
  const s = settings.value
  if (!s.codexEnabled || !s.codexResetWatch || (shotDir && !process.env.TP_RESETS_API)) {
    resetWatch.idle()
    return
  }
  if (!force && !resetWatch.due()) return
  for (const n of await resetWatch.poll()) tellReset(n)
}
resetWatch.on('state', () => broadcast('codex:resets', codexResets()))

/** the tracker's state, with what each regular reset did to the user's own Codex week */
function codexResets(): CodexResets {
  const st = resetWatch.state
  if (!st.history.length || !codexCosted.length) return st
  const weeks = quotaCycles().find((c) => c.source === 'codex')?.seven ?? []
  const effects: CodexResets['effects'] = {}
  for (const p of st.history) {
    if (p.kind !== 'regular') continue
    const e = effectOf(p.at, weeks, codexQ?.updatedAt ?? null)
    if (e) effects[p.id] = e
  }
  return { ...st, effects }
}

const cut = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1)}…` : t)

function tellReset(n: ResetNews): void {
  if (!settings.value.codexResetNotify) return
  const quote = (t: string) => `\n<blockquote>${escapeHtml(cut(t, 400))}</blockquote>`
  const link = (url: string | null) => (url ? `\n<a href="${url}">在 X 上看 Tibo 的原帖</a>` : '')
  if (n.kind === 'reset') {
    const banked = n.post.kind === 'banked'
    const title = banked ? 'Tibo 往每个账户存了一次重置' : n.post.observed ? 'Codex 额度刚刚重置' : 'Tibo 宣布：Codex 额度已重置'
    const e = banked ? null : codexResets().effects?.[n.post.id]
    const mine = e?.before != null ? `\n你这周的 7 天额度重置前用到 <b>${Math.round(e.before)}%</b>` : ''
    notify(title, cut(n.post.text, 90))
    push('quota', `${banked ? '🏦' : '🎉'} <b>${title}</b>${quote(n.post.text)}${mine}${link(n.post.url)}`, banked ? undefined : 'party')
  } else if (n.kind === 'scheduled') {
    const due = n.post.due ? `，预计 ${clockOf(n.post.due)} 生效` : ''
    notify(`Tibo 宣布要重置 Codex 额度${due}`, cut(n.post.text, 90))
    push('quota', `📣 <b>Tibo 宣布要重置 Codex 额度</b>${due}${quote(n.post.text)}${link(n.post.url)}`)
  } else {
    const chance = n.hint.chance !== null ? `（可能性 ${n.hint.chance}%）` : ''
    notify(`Tibo 在暗示重置 Codex 额度${chance}`, cut(n.hint.text, 90))
    push('quota', `👀 <b>Tibo 在暗示重置 Codex 额度</b>${chance}${n.hint.window ? `\n时间：${escapeHtml(n.hint.window)}` : ''}${quote(n.hint.text)}${link(n.hint.url)}`)
  }
}

// ---------- pace and waste ----------

const HOUR_MS = 3600_000

/** Every quota window with a known reset, against an even pace */
function paces(now = Date.now()): Pace[] {
  const out: Pace[] = []
  const add = (entries: CostedEntry[], key: string, label: string, source: 'claude' | 'codex', w: { utilization: number; resetsAt: string | null } | null | undefined, hours: number) => {
    const reset = w?.resetsAt ? Date.parse(w.resetsAt) : NaN
    if (!w || !(reset > now)) return
    out.push(computePace(entries, { key, label, source, pct: w.utilization, resetsAt: reset, durationMs: hours * HOUR_MS }, now))
  }
  if (quota.info.status !== 'disabled') {
    add(claudeCosted, 'claude_5h', 'Claude 5 小时', 'claude', fiveHourWindow(quota.info.windows), 5)
    add(claudeCosted, 'claude_7d', 'Claude 7 天', 'claude', sevenDayWindow(quota.info.windows), 168)
  }
  if (codexQ) {
    add(codexCosted, 'codex_5h', 'Codex 5 小时', 'codex', codexQ.windows.find((w) => w.key === 'codex_5h'), 5)
    add(codexCosted, 'codex_7d', 'Codex 7 天', 'codex', codexQ.windows.find((w) => w.key === 'codex_7d'), 168)
  }
  return out
}

const untilText = (ms: number) => (ms >= HOUR_MS ? `${Math.floor(ms / HOUR_MS)} 小时 ${Math.round((ms % HOUR_MS) / 60_000)} 分钟` : `${Math.max(1, Math.round(ms / 60_000))} 分钟`)

/** A window about to reset with much of it unused: say so, and optionally start a queued refresh task */
async function checkWaste(): Promise<void> {
  const s = settings.value
  if (!s.wasteAlert || loading) return
  const now = Date.now()
  for (const p of paces(now)) {
    if (!wasteDue(p, now, wasteRule(p, s.wasteLeadMin))) continue
    const key = `waste:${p.key}:${p.end}`
    if (appState.quotaKeys.has(key)) continue
    appState.quotaKeys.add(key)
    appState.save()
    let started: string | null = null
    // the tool's own 5h window: start its first queued task, unless one of its tasks already runs
    const tool: UsageSource = p.key === 'codex_5h' ? 'codex' : 'claude'
    const mine = (t: (typeof tasks.tasks)[number]) => (t.tool ?? 'claude') === tool
    if (s.wasteRunTasks && (p.key === 'claude_5h' || p.key === 'codex_5h') && !taskBlocker(tool) && !tasks.tasks.some((t) => mine(t) && t.status === 'running')) {
      const next = tasks.tasks.filter((t) => mine(t) && t.status === 'queued').sort((a, b) => a.order - b.order)[0]
      if (next) {
        await tasks.action(next.id, 'start')
        started = next.prompt
      }
    }
    const unused = Math.round(p.unused)
    const left = untilText(p.end - now)
    const alert: WasteAlert = { key: p.key, label: p.label, source: p.source, unused, resetsAt: p.end, startedTask: started }
    broadcast('waste', alert)
    notify(`${p.label}额度快要浪费了`, started ? `还剩约 ${unused}%，${left}后刷新；已提前开始刷新任务「${taskTitle(started)}」` : `按现在的速度，${left}后刷新时还会剩下约 ${unused}%`)
    push(
      'quota',
      `⏳ <b>${escapeHtml(p.label)}额度快要浪费了</b>\n按现在的速度，${left}后刷新时还会剩下约 <b>${unused}%</b>${
        started ? `\n已提前开始刷新任务：${escapeHtml(taskTitle(started))}` : p.source === 'claude' ? '\n发送 /task 任务内容 可以马上排一个任务用掉它' : '\n发送 /task codex 任务内容 可以马上排一个 Codex 任务用掉它'
      }`
    )
  }
}

// ---------- watching ----------

/** file -> the Claude projects folder it belongs to, or '' for a Codex log */
const pending = new Map<string, string | null>()
let flushTimer: NodeJS.Timeout | null = null
let chain: Promise<void> = Promise.resolve()

function schedule(file: string, dir: string | null): void {
  pending.set(file, dir)
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    chain = chain.then(flush).catch(() => {})
  }, 300)
}

async function flush(): Promise<void> {
  const jobs = [...pending]
  pending.clear()
  const target = store
  const targetCodex = codex
  let addedTokens = 0
  let codexRead = false
  const keys = new Set<string>()
  for (const [file, dir] of jobs) {
    const added = dir === null ? ((codexRead = true), await targetCodex.readFile(file)) : await target.readFile(file, dir)
    for (const e of added) {
      keys.add(e.key)
      addedTokens += tokensOf(e)
    }
  }
  if (target !== store || targetCodex !== codex) return
  if (codexRead) syncCodexQuota()
  if (dataRev() === costedRev) return
  rebuild()
  const addedCost = costed.reduce((s, e) => (keys.has(e.key) ? s + e.cost.total : s), 0)
  afterDataChange({ addedTokens, addedCost, at: Date.now() })
}

function stopWatching(): void {
  watchers.forEach((w) => w.close())
  watchers = []
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}

function startWatching(): void {
  const folders: [string, boolean][] = [...dirs.map((d): [string, boolean] => [d, false]), ...codexFolders.map((d): [string, boolean] => [d, true])]
  for (const [d, isCodex] of folders) {
    try {
      watchers.push(
        watch(d, { recursive: true }, (_ev, name) => {
          if (name && String(name).endsWith('.jsonl')) schedule(join(d, String(name)), isCodex ? null : d)
        })
      )
    } catch {
      /* polling below still covers it */
    }
  }
  // safety net for missed events and new folders
  pollTimer = setInterval(async () => {
    for (const [f, d] of await store.changedFiles(dirs)) schedule(f, d)
    for (const f of await codex.changedFiles(codexFolders)) schedule(f, null)
  }, 15_000)
}

async function rescan(): Promise<void> {
  stopWatching()
  store = new UsageStore()
  codex = new CodexStore()
  if (settings.value.archiveEnabled) store.seed(archive.entries.values())
  dirs = projectsDirs(settings.value.extraDirs)
  codexFolders = settings.value.codexEnabled ? codexDirs() : []
  loading = true
  broadcast('load:state', loadState())
  const target = store
  const targetCodex = codex
  await target.scan(dirs)
  // Codex logs can run to a gigabyte; the head-only reader keeps this to seconds
  await targetCodex.scan(codexFolders)
  if (target !== store || targetCodex !== codex) return
  rebuild()
  loading = false
  syncCodexQuota()
  broadcast('load:state', loadState())
  afterDataChange({ addedTokens: 0, addedCost: 0, at: Date.now() })
  startWatching()
}

// ---------- budget ----------

function runBudgetCheck(): void {
  if (loading) return
  const before = firedAlerts.size
  pruneFired(firedAlerts, Date.now())
  const alerts = checkBudgets(live(), settings.value, firedAlerts)
  for (const a of alerts) {
    if (Notification.isSupported()) new Notification({ title: a.title, body: a.body, icon: iconPath('icon.png') }).show()
    push('budget', `💰 <b>${escapeHtml(a.title)}</b>\n${escapeHtml(a.body)}`)
  }
  if (alerts.length || firedAlerts.size !== before) appState.save()
}

// ---------- windows ----------

function iconPath(name: string): string {
  return app.isPackaged ? join(process.resourcesPath, 'resources', name) : join(app.getAppPath(), 'resources', name)
}

function themeColors(): typeof LIGHT {
  const t = settings.value.theme
  const dark = t === 'dark' || (t === 'system' && nativeTheme.shouldUseDarkColors)
  return dark ? DARK : LIGHT
}

/** The Windows 11 backdrop to draw behind the main window, if any */
function material(): 'mica' | 'acrylic' | null {
  const m = settings.value.windowMaterial
  return process.platform === 'win32' && (m === 'mica' || m === 'acrylic') ? m : null
}

/** the title-bar buttons' symbols, in the theme pack's text colour once the page has said what it is */
let titleSymbol: string | null = null

/**
 * Over a material the page is transparent so the backdrop shows through. The
 * title-bar buttons are always transparent: the page (and a theme pack's
 * scene) runs on under them instead of a solid block in the corner.
 */
function applyMainChrome(): void {
  if (!mainWin || mainWin.isDestroyed()) return
  const mat = material()
  const c = themeColors()
  mainWin.setBackgroundMaterial(mat ?? 'none')
  mainWin.setBackgroundColor(mat ? TRANSPARENT : c.bg)
  mainWin.setTitleBarOverlay({ color: TRANSPARENT, symbolColor: titleSymbol ?? c.fg, height: TITLEBAR_H })
}

function load(win: BrowserWindow, hash: string): void {
  const dev = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && dev) void win.loadURL(`${dev}#${hash}`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
}

const webPreferences: BrowserWindowConstructorOptions['webPreferences'] = {
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  sandbox: true
}

function showMain(): void {
  if (!mainWin || mainWin.isDestroyed()) createMain()
  if (mainWin!.isMinimized()) mainWin!.restore()
  mainWin!.show()
  mainWin!.focus()
}

function createMain(): void {
  const c = themeColors()
  const mat = material()
  mainWin = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'TokenPulse',
    backgroundColor: mat ? TRANSPARENT : c.bg,
    ...(mat ? { backgroundMaterial: mat } : {}),
    icon: iconPath('icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: TRANSPARENT, symbolColor: c.fg, height: TITLEBAR_H },
    webPreferences
  })
  mainWin.once('ready-to-show', () => mainWin?.show())
  mainWin.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      mainWin?.hide()
    }
  })
  load(mainWin, '/')
}

let moveTimer: NodeJS.Timeout | null = null
/** screen edge the floating window is docked to, and where it sits when shown */
let miniDock: Dock = null
let miniShown: { x: number; y: number } | null = null
let miniHidden = false
let miniAway = 0
let miniMenuOpen = false
/** true while the window is moved by code, so it is not mistaken for a drag */
let miniMoving = false
let miniAnim: NodeJS.Timeout | null = null
let edgeTimer: NodeJS.Timeout | null = null

const miniMargin = () => MINI_MARGIN * settings.value.miniScale
const workAreaOf = (b: Rect) => screen.getDisplayMatching(b).workArea

function createMini(): void {
  const s = settings.value
  const size = miniSize(s.miniMode, s.miniScale)
  const { x, y } = restorePosition(s.miniPosition, size, screen.getAllDisplays(), screen.getPrimaryDisplay(), miniMargin())
  miniWin = new BrowserWindow({
    ...size,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences
  })
  miniWin.setAlwaysOnTop(true, 'floating')
  miniWin.once('ready-to-show', () => {
    applyMiniFlags()
    miniWin?.showInactive()
  })
  miniWin.on('moved', onMiniMoved)
  // the panel is a drag region, so Windows treats a right click there as a title-bar click
  miniWin.on('system-context-menu', (e) => {
    e.preventDefault()
    popupMiniMenu()
  })
  miniWin.on('closed', () => {
    miniWin = null
    miniHidden = false
    miniZone.set(null)
    syncEdgeWatch()
  })
  const b = miniWin.getBounds()
  miniDock = snapToEdge(b, workAreaOf(b), miniMargin(), 2).dock
  miniShown = { x: b.x, y: b.y }
  syncEdgeWatch()
  load(miniWin, '/mini')
}

function applyMiniFlags(): void {
  if (!miniWin || miniWin.isDestroyed()) return
  miniWin.setOpacity(settings.value.miniOpacity)
  miniWin.setIgnoreMouseEvents(settings.value.miniClickThrough, { forward: true })
  miniZone.sync()
}

const miniDims = () => miniSize(settings.value.miniMode, settings.value.miniScale)

/** Saves where the floating window rests, with its display and the sides it keeps to */
function rememberMini(): void {
  if (!miniShown) return
  const b = { ...miniShown, ...miniDims() }
  void settings.update({ miniPosition: miniPlace(b, screen.getDisplayMatching(b)) })
}

/** Puts the floating window back at its saved sides after the screens changed (the saved place itself stays) */
function replaceMini(): void {
  if (!miniWin || miniWin.isDestroyed()) return
  const size = miniDims()
  const at = restorePosition(settings.value.miniPosition, size, screen.getAllDisplays(), screen.getPrimaryDisplay(), miniMargin())
  const b = { ...at, ...size }
  if (miniAnim) clearInterval(miniAnim)
  miniAnim = null
  miniMoving = true
  miniHidden = false
  miniWin.setBounds(b)
  setTimeout(() => (miniMoving = false), 120)
  miniShown = at
  miniDock = snapToEdge(b, workAreaOf(b), miniMargin(), 2).dock
  syncEdgeWatch()
}

/**
 * A click-through window that still takes the pointer over one part of it
 * (the floating window's buttons, the island's pill). The page reports that
 * part; the pointer is polled here, because a window that ignores the mouse
 * hears nothing of it: Electron's `forward` option delivered no moves on
 * Windows in a test with real mouse input.
 */
function hotZone(win: () => BrowserWindow | null, active: () => boolean) {
  let rect: Rect | null = null
  /** the window takes the pointer because it is over the part */
  let on = false
  let timer: NodeJS.Timeout | null = null
  const stop = () => {
    if (timer) clearInterval(timer)
    timer = null
    // hand the clicks back to what is underneath
    const w = win()
    if (on && w && active()) w.setIgnoreMouseEvents(true, { forward: true })
    on = false
  }
  const tick = () => {
    const w = win()
    if (!w || !rect || !active()) return stop()
    const b = w.getBounds()
    const inside = contains({ ...rect, x: b.x + rect.x, y: b.y + rect.y }, screen.getCursorScreenPoint(), 2)
    if (inside === on) return
    on = inside
    w.setIgnoreMouseEvents(!inside, { forward: true })
  }
  const run = () => {
    if (win() && rect && active()) timer ??= setInterval(tick, 80)
    else stop()
  }
  return {
    /** where the part is, in window coordinates (null = nowhere) */
    set(r: Rect | null) {
      rect = r && [r.x, r.y, r.width, r.height].every(Number.isFinite) ? r : null
      run()
    },
    /** after the window was set to ignore the mouse (or not) from outside */
    sync() {
      on = false
      run()
    },
    debug: () => ({ rect, on, polling: !!timer })
  }
}
const miniZone = hotZone(() => (miniWin && !miniWin.isDestroyed() ? miniWin : null), () => settings.value.miniClickThrough)
const islandZone = hotZone(() => (islandWin && !islandWin.isDestroyed() ? islandWin : null), () => true)

/**
 * Eases the floating window to a position. Moves use setBounds with the exact
 * size: setPosition alone lets a transparent window grow a pixel per move at
 * fractional display scaling.
 */
function slideMini(to: { x: number; y: number }, ms = 200): void {
  if (!miniWin || miniWin.isDestroyed()) return
  const [fx, fy] = miniWin.getPosition()
  const size = miniDims()
  const start = Date.now()
  if (miniAnim) clearInterval(miniAnim)
  miniMoving = true
  miniAnim = setInterval(() => {
    if (!miniWin || miniWin.isDestroyed()) {
      clearInterval(miniAnim!)
      miniAnim = null
      miniMoving = false
      return
    }
    const t = Math.min(1, (Date.now() - start) / ms)
    const e = 1 - Math.pow(1 - t, 3)
    miniWin.setBounds({ x: Math.round(fx + (to.x - fx) * e), y: Math.round(fy + (to.y - fy) * e), ...size })
    if (t >= 1) {
      clearInterval(miniAnim!)
      miniAnim = null
      setTimeout(() => (miniMoving = false), 60)
    }
  }, 16)
}

/** After a drag: snap to a nearby screen edge and remember where it rests */
function onMiniMoved(): void {
  if (miniMoving) return
  if (moveTimer) clearTimeout(moveTimer)
  moveTimer = setTimeout(() => {
    if (!miniWin || miniWin.isDestroyed() || miniMoving) return
    const b = { ...miniWin.getBounds(), ...miniDims() }
    const snap = snapToEdge(b, workAreaOf(b), miniMargin())
    miniDock = snap.dock
    miniHidden = false
    miniShown = { x: snap.x, y: snap.y }
    if (snap.x !== b.x || snap.y !== b.y) slideMini(snap, 140)
    rememberMini()
    syncEdgeWatch()
  }, 250)
}

/** Polls the pointer while a docked window may hide; works with click-through too */
function syncEdgeWatch(): void {
  const on = !!miniWin && settings.value.miniEdgeHide && !!miniDock
  if (on && !edgeTimer) edgeTimer = setInterval(edgeTick, 200)
  if (!on) {
    if (edgeTimer) clearInterval(edgeTimer)
    edgeTimer = null
    if (miniHidden && miniShown) {
      miniHidden = false
      slideMini(miniShown)
    }
  }
}

function edgeTick(): void {
  if (!miniWin || miniWin.isDestroyed() || !miniDock || !miniShown || miniMoving) return
  const inside = miniMenuOpen || contains(miniWin.getBounds(), screen.getCursorScreenPoint(), 2)
  if (inside) {
    miniAway = 0
    if (miniHidden) {
      miniHidden = false
      slideMini(miniShown)
    }
    return
  }
  if (miniHidden) return
  miniAway ||= Date.now()
  if (Date.now() - miniAway < 900) return
  const shown = { ...miniShown, ...miniDims() }
  miniHidden = true
  slideMini(hiddenPosition(shown, miniDock, workAreaOf(shown), miniMargin()), 260)
}

/** Resizes the floating window for its mode and scale, keeping it docked and on screen */
function layoutMini(): void {
  if (!miniWin || miniWin.isDestroyed()) return
  const size = miniDims()
  const at = miniShown ?? { x: miniWin.getBounds().x, y: miniWin.getBounds().y }
  const b: Rect = { ...at, ...size }
  const wa = workAreaOf(b)
  const m = miniMargin()
  if (miniDock) Object.assign(b, dockedPosition(b, miniDock, wa, m))
  b.x = Math.round(Math.min(Math.max(b.x, wa.x - m), wa.x + wa.width - b.width + m))
  b.y = Math.round(Math.min(Math.max(b.y, wa.y - m), wa.y + wa.height - b.height + m))
  miniMoving = true
  miniHidden = false
  miniWin.setBounds(b)
  setTimeout(() => (miniMoving = false), 120)
  miniShown = { x: b.x, y: b.y }
  rememberMini()
}

function miniMenuItems(): MenuItemConstructorOptions[] {
  const s = settings.value
  const radio = <K extends keyof Settings>(label: string, key: K, value: Settings[K]): MenuItemConstructorOptions => ({
    label,
    type: 'radio',
    checked: s[key] === value,
    click: () => void applySettings({ [key]: value } as Partial<Settings>)
  })
  return [
    { label: '显示模式', submenu: [radio('卡片', 'miniMode', 'card'), radio('胶囊', 'miniMode', 'capsule'), radio('水球', 'miniMode', 'orb')] },
    { label: '大小', submenu: MINI_SCALES.map(([v, l]) => radio(l, 'miniScale', v)) },
    { label: '不透明度', submenu: [1, 0.85, 0.7, 0.55, 0.4].map((v) => radio(`${Math.round(v * 100)}%`, 'miniOpacity', v)) },
    { label: '贴边自动隐藏', type: 'checkbox', checked: s.miniEdgeHide, click: (i) => void applySettings({ miniEdgeHide: i.checked }) },
    {
      label: '鼠标穿透（在托盘菜单关闭）',
      type: 'checkbox',
      checked: s.miniClickThrough,
      click: (i) => void applySettings({ miniClickThrough: i.checked })
    }
  ]
}

function popupMiniMenu(): void {
  if (!miniWin || miniWin.isDestroyed()) return
  miniMenuOpen = true
  Menu.buildFromTemplate([
    ...miniMenuItems(),
    { type: 'separator' },
    { label: '打开 TokenPulse', click: showMain },
    { label: '隐藏悬浮窗', click: () => void applySettings({ showMini: false }) }
  ]).popup({ window: miniWin, callback: () => (miniMenuOpen = false) })
}

function setMini(show: boolean): void {
  if (show && !miniWin) createMini()
  if (!show && miniWin) {
    miniWin.destroy()
    miniWin = null
  }
}

// ---------- big screen ----------

/** Full screen dashboard, on a display other than the main window's when there is one */
function openStage(): void {
  if (stageWin && !stageWin.isDestroyed()) return stageWin.focus()
  const mainDisplay = mainWin && !mainWin.isDestroyed() ? screen.getDisplayMatching(mainWin.getBounds()) : screen.getPrimaryDisplay()
  const target = screen.getAllDisplays().find((d) => d.id !== mainDisplay.id) ?? mainDisplay
  stageWin = new BrowserWindow({
    ...target.bounds,
    frame: false,
    show: false,
    title: 'TokenPulse 大屏',
    backgroundColor: themeColors().bg,
    icon: iconPath('icon.png'),
    autoHideMenuBar: true,
    webPreferences
  })
  stageWin.once('ready-to-show', () => {
    stageWin?.setFullScreen(true)
    stageWin?.show()
  })
  stageWin.on('closed', () => (stageWin = null))
  load(stageWin, '/stage')
}

function closeStage(): void {
  if (stageWin && !stageWin.isDestroyed()) stageWin.close()
}

// ---------- dynamic island ----------

const ISLAND = { width: 460, height: 250 }
/** top centre of the primary display */
function islandPosition(): { x: number; y: number } {
  const wa = screen.getPrimaryDisplay().workArea
  return { x: Math.round(wa.x + (wa.width - ISLAND.width) / 2), y: wa.y + 6 }
}

/** Screens added, removed or resized (a laptop plugged into a large monitor): the floating window and the island find their places again */
let displayTimer: NodeJS.Timeout | null = null
function onDisplaysChanged(): void {
  if (displayTimer) clearTimeout(displayTimer)
  displayTimer = setTimeout(() => {
    replaceMini()
    if (islandWin && !islandWin.isDestroyed()) islandWin.setBounds({ ...islandPosition(), ...ISLAND })
  }, 600)
}

/**
 * A capsule at the top centre of the primary display. The window is larger
 * than the capsule and lets clicks through until the capsule is hovered.
 */
function setIsland(on: boolean): void {
  if (!on) {
    if (islandWin && !islandWin.isDestroyed()) islandWin.destroy()
    islandWin = null
    return
  }
  if (islandWin && !islandWin.isDestroyed()) return
  const win = new BrowserWindow({
    ...ISLAND,
    ...islandPosition(),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    webPreferences
  })
  islandWin = win
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true, { forward: true })
  win.once('ready-to-show', () => win.showInactive())
  win.on('closed', () => {
    if (islandWin === win) islandWin = null
    islandZone.set(null)
  })
  load(win, '/island')
}

function popupIslandMenu(): void {
  if (!islandWin || islandWin.isDestroyed()) return
  const held = guard.state.manualHold
  Menu.buildFromTemplate([
    { label: '打开 TokenPulse', click: showMain },
    { label: held ? '恢复所有任务' : '暂停所有任务', click: () => void guard.setManualHold(!held) },
    { type: 'separator' },
    { label: '关闭灵动岛', click: () => void applySettings({ island: false }) }
  ]).popup({ window: islandWin })
}

// ---------- live wallpaper ----------

/** The backdrop behind the desktop icons of the primary display */
async function setWallpaper(on: boolean): Promise<void> {
  if (!on) {
    if (wallWin && !wallWin.isDestroyed()) {
      wallWin.destroy()
      wallWin = null
      await refreshDesktop()
    }
    return
  }
  if (process.platform !== 'win32' || (wallWin && !wallWin.isDestroyed())) return
  const d = screen.getPrimaryDisplay()
  const win = new BrowserWindow({
    ...d.bounds,
    frame: false,
    show: false,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    backgroundColor: themeColors().bg,
    // it is never "visible" to Chromium in the usual sense, so keep it animating
    webPreferences: { ...webPreferences, backgroundThrottling: false }
  })
  wallWin = win
  win.on('closed', () => {
    if (wallWin === win) wallWin = null
  })
  win.once('ready-to-show', async () => {
    const r = await attachToDesktop(hwndOf(win.getNativeWindowHandle()), screen.dipToScreenRect(null, d.bounds))
    if (shotDir) void appendFile(join(shotDir, 'devshot.log'), JSON.stringify({ wallpaper: r }) + '\n').catch(() => {})
    if (win.isDestroyed()) return
    if (!r.ok) {
      win.destroy()
      notify('动态壁纸未能启用', r.detail)
      return
    }
    win.showInactive()
  })
  load(win, '/wallpaper')
}

// ---------- global hotkey ----------

/** Registers the chosen hotkey, or the first free one after it when another app holds it */
function syncHotkey(): void {
  if (activeHotkey) globalShortcut.unregister(activeHotkey)
  activeHotkey = null
  if (!settings.value.globalHotkey) return
  const wanted = settings.value.hotkey
  for (const key of [wanted, ...HOTKEYS.filter((h) => h !== wanted)]) {
    if (globalShortcut.register(key, () => void applySettings({ showMini: !settings.value.showMini }))) {
      activeHotkey = key
      return
    }
  }
}

// ---------- tray ----------

let trayAngle = 0
let trayAnim: NodeJS.Timeout | null = null
let trayKey = ''
let taskKey = ''
let badge: Electron.NativeImage | null = null

function accentRGB(): [number, number, number] {
  const n = parseInt(accentHex(settings.value).slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** a response in the last two minutes */
const claudeWorking = () => claudeCosted.length > 0 && Date.now() - claudeCosted[claudeCosted.length - 1].ts < 120_000
const codexWorking = () => codexCosted.length > 0 && Date.now() - codexCosted[codexCosted.length - 1].ts < 120_000

/** the 5h window the tray and taskbar show: Codex's while only Codex is on view */
function trayFive(): { utilization: number } | undefined {
  return source() === 'codex' ? codexQ?.windows.find((w) => w.key === 'codex_5h') : fiveHourWindow(quota.info.windows)
}

let windowIcon = ''
/** The window and taskbar icon: TokenPulse's, or the Codex one while only Codex is on view */
function syncWindowIcon(): void {
  const want = source() === 'codex' ? 'codex' : 'claude'
  if (!mainWin || mainWin.isDestroyed() || want === windowIcon) return
  windowIcon = want
  const img = nativeImage.createFromPath(iconPath(want === 'codex' ? 'icon-codex.png' : 'icon.png'))
  if (!img.isEmpty()) mainWin.setIcon(img)
}

/**
 * The tray icon is a live 5h quota ring with the spark (Codex: a hexagon)
 * spinning while the tool works (pause bars while the guard holds a task);
 * the taskbar button shows the same quota as a green / yellow / red bar.
 */
function updateTrayIcon(): void {
  if (!tray) return
  syncWindowIcon()
  const five = trayFive()
  const pct = five ? five.utilization : null
  const paused = guard.state.paused.length > 0
  const glyph = source() === 'codex' ? 'codex' : 'spark'
  const key = `${pct === null ? '-' : Math.round(pct)}|${paused}|${trayAngle}|${accentHex(settings.value)}|${glyph}`
  if (key !== trayKey) {
    trayKey = key
    const img = nativeImage.createFromBitmap(trayBitmap(32, { pct, angle: trayAngle, paused, accent: accentRGB(), glyph }), { width: 32, height: 32, scaleFactor: 2 })
    if (!img.isEmpty()) tray.setImage(img)
  }
  const tk = `${pct === null ? '-' : Math.round(pct)}|${paused}`
  if (mainWin && !mainWin.isDestroyed() && tk !== taskKey) {
    taskKey = tk
    if (pct === null) mainWin.setProgressBar(-1)
    else mainWin.setProgressBar(Math.max(0.02, Math.min(1, pct / 100)), { mode: pct >= 90 ? 'error' : pct >= 75 ? 'paused' : 'normal' })
    badge ??= nativeImage.createFromBitmap(pauseBadge(32), { width: 32, height: 32, scaleFactor: 2 })
    mainWin.setOverlayIcon(paused ? badge : null, paused ? '额度守卫暂停中' : '')
  }
  const src = source()
  const spin = (src === 'codex' ? codexWorking() : src === 'all' ? claudeWorking() || codexWorking() : claudeWorking()) && !paused
  if (spin && !trayAnim) {
    trayAnim = setInterval(() => {
      trayAngle = (trayAngle + 15) % 360
      updateTrayIcon()
    }, 140)
  } else if (!spin && trayAnim) {
    clearInterval(trayAnim)
    trayAnim = null
  }
}

function refreshTray(): void {
  if (!tray) return
  updateTrayIcon()
  const l = live()
  const rate = computeRate(view(), Date.now())
  const src = source()
  const five = trayFive()
  const lines = [
    src === 'codex' ? 'TokenPulse · Codex' : src === 'claude' ? 'TokenPulse · Claude' : 'TokenPulse',
    `今日 ${fmtTokens(l.today.tokens)} tokens · ${fmtMoney(l.today.cost, settings.value)}`,
    `速率 ${fmtTokens(rate.tokensPerMin)}/分钟 · 输出 ${rate.outputPerSec.toFixed(1)} tok/s`
  ]
  if (five) lines.push(`${src === 'codex' ? 'Codex ' : ''}5h 额度 ${Math.round(five.utilization)}%`)
  if (guard.state.paused.length) lines.push(`⏸ 守卫已暂停 ${guard.state.paused.length} 个任务`)
  const running = tasks.tasks.filter((t) => t.status === 'running')
  if (running.length) lines.push(`▶ 任务 ${running.length} 个执行中 · 已做 ${running.reduce((a, t) => a + (t.steps ?? 0), 0)} 步`)
  // Windows caps tray tooltips at 127 characters
  tray.setToolTip(lines.join('\n').slice(0, 127))
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开 TokenPulse', click: showMain },
      ...(settings.value.codexEnabled && codex.fileCount > 0
        ? [
            {
              label: '查看',
              submenu: (
                [
                  ['claude', 'Claude'],
                  ['codex', 'Codex'],
                  ['all', '全部（一起看）']
                ] as const
              ).map(([value, label]): MenuItemConstructorOptions => ({
                label,
                type: 'radio',
                checked: source() === value,
                click: () => void applySettings({ sourceFilter: value })
              }))
            }
          ]
        : []),
      { label: '悬浮窗', type: 'checkbox', checked: settings.value.showMini, click: (i) => void applySettings({ showMini: i.checked }) },
      { label: '悬浮窗样式', submenu: miniMenuItems() },
      { label: '大屏模式', click: openStage },
      { label: '灵动岛', type: 'checkbox', checked: settings.value.island, click: (i) => void applySettings({ island: i.checked }) },
      {
        label: '暂停所有 Claude Code 任务',
        type: 'checkbox',
        checked: guard.state.manualHold,
        click: (i) => void guard.setManualHold(i.checked)
      },
      {
        label: '动态壁纸',
        type: 'checkbox',
        checked: settings.value.wallpaper,
        click: (i) => void applySettings({ wallpaper: i.checked })
      },
      {
        label: `额度守卫（${settings.value.guardPauseAt}% 暂停）`,
        type: 'checkbox',
        checked: settings.value.guardEnabled,
        click: (i) => void applySettings({ guardEnabled: i.checked })
      },
      { type: 'separator' },
      { label: '刷新定价', click: () => void pricing.refresh() },
      { label: '重新扫描日志', click: () => void rescan() },
      {
        label: '开机自启',
        type: 'checkbox',
        checked: settings.value.launchAtLogin,
        click: (i) => void applySettings({ launchAtLogin: i.checked })
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
}

function createTray(): void {
  const img = nativeImage.createFromPath(iconPath('tray.png'))
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img)
  tray.on('click', showMain)
  refreshTray()
}

// ---------- settings ----------

async function applySettings(patch: Partial<Settings>): Promise<Settings> {
  const { next, prev } = await settings.update(patch)
  if (next.launchAtLogin !== prev.launchAtLogin) syncLoginItem(next.launchAtLogin)
  if (next.showMini !== prev.showMini) setMini(next.showMini)
  if (
    next.quotaEnabled !== prev.quotaEnabled ||
    next.quotaSource !== prev.quotaSource ||
    next.local5hLimitUsd !== prev.local5hLimitUsd ||
    next.guardEnabled !== prev.guardEnabled ||
    next.guardPauseAt !== prev.guardPauseAt
  ) {
    quota.configure(quotaConfig())
  }
  if (
    next.guardEnabled !== prev.guardEnabled ||
    next.guardPauseAt !== prev.guardPauseAt ||
    JSON.stringify(guardExtra(next)) !== JSON.stringify(guardExtra(prev))
  ) {
    await guard.configure(next.guardEnabled, next.guardPauseAt, guardExtra(next))
    void guard.publishQuota(quota.info)
  }
  if (next.globalHotkey !== prev.globalHotkey || next.hotkey !== prev.hotkey) syncHotkey()
  if (next.island !== prev.island) setIsland(next.island)
  if (
    next.telegramEnabled !== prev.telegramEnabled ||
    next.telegramToken !== prev.telegramToken ||
    next.telegramChatId !== prev.telegramChatId ||
    next.telegramCommands !== prev.telegramCommands ||
    next.telegramKeyboard !== prev.telegramKeyboard
  ) {
    syncBot()
  } else if (next.telegramBoard !== prev.telegramBoard) void syncBoard(true)
  if (!next.runawayDetect && prev.runawayDetect && runaways.length) {
    runaways = []
    broadcast('runaway:update', runaways)
  }
  if (next.wallpaper !== prev.wallpaper) void setWallpaper(next.wallpaper)
  if (next.archiveEnabled !== prev.archiveEnabled) void rescan()
  if (next.theme !== prev.theme || next.windowMaterial !== prev.windowMaterial) applyMainChrome()
  if (next.miniMode !== prev.miniMode || next.miniScale !== prev.miniScale) layoutMini()
  if (next.miniOpacity !== prev.miniOpacity || next.miniClickThrough !== prev.miniClickThrough) applyMiniFlags()
  if (next.miniEdgeHide !== prev.miniEdgeHide) syncEdgeWatch()
  if (next.themePack !== prev.themePack) {
    appState.tryPack(next.themePack)
    checkAchievements()
  }
  if (next.dayNight && (!prev.dayNight || next.dayPack !== prev.dayPack || next.nightPack !== prev.nightPack || JSON.stringify(next.skyPlace) !== JSON.stringify(prev.skyPlace))) {
    setTimeout(() => checkDayNight(true), 0)
  }
  if (JSON.stringify(next.extraDirs) !== JSON.stringify(prev.extraDirs) || next.codexEnabled !== prev.codexEnabled) void rescan()
  if (next.codexEnabled !== prev.codexEnabled || next.codexUsageApi !== prev.codexUsageApi) void pollCodexUsage()
  if (next.codexEnabled !== prev.codexEnabled || next.codexResetWatch !== prev.codexResetWatch) void pollResets(true)
  if (next.autoUpdate && !prev.autoUpdate) void checkForUpdate()
  // Codex switched off while it was the only thing on view
  if (!next.codexEnabled && next.sourceFilter === 'codex') return applySettings({ sourceFilter: 'all' })
  if (next.dailyBudget !== prev.dailyBudget || next.monthlyBudget !== prev.monthlyBudget || next.sourceFilter !== prev.sourceFilter) {
    afterDataChange({ addedTokens: 0, addedCost: 0, at: Date.now() })
  } else refreshTray()
  return next
}

// ---------- ipc ----------

function registerIpc(): void {
  ipcMain.handle('summary', (_e, range: RangeKey) =>
    computeSummary(view(), RANGES.includes(range) ? range : 'today', Date.now(), modelLabel)
  )
  ipcMain.handle('ranges', () => computeRanges(view(), Date.now(), archive.entries.size))
  ipcMain.handle('rate', () => computeRate(view(), Date.now()))
  ipcMain.handle('guard:get', () => guard.state)
  ipcMain.handle('guard:bridge', (_e, on: boolean) => guard.setBridge(!!on))
  ipcMain.handle('live', () => live())
  ipcMain.handle('sessions', () => {
    const rows = computeSessions(view(), store.reportedCost, modelLabel)
    // each session's own window and line, from the model of its latest request
    const lastModel = new Map<string, { model: string; source: UsageSource }>()
    for (const e of view()) if (!e.side) lastModel.set(e.sessionId, { model: e.model, source: e.source ?? 'claude' })
    return rows.map((r) => {
      const m = lastModel.get(r.sessionId)
      return m ? { ...r, ...warnFor(m.model, m.source) } : r
    })
  })
  ipcMain.handle('pricing:get', () => pricing.info(models()))
  ipcMain.handle('pricing:refresh', async () => {
    await pricing.refresh()
    return pricing.info(models())
  })
  ipcMain.handle('quota:get', () => quota.info)
  ipcMain.handle('quota:refresh', () => {
    void pollCodexUsage()
    return quota.refresh()
  })
  ipcMain.handle('codex:usage-state', () => codexUsage.state)
  ipcMain.handle('update:state', () => updater.state)
  ipcMain.handle('update:check', () => updater.check())
  ipcMain.handle('update:download', () => updater.download())
  ipcMain.handle('update:install', async () => {
    if (!(await updater.install())) return false
    quitting = true
    app.quit()
    return true
  })
  // links in release notes open in the browser
  ipcMain.handle('open:external', (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) void shell.openExternal(url)
  })
  ipcMain.handle('codex:sign-in', async () => {
    const r = await codexUsage.signIn((url) => void shell.openExternal(url))
    if (r.ok) await pollCodexUsage()
    return r
  })
  ipcMain.handle('codex:sign-out', async () => {
    await codexUsage.signOut()
    await pollCodexUsage()
  })
  ipcMain.handle('codex:usage-refresh', async () => {
    await pollCodexUsage()
    return codexUsage.state
  })
  ipcMain.handle('codex:resets', () => codexResets())
  ipcMain.handle('codex:resets-refresh', async () => {
    await pollResets(true)
    return codexResets()
  })
  ipcMain.handle('settings:get', () => settings.value)
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => applySettings(patch))
  ipcMain.handle('load:get', () => loadState())
  ipcMain.on('main:show', showMain)
  ipcMain.on('mini:toggle', (_e, show?: boolean) => void applySettings({ showMini: show ?? !settings.value.showMini }))
  ipcMain.on('mini:menu', popupMiniMenu)
  ipcMain.on('hotspot', (e, r: Rect | null) => {
    const from = BrowserWindow.fromWebContents(e.sender)
    if (from && from === miniWin) miniZone.set(r)
    else if (from && from === islandWin) islandZone.set(r)
  })
  ipcMain.handle('value', (_e, src?: SourceView) => valueFor(src === 'claude' || src === 'codex' || src === 'all' ? src : source()))
  ipcMain.handle('forecast', (_e, src?: UsageSource) => {
    const pick = (w: { utilization: number; resetsAt: string | null } | undefined) => (w ? { pct: w.utilization, resetsAt: w.resetsAt ? Date.parse(w.resetsAt) : null } : null)
    if ((src ?? (source() === 'codex' ? 'codex' : 'claude')) === 'codex') return forecastWeekly(codexCosted, pick(codexQ?.windows.find((w) => w.key === 'codex_7d')), Date.now())
    return forecastWeekly(claudeCosted, pick(sevenDayWindow(quota.info.windows)), Date.now())
  })
  ipcMain.handle('sign', () => codingSign(view(), Date.now()))
  ipcMain.handle('patterns', (_e, range: RangeKey) => computePatterns(view(), RANGES.includes(range) ? range : 'today', Date.now(), modelLabel))
  ipcMain.handle('cosmos', () => cosmos())
  ipcMain.handle('race', (_e, kind: string) => raceSeries(view(), kind === 'month' ? 'month' : 'week', Date.now()))
  ipcMain.handle('starmap', (_e, days: number) => starMap(view(), prompts(), [7, 30, 90].includes(days) ? days : 30, Date.now(), modelLabel))
  ipcMain.handle('quota:cycles', () => quotaCycles())
  ipcMain.handle('quota:rates', (_e, days: number) => quotaRates(Math.max(1, Math.min(30, Math.round(Number(days) || 7)))))
  ipcMain.on('counter:bump', (_e, name: string) => {
    if (name !== 'palette') return
    appState.bump('palette')
    checkAchievements()
  })
  ipcMain.handle('achievements', () => {
    if (!achievements.length) checkAchievements()
    return achievements
  })
  ipcMain.handle('poster:save', async (e, dataUrl: string, name: string) => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) return null
    const win = BrowserWindow.fromWebContents(e.sender)
    const file = `${String(name || 'TokenPulse').replace(/[\\/:*?"<>|]/g, '_')}.png`
    const opts = { defaultPath: join(app.getPath('pictures'), file), filters: [{ name: 'PNG 图片', extensions: ['png'] }] }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    await writeFile(r.filePath, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'))
    return r.filePath
  })
  ipcMain.handle('poster:copy', async (_e, dataUrl: string) => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) return
    const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })])
  })
  ipcMain.handle('telegram:test', () =>
    telegram.send(settings.value.telegramToken, settings.value.telegramChatId, {
      text: '<b>TokenPulse</b>\n✅ 测试消息：推送已连通，守卫暂停、额度提醒等通知会发到这里',
      effect: fx('party')
    })
  )
  // getUpdates allows one reader: while the bot listens it already saw the chat
  ipcMain.handle('telegram:detect', async (_e, token: string) => {
    const t = String(token ?? '').trim()
    if (bot.running && t === settings.value.telegramToken) {
      if (bot.lastChat) return { ok: true, chatId: bot.lastChat.id, name: bot.lastChat.name }
      return { ok: false, error: '遥控正在监听：先在 Telegram 里给机器人发一条任意消息，再点一次' }
    }
    const wasRunning = bot.running
    bot.stop()
    const r = await telegram.detectChat(t)
    if (wasRunning) syncBot()
    return r
  })
  ipcMain.handle('hotkey:status', () => ({ wanted: settings.value.hotkey, active: activeHotkey }))
  ipcMain.on('stage:open', openStage)
  ipcMain.on('stage:close', closeStage)
  ipcMain.handle('guard:manual', (_e, on: boolean) => guard.setManualHold(!!on))
  ipcMain.handle('guard:hold', async (_e, id: string) => {
    runaways = runaways.map((r) => (r.sessionId === id ? { ...r, held: true } : r))
    broadcast('runaway:update', runaways)
    return guard.holdSession(String(id))
  })
  ipcMain.handle('guard:release', async (_e, id?: string) => {
    runaways = runaways.map((r) => (!id || r.sessionId === id ? { ...r, held: false } : r))
    broadcast('runaway:update', runaways)
    return guard.releaseSessions(id ? String(id) : undefined)
  })
  ipcMain.handle('runaway:get', () => runaways)
  ipcMain.on('runaway:dismiss', (_e, id: string) => {
    dismissed.set(id, Date.now() + 60 * 60_000)
    runaways = runaways.filter((r) => r.sessionId !== id)
    void guard.releaseSessions(id)
    broadcast('runaway:update', runaways)
  })
  ipcMain.on('island:interactive', (_e, on: boolean) => {
    if (islandWin && !islandWin.isDestroyed()) islandWin.setIgnoreMouseEvents(!on, { forward: true })
  })
  ipcMain.on('island:menu', popupIslandMenu)
  ipcMain.handle('codex:quota', () => codexQ)
  ipcMain.handle('pace', () => {
    const on = sources()
    return paces().filter((p) => on.includes(p.source))
  })
  ipcMain.handle('cache:report', (_e, range: RangeKey) => {
    const r = RANGES.includes(range) ? range : 'today'
    const now = Date.now()
    const entries = view()
    const b = rangeBounds(r, now, entries[0]?.ts ?? null)
    const price = (model: string) => pricing.resolve(model)?.row ?? null
    return diagnoseCache(entries, r, source(), b.start, Math.min(b.end, now + 1), price, money)
  })
  ipcMain.handle('prompts', (_e, range: RangeKey) => {
    const r = RANGES.includes(range) ? range : 'today'
    const now = Date.now()
    const entries = view()
    const b = rangeBounds(r, now, entries[0]?.ts ?? null)
    return promptReport(entries, prompts(), r, b.start, Math.min(b.end, now + 1), modelLabel)
  })
  ipcMain.handle('session:dialogue', async (_e, id: string) => {
    const sid = String(id)
    const cx = codex.fileOf(sid)
    if (cx) return codexDialogue(cx, sid)
    const files = store.filesOf(sid)
    return files.length ? claudeDialogue(files, sid) : null
  })
  ipcMain.handle('session:context', (_e, id: string) => {
    const list = costed.filter((e) => e.sessionId === String(id))
    const base = sessionContext(list, warnFor)
    if (!base) return null
    const { list: asked } = costByPrompt(list, prompts(), 0, Infinity, modelLabel)
    return { ...base, prompts: asked.sort((a, b) => a.ts - b.ts) }
  })
  ipcMain.handle('context:alerts', () => contextList())
  ipcMain.handle('windows:history', (_e, days: number) => {
    const d = Math.max(1, Math.min(30, Math.round(Number(days) || 7)))
    const now = Date.now()
    const on = sources()
    const limit = settings.value.local5hLimitUsd ?? quota.calibratedLimit
    const est = limit && on.includes('claude') ? estimateClaudeWindows(claudeCosted, limit, now - d * 86_400_000, now) : []
    return buildHistory({ days: d, now, sources: on, claude: windowLog.windows, claudeEstimated: est, codex: codex.windows })
  })
  ipcMain.handle('tasks:get', () => tasks.state())
  ipcMain.handle('tasks:add', (_e, input) => {
    if (!input || typeof input.prompt !== 'string' || !input.prompt.trim()) throw new Error('任务内容不能为空')
    // the folder typed into the form becomes the default (a follow-up keeps its task's)
    if (input.cwd && !input.followOf) void settings.update({ taskCwd: String(input.cwd) })
    return tasks.add(input)
  })
  ipcMain.handle('tasks:action', async (_e, id: string, action) => {
    await tasks.action(String(id), action)
    return tasks.state()
  })
  ipcMain.handle('tasks:move', (_e, id: string, target: string | null, how) => {
    if (['before', 'after', 'child', 'root'].includes(how)) tasks.move(String(id), target ? String(target) : null, how)
    return tasks.state()
  })
  ipcMain.handle('tasks:update', (_e, id: string, patch, then) => {
    if (patch && typeof patch === 'object') tasks.update(String(id), patch, then === 'now' || then === 'reset' ? then : 'keep')
    return tasks.state()
  })
  ipcMain.handle('tasks:clear', (_e, tool) => {
    tasks.clearHistory(tool === 'claude' || tool === 'codex' ? tool : 'all')
    return tasks.state()
  })
  ipcMain.handle('tasks:log', (_e, id: string) => tasks.log(String(id)))
  ipcMain.handle('dialog:folder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { properties: ['openDirectory' as const], defaultPath: settings.value.taskCwd || homedir() }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
  ipcMain.handle('report:send', () => sendReport())
  ipcMain.handle('display:hz', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const hz = win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()).displayFrequency : 0
    return Number.isFinite(hz) && hz > 0 ? hz : 0
  })
  // what the page shows under the title-bar buttons, read from the real pixels (CSS gradients and cards included)
  ipcMain.handle('tarot', () => readDeck())
  ipcMain.handle('overview:calendar', () => calendarDays(view(), Date.now(), modelLabel))
  ipcMain.handle('overview:timeline', () => todaySessions(view(), Date.now(), modelLabel))
  ipcMain.handle('overview:models', (_e, range: RangeKey) => {
    const now = Date.now()
    const r = RANGES.includes(range) ? range : 'today'
    const b = rangeBounds(r, now, view()[0]?.ts ?? null)
    return modelRows(view(), b.start, b.end, modelLabel, costByPrompt(view(), prompts(), b.start, b.end, modelLabel).list)
  })
  ipcMain.handle('overview:actions', (_e, range: RangeKey) => {
    const r = RANGES.includes(range) ? range : 'today'
    const b = rangeBounds(r, Date.now(), view()[0]?.ts ?? null)
    const asked = promptMarks().filter((p) => p.ts >= b.start && p.ts < b.end).length
    return actionStats(actionList(), b.start, b.end, asked)
  })
  ipcMain.handle('overview:records', () => {
    const now = Date.now()
    return personalRecords(view(), promptMarks(), costByPrompt(view(), prompts(), 0, now + 1, modelLabel).list, actionList(), now)
  })
  ipcMain.handle('titlebar:sample', async (e): Promise<TitleCorner | null> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win || win !== mainWin || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return null
    const [w] = win.getContentSize()
    const width = Math.min(150, w)
    const img = await win.webContents.capturePage({ x: w - width, y: 0, width, height: TITLEBAR_H }).catch(() => null)
    if (!img || img.isEmpty()) return null
    const bmp = img.toBitmap()
    const px: { l: number; c: number[] }[] = []
    let total = 0
    for (let i = 0; i + 3 < bmp.length; i += 4) {
      total++
      if (bmp[i + 3] < 128) continue
      const c = [bmp[i + 2], bmp[i + 1], bmp[i]]
      px.push({ l: 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], c })
    }
    if (!px.length) return { avg: [0, 0, 0], lo: [0, 0, 0], hi: [0, 0, 0], opaque: 0 }
    px.sort((a, b) => a.l - b.l)
    const mean = (list: typeof px) => [0, 1, 2].map((k) => list.reduce((s, p) => s + p.c[k], 0) / list.length)
    const tenth = Math.max(1, Math.round(px.length / 10))
    return { avg: mean(px), lo: mean(px.slice(0, tenth)), hi: mean(px.slice(-tenth)), opaque: px.length / total }
  })
  ipcMain.on('theme:colors', (e, c: { bg: string; fg: string }) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win && win === mainWin && /^#[0-9a-f]{6}$/i.test(c?.bg) && /^#[0-9a-f]{6}$/i.test(c?.fg)) {
      titleSymbol = c.fg
      win.setTitleBarOverlay({ color: TRANSPARENT, symbolColor: c.fg, height: TITLEBAR_H })
      win.setBackgroundColor(material() ? TRANSPARENT : c.bg)
    }
  })
}

// ---------- lifecycle ----------

pricing.on('change', () => {
  rebuild()
  broadcast('pricing:update', pricing.info(models()))
  afterDataChange({ addedTokens: 0, addedCost: 0, at: Date.now() })
})
quota.on('change', (q: QuotaInfo) => {
  // official readings build the history of 5h windows
  const five = fiveHourWindow(q.windows)
  if (five?.resetsAt && q.origin !== 'local' && (q.status === 'ok' || q.status === 'expired' || q.status === 'error')) {
    windowLog.record(five.utilization, Date.parse(five.resetsAt), Math.min(Date.now(), q.fetchedAt ?? Date.now()))
  }
  const seven = sevenDayWindow(q.windows)
  if (seven?.resetsAt && q.origin !== 'local' && q.status === 'ok') windowLog.recordWeek(seven.utilization, Date.parse(seven.resetsAt), Math.min(Date.now(), q.fetchedAt ?? Date.now()))
  broadcast('quota:update', q)
  void guard.publishQuota(q)
  onQuotaReading(q)
  refreshTray()
  void tasks.tick()
  void checkWaste()
})
settings.on('change', (s) => broadcast('settings:update', s))

const clock = (t: number | null) => (t ? new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '额度重置')
function notify(title: string, body: string): void {
  if (Notification.isSupported()) new Notification({ title, body, icon: iconPath('icon.png') }).show()
}
guard.on('change', (g) => {
  broadcast('guard:update', g)
  refreshTray()
})
guard.on('paused', (p: PausedTask[]) => {
  const until = p.find((x) => x.until)?.until ?? null
  const pct = Math.round(Math.max(...p.map((x) => x.pct)))
  const why = p.every((x) => x.reason === 'manual')
    ? '手动 / 远程暂停'
    : p.some((x) => x.reason === 'week')
      ? `7 天额度达到 ${pct}%`
      : p.every((x) => x.reason === 'window')
        ? '等待设定的续跑时段'
        : `5 小时额度达到 ${pct}%`
  notify(`已暂停 ${p.length} 个 Claude Code 任务`, until ? `${why}，将在 ${clock(until)} 后自动继续` : `${why}，恢复后继续`)
  push('guard', `⏸ 已暂停 <b>${p.length}</b> 个任务\n${why}\n${until ? `预计 ${clockOf(until)} 自动继续` : '回复 /resume 继续'}`)
  appState.recordGuardPause(Date.now())
  checkAchievements()
})
guard.on('resumed', () => {
  notify('额度已重置，任务继续', 'Claude Code 任务已自动恢复运行')
  push('guard', '▶️ 额度已重置，Claude Code 任务已自动继续')
})

/**
 * Start with Windows. The portable build runs from a temporary copy that
 * changes every launch, so it registers the portable exe itself.
 */
function syncLoginItem(on: boolean): void {
  if (!app.isPackaged || shotDir) return
  const portable = process.env.PORTABLE_EXECUTABLE_FILE
  app.setLoginItemSettings({ openAtLogin: on, ...(portable ? { path: portable } : {}) })
}

app.on('second-instance', showMain)
app.on('before-quit', () => (quitting = true))
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  tasks.stopAll()
  appState.flush()
  windowLog.flush()
  if (wallWin && !wallWin.isDestroyed()) {
    wallWin.destroy()
    void refreshDesktop()
  }
})
app.on('window-all-closed', () => {
  /* keep running in the tray */
})

void app.whenReady().then(async () => {
  if (!primary) return
  await Promise.all([settings.load(), pricing.loadCache(), appState.load(), archive.load(), quota.loadCalibration(), tasks.load(), windowLog.load()])
  registerIpc()
  createMain()
  // every launch asks GitHub for a newer release while the logs are scanned
  void checkForUpdate()
  createTray()
  if (settings.value.showMini) createMini()
  screen.on('display-added', onDisplaysChanged)
  screen.on('display-removed', onDisplaysChanged)
  screen.on('display-metrics-changed', onDisplaysChanged)
  syncHotkey()
  syncBot()
  // a new portable version lives at a new path: keep auto-start pointing at the one running now
  if (settings.value.launchAtLogin) syncLoginItem(true)
  if (settings.value.island) setIsland(true)
  if (settings.value.wallpaper) void setWallpaper(true)
  await guard.init(settings.value.guardEnabled, settings.value.guardPauseAt, guardExtra())
  quota.configure(quotaConfig())
  // the statusline bridge rewrites its file after every Claude response
  setInterval(() => void quota.checkStatusline(), 5_000)
  await rescan()
  void pollCodexUsage()
  void pollResets()
  if (pricing.isStale) void pricing.refresh()
  setInterval(() => pricing.isStale && void pricing.refresh(), 3600_000)
  // date rollover, burn-rate decay and tray text
  setInterval(() => {
    refreshTray()
    runBudgetCheck()
    checkReport()
    void syncBoard()
    void pollCodexUsage()
    void pollResets()
    checkRunaway()
    // a Codex window that reset while Codex was idle rolls over to 0%
    syncCodexQuota()
    void checkWaste()
    checkDayNight()
  }, 60_000)
  checkDayNight()
  // refresh tasks start within ~20 s of their time
  setInterval(() => void tasks.tick(), 20_000)
  if (process.env.TP_SCREENSHOT && mainWin) {
    // the walkthrough runs tasks with a stand-in instead of the real claude
    ;(globalThis as { __tpTasks?: TaskService }).__tpTasks = tasks
    ;(globalThis as { __tpMini?: () => BrowserWindow | null }).__tpMini = () => (miniWin && !miniWin.isDestroyed() ? miniWin : null)
    ;(globalThis as { __tpMiniHot?: () => unknown }).__tpMiniHot = () => ({ ...miniZone.debug(), through: settings.value.miniClickThrough, island: islandZone.debug() })
    ;(globalThis as { __tpTelegram?: unknown }).__tpTelegram = { onCommand, cardPhoto, cardAnimation, gauge: (g: GaugeAlert) => svgsToMp4(gaugeFrames(g, 20), GAUGE_W, GAUGE_H, 20) }
    ;(globalThis as { __tpUpdater?: Updater }).__tpUpdater = updater
    const { runDevShots } = await import('./devshot')
    if (!miniWin) createMini()
    void runDevShots(process.env.TP_SCREENSHOT, mainWin, miniWin, () => {
      quitting = true
      app.quit()
    })
  }
})
