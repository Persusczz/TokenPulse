import { AnimatePresence, motion } from 'motion/react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { Backdrop } from './components/Backdrop'
import { Brand, SourceSwitch } from './components/Brand'
import { Splash } from './components/Splash'
import { Celebration, LightFx, SideCounter, TokenFx } from './components/Fx'
import { IconMoon, IconTarot, IconOverview, IconPrice, IconSessions, IconSettings, IconTasks, IconTrophy } from './components/Icons'
import { CommandPalette } from './components/CommandPalette'
import { DayClock, useDayPalette } from './components/DayCycle'
import { FpsMeter } from './components/FpsMeter'
import { SideEmblem } from './components/Emblem'
import { SoundEffects } from './components/SoundEffects'
import { Toasts } from './components/Toasts'
import { openUpdateDialog, UpdateDialog } from './components/UpdateDialog'
import { pageMotion, playPageTransition, playThemeEntrance, SceneTransition } from './components/Transitions'
import { installEffects } from './effects'
import { AchievementsPage } from './pages/Achievements'
import { Island } from './pages/Island'
import { Mini } from './pages/Mini'
import { Overview } from './pages/Overview'
import { Pricing } from './pages/Pricing'
import { Sessions } from './pages/Sessions'
import { SkyPage } from './pages/SkyPage'
import { TarotPage } from './pages/TarotPage'
import { SETTINGS_GROUPS, SettingsPage, useSettingsGroups, type SettingsGroupId } from './pages/SettingsPage'
import { Stage } from './pages/Stage'
import { TasksPage } from './pages/Tasks'
import { Wallpaper } from './pages/Wallpaper'
import { AppProvider, cssVar, finishIntro, hexColor, TOOL_NAME, useApp, useData, useHtmlFlags, useMotionLevel, useNow, usePaintKey, useResolvedTheme, useSource, useUpdate } from './state'

type Page = 'overview' | 'tasks' | 'sessions' | 'achievements' | 'sky' | 'tarot' | 'pricing' | 'settings'

const NAV: { id: Page; label: string; icon: typeof IconOverview; key: string; keys: string }[] = [
  { id: 'overview', label: '概览', icon: IconOverview, key: '1', keys: 'gl overview' },
  { id: 'tasks', label: '任务', icon: IconTasks, key: '2', keys: 'rw tasks' },
  { id: 'sessions', label: '会话', icon: IconSessions, key: '3', keys: 'hh sessions' },
  { id: 'achievements', label: '成就', icon: IconTrophy, key: '4', keys: 'cj achievements' },
  { id: 'sky', label: '星空', icon: IconMoon, key: '5', keys: 'xk sky moon star tx' },
  { id: 'tarot', label: '塔罗', icon: IconTarot, key: '6', keys: 'tl tarot taluo zb arcana' },
  { id: 'pricing', label: '定价', icon: IconPrice, key: '7', keys: 'dj pricing' },
  { id: 'settings', label: '设置', icon: IconSettings, key: '8', keys: 'sz settings' }
]

/** a new version waiting, downloading or ready: a click opens the update dialog */
function UpdatePill() {
  const u = useUpdate()
  if (!u?.latest || (u.status !== 'available' && u.status !== 'downloading' && u.status !== 'ready')) return null
  return (
    <button className={`update-pill${u.status === 'downloading' ? '' : ' ready'}`} onClick={openUpdateDialog} title="查看更新内容">
      {u.status === 'downloading' ? (
        <>
          <span>正在下载 {u.latest.version}</span>
          <b>{Math.round((u.progress ?? 0) * 100)}%</b>
          <i style={{ width: `${Math.round((u.progress ?? 0) * 100)}%` }} />
        </>
      ) : (
        <>
          <span>✦ {u.latest.version} {u.status === 'ready' ? '已就绪' : '可更新'}</span>
          <b>{u.status === 'ready' ? '重启并更新' : '查看'}</b>
        </>
      )}
    </button>
  )
}

function LiveStatus() {
  const { load } = useApp()
  const source = useSource()
  const live = useData(() => window.api.getLive(), [], 30_000)
  const now = useNow(30_000)
  const last = live?.lastEntryAt
  const active = !!last && now - last < 3 * 60_000
  const ago = last ? Math.round((now - last) / 60000) : null
  return (
    <>
      <span className="live">
        <span className={`live-dot${active ? ' hot' : ''}`} />
        {load?.loading ? '正在扫描…' : active ? `实时 · ${source === 'all' ? 'AI' : TOOL_NAME[source]} 正在工作` : '实时监听中'}
      </span>
      {ago !== null && <span>最近活动：{ago < 1 ? '刚刚' : ago < 60 ? `${ago} 分钟前` : new Date(last!).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
    </>
  )
}

const lum = ([r, g, b]: number[]) => {
  const c = [r, g, b].map((v) => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const rgbOfHex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))

/** what shows under the title-bar buttons: the page colour with the backdrop's canvases over it, averaged */
function cornerColor(bg: string): number[] {
  const sc = document.createElement('canvas')
  sc.width = 16
  sc.height = 4
  const g = sc.getContext('2d', { willReadFrequently: true })!
  g.fillStyle = bg
  g.fillRect(0, 0, 16, 4)
  for (const c of document.querySelectorAll<HTMLCanvasElement>('.backdrop canvas')) {
    const r = c.getBoundingClientRect()
    if (!r.width || !r.height || !c.width) continue
    const kx = c.width / r.width
    const ky = c.height / r.height
    const x = Math.max(0, (innerWidth - 150 - r.left) * kx)
    const w = Math.min(c.width - x, 150 * kx)
    const h = Math.min(c.height, (44 - r.top) * ky)
    if (w <= 0 || h <= 0) continue
    g.globalAlpha = Number(getComputedStyle(c).opacity) || 1
    try {
      g.drawImage(c, x, Math.max(0, -r.top * ky), w, h, 0, 0, 16, 4)
    } catch {
      /* not drawable */
    }
  }
  const d = g.getImageData(0, 0, 16, 4).data
  const sum = [0, 0, 0]
  for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += d[i + k]
  return sum.map((v) => v / (d.length / 4))
}

const contrast = (x: number[], y: number[]) => {
  const [a, b] = [lum(x), lum(y)]
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
const mixRgb = (x: number[], y: number[], t: number) => x.map((v, i) => v + (y[i] - v) * t)
/** strongest scrim, as an opacity of the page colour */
const SCRIM_MAX = 0.8

/**
 * The native title-bar buttons stay transparent, so the page and the pack's
 * scene run on under them. Their symbols take the theme's own text colour,
 * and a soft wash of the page colour fades in from the corner only as far as
 * that colour needs to read (5:1 on average, 3.5:1 on the darkest and
 * brightest tenth of the pixels). Where the scene already contrasts, there is
 * no wash at all; where the theme colour can't win without one but plain
 * white or black can, that is used instead. Looked at again every few seconds
 * (the 昼夜 sky changes all day).
 */
function useTitleButtons(deps: unknown[]): void {
  const sent = useRef('')
  const shown = useRef(0)
  useEffect(() => {
    let alive = true
    const check = async () => {
      const bg = hexColor(cssVar('--bg'))
      const page = rgbOfHex(bg)
      const theme = hexColor(cssVar('--text'))
      const own = rgbOfHex(theme)
      const sample = await window.api.titleCorner().catch(() => null)
      if (!alive) return
      // what is there without the wash (the sample includes the wash now showing); a window material shows the page colour
      const a0 = shown.current
      const unwash = (c: number[]) => c.map((v, i) => Math.max(0, Math.min(255, (v - a0 * page[i]) / (1 - a0))))
      const under = sample && sample.opaque > 0.5 ? [sample.avg, sample.lo, sample.hi].map(unwash) : [cornerColor(bg)]
      // the symbols are 1 px lines, so a little more than text needs
      const reads = (fg: number[], a: number) => under.every((u, i) => contrast(fg, mixRgb(u, page, a)) >= (i === 0 ? 5 : 3.5))
      let fg = theme
      let wash = 0
      if (!reads(own, 0)) {
        const plain = lum(under[0]) > 0.3 ? '#2b2a26' : '#f3f1ea'
        if (reads(rgbOfHex(plain), 0)) fg = plain
        else {
          wash = SCRIM_MAX
          for (let a = 0.1; a <= SCRIM_MAX + 1e-9; a += 0.05) {
            if (reads(own, a)) {
              wash = a
              break
            }
          }
        }
      }
      shown.current = wash
      document.documentElement.style.setProperty('--tb-scrim', wash.toFixed(2))
      document.documentElement.style.setProperty('--tb-fg', fg)
      if (sent.current === bg + fg) return
      sent.current = bg + fg
      window.api.setThemeColors({ bg, fg })
    }
    // once the new look has painted, again when a theme fade has settled, then every few seconds
    const first = setTimeout(() => void check(), 1200)
    const settled = setTimeout(() => void check(), 3500)
    const every = setInterval(() => void check(), 8000)
    return () => {
      alive = false
      clearTimeout(first)
      clearTimeout(settled)
      clearInterval(every)
    }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
}

function storedGroup(): SettingsGroupId {
  try {
    const v = localStorage.getItem('tp.settings.group')
    return SETTINGS_GROUPS.some((g) => g.id === v) ? (v as SettingsGroupId) : 'appearance'
  } catch {
    return 'appearance'
  }
}

/** The settings groups, as sub-items under 设置 */
function SettingsTree({ open, active, onPick }: { open: boolean; active: SettingsGroupId | null; onPick: (g: SettingsGroupId) => void }) {
  const groups = useSettingsGroups()
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          className="nav-tree"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        >
          {groups.map((g, i) => (
            <motion.button
              key={g.id}
              className={`nav-sub${active === g.id ? ' active' : ''}`}
              onClick={() => onPick(g.id)}
              title={g.summary}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.018 }}
            >
              {active === g.id && <motion.span layoutId="nav-sub-pill" className="nav-sub-pill" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
              <span className={`nav-sub-icon${g.on ? ' on' : ''}`}>{g.icon}</span>
              <span className="nav-sub-label">{g.title}</span>
            </motion.button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Shell() {
  const { settings, setQuota } = useApp()
  const theme = useResolvedTheme(settings?.theme)
  const [page, setPageRaw] = useState<Page>('overview')
  const [group, setGroupRaw] = useState<SettingsGroupId>(storedGroup)
  const [tree, setTree] = useState(false)
  useHtmlFlags(true)
  useDayPalette()
  const paint = usePaintKey(theme)
  const level = useMotionLevel()
  const style = settings?.backdrop ?? 'plain'
  // each backdrop turns pages its own way (the cosmos warps through hyperspace)
  const pm = pageMotion(style, level)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) return void (first.current = false)
    playPageTransition()
  }, [page]) // eslint-disable-line react-hooks/exhaustive-deps
  // switching to another backdrop plays its entrance over the whole window
  const shownStyle = useRef<string | null>(null)
  useEffect(() => {
    if (!settings) return
    const was = shownStyle.current
    shownStyle.current = style
    if (was === null || was === style) return
    // after the new backdrop has mounted and is listening
    const t = setTimeout(playThemeEntrance, 160)
    return () => clearTimeout(t)
  }, [style, !!settings]) // eslint-disable-line react-hooks/exhaustive-deps
  const setGroup = (g: SettingsGroupId) => {
    setGroupRaw(g)
    try {
      localStorage.setItem('tp.settings.group', g)
    } catch {
      /* ignore */
    }
  }
  // the settings tree opens with the settings page and folds away when leaving it
  const setPage = (p: Page) => {
    setPageRaw(p)
    setTree(p === 'settings')
  }
  const openGroup = (g: SettingsGroupId) => {
    setGroup(g)
    setPage('settings')
    document.querySelector('.main')?.scrollTo(0, 0)
  }

  useTitleButtons([theme, settings?.themePack, settings?.backdrop, settings?.accent])

  useEffect(() => installEffects(), [])

  // links between pages: "tasks", or "settings:island" for one settings group
  useEffect(() => {
    const go = (e: Event) => {
      const [p, g] = String((e as CustomEvent<string>).detail).split(':')
      if (p === 'settings' && SETTINGS_GROUPS.some((x) => x.id === g)) openGroup(g as SettingsGroupId)
      else if (NAV.some((n) => n.id === p)) setPage(p as Page)
    }
    document.addEventListener('tp-nav', go)
    return () => document.removeEventListener('tp-nav', go)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // each page starts at the top
  useEffect(() => {
    document.querySelector('.main')?.scrollTo(0, 0)
  }, [page])

  // Ctrl+1–8 pages, Ctrl+M floating window, F5 refresh quota, F11 big screen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea')) return
      const nav = e.ctrlKey && !e.shiftKey && !e.altKey ? NAV.find((n) => n.key === e.key) : undefined
      if (nav) setPage(nav.id)
      else if (e.ctrlKey && e.key.toLowerCase() === 'm') window.api.toggleMini()
      else if (e.key === 'F5') void window.api.refreshQuota().then(setQuota)
      else if (e.key === 'F11') window.api.openStage()
      else return
      e.preventDefault()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [setQuota]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="shell">
      <Backdrop theme={theme} paint={paint} />
      <LightFx />
      <div className="titlebar" />
      <div className="title-scrim" aria-hidden />
      <aside className="side">
        <Brand />
        <SourceSwitch />
        <nav className="side-nav">
          {NAV.map((n) => (
            <Fragment key={n.id}>
              <button
                className={`nav-item${page === n.id ? ' active' : ''}`}
                onClick={() => (n.id === 'settings' && page === 'settings' ? setTree(!tree) : setPage(n.id))}
                title={`Ctrl+${n.key}`}
              >
                {page === n.id && <motion.span layoutId="nav-pill" className="nav-pill" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                <n.icon />
                {n.label}
                {n.id === 'settings' && <span className={`nav-chev${tree ? ' open' : ''}`} aria-hidden />}
              </button>
              {n.id === 'settings' && <SettingsTree open={tree} active={page === 'settings' ? group : null} onPick={openGroup} />}
            </Fragment>
          ))}
        </nav>
        <SideEmblem />
        <div className="side-foot">
          {style === 'daylight' && <DayClock />}
          <button className="pal-open" onClick={() => document.dispatchEvent(new CustomEvent('tp-palette'))} title="搜索页面、设置、主题包或操作">
            <span>⌕ 搜索与快捷操作</span>
            <kbd>Ctrl K</kbd>
          </button>
          <SideCounter />
          <UpdatePill />
          <LiveStatus />
          <button className="btn" style={{ marginTop: 6, justifyContent: 'center' }} onClick={() => window.api.toggleMini()} title="Ctrl+M">
            {settings?.showMini ? '隐藏悬浮窗' : '显示悬浮窗'}
          </button>
        </div>
      </aside>
      <main className="main">
        <AnimatePresence mode="wait">
          <motion.div key={page} className="page" initial={pm.initial} animate={pm.animate} exit={pm.exit} transition={pm.transition}>
            {page === 'overview' && <Overview theme={paint} />}
            {page === 'tasks' && <TasksPage />}
            {page === 'sessions' && <Sessions />}
            {page === 'achievements' && <AchievementsPage />}
            {page === 'sky' && <SkyPage />}
            {page === 'tarot' && <TarotPage />}
            {page === 'pricing' && <Pricing />}
            {page === 'settings' && <SettingsPage group={group} onGroup={openGroup} />}
          </motion.div>
        </AnimatePresence>
      </main>
      <SceneTransition style={style} level={level} />
      {settings?.fpsMeter && <FpsMeter />}
      <CommandPalette pages={NAV} />
      <Toasts />
      <SoundEffects />
      <TokenFx />
      <Celebration />
      <UpdateDialog />
      <Splash />
    </div>
  )
}

/** Big-screen and wallpaper windows: the main window's look, without the shell */
function BareShell({ kind }: { kind: 'stage' | 'wallpaper' }) {
  const { settings } = useApp()
  const theme = useResolvedTheme(settings?.theme)
  useHtmlFlags(true)
  useDayPalette()
  const paint = usePaintKey(theme)
  useEffect(() => {
    document.documentElement.classList.add(`${kind}-root`)
    if (kind === 'stage') return installEffects()
  }, [kind])
  return kind === 'stage' ? <Stage theme={theme} paint={paint} /> : <Wallpaper theme={theme} paint={paint} />
}

function IslandShell() {
  const { settings } = useApp()
  useResolvedTheme(settings?.theme)
  useHtmlFlags(false)
  useDayPalette()
  return <Island />
}

function MiniShell() {
  const { settings } = useApp()
  const theme = useResolvedTheme(settings?.theme)
  useHtmlFlags(false)
  useDayPalette()
  const paint = usePaintKey(theme)
  useEffect(() => installEffects(), [])
  return <Mini theme={theme} paint={paint} />
}

export function App() {
  const h = location.hash
  // only the main window plays the launch animation
  if (h.startsWith('#/mini') || h.startsWith('#/island') || h.startsWith('#/stage') || h.startsWith('#/wallpaper')) finishIntro()
  return (
    <AppProvider>
      {h.startsWith('#/mini') ? (
        <MiniShell />
      ) : h.startsWith('#/island') ? (
        <IslandShell />
      ) : h.startsWith('#/stage') ? (
        <BareShell kind="stage" />
      ) : h.startsWith('#/wallpaper') ? (
        <BareShell kind="wallpaper" />
      ) : (
        <Shell />
      )}
    </AppProvider>
  )
}
