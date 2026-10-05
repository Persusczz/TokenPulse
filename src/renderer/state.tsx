import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { fmtMoney, type MoneyOpts } from '@shared/format'
import type { CodexQuota, GuardState, LoadState, PricingInfo, QuotaInfo, QuotaWindow, Settings, SourceView, UpdateEvent, UsageSource } from '@shared/types'

const api = window.api

interface AppState {
  settings: Settings | null
  quota: QuotaInfo | null
  /** Codex (GPT) limits, when Codex logs are read */
  codexQuota: CodexQuota | null
  guard: GuardState | null
  setGuard: (g: GuardState) => void
  pricing: PricingInfo | null
  load: LoadState | null
  /** increments whenever usage data or prices change */
  version: number
  lastUpdate: UpdateEvent | null
  money: (usd: number, digits?: number) => string
  moneyOpts: MoneyOpts
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  setPricing: (p: PricingInfo) => void
  setQuota: (q: QuotaInfo) => void
}

const Ctx = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [quota, setQuota] = useState<QuotaInfo | null>(null)
  const [codexQuota, setCodexQuota] = useState<CodexQuota | null>(null)
  const [guard, setGuard] = useState<GuardState | null>(null)
  const [pricing, setPricing] = useState<PricingInfo | null>(null)
  const [load, setLoad] = useState<LoadState | null>(null)
  const [version, setVersion] = useState(0)
  const [lastUpdate, setLastUpdate] = useState<UpdateEvent | null>(null)

  useEffect(() => {
    void api.getSettings().then(setSettings)
    void api.getQuota().then(setQuota)
    void api.getCodexQuota().then(setCodexQuota)
    void api.getGuard().then(setGuard)
    void api.getPricing().then(setPricing)
    void api.getLoadState().then(setLoad)
    const offs = [
      api.onSettings(setSettings),
      api.onQuota(setQuota),
      api.onCodexQuota(setCodexQuota),
      api.onGuard(setGuard),
      api.onPricing((p) => {
        setPricing(p)
        setVersion((v) => v + 1)
      }),
      api.onLoadState((s) => {
        setLoad(s)
        setVersion((v) => v + 1)
      }),
      api.onUpdate((e) => {
        setLastUpdate(e)
        setVersion((v) => v + 1)
        // keep "models seen" on the pricing page current
        void api.getPricing().then(setPricing)
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  const moneyOpts = useMemo<MoneyOpts>(
    () => ({ currency: settings?.currency ?? 'USD', cnyRate: settings?.cnyRate ?? 7.1 }),
    [settings?.currency, settings?.cnyRate]
  )
  const money = useCallback((usd: number, digits?: number) => fmtMoney(usd, moneyOpts, digits), [moneyOpts])
  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings(await api.setSettings(patch))
  }, [])

  const value: AppState = { settings, quota, codexQuota, guard, setGuard, pricing, load, version, lastUpdate, money, moneyOpts, saveSettings, setPricing, setQuota }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside provider')
  return v
}

/**
 * Fetches with `fetcher`, re-fetching when deps or the data version change,
 * and optionally on an interval. Keeps the previous value while loading.
 */
export function useData<T>(fetcher: () => Promise<T>, deps: unknown[], intervalMs?: number): T | null {
  const { version } = useApp()
  const [data, setData] = useState<T | null>(null)
  const seq = useRef(0)
  const run = useCallback(() => {
    const id = ++seq.current
    void fetcher().then((d) => {
      if (id === seq.current) setData(d)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    const t = setTimeout(run, 120)
    return () => clearTimeout(t)
  }, [run, version])

  useEffect(() => {
    if (!intervalMs) return
    const t = setInterval(run, intervalMs)
    return () => clearInterval(t)
  }, [run, intervalMs])

  return data
}

function useOsReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const m = matchMedia('(prefers-reduced-motion: reduce)')
    const fn = () => setReduced(m.matches)
    m.addEventListener('change', fn)
    return () => m.removeEventListener('change', fn)
  }, [])
  return reduced
}

export type MotionScale = 0 | 1 | 2 | 3
const MOTION_SCALE: Record<Settings['motion'], MotionScale> = { off: 0, subtle: 1, standard: 2, rich: 3 }

/** 0 = no decorative motion (setting or OS preference), 1 subtle, 2 standard, 3 rich */
export function useMotionLevel(): MotionScale {
  const motion = useContext(Ctx)?.settings?.motion ?? 'standard'
  return useOsReducedMotion() ? 0 : MOTION_SCALE[motion]
}

export function usePrefersReducedMotion(): boolean {
  return useMotionLevel() === 0
}

/**
 * The tool on view: Claude, Codex, or both together ('all'). Codex counts only
 * while its logs are read, so a stale 'codex' setting falls back to Claude.
 */
export function useSource(): SourceView {
  const { settings, load } = useApp()
  const f = settings?.sourceFilter ?? 'all'
  if (!settings?.codexEnabled) return 'claude'
  // before the first scan finishes the Codex file count is unknown: trust the setting
  if (f === 'all' && load && !load.loading && !(load.codexFiles ?? 0)) return 'claude'
  return f
}

/** Codex is set up and has logs: the Claude / Codex / 全部 switch is worth showing */
export function useHasCodex(): boolean {
  const { settings, load, codexQuota } = useApp()
  return !!settings?.codexEnabled && ((load?.codexFiles ?? 0) > 0 || !!codexQuota)
}

/** Mirrors appearance settings onto <html> for CSS: data-motion, data-backdrop, data-material, data-source, data-pack */
export function useHtmlFlags(main: boolean): void {
  const { settings } = useApp()
  const level = useMotionLevel()
  const source = useSource()
  useEffect(() => {
    const d = document.documentElement.dataset
    d.motion = (['off', 'subtle', 'standard', 'rich'] as const)[level]
    if (settings) d.accent = settings.accent
    d.source = source
    if (settings && settings.themePack !== 'none') d.pack = settings.themePack
    else delete d.pack
    if (main && settings) {
      d.backdrop = settings.backdrop
      if (settings.windowMaterial !== 'none') d.material = settings.windowMaterial
      else delete d.material
      if (settings.glassCards && settings.backdrop !== 'plain') d.glass = ''
      else delete d.glass
    }
  }, [level, main, source, settings?.accent, settings?.backdrop, settings?.windowMaterial, settings?.glassCards, settings?.themePack]) // eslint-disable-line react-hooks/exhaustive-deps
}

export interface ToolQuota {
  source: UsageSource
  five: QuotaWindow | null
  seven: QuotaWindow | null
  /** the guard line (Claude only) */
  pauseAt: number | null
  plan: string | null
}

const isFive = (w: QuotaWindow) => w.key === 'session' || w.key === 'five_hour' || w.key === 'codex_5h'
const isSeven = (w: QuotaWindow) => w.key === 'weekly_all' || w.key === 'seven_day' || w.key === 'codex_7d'

/** The 5h / 7d windows of each tool on view, Claude first */
export function useToolQuotas(): ToolQuota[] {
  const { quota, codexQuota, settings } = useApp()
  const source = useSource()
  const out: ToolQuota[] = []
  if (source !== 'codex') {
    const ws = quota?.windows ?? []
    out.push({ source: 'claude', five: ws.find(isFive) ?? null, seven: ws.find(isSeven) ?? null, pauseAt: settings?.guardEnabled ? settings.guardPauseAt : null, plan: quota?.plan ?? null })
  }
  if (source !== 'claude' && codexQuota) {
    const ws = codexQuota.windows
    out.push({ source: 'codex', five: ws.find(isFive) ?? null, seven: ws.find(isSeven) ?? null, pauseAt: null, plan: codexQuota.plan ? `ChatGPT ${codexQuota.plan.charAt(0).toUpperCase()}${codexQuota.plan.slice(1)}` : null })
  }
  return out
}

export const TOOL_NAME: Record<SourceView, string> = { claude: 'Claude', codex: 'Codex', all: '全部' }
export const TOOL_CLI: Record<UsageSource, string> = { claude: 'Claude Code', codex: 'Codex' }

// ---------- launch intro ----------

let introDone = false
const introSubs = new Set<() => void>()

/** The launch animation has finished (always true outside the main window) */
export function useIntroDone(): boolean {
  const [done, setDone] = useState(introDone)
  useEffect(() => {
    if (introDone) return setDone(true)
    const fn = () => setDone(true)
    introSubs.add(fn)
    return () => void introSubs.delete(fn)
  }, [])
  return done
}

export function finishIntro(): void {
  if (introDone) return
  introDone = true
  introSubs.forEach((fn) => fn())
}

export const resolveTheme = (setting: Settings['theme'] | undefined, sysDark = matchMedia('(prefers-color-scheme: dark)').matches) =>
  setting === 'light' || setting === 'dark' ? setting : sysDark ? 'dark' : 'light'

/** Resolved theme, applied to <html data-theme> */
export function useResolvedTheme(setting: Settings['theme'] | undefined): 'light' | 'dark' {
  const [sysDark, setSysDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const m = matchMedia('(prefers-color-scheme: dark)')
    const fn = () => setSysDark(m.matches)
    m.addEventListener('change', fn)
    return () => m.removeEventListener('change', fn)
  }, [])
  const theme = resolveTheme(setting, sysDark)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  return theme
}

/**
 * Key that changes with anything canvases read from CSS (theme and accent):
 * components take it as their `theme` prop and re-read colours when it changes.
 */
export function usePaintKey(theme: 'light' | 'dark'): string {
  const s = useContext(Ctx)?.settings
  const source = useSource()
  const want = `${theme}-${s?.accent ?? 'clay'}-${source}-${s?.themePack ?? 'none'}`
  const [key, setKey] = useState(want)
  // after the effect that writes data-accent / data-source, so the new colours are in place
  useEffect(() => {
    const t = setTimeout(() => setKey(want), 0)
    return () => clearTimeout(t)
  }, [want])
  return key
}

/** Reads a CSS custom property; re-read when the theme changes */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** "1:23:45" / "12:05" countdown to `t` */
export function countdown(t: number, now: number): string {
  const s = Math.max(0, Math.round((t - now) / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const p = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${p(m)}:${p(s % 60)}` : `${p(m)}:${p(s % 60)}`
}

export const clock = (t: number) => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}
