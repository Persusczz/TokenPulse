import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { fmtTokens } from '@shared/format'
import { cnCount, TOKEN_MARKS } from '@shared/milestones'
import type { Achievement, Intensity } from '@shared/types'
import { useApp, useData, useMotionLevel } from '../state'
import { Odometer } from './Numbers'

/**
 * Light and token effects for the main window:
 * - LightFx: light rays from the logo, a glow under the pointer, a glint that
 *   sweeps across the cards (nearest first) and a lens flare on big batches
 * - TokenFx: each batch of tokens floats up from the counter as "+N" and flies
 *   as comets into the energy tank, quota rings, token tiles and the sidebar
 * - Celebration: achievement unlocks burst open in the middle of the window
 * - SideCounter, NextMilestone, useCombo: the counter echoed in the sidebar,
 *   progress to the next daily milestone and a streak of batches in a row
 */

const fxOn = (lightFx: boolean | undefined, level: number) => !!lightFx && level > 0

function fxLayer(): HTMLElement {
  let el = document.getElementById('fx-layer')
  if (!el) {
    el = document.createElement('div')
    el.id = 'fx-layer'
    document.body.appendChild(el)
  }
  return el
}

const shown = (r: DOMRect) => r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth
const mid = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 })

/** where a batch comes from: the big counter on the overview, else the sidebar counter */
function source(): DOMRect | null {
  for (const sel of ['.hero-number', '.side-count b']) {
    const r = document.querySelector(sel)?.getBoundingClientRect()
    if (r && shown(r)) return r
  }
  return null
}

function glint(): void {
  const from = source() ?? new DOMRect(0, 0, 0, 0)
  const o = mid(from)
  const cards = [...document.querySelectorAll<HTMLElement>('.main .card')].filter((c) => shown(c.getBoundingClientRect())).slice(0, 28)
  for (const c of cards) {
    const d = Math.hypot(mid(c.getBoundingClientRect()).x - o.x, mid(c.getBoundingClientRect()).y - o.y)
    const g = document.createElement('span')
    g.className = 'glint'
    g.style.setProperty('--glint-delay', `${Math.round(d / 2.2)}ms`)
    c.appendChild(g)
    g.addEventListener('animationend', () => g.remove(), { once: true })
    setTimeout(() => g.remove(), 3000)
  }
}

function lensFlare(at: DOMRect): void {
  const o = mid(at)
  const el = document.createElement('div')
  el.className = 'lens-flare'
  el.style.left = `${o.x}px`
  el.style.top = `${o.y}px`
  el.innerHTML = '<i class="lf-streak"></i><i class="lf-core"></i><i class="lf-ring"></i><i class="lf-ghost"></i>'
  fxLayer().appendChild(el)
  setTimeout(() => el.remove(), 1500)
}

export function LightFx() {
  const { settings, lastUpdate } = useApp()
  const level = useMotionLevel()
  const live = useData(() => window.api.getLive(), [], 30_000)
  const glow = useRef<HTMLDivElement>(null)
  const [flash, setFlash] = useState(0)
  const on = fxOn(settings?.lightFx, level)
  const intensity = (live?.intensity ?? 0) as Intensity

  useEffect(() => {
    if (!on || !lastUpdate || lastUpdate.addedTokens <= 0) return
    setFlash(lastUpdate.at)
    glint()
    const mark = document.querySelector('.hero-mark')?.getBoundingClientRect()
    if (mark && shown(mark) && lastUpdate.addedTokens >= 20_000) lensFlare(mark)
    const t = setTimeout(() => setFlash(0), 1400)
    return () => clearTimeout(t)
  }, [lastUpdate]) // eslint-disable-line react-hooks/exhaustive-deps

  // a soft light follows the pointer across the window
  useEffect(() => {
    if (!on || level < 2) return
    let raf = 0
    const move = (e: PointerEvent) => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        glow.current?.style.setProperty('transform', `translate(${e.clientX}px, ${e.clientY}px)`)
      })
    }
    addEventListener('pointermove', move, { passive: true })
    return () => {
      removeEventListener('pointermove', move)
      cancelAnimationFrame(raf)
    }
  }, [on, level])

  if (!on) return null
  return (
    <div className={`light-fx${flash ? ' flash' : ''}`} style={{ '--rays': 0.45 + intensity * 0.18 } as CSSProperties} aria-hidden>
      <div className="rays">
        <i style={{ '--a': '12deg', '--d': '17s', '--h': '9vmax' } as CSSProperties} />
        <i style={{ '--a': '24deg', '--d': '23s', '--h': '6vmax' } as CSSProperties} />
        <i style={{ '--a': '35deg', '--d': '19s', '--h': '11vmax' } as CSSProperties} />
        <i style={{ '--a': '48deg', '--d': '27s', '--h': '5vmax' } as CSSProperties} />
        <i style={{ '--a': '61deg', '--d': '21s', '--h': '8vmax' } as CSSProperties} />
      </div>
      {level >= 2 && <div className="cursor-glow" ref={glow} />}
    </div>
  )
}

/** One comet from a to b along a curve; the target lights up when it lands */
function comet(a: { x: number; y: number }, target: HTMLElement, delay: number, big: boolean): void {
  const b = mid(target.getBoundingClientRect())
  const dx = b.x - a.x
  const dy = b.y - a.y
  const bend = (Math.random() - 0.5) * Math.min(260, Math.hypot(dx, dy) * 0.6)
  const len = Math.hypot(dx, dy) || 1
  const c = { x: a.x + dx / 2 - (dy / len) * bend, y: a.y + dy / 2 + (dx / len) * bend - 60 }
  const frames: Keyframe[] = []
  for (let i = 0; i <= 12; i++) {
    const t = i / 12
    const x = (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t * t * b.x
    const y = (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t * t * b.y
    frames.push({ transform: `translate(${x}px, ${y}px) scale(${1 - t * 0.4})`, opacity: t < 0.08 ? t / 0.08 : 1 })
  }
  const duration = 760 + Math.random() * 360
  const layer = fxLayer()
  // a head and two fading trail dots
  for (let k = 0; k < 3; k++) {
    const el = document.createElement('i')
    el.className = `fx-comet${k ? ' trail' : ''}${big ? ' big' : ''}`
    el.style.setProperty('--k', String(k))
    layer.appendChild(el)
    const anim = el.animate(frames, { duration, delay: delay + k * 34, easing: 'cubic-bezier(0.55, 0, 0.7, 1)', fill: 'both' })
    anim.onfinish = () => {
      el.remove()
      if (k === 0) {
        target.classList.remove('fx-hit')
        void target.offsetWidth
        target.classList.add('fx-hit')
        setTimeout(() => target.classList.remove('fx-hit'), 800)
      }
    }
  }
}

function floatChip(text: string, at: DOMRect, big: boolean): void {
  const el = document.createElement('span')
  el.className = `fx-chip${big ? ' big' : ''}`
  el.textContent = text
  el.style.left = `${Math.min(innerWidth - 120, at.right + 10)}px`
  el.style.top = `${at.top + at.height * 0.2}px`
  fxLayer().appendChild(el)
  el.addEventListener('animationend', () => el.remove(), { once: true })
}

export function TokenFx() {
  const { lastUpdate } = useApp()
  const level = useMotionLevel()
  useEffect(() => {
    if (!lastUpdate || lastUpdate.addedTokens <= 0 || !level) return
    const n = lastUpdate.addedTokens
    const from = source()
    if (!from) return
    const big = n >= 100_000
    floatChip(`+${fmtTokens(n, n >= 1e6 ? 2 : 1)}`, from, big)
    if (level < 2) return
    const a = mid(from)
    const targets = ['.tank-card', '.quota-card', '.grid-stats .tile', '.brand-mark', '.side-count']
      .flatMap((sel) => [...document.querySelectorAll<HTMLElement>(sel)])
      .filter((el) => shown(el.getBoundingClientRect()) && !el.contains(document.querySelector('.hero-number')))
    const per = Math.min(2, Math.max(1, Math.round(Math.log10(n) - 3)))
    let i = 0
    for (const t of targets.slice(0, level >= 3 ? 12 : 8)) for (let k = 0; k < per; k++) comet(a, t, i++ * 55, big)
  }, [lastUpdate]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

const TIER = ['', '铜', '银', '金', '传说']

export function Celebration() {
  const { settings } = useApp()
  const level = useMotionLevel()
  const [queue, setQueue] = useState<Achievement[]>([])
  // a big batch gets one celebration: the rarest badge, noting the rest
  useEffect(
    () =>
      window.api.onAchievement((list) => {
        if (list.length > 2) {
          const top = [...list].sort((a, b) => b.tier - a.tier)[0]
          setQueue((q) => [...q, { ...top, desc: `${top.desc} · 另外还解锁了 ${list.length - 1} 个成就` }])
        } else setQueue((q) => [...q, ...list].slice(0, 8))
      }),
    []
  )
  useEffect(() => {
    const fn = (e: Event) => setQueue((q) => [...q, (e as CustomEvent<Achievement>).detail])
    document.addEventListener('tp-celebrate', fn)
    return () => document.removeEventListener('tp-celebrate', fn)
  }, [])
  const cur = queue[0]
  useEffect(() => {
    if (!cur) return
    const t = setTimeout(() => setQueue((q) => q.slice(1)), 3800)
    return () => clearTimeout(t)
  }, [cur])
  if (!fxOn(settings?.lightFx, level)) return null
  return (
    <AnimatePresence>
      {cur && (
        <motion.div
          key={`${cur.id}-${queue.length}`}
          className={`celebrate tier-${cur.tier}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.5 } }}
          onClick={() => setQueue((q) => q.slice(1))}
        >
          <div className="celebrate-rays" />
          <div className="celebrate-burst">
            {Array.from({ length: 18 }, (_, i) => (
              <i key={i} style={{ '--a': `${i * 20 + Math.random() * 10}deg`, '--d': `${90 + Math.random() * 110}px` } as CSSProperties} />
            ))}
          </div>
          <motion.div className="celebrate-badge" initial={{ scale: 0.2, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 14 }}>
            <span className="celebrate-glyph">{cur.icon}</span>
          </motion.div>
          <motion.div className="celebrate-text" initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.25 }}>
            <small>解锁成就 · {TIER[cur.tier]}</small>
            <b>{cur.title}</b>
            <span>{cur.desc}</span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Today's tokens in the sidebar, rolling on every page */
export function SideCounter() {
  const { lastUpdate } = useApp()
  const live = useData(() => window.api.getLive(), [], 15_000)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || !lastUpdate?.addedTokens) return
    el.classList.remove('hit')
    void el.offsetWidth
    el.classList.add('hit')
  }, [lastUpdate])
  return (
    <div className="side-count" ref={ref} title="今日 Token">
      <span>今日</span>
      <b>
        <Odometer text={fmtTokens(live?.today.tokens ?? 0, 2)} />
      </b>
      <span>tokens</span>
    </div>
  )
}

/** Progress toward the next daily token milestone */
export function NextMilestone({ tokens }: { tokens: number }) {
  const next = TOKEN_MARKS.find((m) => m > tokens)
  if (!next) return null
  const prev = [...TOKEN_MARKS].reverse().find((m) => m <= tokens) ?? 0
  const p = Math.max(0.02, (tokens - prev) / (next - prev))
  return (
    <div className="milestone" title="今日 Token 到达里程碑时会有庆祝">
      <span className="milestone-text">
        今日下一个里程碑 <b>{cnCount(next)}</b>
        <span className="muted"> · 还差 {cnCount(next - tokens)}</span>
      </span>
      <span className="milestone-bar">
        <i style={{ width: `${p * 100}%` }} />
      </span>
    </div>
  )
}

/** Batches of new usage arriving less than a minute apart */
export function useCombo(): number {
  const { lastUpdate } = useApp()
  const [combo, setCombo] = useState(0)
  const last = useRef(0)
  useEffect(() => {
    if (!lastUpdate || lastUpdate.addedTokens <= 0) return
    const at = lastUpdate.at
    setCombo((c) => (at - last.current < 60_000 ? c + 1 : 1))
    last.current = at
    const t = setTimeout(() => setCombo(0), 60_000)
    return () => clearTimeout(t)
  }, [lastUpdate])
  return combo
}

export function ComboBadge({ combo }: { combo: number }) {
  return (
    <AnimatePresence>
      {combo >= 2 && (
        <motion.span
          key={combo}
          className={`combo c${Math.min(3, Math.floor(combo / 5))}`}
          initial={{ scale: 1.7, opacity: 0, rotate: -8 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ type: 'spring', stiffness: 520, damping: 18 }}
          title="一分钟内连续到来的用量批次"
        >
          连击 ×{combo}
        </motion.span>
      )}
    </AnimatePresence>
  )
}
