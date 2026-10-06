import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { fmtTokens } from '@shared/format'
import type { BackdropStyle, Intensity, QuotaWindow, RateStats } from '@shared/types'
import { flowGlow, useAmbient } from '../components/Backdrop'
import { EnergyTank } from '../components/EnergyTank'
import { FlowField } from '../components/FlowField'
import { IconBolt, IconClose, IconExpand } from '../components/Icons'
import { AnimatedNumber } from '../components/Numbers'
import { PulseRings } from '../components/PulseRings'
import { useQuotaMotion } from '../components/QuotaMotion'
import { Starburst } from '../components/Starburst'
import { CodexMark, SourceMark } from '../components/CodexMark'
import { BlackHole, MiniGalaxy } from '../components/Cosmos'
import { hasPocket, PocketOrb, pocketDark, PocketScene } from '../components/Pocket'
import { clock, countdown, useApp, useData, useMotionLevel, useNow, useSource, useToolQuotas } from '../state'

const quotaColor = (pct: number, pauseAt: number | null) =>
  pct >= (pauseAt ?? 90) ? 'var(--critical)' : pct >= 75 ? 'var(--serious)' : 'var(--accent)'
const tok1 = (v: number) => fmtTokens(v, 1)
const tok2 = (v: number) => fmtTokens(v, 2)

function useMiniData() {
  const app = useApp()
  const source = useSource()
  const live = useData(() => window.api.getLive(), [source], 15_000)
  const rate = useData(() => window.api.getRate(), [source], 5_000)
  // the tool on view (Claude first under 全部), and Codex as the second line under 全部
  const tools = useToolQuotas()
  const main = tools[0]
  return {
    ...app,
    source,
    live,
    rate,
    five: main?.five ?? null,
    seven: main?.seven ?? null,
    other: tools[1] ?? null,
    beat: app.lastUpdate?.addedTokens ? app.lastUpdate.at : 0,
    pauseAt: main?.pauseAt ?? null,
    paused: source === 'codex' ? [] : (app.guard?.paused ?? []),
    intensity: (live?.intensity ?? 0) as Intensity
  }
}
type MiniData = ReturnType<typeof useMiniData>

/** True for a moment after the 5h quota crosses 75%, 90% or the guard line */
function useAlert(pct: number | null, pauseAt: number | null): boolean {
  const prev = useRef(pct)
  const [on, setOn] = useState(false)
  useEffect(() => {
    const p = prev.current
    prev.current = pct
    if (p === null || pct === null) return
    if (![75, 90, ...(pauseAt ? [pauseAt] : [])].some((m) => p < m && pct >= m)) return
    setOn(true)
    const t = setTimeout(() => setOn(false), 2600)
    return () => clearTimeout(t)
  }, [pct]) // eslint-disable-line react-hooks/exhaustive-deps
  return on
}

/** Drops for the orb, sized like the main window's tank */
function usePour(d: MiniData) {
  const [pour, setPour] = useState({ id: 0, count: 0 })
  const last = d.lastUpdate
  useEffect(() => {
    if (!last || last.addedTokens <= 0) return
    setPour((p) => ({ id: p.id + 1, count: Math.max(1, Math.min(6, Math.round(Math.log10(last.addedTokens + 1) - 2))) }))
  }, [last])
  return pour
}

function QuotaBar({ label, w, pauseAt, when }: { label: ReactNode; w: QuotaWindow; pauseAt: number | null; when: string }) {
  const pct = Math.max(0, Math.min(100, w.utilization))
  // surges up with new usage, rewinds to zero when the window resets
  const m = useQuotaMotion(pct, w.resetsAt)
  return (
    <>
      <span className="mini-q-label">{label}</span>
      <div className={`bar-track q-bar q-${m.phase}`} style={{ position: 'relative' }}>
        <div className="bar-fill" style={{ width: `${m.v}%`, background: m.phase === 'rewind' ? 'var(--rewind)' : quotaColor(m.v, pauseAt) }} />
        {pauseAt !== null && <i className="mini-guard-tick" style={{ left: `${pauseAt}%` }} title={`守卫线 ${pauseAt}%`} />}
      </div>
      <span className={`tnum mini-q-pct q-${m.phase}`}>
        {m.phase === 'rewind' && <i className="q-rw">⏪</i>}
        {Math.round(m.v)}%
      </span>
      {when && <span className="mini-when">{when}</span>}
    </>
  )
}

/** The rotating line under the numbers */
function carousel(d: MiniData, now: number): { key: string; node: ReactNode }[] {
  const items: { key: string; node: ReactNode }[] = []
  const resetIn = (w: QuotaWindow, short: boolean) => {
    const t = w.resetsAt ? Date.parse(w.resetsAt) : NaN
    if (!(t > now)) return ''
    if (short) return countdown(t, now)
    const h = Math.round((t - now) / 3600_000)
    return h >= 24 ? `${Math.floor(h / 24)} 天` : `${h} 小时`
  }
  // under 全部 each bar carries its tool's mark
  const tag = (s: 'claude' | 'codex', text: string) =>
    d.other ? (
      <>
        {s === 'codex' ? <CodexMark size={10} animated={false} /> : <Starburst size={10} animated={false} />}
        {text}
      </>
    ) : (
      text
    )
  if (d.five) items.push({ key: '5h', node: <QuotaBar label={tag('claude', '5h')} w={d.five} pauseAt={d.pauseAt} when={resetIn(d.five, true)} /> })
  if (d.other?.five) items.push({ key: 'x5h', node: <QuotaBar label={tag('codex', '5h')} w={d.other.five} pauseAt={null} when={resetIn(d.other.five, true)} /> })
  if (d.seven) items.push({ key: '7d', node: <QuotaBar label={tag('claude', '7d')} w={d.seven} pauseAt={null} when={resetIn(d.seven, false)} /> })
  if (d.other?.seven) items.push({ key: 'x7d', node: <QuotaBar label={tag('codex', '7d')} w={d.other.seven} pauseAt={null} when={resetIn(d.other.seven, false)} /> })
  const burn = d.source === 'codex' ? null : d.quota?.burn
  if (burn && burn.pctPerHour >= 0.5) {
    const eta = burn.etaPause ?? burn.etaFull
    items.push({
      key: 'burn',
      node: (
        <span className="mini-line">
          <IconBolt width={11} height={11} style={{ color: 'var(--accent)' }} />
          5h 消耗 <b>+{burn.pctPerHour.toFixed(1)}%/时</b>
          {eta && (
            <span className="mini-warn">
              {' '}
              · {clock(eta)} 达 {burn.etaPause ? `${d.pauseAt ?? 90}%` : '100%'}
            </span>
          )}
        </span>
      )
    })
  }
  if (d.rate && d.rate.requestsPerMin > 0) {
    items.push({
      key: 'rate',
      node: (
        <span className="mini-line">
          输出 <b>{d.rate.outputPerSec.toFixed(1)}</b> tok/s · <b>{d.rate.requestsPerMin.toFixed(1)}</b> 次/分 · 近 1h <b>{d.money(d.rate.costPerHour)}</b>
        </span>
      )
    })
  }
  if (d.pauseAt !== null) {
    items.push({
      key: 'guard',
      node: (
        <span className="mini-line">
          <span className="guard-dot on" /> 守卫就绪 · 5h 达到 {d.pauseAt}% 时暂停
        </span>
      )
    })
  }
  return items
}

/** The last 30 minutes of tokens/min, drawn faintly behind the card */
function Trail({ rate }: { rate: RateStats | null }) {
  const pts = (rate?.perMinute ?? []).slice(-30).map((p) => p.tokens)
  if (pts.length < 2) return null
  const max = Math.max(...pts, 1)
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * 100).toFixed(2)} ${(30 - (v / max) * 26).toFixed(2)}`).join('')
  return (
    <svg className="mini-trail" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden>
      <path d={`${line}L100 30L0 30Z`} />
      <path d={line} className="line" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function Buttons() {
  return (
    <div className="mini-btns">
      <button title="打开主窗口" onClick={() => window.api.showMain()}>
        <IconExpand />
      </button>
      <button title="关闭悬浮窗" onClick={() => window.api.toggleMini(false)}>
        <IconClose />
      </button>
    </div>
  )
}

function CardMini({ d }: { d: MiniData }) {
  const now = useNow(1000)
  const items = carousel(d, now)
  const [idx, setIdx] = useState(0)
  const [hold, setHold] = useState(false)
  useEffect(() => {
    if (hold || items.length < 2) return
    const t = setInterval(() => setIdx((i) => i + 1), 5000)
    return () => clearInterval(t)
  }, [hold, items.length])
  const item = items.length ? items[idx % items.length] : null
  const until = d.paused.find((p) => p.until)?.until

  return (
    <>
      <Trail rate={d.rate} />
      <span className="mini-mark">
        <PulseRings trigger={d.beat} />
        <SourceMark size={46} intensity={d.intensity} pulse={d.beat} />
      </span>
      <div className="mini-main">
        <div className="mini-label">
          今日 Token
          <span className="mini-rate" title="近 1 分钟 tokens/分钟">
            <IconBolt width={11} height={11} />
            <AnimatedNumber value={d.rate?.tokensPerMin ?? 0} format={tok1} />
            /分
          </span>
        </div>
        <div className="mini-tokens">
          <AnimatedNumber value={d.live?.today.tokens ?? 0} format={tok2} />
        </div>
        <div className="mini-cost">
          <AnimatedNumber value={d.live?.today.cost ?? 0} format={(v) => d.money(v)} />
          {d.live && d.live.monthCost > 0 && <span className="mini-sub">本月 {d.money(d.live.monthCost)}</span>}
        </div>
      </div>
      <Buttons />
      <div className="mini-foot" onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)}>
        {d.paused.length > 0 ? (
          <div className="mini-quota mini-paused">
            <span className="guard-dot hot" />
            守卫暂停 {d.paused.length} 个任务{until ? ` · ${countdown(until, now)} 后恢复` : ''}
          </div>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            {item && (
              <motion.div
                key={item.key}
                className="mini-quota"
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -10, opacity: 0 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              >
                {item.node}
              </motion.div>
            )}
          </AnimatePresence>
        )}
        {!d.paused.length && items.length > 1 && (
          <span className="mini-dots" aria-hidden>
            {items.map((it, i) => (
              <i key={it.key} className={i === idx % items.length ? 'on' : ''} />
            ))}
          </span>
        )}
      </div>
    </>
  )
}

/** Small donut for the capsule */
function MiniRing({ pct, color }: { pct: number; color: string }) {
  const R = 11
  const C = 2 * Math.PI * R
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" className="mini-ring" aria-hidden>
      <circle cx="14" cy="14" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="3.5" />
      <circle
        cx="14"
        cy="14"
        r={R}
        fill="none"
        stroke={color}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={C * (1 - Math.min(100, pct) / 100)}
        transform="rotate(-90 14 14)"
      />
    </svg>
  )
}

function CapsuleMini({ d }: { d: MiniData }) {
  const pct = d.five ? d.five.utilization : null
  return (
    <>
      <span className="mini-mark">
        <PulseRings trigger={d.beat} rings={2} />
        <SourceMark size={26} intensity={d.intensity} pulse={d.beat} />
      </span>
      <span className="cap-tokens serif">
        <AnimatedNumber value={d.live?.today.tokens ?? 0} format={tok1} />
      </span>
      <span className="cap-sep" />
      {pct !== null ? (
        <span className="cap-quota" title="5 小时额度">
          <MiniRing pct={pct} color={quotaColor(pct, d.pauseAt)} />
          <span className="tnum">{Math.round(pct)}%</span>
        </span>
      ) : (
        <span className="cap-cost">
          <AnimatedNumber value={d.live?.today.cost ?? 0} format={(v) => d.money(v)} />
        </span>
      )}
      <span className="mini-rate" title="近 1 分钟 tokens/分钟">
        <IconBolt width={10} height={10} />
        <AnimatedNumber value={d.rate?.tokensPerMin ?? 0} format={tok1} />
      </span>
    </>
  )
}

/** main-window backdrops that also flow inside the floating window (theme packs bring pocket scenes of their own) */
const ANIMATED: BackdropStyle[] = ['flow', 'stars', 'aurora', 'ripples']

/** The main window's flowing light, inside the panel */
function MiniFlow({ d, dark, scale }: { d: MiniData; dark: boolean; scale: number }) {
  const level = useMotionLevel()
  const amb = useAmbient(d.settings, d.intensity)
  return (
    <div className="mini-flow" aria-hidden>
      <FlowField
        colors={amb.colors}
        glow={Math.min(1, flowGlow(d.settings?.backdropVivid ?? 0.7, amb.glow, dark) * 1.15)}
        intensity={d.intensity}
        level={level}
        pulse={d.beat}
        pixelScale={scale}
      />
    </div>
  )
}

function OrbMini({ d, paint, scale, glass, cosmic, pocket, dark }: { d: MiniData; paint: string; scale: number; glass: boolean; cosmic: boolean; pocket: BackdropStyle | null; dark: boolean }) {
  const pour = usePour(d)
  const motion = useMotionLevel()
  const level = d.five ? d.five.utilization / 100 : d.live ? d.live.today.cost / d.live.capacity : 0
  return (
    <>
      <PulseRings trigger={d.beat} rings={2} />
      {cosmic ? (
        // the cosmos theme: a black hole whose accretion disk is the 5h window
        <BlackHole key={paint} pct={d.five ? d.five.utilization : null} intensity={d.intensity} level={motion} pulse={d.beat} pixelScale={scale} />
      ) : pocket ? (
        // a theme pack: its own scene in the circle, the 5h window as a ring of light round the rim
        <PocketOrb
          key={paint}
          style={pocket}
          dark={dark}
          intensity={d.intensity}
          level={motion}
          pulse={d.beat}
          size={d.lastUpdate?.addedTokens ?? 0}
          pct={d.five ? d.five.utilization : null}
          vivid={d.settings?.backdropVivid ?? 0.7}
          place={d.settings?.skyPlace ?? null}
          pixelScale={scale}
        />
      ) : (
        <EnergyTank shape="orb" level={level} intensity={d.intensity} pour={pour} theme={paint} pixelScale={scale} glass={glass} />
      )}
      <div className={`orb-text${cosmic ? ' cosmic' : pocket ? ' pocket' : level > 0.58 ? ' on-liquid' : ''}`}>
        <b className="serif">{d.five ? `${Math.round(d.five.utilization)}%` : d.money(d.live?.today.cost ?? 0)}</b>
        <span>{d.paused.length ? '守卫暂停中' : d.five ? (d.source === 'codex' ? 'Codex 5h' : '5h 额度') : '今日费用'}</span>
        <small>
          {fmtTokens(d.live?.today.tokens ?? 0, 1)} · <IconBolt width={9} height={9} />
          {fmtTokens(d.rate?.tokensPerMin ?? 0, 1)}
        </small>
      </div>
    </>
  )
}

export function Mini({ theme, paint }: { theme: string; paint: string }) {
  const d = useMiniData()
  const motion = useMotionLevel()
  const mode = d.settings?.miniMode ?? 'card'
  const scale = d.settings?.miniScale ?? 1
  const alert = useAlert(d.five ? d.five.utilization : null, d.pauseAt)
  // the cosmos backdrop follows into the floating window: a mini galaxy, or a black hole as the orb
  const cosmic = d.settings?.backdrop === 'galaxy'
  // a theme pack plays its own pocket scene inside the panel, the text over it in the scene's own tone
  const pocket = !cosmic && hasPocket(d.settings?.backdrop) ? d.settings!.backdrop : null
  const pdark = pocket ? pocketDark(pocket, theme === 'dark') : false
  const flowing = !!d.settings && (cosmic || !!pocket || ANIMATED.includes(d.settings.backdrop))

  useEffect(() => {
    document.documentElement.classList.add('mini-root')
  }, [])
  // CSS zoom keeps the scale local to this window (Chromium zoom levels are shared per origin)
  useEffect(() => {
    document.documentElement.style.zoom = String(scale)
  }, [scale])

  const cls = [
    'mini',
    `mini-${mode}`,
    `lv${d.intensity}`,
    flowing ? 'flowing' : '',
    cosmic ? 'cosmic' : '',
    pocket ? `pocket ${pdark ? 'pocket-dark' : 'pocket-light'}` : '',
    d.paused.length ? 'paused' : '',
    alert ? 'alert' : '',
    d.settings?.miniClickThrough ? 'through' : ''
  ]
  return (
    <div
      className={cls.filter(Boolean).join(' ')}
      onDoubleClick={() => window.api.showMain()}
      onContextMenu={(e) => {
        e.preventDefault()
        window.api.miniMenu()
      }}
    >
      {flowing && !cosmic && !pocket && <MiniFlow d={d} dark={theme === 'dark'} scale={scale} />}
      {pocket && mode !== 'orb' && (
        <div className="mini-flow" aria-hidden>
          <PocketScene
            key={paint}
            style={pocket}
            shape={mode === 'capsule' ? 'capsule' : 'card'}
            dark={theme === 'dark'}
            intensity={d.intensity}
            level={motion}
            pulse={d.beat}
            size={d.lastUpdate?.addedTokens ?? 0}
            pct={d.five ? d.five.utilization : null}
            vivid={d.settings!.backdropVivid}
            place={d.settings!.skyPlace}
            pixelScale={scale}
          />
        </div>
      )}
      {cosmic && mode !== 'orb' && (
        <div className="mini-flow" aria-hidden>
          <MiniGalaxy key={paint} intensity={d.intensity} level={motion} pulse={d.beat} theme={paint} pixelScale={scale} />
        </div>
      )}
      {motion > 0 && d.beat > 0 && <span key={d.beat} className="mini-sheen" aria-hidden />}
      {mode === 'orb' ? (
        <OrbMini d={d} paint={paint} scale={scale} glass={flowing} cosmic={cosmic} pocket={pocket} dark={theme === 'dark'} />
      ) : mode === 'capsule' ? (
        <CapsuleMini d={d} />
      ) : (
        <CardMini d={d} />
      )}
    </div>
  )
}
