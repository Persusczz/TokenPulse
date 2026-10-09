import { EventEmitter } from 'node:events'
import { copyFile, readFile } from 'node:fs/promises'
import { ACCENT_KEYS } from '@shared/accents'
import { cleanCompactAt } from '@shared/compact'
import { HOTKEYS } from '@shared/hotkeys'
import type { BackdropStyle, MiniMode, MotionLevel, Settings, ThemePack, WindowMaterial } from '@shared/types'
import { writeFileAtomic } from './atomicFile'

const MOTIONS: MotionLevel[] = ['off', 'subtle', 'standard', 'rich']
const BACKDROPS: BackdropStyle[] = [
  'plain',
  'galaxy',
  'flow',
  'stars',
  'aurora',
  'ripples',
  'paper',
  'neon',
  'borealis',
  'ink',
  'abyss',
  'claude',
  'codex',
  'sakura',
  'dune',
  'astral',
  'orrery',
  'lunar',
  'eclipse',
  'trails',
  'rain',
  'firefly',
  'lava',
  'crystal',
  'matrix',
  'fireworks',
  'lantern',
  'bauhaus',
  'daylight',
  'mystic',
  'cyber',
  'xianxia',
  'koi',
  'ukiyo',
  'pixel'
]
const PACKS: ThemePack[] = [
  'none',
  'claude',
  'codex',
  'astral',
  'orrery',
  'lunar',
  'eclipse',
  'trails',
  'rain',
  'firefly',
  'lava',
  'crystal',
  'matrix',
  'fireworks',
  'lantern',
  'bauhaus',
  'sakura',
  'dune',
  'paper',
  'neon',
  'borealis',
  'ink',
  'abyss',
  'daylight',
  'mystic',
  'cyber',
  'xianxia',
  'koi',
  'ukiyo',
  'pixel'
]
const PERMISSIONS = ['inherit', 'auto', 'acceptEdits', 'bypassPermissions', 'plan'] as const
/** context warning lines offered, thousand tokens */
export const CONTEXT_STEPS = [80, 120, 160, 250, 400]
const MATERIALS: WindowMaterial[] = ['none', 'mica', 'acrylic']
const MINI_MODES: MiniMode[] = ['card', 'capsule', 'orb']

export const DEFAULT_SETTINGS: Settings = {
  dailyBudget: null,
  monthlyBudget: null,
  currency: 'USD',
  cnyRate: 7.1,
  quotaEnabled: true,
  extraDirs: [],
  launchAtLogin: false,
  showMini: false,
  miniPosition: null,
  theme: 'system',
  quotaSource: 'auto',
  local5hLimitUsd: null,
  guardEnabled: false,
  guardPauseAt: 90,
  archiveEnabled: true,
  motion: 'standard',
  frameCap: 'auto',
  fpsMeter: false,
  accent: 'clay',
  backdrop: 'flow',
  adaptiveBackdrop: true,
  backdropVivid: 0.7,
  glassCards: true,
  lightFx: true,
  windowMaterial: 'none',
  miniMode: 'card',
  miniOpacity: 1,
  miniScale: 1,
  miniClickThrough: false,
  miniEdgeHide: false,
  sound: false,
  soundVolume: 0.5,
  planPrice: null,
  telegramEnabled: false,
  telegramToken: '',
  telegramChatId: '',
  pushGuard: true,
  pushQuota: true,
  pushBudget: true,
  pushAchievement: true,
  pushRunaway: true,
  telegramCommands: true,
  telegramKeyboard: 'fold',
  telegramEffects: true,
  telegramAnimations: true,
  telegramCardReport: true,
  telegramBoard: false,
  telegramQuietFrom: null,
  telegramQuietTo: null,
  reportTime: '22:00',
  runawayDetect: true,
  runawaySensitivity: 'medium',
  runawayAction: 'notify',
  island: false,
  taskQueuePaused: false,
  taskPermission: 'inherit',
  taskModel: null,
  taskCwd: '',
  taskContinue: true,
  taskAutoCompact: true,
  taskCompactAt: null,
  taskTerminal: true,
  taskRetries: 1,
  taskTimeoutMin: null,
  codexTaskPermission: 'inherit',
  codexTaskModel: null,
  pushTasks: true,
  codexEnabled: true,
  workbuddyEnabled: true,
  workbuddyDirs: [],
  workbuddyHarnessEnabled: true,
  workbuddyHarnessProviders: [],
  workbuddyHarnessAuto: true,
  workbuddyCli: '',
  codexUsageApi: true,
  codexResetWatch: true,
  codexResetNotify: true,
  codexResetLang: 'zh-CN',
  autoUpdate: true,
  sourceFilter: 'all',
  themePack: 'none',
  contextAlert: true,
  contextAuto: true,
  contextWarnK: 120,
  wasteAlert: true,
  wasteLeadMin: 30,
  wasteRunTasks: false,
  guardWeeklyAt: null,
  guardResumeFrom: null,
  guardResumeTo: null,
  globalHotkey: true,
  hotkey: 'Control+Alt+T',
  wallpaper: false,
  skyPlace: null,
  dayNight: false,
  dayPack: 'none',
  nightPack: 'astral'
}

const posNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)
/** "HH:MM" (24 h), else null */
const hhmm = (v: unknown): string | null => {
  const m = typeof v === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(v.trim()) : null
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null
  return `${m[1].padStart(2, '0')}:${m[2]}`
}
const BOOLS = [
  'telegramEnabled',
  'pushGuard',
  'pushQuota',
  'pushBudget',
  'pushAchievement',
  'pushRunaway',
  'telegramCommands',
  'telegramEffects',
  'telegramAnimations',
  'telegramCardReport',
  'telegramBoard',
  'runawayDetect',
  'island',
  'taskQueuePaused',
  'pushTasks',
  'taskContinue',
  'taskAutoCompact',
  'taskTerminal',
  'codexEnabled',
  'workbuddyEnabled',
  'workbuddyHarnessEnabled',
  'workbuddyHarnessAuto',
  'codexUsageApi',
  'codexResetWatch',
  'codexResetNotify',
  'autoUpdate',
  'wasteAlert',
  'wasteRunTasks',
  'contextAlert',
  'contextAuto',
  'globalHotkey',
  'wallpaper',
  'sound',
  'dayNight'
] as const
const oneOf = <T extends string>(v: unknown, list: T[]): v is T => list.includes(v as T)
const clamp2 = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)) * 100) / 100

const text = (v: unknown, n: number): string => (typeof v === 'string' ? v.trim().slice(0, n) : '')

/** Coerces untrusted input onto the settings shape */
export function sanitize(raw: any, base: Settings): Settings {
  const s = { ...base }
  if (!raw || typeof raw !== 'object') return s
  if ('dailyBudget' in raw) s.dailyBudget = posNum(raw.dailyBudget)
  if ('monthlyBudget' in raw) s.monthlyBudget = posNum(raw.monthlyBudget)
  if (raw.currency === 'USD' || raw.currency === 'CNY') s.currency = raw.currency
  if (posNum(raw.cnyRate)) s.cnyRate = raw.cnyRate
  if (typeof raw.quotaEnabled === 'boolean') s.quotaEnabled = raw.quotaEnabled
  if (Array.isArray(raw.extraDirs)) s.extraDirs = raw.extraDirs.filter((d: unknown) => typeof d === 'string' && d.trim())
  if (typeof raw.launchAtLogin === 'boolean') s.launchAtLogin = raw.launchAtLogin
  if (typeof raw.showMini === 'boolean') s.showMini = raw.showMini
  if (raw.miniPosition === null) s.miniPosition = null
  else if (raw.miniPosition && Number.isFinite(raw.miniPosition.x) && Number.isFinite(raw.miniPosition.y)) {
    const p = raw.miniPosition
    s.miniPosition = { x: Math.round(p.x), y: Math.round(p.y) }
    if (Number.isFinite(p.display) && (p.h === 'left' || p.h === 'right') && (p.v === 'top' || p.v === 'bottom') && Number.isFinite(p.dx) && Number.isFinite(p.dy))
      Object.assign(s.miniPosition, { display: p.display, h: p.h, dx: Math.round(p.dx), v: p.v, dy: Math.round(p.dy) })
  }
  if (['system', 'light', 'dark'].includes(raw.theme)) s.theme = raw.theme
  if (['auto', 'oauth', 'statusline', 'local'].includes(raw.quotaSource)) s.quotaSource = raw.quotaSource
  if ('local5hLimitUsd' in raw) s.local5hLimitUsd = posNum(raw.local5hLimitUsd)
  if (typeof raw.guardEnabled === 'boolean') s.guardEnabled = raw.guardEnabled
  if (Number.isFinite(raw.guardPauseAt)) s.guardPauseAt = Math.round(Math.min(99, Math.max(50, raw.guardPauseAt)))
  if (typeof raw.archiveEnabled === 'boolean') s.archiveEnabled = raw.archiveEnabled
  if (oneOf(raw.motion, MOTIONS)) s.motion = raw.motion
  if (oneOf(raw.frameCap, ['auto', '30', '60', 'max'])) s.frameCap = raw.frameCap
  if (typeof raw.fpsMeter === 'boolean') s.fpsMeter = raw.fpsMeter
  if (oneOf(raw.accent, ACCENT_KEYS)) s.accent = raw.accent
  if (oneOf(raw.backdrop, BACKDROPS)) s.backdrop = raw.backdrop
  if (typeof raw.adaptiveBackdrop === 'boolean') s.adaptiveBackdrop = raw.adaptiveBackdrop
  if (Number.isFinite(raw.backdropVivid)) s.backdropVivid = clamp2(raw.backdropVivid, 0.2, 1)
  if (typeof raw.glassCards === 'boolean') s.glassCards = raw.glassCards
  if (typeof raw.lightFx === 'boolean') s.lightFx = raw.lightFx
  if (oneOf(raw.sourceFilter, ['all', 'claude', 'codex', 'workbuddy'])) s.sourceFilter = raw.sourceFilter
  if (Array.isArray(raw.workbuddyDirs)) s.workbuddyDirs = raw.workbuddyDirs.filter((d: unknown) => typeof d === 'string' && d.trim())
  if (Array.isArray(raw.workbuddyHarnessProviders)) s.workbuddyHarnessProviders = [...new Set<string>(raw.workbuddyHarnessProviders.filter((d: unknown) => typeof d === 'string' && d.trim()))]
  if (typeof raw.workbuddyCli === 'string') s.workbuddyCli = raw.workbuddyCli.trim()
  if ([15, 30, 60].includes(raw.wasteLeadMin)) s.wasteLeadMin = raw.wasteLeadMin
  if (oneOf(raw.themePack, PACKS)) s.themePack = raw.themePack
  if (oneOf(raw.dayPack, PACKS)) s.dayPack = raw.dayPack
  if (oneOf(raw.nightPack, PACKS)) s.nightPack = raw.nightPack
  if (raw.skyPlace === null) s.skyPlace = null
  else if (raw.skyPlace && Number.isFinite(raw.skyPlace.lat) && Number.isFinite(raw.skyPlace.lon) && Math.abs(raw.skyPlace.lat) <= 90 && Math.abs(raw.skyPlace.lon) <= 180) {
    s.skyPlace = { name: String(raw.skyPlace.name ?? '').trim().slice(0, 24) || '自定义位置', lat: Math.round(raw.skyPlace.lat * 100) / 100, lon: Math.round(raw.skyPlace.lon * 100) / 100 }
  }
  if (CONTEXT_STEPS.includes(raw.contextWarnK)) s.contextWarnK = raw.contextWarnK
  if (oneOf(raw.windowMaterial, MATERIALS)) s.windowMaterial = raw.windowMaterial
  if (oneOf(raw.miniMode, MINI_MODES)) s.miniMode = raw.miniMode
  if (Number.isFinite(raw.miniOpacity)) s.miniOpacity = clamp2(raw.miniOpacity, 0.3, 1)
  if (Number.isFinite(raw.miniScale)) s.miniScale = clamp2(raw.miniScale, 0.8, 1.5)
  if (typeof raw.miniClickThrough === 'boolean') s.miniClickThrough = raw.miniClickThrough
  if (typeof raw.miniEdgeHide === 'boolean') s.miniEdgeHide = raw.miniEdgeHide
  for (const k of BOOLS) if (typeof raw[k] === 'boolean') s[k] = raw[k]
  if (Number.isFinite(raw.soundVolume)) s.soundVolume = clamp2(raw.soundVolume, 0, 1)
  if ('planPrice' in raw) s.planPrice = posNum(raw.planPrice)
  // a bot token looks like 123456:ABC-…; the chat id is a (possibly negative) number or @channel
  if (typeof raw.telegramToken === 'string') s.telegramToken = raw.telegramToken.trim().slice(0, 200)
  if (typeof raw.telegramChatId === 'string' || typeof raw.telegramChatId === 'number') {
    s.telegramChatId = String(raw.telegramChatId).trim().slice(0, 64)
  }
  if (raw.guardWeeklyAt === null) s.guardWeeklyAt = null
  else if (Number.isFinite(raw.guardWeeklyAt)) s.guardWeeklyAt = Math.round(Math.min(100, Math.max(50, raw.guardWeeklyAt)))
  if ('guardResumeFrom' in raw) s.guardResumeFrom = hhmm(raw.guardResumeFrom)
  if ('guardResumeTo' in raw) s.guardResumeTo = hhmm(raw.guardResumeTo)
  if (oneOf(raw.hotkey, [...HOTKEYS])) s.hotkey = raw.hotkey
  if ('reportTime' in raw) s.reportTime = hhmm(raw.reportTime)
  if (oneOf(raw.telegramKeyboard, ['fold', 'keep', 'off'])) s.telegramKeyboard = raw.telegramKeyboard
  if ('telegramQuietFrom' in raw) s.telegramQuietFrom = hhmm(raw.telegramQuietFrom)
  if ('telegramQuietTo' in raw) s.telegramQuietTo = hhmm(raw.telegramQuietTo)
  if (oneOf(raw.runawaySensitivity, ['low', 'medium', 'high'])) s.runawaySensitivity = raw.runawaySensitivity
  if (oneOf(raw.runawayAction, ['notify', 'pause'])) s.runawayAction = raw.runawayAction
  if (oneOf(raw.taskPermission, [...PERMISSIONS])) s.taskPermission = raw.taskPermission
  if (raw.taskModel === null || oneOf(raw.taskModel, ['opus', 'sonnet', 'haiku'])) s.taskModel = raw.taskModel
  if (typeof raw.taskCwd === 'string') s.taskCwd = raw.taskCwd.trim()
  if (oneOf(raw.codexTaskPermission, [...PERMISSIONS])) s.codexTaskPermission = raw.codexTaskPermission
  if (oneOf(raw.codexResetLang, ['en', 'zh-CN', 'zh-TW', 'ja', 'ko'])) s.codexResetLang = raw.codexResetLang
  // Codex model names change often: any short plain name
  if (Number.isFinite(raw.taskRetries)) s.taskRetries = Math.round(Math.min(5, Math.max(0, raw.taskRetries)))
  if (raw.taskTimeoutMin === null) s.taskTimeoutMin = null
  else if (Number.isFinite(raw.taskTimeoutMin) && raw.taskTimeoutMin > 0) s.taskTimeoutMin = Math.round(Math.min(720, Math.max(1, raw.taskTimeoutMin)))
  if ('taskCompactAt' in raw) s.taskCompactAt = cleanCompactAt(raw.taskCompactAt)
  if (raw.codexTaskModel === null || (typeof raw.codexTaskModel === 'string' && /^[\w.-]{0,60}$/.test(raw.codexTaskModel))) s.codexTaskModel = raw.codexTaskModel || null
  return s
}

export class SettingsStore extends EventEmitter {
  value: Settings = { ...DEFAULT_SETTINGS }

  constructor(private path: string) {
    super()
  }

  async load(): Promise<void> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch {
      this.value = { ...DEFAULT_SETTINGS }
      return
    }
    try {
      // an editor may have put a byte-order mark in front
      this.value = sanitize(JSON.parse(text.replace(/^﻿/, '')), DEFAULT_SETTINGS)
    } catch {
      // unreadable (edited by hand?): kept aside, or the next save would write over it
      this.value = { ...DEFAULT_SETTINGS }
      await copyFile(this.path, `${this.path}.broken`).catch(() => {})
    }
  }

  async update(patch: Partial<Settings>): Promise<{ next: Settings; prev: Settings }> {
    const prev = this.value
    this.value = sanitize(patch, prev)
    await writeFileAtomic(this.path, JSON.stringify(this.value, null, 2)).catch(() => {})
    this.emit('change', this.value)
    return { next: this.value, prev }
  }
}
