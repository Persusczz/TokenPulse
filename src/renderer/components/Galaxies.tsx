import { AnimatePresence } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtTokens } from '@shared/format'
import type { PromptCost, StarMap, UsageSource } from '@shared/types'
import { useApp, useMotionLevel } from '../state'
import { GalaxyDive } from './GalaxyDive'
import { GalaxyGas } from './GalaxyGas'
import { onFrame, sceneScale } from '../frames'

/**
 * The sky page's two scenes. 项目星系: every project is a spiral galaxy and
 * every prompt of that project one star on its arms, each conversation a
 * chain along one arm (oldest near the core, newest at the rim); the more the
 * project cost, the bigger the galaxy. A click flies into a galaxy, where the
 * conversations can be read. New usage flies in as a comet. 模型行星: every
 * model is a planet around the sun of your total spend, as big as its share.
 */

const TAU = Math.PI * 2
const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return ((h >>> 0) % 100_000) / 100_000
}
export const folder = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p || '（无项目）'
const CN = (n: number) => (n >= 1e8 ? `${(n / 1e8).toFixed(2)} 亿` : n >= 1e4 ? `${(n / 1e4).toFixed(n >= 1e6 ? 0 : 1)} 万` : String(Math.round(n)))

/** a seeded random sequence, so a galaxy keeps its shape between frames and refreshes */
function rng(seed: number) {
  let s = Math.floor(seed * 2 ** 31) || 1
  return () => {
    s = (Math.imul(s, 48271) + 11) % 2147483647
    return (s & 0x7fffffff) / 2147483647
  }
}

// ---------------------------------------------------------------- 项目星系

interface GStar {
  p: PromptCost
  /** from the core, in the overview's pixels */
  rad: number
  ang: number
  size: number
  a: number
}
/** one conversation: its prompts as a chain of stars along an arm */
interface GChain {
  id: string
  stars: GStar[]
}
interface Galaxy {
  key: string
  project: string
  source: UsageSource
  prompts: PromptCost[]
  sessions: number
  cost: number
  tokens: number
  x: number
  y: number
  r: number
  tilt: number
  squash: number
  spin: number
  seed: number
  arms: number
  /** how far it has turned */
  rot: number
  /** the galaxy's light, painted once face-on and turned each frame */
  sprite: HTMLCanvasElement
  /** the same, painted large when flown into */
  hi: HTMLCanvasElement | null
  stars: GStar[]
  chains: GChain[]
}

export type GalaxyHit = { kind: 'star'; p: PromptCost; x: number; y: number; inside: boolean } | { kind: 'galaxy'; g: { project: string; source: UsageSource; prompts: number; sessions: number; cost: number; tokens: number; top: PromptCost | null }; x: number; y: number }

const PALETTE: Record<UsageSource, { core: string; mid: string; star: string; arm: string; young: string; knot: string }> = {
  workbuddy: { core: '220,255,244', mid: '47,165,133', star: '165,230,210', arm: '120,214,182', young: '184,242,220', knot: '101,202,174' },
  claude: { core: '255,238,218', mid: '226,128,90', star: '255,228,204', arm: '255,186,150', young: '196,212,255', knot: '255,120,150' },
  codex: { core: '230,236,255', mid: '98,112,255', star: '214,224,255', arm: '150,172,255', young: '200,240,255', knot: '190,130,255' }
}

/** the glow of each tool's ionised gas: hydrogen pink for Claude, oxygen blue for Codex, green for WorkBuddy */
const ION: Record<UsageSource, [number, number, number]> = { claude: [1, 0.45, 0.55], codex: [0.5, 0.75, 1], workbuddy: [0.45, 1, 0.78] }

/** how tightly the arms wind */
const WIND = 2.4

/** a point on one of the arms, `u` from the core (0) to the rim (1), scattered by `spread` */
function armPlace(rnd: () => number, arms: number, r: number) {
  return (u: number, spread: number) => {
    const arm = Math.floor(rnd() * arms)
    const ang = (arm / arms) * TAU + WIND * Math.log(1 + 5 * u) + (rnd() - 0.5) * spread * (1.1 - u * 0.5)
    return { rad: r * Math.min(1, u + (rnd() - 0.5) * 0.06), ang }
  }
}

/**
 * A spiral galaxy seen face-on: a halo, arms of thousands of stars over a
 * soft glow of the same arms, dark dust along their inner edges, pink
 * star-forming knots, and a bright core. `place` puts a point on an arm.
 */
function paintGalaxy(r: number, dpr: number, source: UsageSource, rnd: () => number, place: (u: number, spread: number) => { rad: number; ang: number }, gas = false): HTMLCanvasElement {
  const pal = PALETTE[source]
  const R = r * 1.2
  const c = document.createElement('canvas')
  c.width = c.height = Math.max(2, Math.ceil(R * 2 * dpr))
  const x = c.getContext('2d')!
  x.setTransform(dpr, 0, 0, dpr, R * dpr, R * dpr)
  // with the shader's gas underneath, the glow and halo come from there: the sprite keeps the stars
  let g = x.createRadialGradient(0, 0, 0, 0, 0, R)
  g.addColorStop(0, `rgba(${pal.mid},${gas ? 0.1 : 0.3})`)
  g.addColorStop(0.45, `rgba(${pal.mid},0.09)`)
  g.addColorStop(1, `rgba(${pal.mid},0)`)
  x.fillStyle = g
  x.fillRect(-R, -R, R * 2, R * 2)
  const pt = (rad: number, ang: number) => [Math.cos(ang) * rad, Math.sin(ang) * rad] as const
  x.globalCompositeOperation = 'lighter'
  // the arms' glow: big soft dabs
  for (let i = 0; i < (gas ? 140 : 420); i++) {
    const q = place(Math.pow(rnd(), 0.8), 0.5)
    const [px, py] = pt(q.rad, q.ang)
    const rr = r * (0.05 + rnd() * 0.06)
    const d = x.createRadialGradient(px, py, 0, px, py, rr)
    d.addColorStop(0, `rgba(${pal.arm},0.07)`)
    d.addColorStop(1, `rgba(${pal.arm},0)`)
    x.fillStyle = d
    x.fillRect(px - rr, py - rr, rr * 2, rr * 2)
  }
  // the stars of the arms, warm inside and young and blue at the rim
  const count = Math.min(9000, Math.round(1400 + r * 22))
  for (let i = 0; i < count; i++) {
    const u = Math.pow(rnd(), 0.85)
    const q = place(u, 0.75)
    const [px, py] = pt(q.rad, q.ang)
    const col = rnd() < u * 0.45 ? pal.young : rnd() < 0.5 ? pal.arm : pal.core
    x.fillStyle = `rgba(${col},${(0.12 + rnd() * 0.5 * (1 - u * 0.4)).toFixed(3)})`
    const sz = (rnd() < 0.06 ? 1.6 : 0.5 + rnd() * 0.7) * Math.max(1, r / 160)
    x.fillRect(px, py, sz, sz)
  }
  // pink knots where stars are being born
  for (let i = 0; i < Math.round(8 + Math.min(60, r / 5)); i++) {
    const q = place(0.35 + rnd() * 0.6, 0.25)
    const [px, py] = pt(q.rad, q.ang)
    const rr = (1.2 + rnd() * 2.2) * Math.max(1, r / 160)
    const d = x.createRadialGradient(px, py, 0, px, py, rr * 3)
    d.addColorStop(0, `rgba(${pal.knot},0.8)`)
    d.addColorStop(1, `rgba(${pal.knot},0)`)
    x.fillStyle = d
    x.fillRect(px - rr * 3, py - rr * 3, rr * 6, rr * 6)
  }
  // dark dust along the inner edge of each arm
  x.globalCompositeOperation = 'source-over'
  for (let i = 0; i < Math.round(260 + Math.min(900, r * 3)); i++) {
    const u = 0.18 + rnd() * 0.7
    const q = place(u, 0.22)
    const [px, py] = pt(q.rad * 0.97, q.ang - 0.16)
    x.fillStyle = `rgba(6,6,16,${(0.08 + rnd() * 0.14).toFixed(3)})`
    const rr = 1 + rnd() * r * 0.02
    x.beginPath()
    x.arc(px, py, rr, 0, TAU)
    x.fill()
  }
  // the core
  x.globalCompositeOperation = 'lighter'
  g = x.createRadialGradient(0, 0, 0, 0, 0, r * 0.36)
  g.addColorStop(0, `rgba(${pal.core},1)`)
  g.addColorStop(0.18, `rgba(${pal.core},0.75)`)
  g.addColorStop(0.55, `rgba(${pal.mid},0.22)`)
  g.addColorStop(1, `rgba(${pal.mid},0)`)
  x.fillStyle = g
  x.fillRect(-r * 0.36, -r * 0.36, r * 0.72, r * 0.72)
  return c
}

/** the projects of the span, costliest first */
function projectsOf(map: StarMap) {
  const by = new Map<string, { key: string; project: string; source: UsageSource; prompts: PromptCost[]; sessions: Set<string>; cost: number; tokens: number }>()
  for (const p of map.prompts) {
    const key = `${p.source}|${p.project}`
    let g = by.get(key)
    if (!g) by.set(key, (g = { key, project: p.project, source: p.source, prompts: [], sessions: new Set(), cost: 0, tokens: 0 }))
    g.prompts.push(p)
    g.sessions.add(p.sessionId)
    g.cost += p.cost
    g.tokens += p.tokens
  }
  return [...by.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
}

/** the panel inside a galaxy takes this much of the stage's right side */
const panelWidth = (W: number) => Math.min(440, Math.max(300, W * 0.4))

export function GalaxyField({ map, onProject }: { map: StarMap; onProject: (project: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const gasRef = useRef<HTMLCanvasElement>(null)
  const level = useMotionLevel()
  const { lastUpdate, money } = useApp()
  const [hit, setHit] = useState<GalaxyHit | null>(null)
  /** the galaxy flown into, the conversation open in it, and what the panel points at */
  const [focus, setFocus] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [hoverSession, setHoverSession] = useState<string | null>(null)
  const [pulse, setPulse] = useState<string | null>(null)
  const [jump, setJump] = useState<{ key: string; n: number } | null>(null)
  const enter = (key: string, project: string) => {
    setFocus(key)
    setSel(null)
    setHit(null)
    onProject(project)
  }
  const leave = () => {
    setFocus(null)
    setSel(null)
    setHoverSession(null)
    setPulse(null)
    onProject(null)
  }
  const pickStar = (p: PromptCost) => {
    setSel(p.sessionId)
    setJump((j) => ({ key: p.key, n: (j?.n ?? 0) + 1 }))
  }
  const live = useRef({ map, setHit, money, focus, sel, hoverSession, pulse, enter, pickStar })
  live.current = { map, setHit, money, focus, sel, hoverSession, pulse, enter, pickStar }
  const redraw = useRef<() => void>(() => {})
  const comets = useRef<{ t0: number; x: number; y: number; to: string; label: string }[]>([])
  const stage = useRef<HTMLDivElement>(null)

  // new usage arrives as a comet, aimed at the project of the latest prompt
  useEffect(() => {
    if (!lastUpdate || lastUpdate.addedTokens <= 0) return
    const last = map.prompts[map.prompts.length - 1]
    const to = last ? `${last.source}|${last.project}` : ''
    comets.current.push({ t0: performance.now(), x: Math.random(), y: Math.random() * 0.2, to, label: `+${fmtTokens(lastUpdate.addedTokens)} Token` })
  }, [lastUpdate]) // eslint-disable-line react-hooks/exhaustive-deps

  // Esc steps back out: the conversation first, then the galaxy
  useEffect(() => {
    if (!focus) return
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (sel) setSel(null)
      else leave()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  // a galaxy that left the span (another range) closes
  const all = useMemo(() => projectsOf(map), [map])
  useEffect(() => {
    if (focus && !all.some((g) => g.key === focus)) leave()
  }, [all]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    // the gas, haze and dust come from a shader layer underneath; without WebGL the 2D sky paints them flat
    const gas = gasRef.current ? new GalaxyGas(gasRef.current) : null
    const fluid = !!gas?.ok
    let W = 0
    let H = 0
    let dpr = 1
    let galaxies: Galaxy[] = []
    let more = 0
    let mixed = false
    let sky: HTMLCanvasElement | null = null
    let twinkle: { x: number; y: number; r: number; ph: number }[] = []
    let built: StarMap | null = null
    let pos = new Float32Array(0)
    let posStars: GStar[] = []
    let posGalaxy: Galaxy[] = []
    let hoverKey: string | null = null
    let hoverGalaxy: string | null = null
    let prev = performance.now()
    const t0 = performance.now()
    /** 0 = all galaxies, 1 = inside the focused one; the last focused one, while flying back out */
    let fk = 0
    let lastFocus: Galaxy | null = null
    let cam = { s: 1, S: 1, camX: 0, camY: 0, offX: 0, offY: 0 }

    const layout = () => {
      const m = live.current.map
      built = m
      dpr = window.devicePixelRatio || 1
      W = canvas.clientWidth
      H = canvas.clientHeight
      canvas.width = Math.max(1, Math.round(W * dpr))
      canvas.height = Math.max(1, Math.round(H * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      gas?.size(W, H, Math.min(1.25, dpr * 0.75) * sceneScale())

      // the backdrop: deep space, a band of the Milky Way, a few nebulae
      sky = document.createElement('canvas')
      sky.width = canvas.width
      sky.height = canvas.height
      const sc = sky.getContext('2d')!
      sc.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (!fluid) {
      const bg = sc.createLinearGradient(0, 0, W, H)
      bg.addColorStop(0, '#070818')
      bg.addColorStop(0.5, '#0b0d26')
      bg.addColorStop(1, '#05060f')
      sc.fillStyle = bg
      sc.fillRect(0, 0, W, H)
      const neb = (x: number, y: number, r: number, c: string) => {
        const g = sc.createRadialGradient(x, y, 0, x, y, r)
        g.addColorStop(0, c)
        g.addColorStop(1, 'rgba(0,0,0,0)')
        sc.fillStyle = g
        sc.fillRect(0, 0, W, H)
      }
      neb(W * 0.15, H * 0.2, H * 0.7, 'rgba(110,70,190,0.20)')
      neb(W * 0.85, H * 0.85, H * 0.8, 'rgba(217,119,87,0.13)')
      neb(W * 0.62, H * 0.1, H * 0.6, 'rgba(70,130,255,0.12)')
      sc.save()
      sc.translate(W / 2, H / 2)
      sc.rotate(-0.32)
      sc.scale(1, 0.16)
      const band = sc.createRadialGradient(0, 0, 0, 0, 0, W * 0.62)
      band.addColorStop(0, 'rgba(200,190,255,0.16)')
      band.addColorStop(0.6, 'rgba(160,150,230,0.06)')
      band.addColorStop(1, 'rgba(0,0,0,0)')
      sc.fillStyle = band
      sc.fillRect(-W, -H * 4, W * 2, H * 8)
      sc.restore()
      }
      const rand = rng(0.37)
      for (let i = 0; i < (W * H) / 700; i++) {
        // half the stars crowd the band
        let x = rand() * W
        let y = rand() * H
        if (i % 2) {
          const u = rand() * 2 - 1
          const v = (rand() + rand() + rand() - 1.5) * 0.12
          x = W / 2 + u * W * 0.6 * Math.cos(-0.32) - v * H * Math.sin(-0.32)
          y = H / 2 + u * W * 0.6 * Math.sin(-0.32) + v * H * Math.cos(-0.32)
        }
        sc.fillStyle = `rgba(220,226,255,${(0.08 + rand() * 0.35).toFixed(2)})`
        sc.fillRect(x, y, rand() < 0.08 ? 1.4 : 0.8, rand() < 0.08 ? 1.4 : 0.8)
      }
      twinkle = Array.from({ length: 50 }, () => ({ x: rand() * W, y: rand() * H, r: 0.6 + rand() * 1.1, ph: rand() * TAU }))

      // the galaxies: biggest in the middle, the rest alternating outwards
      const all = projectsOf(m)
      const n = Math.min(all.length, W < 760 ? 4 : W < 1100 ? 5 : 7)
      more = all.length - n
      const list = all.slice(0, n)
      const order: typeof list = []
      list.forEach((g, i) => (i % 2 ? order.push(g) : order.unshift(g)))
      const maxR = Math.min(H * 0.34, (W / Math.max(1.6, n)) * 0.5)
      const top = list[0]?.cost || list[0]?.tokens || 1
      // size follows spend, gently, so a small project is still a galaxy
      const radius = (g: (typeof list)[number]) => Math.max(Math.min(42, maxR), maxR * Math.pow((list[0]?.cost ? g.cost : g.tokens) / top, 0.4))
      const widths = order.map((g) => Math.max(radius(g) * 2.2, 128))
      const gap = Math.max(8, (W - widths.reduce((a, b) => a + b, 0)) / (order.length + 1))
      const costs = m.prompts.map((p) => p.cost).sort((a, b) => a - b)
      const ref95 = costs[Math.floor(costs.length * 0.95)] || costs[costs.length - 1] || 1
      const old = new Map(galaxies.map((g) => [g.key, g]))
      let cx = gap
      galaxies = order.map((g, k) => {
        const r = radius(g)
        const x = cx + widths[k] / 2
        cx += widths[k] + gap
        const seed = hash(g.key)
        const rnd = rng(seed)
        const arms = g.source === 'codex' ? 3 : 2
        const sprite = paintGalaxy(r, dpr, g.source, rnd, armPlace(rnd, arms, r), fluid)
        // the conversations, oldest by the core and newest at the rim, each a chain along one arm
        const bySession = new Map<string, PromptCost[]>()
        for (const p of [...g.prompts].sort((a, b) => a.ts - b.ts)) {
          const l = bySession.get(p.sessionId)
          if (l) l.push(p)
          else bySession.set(p.sessionId, [p])
        }
        const N = g.prompts.length
        let c = 0
        const chains = [...bySession.entries()].map(([id, ps]) => {
          const arm = Math.floor(hash(id) * arms)
          const u0 = 0.16 + 0.82 * (c / N)
          const u1 = 0.16 + 0.82 * ((c + ps.length) / N)
          c += ps.length
          const off = (hash(`${id}~`) - 0.5) * 0.4
          const stars = ps.map((p, i) => {
            const u = ps.length > 1 ? u0 + (u1 - u0) * 0.9 * (i / (ps.length - 1)) : (u0 + u1) / 2
            const k2 = Math.min(1.6, Math.sqrt(p.cost > 0 ? p.cost / ref95 : 0.05))
            return {
              p,
              rad: r * Math.min(1, u + (rnd() - 0.5) * 0.02),
              ang: (arm / arms) * TAU + WIND * Math.log(1 + 5 * u) + off + (rnd() - 0.5) * 0.1,
              size: 0.9 + 2.4 * Math.min(1, k2) + (k2 > 1 ? (k2 - 1) * 1.6 : 0),
              a: 0.5 + 0.5 * Math.min(1, k2)
            }
          })
          return { id, stars }
        })
        const was = old.get(g.key)
        return {
          key: g.key,
          project: g.project,
          source: g.source,
          prompts: g.prompts,
          sessions: g.sessions.size,
          cost: g.cost,
          tokens: g.tokens,
          x,
          y: H * 0.46 + (g === list[0] ? 0 : (k % 2 ? -1 : 1) * H * 0.06),
          r,
          tilt: (seed - 0.5) * 1.1,
          squash: 0.42 + hash(g.key + 'q') * 0.2,
          spin: (g.source === 'codex' ? -1 : 1) * (0.05 + 0.05 * (1 - r / maxR)),
          seed,
          arms,
          rot: was?.rot ?? 0,
          sprite,
          // the large painting depends on the size: keep it only while the size holds
          hi: was && Math.abs(was.r - r) < 0.5 ? was.hi : null,
          stars: chains.flatMap((ch) => ch.stars),
          chains
        }
      })
      if (lastFocus) lastFocus = galaxies.find((g) => g.key === lastFocus!.key) ?? null
      mixed = new Set(galaxies.map((g) => g.source)).size > 1
      posStars = galaxies.flatMap((g) => g.stars)
      posGalaxy = galaxies.flatMap((g) => g.stars.map(() => g))
      pos = new Float32Array(posStars.length * 2)
    }

    /** the zoom that fits a galaxy beside the panel */
    const fitScale = (g: Galaxy) => Math.max(1, Math.min(((W - panelWidth(W)) * 0.43) / g.r, (H * 0.43) / (g.r * 0.82)))

    const draw = (now: number) => {
      const L = live.current
      if (L.map !== built) layout()
      const dt = Math.min(0.1, (now - prev) / 1000)
      prev = now
      const t = level ? (now - t0) / 1000 : 0
      // flying in and out
      const fg = L.focus ? galaxies.find((g) => g.key === L.focus) ?? null : null
      if (fg) lastFocus = fg
      const target = fg ? 1 : 0
      fk = level ? fk + (target - fk) * Math.min(1, dt * 3.4) : target
      if (Math.abs(target - fk) < 0.002) fk = target
      const e = fk * fk * (3 - 2 * fk)
      const g0 = lastFocus
      if (g0 && !g0.hi && fk > 0) {
        // painted large once, the first time it is flown into
        const rHi = g0.r * fitScale(g0)
        const rnd = rng(g0.seed)
        g0.hi = paintGalaxy(rHi, dpr, g0.source, rnd, armPlace(rnd, g0.arms, rHi), fluid)
      }
      const S = g0 ? fitScale(g0) : 1
      const s = 1 + (S - 1) * e
      const pw = panelWidth(W)
      cam = {
        s,
        S,
        camX: W / 2 + ((g0?.x ?? W / 2) - W / 2) * e,
        camY: H / 2 + ((g0?.y ?? H / 2) - H / 2) * e,
        offX: W / 2 + ((W - pw) / 2 - 8 - W / 2) * e,
        offY: H / 2
      }
      const SX = (x: number) => (x - cam.camX) * s + cam.offX
      const SY = (y: number) => (y - cam.camY) * s + cam.offY

      if (fluid) {
        gas!.render(
          t,
          galaxies.map((g) => {
            const isF = g === g0
            const pal = PALETTE[g.source]
            return {
              x: SX(g.x),
              y: SY(g.y),
              r: g.r * s,
              fade: isF ? 1 : 1 - 0.94 * e,
              squash: isF ? g.squash + (0.82 - g.squash) * e : g.squash,
              tilt: isF ? g.tilt + (-0.16 - g.tilt) * e : g.tilt,
              rot: g.rot,
              arms: g.arms,
              seed: g.seed,
              spin: g.spin < 0 ? -1 : 1,
              focus: isF ? e : 0,
              mid: pal.mid,
              arm: pal.arm,
              ion: ION[g.source]
            }
          }),
          -(W / 2 - cam.camX) * 0.04,
          e
        )
        ctx.clearRect(0, 0, W, H)
      }
      // the sky drifts in a little behind
      if (sky) {
        const k = 1 + 0.12 * e
        ctx.drawImage(sky, (W - W * k) / 2 - (W / 2 - cam.camX) * 0.04, (H - H * k) / 2, W * k, H * k)
      }
      for (const st of twinkle) {
        ctx.globalAlpha = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * 1.7 + st.ph))
        ctx.fillStyle = '#eef1ff'
        ctx.beginPath()
        ctx.arc(st.x, st.y, st.r, 0, TAU)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      let pi = 0
      for (const g of galaxies) {
        const isF = g === g0
        const pal = PALETTE[g.source]
        // the galaxy flown into nearly stops turning, so its stars stay under the pointer
        if (level) g.rot += g.spin * dt * (isF ? 1 - 0.94 * e : 1)
        const fade = isF ? 1 : 1 - 0.94 * e
        const sq = isF ? g.squash + (0.82 - g.squash) * e : g.squash
        const tl = isF ? g.tilt + (-0.16 - g.tilt) * e : g.tilt
        const gx = SX(g.x)
        const gy = SY(g.y)
        const ct = Math.cos(tl)
        const st = Math.sin(tl)
        const at = (rad: number, ang: number) => {
          const px = Math.cos(ang + g.rot) * rad * s
          const py = Math.sin(ang + g.rot) * rad * s * sq
          return [gx + px * ct - py * st, gy + px * st + py * ct] as const
        }
        if (fade < 0.02) {
          // out of sight: nothing of it can be picked
          for (let k = 0; k < g.stars.length; k++, pi++) {
            pos[pi * 2] = -1e4
            pos[pi * 2 + 1] = -1e4
          }
          continue
        }
        const on = hoverGalaxy === g.key && !isF
        const R = g.r * 1.2
        ctx.save()
        ctx.translate(gx, gy)
        ctx.rotate(tl)
        ctx.scale(s, s * sq)
        ctx.rotate(g.rot)
        // inside, the arms step back so the conversations stand out
        const dimArms = isF ? 1 - 0.5 * e : 1
        ctx.globalAlpha = fade * (on ? 1 : 0.92) * (isF && g.hi ? 1 - e : 1) * dimArms
        ctx.drawImage(g.sprite, -R, -R, R * 2, R * 2)
        if (isF && g.hi && e > 0) {
          ctx.globalAlpha = e * dimArms
          ctx.drawImage(g.hi, -R, -R, R * 2, R * 2)
        }
        if (on) {
          ctx.globalCompositeOperation = 'lighter'
          ctx.globalAlpha = 0.25
          ctx.drawImage(g.sprite, -R, -R, R * 2, R * 2)
        }
        ctx.restore()
        // inside: each conversation as a chain of light
        const inside = isF && e > 0.05
        if (inside) {
          for (const ch of g.chains) {
            if (ch.stars.length < 2) continue
            const picked = L.sel === ch.id
            const hov = L.hoverSession === ch.id
            const al = (picked ? 0.95 : hov ? 0.8 : L.sel ? 0.12 : 0.5) * e
            ctx.strokeStyle = picked || hov ? `rgba(255,244,228,${al})` : `rgba(${pal.star},${al})`
            ctx.lineWidth = picked ? 2.4 : hov ? 1.9 : 1.3
            ctx.shadowColor = `rgba(${pal.mid},0.9)`
            ctx.shadowBlur = picked || hov ? 10 : 5
            ctx.beginPath()
            ch.stars.forEach((sg, i) => {
              const [x, y] = at(sg.rad, sg.ang)
              if (i) ctx.lineTo(x, y)
              else ctx.moveTo(x, y)
            })
            ctx.stroke()
            ctx.shadowBlur = 0
          }
        }
        // the prompts
        for (const sg of g.stars) {
          const [x, y] = at(sg.rad, sg.ang)
          pos[pi * 2] = x
          pos[pi * 2 + 1] = y
          pi++
          const hot = hoverKey === sg.p.key
          const mine = inside && (L.sel === sg.p.sessionId || L.hoverSession === sg.p.sessionId)
          const dim = inside && L.sel && L.sel !== sg.p.sessionId && L.hoverSession !== sg.p.sessionId
          const size = sg.size * (1 + (isF ? 1.2 * e : 0)) + (mine ? 0.8 : 0)
          const a = Math.min(1, (sg.a + (isF ? 0.3 * e : 0)) * fade * (dim ? 0.3 : 1))
          // inside, each prompt carries a small cross of light, so it reads as a star of its own
          if (inside && !dim) {
            const fl = size * (2.6 + 1.4 * Math.min(1, sg.a))
            ctx.strokeStyle = `rgba(255,250,240,${(0.55 * a * e).toFixed(3)})`
            ctx.lineWidth = 0.8
            ctx.beginPath()
            ctx.moveTo(x - fl, y)
            ctx.lineTo(x + fl, y)
            ctx.moveTo(x, y - fl)
            ctx.lineTo(x, y + fl)
            ctx.stroke()
          }
          if (size > 2.6 || hot || mine) {
            const gl = ctx.createRadialGradient(x, y, 0, x, y, size * 4)
            gl.addColorStop(0, `rgba(${mine ? '255,246,232' : pal.star},${(0.45 * a).toFixed(3)})`)
            gl.addColorStop(1, `rgba(${pal.star},0)`)
            ctx.fillStyle = gl
            ctx.fillRect(x - size * 4, y - size * 4, size * 8, size * 8)
          }
          ctx.globalAlpha = a
          ctx.fillStyle = hot || mine ? '#fff' : `rgb(${pal.star})`
          ctx.beginPath()
          ctx.arc(x, y, hot ? size + 1.2 : size, 0, TAU)
          ctx.fill()
          ctx.globalAlpha = 1
          if (hot || (inside && L.pulse === sg.p.key)) {
            const k = L.pulse === sg.p.key ? (t * 1.3) % 1 : 0
            ctx.strokeStyle = `rgba(255,255,255,${(0.85 * (1 - k)).toFixed(3)})`
            ctx.lineWidth = 1.2
            ctx.beginPath()
            ctx.arc(x, y, size + 6 + k * 18, 0, TAU)
            ctx.stroke()
          }
        }
        // the open conversation is named by its first star
        if (inside && L.sel) {
          const ch = g.chains.find((c) => c.id === L.sel)
          if (ch) {
            const [x, y] = at(ch.stars[0].rad, ch.stars[0].ang)
            const text = ch.stars[0].p.text || '（没有文字的提问）'
            const label = text.length > 18 ? `${text.slice(0, 18)}…` : text
            ctx.font = '600 12px "Segoe UI", "Microsoft YaHei UI", sans-serif'
            const w = ctx.measureText(label).width + 16
            const lx = Math.max(6, Math.min(W - pw - w - 12, x - w / 2))
            const ly = y - 30
            ctx.globalAlpha = e
            ctx.fillStyle = 'rgba(12,14,34,0.88)'
            ctx.strokeStyle = 'rgba(255,226,190,0.55)'
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.roundRect(lx, ly - 15, w, 22, 11)
            ctx.fill()
            ctx.stroke()
            ctx.fillStyle = '#fff'
            ctx.textAlign = 'left'
            ctx.fillText(label, lx + 8, ly)
            ctx.globalAlpha = 1
          }
        }
        // the name and what it took, under the galaxy (not once inside)
        const la = fade * (1 - e)
        if (la > 0.02) {
          const ly = gy + g.r * s * (sq + 0.32) + 18
          ctx.globalAlpha = la
          ctx.textAlign = 'center'
          ctx.font = `${on ? 700 : 600} 13px "Segoe UI", "Microsoft YaHei UI", sans-serif`
          ctx.fillStyle = on ? '#fff' : 'rgba(236,240,255,0.92)'
          ctx.fillText(folder(g.project), gx, Math.min(H - 22, ly))
          ctx.font = '500 11px "Segoe UI", "Microsoft YaHei UI", sans-serif'
          ctx.fillStyle = 'rgba(190,200,240,0.7)'
          ctx.fillText(`${mixed ? (g.source === 'workbuddy' ? 'WorkBuddy · ' : g.source === 'codex' ? 'Codex · ' : 'Claude · ') : ''}${g.prompts.length} 次提问 · ${L.money(g.cost)}`, gx, Math.min(H - 7, ly + 15))
          ctx.globalAlpha = 1
        }
      }
      if (more > 0 && e < 0.98) {
        ctx.globalAlpha = 1 - e
        ctx.textAlign = 'right'
        ctx.font = '500 11px "Segoe UI", "Microsoft YaHei UI", sans-serif'
        ctx.fillStyle = 'rgba(190,200,240,0.55)'
        ctx.fillText(`另有 ${more} 个小项目`, W - 12, 18)
        ctx.globalAlpha = 1
      }
      // comets
      comets.current = comets.current.filter((c) => now - c.t0 < 2600)
      for (const c of comets.current) {
        const g = galaxies.find((x) => x.key === c.to) ?? galaxies[0]
        if (!g) continue
        const k = Math.min(1, (now - c.t0) / 1500)
        const ek = k * k * (3 - 2 * k)
        const sx = c.x * W
        const sy = c.y * H - 20
        const tx0 = SX(g.x)
        const ty0 = SY(g.y)
        const x = sx + (tx0 - sx) * ek
        const y = sy + (ty0 - sy) * ek - Math.sin(ek * Math.PI) * 40
        if (k < 1) {
          const dx = tx0 - sx
          const dy = ty0 - sy
          const len = Math.hypot(dx, dy) || 1
          const tx = x - (dx / len) * 120 * (1 - ek * 0.4)
          const ty = y - (dy / len) * 120 * (1 - ek * 0.4)
          const tail = ctx.createLinearGradient(x, y, tx, ty)
          tail.addColorStop(0, 'rgba(255,245,230,0.95)')
          tail.addColorStop(1, 'rgba(255,190,140,0)')
          ctx.strokeStyle = tail
          ctx.lineWidth = 3
          ctx.lineCap = 'round'
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.lineTo(tx, ty)
          ctx.stroke()
          ctx.fillStyle = '#fff'
          ctx.beginPath()
          ctx.arc(x, y, 3.2, 0, TAU)
          ctx.fill()
          ctx.font = '600 12px "Segoe UI", sans-serif'
          ctx.textAlign = 'left'
          ctx.fillStyle = 'rgba(255,236,214,0.95)'
          ctx.fillText(c.label, x + 10, y - 8)
        } else {
          // it lands: a flash through the galaxy
          const f = Math.min(1, (now - c.t0 - 1500) / 1100)
          ctx.strokeStyle = `rgba(255,240,220,${(1 - f).toFixed(3)})`
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.ellipse(tx0, ty0, g.r * s * (0.3 + f), g.r * s * (0.3 + f) * g.squash, g.tilt, 0, TAU)
          ctx.stroke()
        }
      }
    }

    // while flying, frames come even with motion turned down
    const loop = (now: number) => draw(now)
    const ro = new ResizeObserver(() => {
      layout()
      draw(performance.now())
    })
    ro.observe(canvas)
    layout()
    draw(performance.now())
    redraw.current = () => draw(performance.now())
    const stop = level ? onFrame(30, (_dt, now) => loop(now), 'sky') : null

    const local = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect()
      return [e.clientX - r.left, e.clientY - r.top] as const
    }
    const find = (mx: number, my: number): GalaxyHit | null => {
      const inside = fk > 0.5
      let best = -1
      let bd = (inside ? 12 : 10) ** 2
      for (let i = 0; i < posStars.length; i++) {
        if (inside && posGalaxy[i] !== lastFocus) continue
        const d = (pos[i * 2] - mx) ** 2 + (pos[i * 2 + 1] - my) ** 2
        if (d < bd) {
          bd = d
          best = i
        }
      }
      if (best >= 0) return { kind: 'star', p: posStars[best].p, x: pos[best * 2], y: pos[best * 2 + 1], inside }
      if (inside) return null
      for (const g of galaxies) {
        if (Math.hypot(mx - g.x, (my - g.y) / 0.75) < g.r * 1.05) {
          const top = [...g.prompts].sort((a, b) => b.cost - a.cost)[0] ?? null
          return { kind: 'galaxy', g: { project: g.project, source: g.source, prompts: g.prompts.length, sessions: g.sessions, cost: g.cost, tokens: g.tokens, top }, x: g.x, y: g.y - g.r * 0.6 }
        }
      }
      return null
    }
    const move = (e: MouseEvent) => {
      const [mx, my] = local(e)
      const h = find(mx, my)
      hoverKey = h?.kind === 'star' ? h.p.key : null
      hoverGalaxy = h?.kind === 'galaxy' ? `${h.g.source}|${h.g.project}` : h?.kind === 'star' ? `${h.p.source}|${h.p.project}` : null
      live.current.setHit(h)
      canvas.style.cursor = h ? 'pointer' : 'default'
      if (!level) draw(performance.now())
    }
    const out = () => {
      hoverKey = null
      hoverGalaxy = null
      live.current.setHit(null)
      if (!level) draw(performance.now())
    }
    const click = (e: MouseEvent) => {
      const [mx, my] = local(e)
      const h = find(mx, my)
      const L = live.current
      if (h?.kind === 'galaxy') L.enter(`${h.g.source}|${h.g.project}`, h.g.project)
      else if (h?.kind === 'star') {
        // outside: fly into its galaxy with its conversation open; inside: open it
        if (!h.inside) L.enter(`${h.p.source}|${h.p.project}`, h.p.project)
        L.pickStar(h.p)
      }
      if (!level) setTimeout(() => draw(performance.now()), 0)
    }
    canvas.addEventListener('mousemove', move)
    canvas.addEventListener('mouseleave', out)
    canvas.addEventListener('click', click)
    return () => {
      stop?.()
      gas?.dispose()
      ro.disconnect()
      canvas.removeEventListener('mousemove', move)
      canvas.removeEventListener('mouseleave', out)
      canvas.removeEventListener('click', click)
    }
  }, [level])
  // with motion off nothing loops: draw again when what is shown changes
  useEffect(() => {
    if (!level) redraw.current()
  }, [level, map, focus, sel, hoverSession, pulse])

  const fg = focus ? all.find((g) => g.key === focus) : null
  const fgSessions = useMemo(() => new Set(fg?.prompts.map((p) => p.sessionId)), [fg])
  const stamp = (t: number) => new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <div className={`galaxy-stage${focus ? ' inside' : ''}`} ref={stage}>
      <canvas ref={gasRef} className="galaxy-canvas galaxy-gas" aria-hidden />
      <canvas ref={ref} className="galaxy-canvas" />
      {hit && (
        <div className={`starmap-tip${hit.x > (stage.current?.clientWidth ?? 900) - (focus ? 360 + panelWidth(stage.current?.clientWidth ?? 900) : 360) ? ' left' : ''}`} style={{ left: hit.x, top: hit.y }}>
          {hit.kind === 'star' ? (
            <>
              <div className="starmap-tip-time">
                {stamp(hit.p.ts)} · {folder(hit.p.project)}
              </div>
              <div className="starmap-tip-text">{hit.p.text || '（没有文字的提问）'}</div>
              <div className="starmap-tip-nums tnum">
                <b>{money(hit.p.cost)}</b> · {CN(hit.p.tokens)} Token · {hit.p.requests} 次请求
              </div>
            </>
          ) : (
            <>
              <div className="starmap-tip-time">{hit.g.source === 'workbuddy' ? 'WorkBuddy 项目' : hit.g.source === 'codex' ? 'Codex 项目' : 'Claude 项目'}</div>
              <div className="starmap-tip-text">{folder(hit.g.project)}</div>
              <div className="starmap-tip-nums tnum">
                <b>{money(hit.g.cost)}</b> · {hit.g.prompts} 次提问 · {hit.g.sessions} 段对话 · {CN(hit.g.tokens)} Token
              </div>
              {hit.g.top && <div className="muted ellipsis">最亮的一颗：{hit.g.top.text || '（没有文字）'}</div>}
            </>
          )}
        </div>
      )}
      <AnimatePresence>
        {fg && (
          <GalaxyDive
            key={fg.key}
            g={fg}
            sessions={map.sessions.filter((s) => fgSessions.has(s.id))}
            sel={sel}
            onSel={(id) => {
              setSel(id)
              setPulse(null)
            }}
            onHoverSession={setHoverSession}
            onPulse={setPulse}
            jump={jump}
            onBack={leave}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------------------------------------------------------------- 模型行星

/** a planet's colours by model family: [lit side, shadow side] */
function planetColors(name: string, source: UsageSource): [string, string] {
  const n = name.toLowerCase()
  if (n.includes('opus')) return ['#f6b08a', '#b4532f']
  if (n.includes('sonnet')) return ['#9fe3cf', '#2f8f7e']
  if (n.includes('haiku')) return ['#bcd5ff', '#4a74d6']
  if (n.includes('deepseek')) return ['#9ad8ff', '#2a7fb8']
  if (n.includes('grok')) return ['#e2e2e2', '#6c6c6c']
  if (source === 'codex' || /gpt|^o\d|codex/.test(n)) return ['#c2c9ff', '#4c5be0']
  const h = Math.round(hash(n) * 360)
  return [`hsl(${h} 70% 78%)`, `hsl(${h} 55% 38%)`]
}

export function PlanetSystem({ models, source }: { models: StarMap['models']; source: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const level = useMotionLevel()
  const { money } = useApp()
  const [hit, setHit] = useState<{ m: StarMap['models'][number]; share: number; x: number; y: number } | null>(null)
  const list = useMemo(() => models.slice(0, 7), [models])
  const total = useMemo(() => models.reduce((a, m) => a + m.cost, 0), [models])
  const live = useRef({ list, total, setHit, source, money })
  live.current = { list, total, setHit, source, money }
  const redraw = useRef<() => void>(() => {})

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    let W = 0
    let H = 0
    let hover: string | null = null
    let spots: { name: string; x: number; y: number; r: number }[] = []
    let dust: { x: number; y: number; a: number }[] = []
    const t0 = performance.now()
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      W = canvas.clientWidth
      H = canvas.clientHeight
      canvas.width = Math.max(1, Math.round(W * dpr))
      canvas.height = Math.max(1, Math.round(H * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const rand = rng(0.71)
      dust = Array.from({ length: Math.round((W * H) / 900) }, () => ({ x: rand() * W, y: rand() * H, a: 0.08 + rand() * 0.3 }))
    }
    const draw = (now: number) => {
      const { list: ms, total: sum, source: src, money } = live.current
      const t = level ? (now - t0) / 1000 : 0
      const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7)
      bg.addColorStop(0, '#0e1230')
      bg.addColorStop(1, '#04050d')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#dfe4ff'
      for (const d of dust) {
        ctx.globalAlpha = d.a
        ctx.fillRect(d.x, d.y, 0.8, 0.8)
      }
      ctx.globalAlpha = 1
      const cx = W / 2
      const cy = H * 0.47
      const sunR = Math.min(32, H * 0.1)
      const outer = Math.min(W / 2 - 70, (H * 0.44) / 0.42)
      const n = ms.length
      const inner = sunR + 64
      const orbit = (i: number) => (n > 1 ? inner + (i / (n - 1)) * (outer - inner) : (inner + outer) / 2)
      const flat = 0.5
      // the biggest on the outer orbit, where it has room; the far side drawn before the sun
      const planets = ms.map((m, i) => {
        const rx = orbit(n - 1 - i)
        const a = hash(m.name) * TAU + t * (0.42 / Math.pow(n - i, 1.15))
        const share = sum > 0 ? m.cost / sum : 1 / n
        return { m, i, rx, a, share, x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * rx * flat, r: 6 + 20 * Math.sqrt(share) }
      })
      for (const p of planets) {
        ctx.strokeStyle = hover === p.m.name ? 'rgba(255,255,255,0.35)' : 'rgba(200,210,255,0.1)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.ellipse(cx, cy, p.rx, p.rx * flat, 0, 0, TAU)
        ctx.stroke()
      }
      const planet = (p: (typeof planets)[number]) => {
        const [lit, dark] = planetColors(p.m.name, p.m.source)
        const dx = cx - p.x
        const dy = cy - p.y
        const dl = Math.hypot(dx, dy) || 1
        const hx = p.x + (dx / dl) * p.r * 0.45
        const hy = p.y + (dy / dl) * p.r * 0.45
        const g = ctx.createRadialGradient(hx, hy, p.r * 0.1, p.x, p.y, p.r * 1.05)
        g.addColorStop(0, lit)
        g.addColorStop(1, dark)
        // the biggest gets a ring
        const ringed = p.i === 0 && p.r > 12
        if (ringed) {
          ctx.strokeStyle = 'rgba(255,230,200,0.35)'
          ctx.lineWidth = 2.5
          ctx.beginPath()
          ctx.ellipse(p.x, p.y, p.r * 1.9, p.r * 0.55, -0.35, Math.PI, TAU)
          ctx.stroke()
        }
        ctx.fillStyle = g
        ctx.shadowColor = lit
        ctx.shadowBlur = hover === p.m.name ? 22 : 10
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, TAU)
        ctx.fill()
        ctx.shadowBlur = 0
        if (ringed) {
          ctx.strokeStyle = 'rgba(255,230,200,0.5)'
          ctx.lineWidth = 2.5
          ctx.beginPath()
          ctx.ellipse(p.x, p.y, p.r * 1.9, p.r * 0.55, -0.35, 0, Math.PI)
          ctx.stroke()
        }
      }
      // names last, so no body ever covers one: on the side facing away from the sun,
      // moved down a line when two would overlap
      const placed: { x0: number; x1: number; y: number }[] = []
      const label = (p: (typeof planets)[number]) => {
        const right = p.x >= cx
        ctx.textAlign = right ? 'left' : 'right'
        const lx = p.x + (right ? 1 : -1) * (p.r + 8)
        const sub = `${p.share < 0.01 ? '<1' : Math.round(p.share * 100)}% · ${money(p.m.cost)}`
        ctx.font = '600 12px "Segoe UI", "Microsoft YaHei UI", sans-serif'
        const w = Math.max(ctx.measureText(p.m.name).width, ctx.measureText(sub).width * 0.9)
        const x0 = right ? lx : lx - w
        let y = p.y
        for (let k = 0; k < 6 && placed.some((q) => q.x0 < x0 + w && x0 < q.x1 && Math.abs(q.y - y) < 28); k++) y += 28
        placed.push({ x0, x1: x0 + w, y })
        ctx.fillStyle = 'rgba(240,243,255,0.95)'
        ctx.shadowColor = 'rgba(0,0,0,0.8)'
        ctx.shadowBlur = 4
        ctx.fillText(p.m.name, lx, y - 2)
        ctx.font = '500 10.5px "Segoe UI", sans-serif'
        ctx.fillStyle = 'rgba(200,210,245,0.85)'
        ctx.fillText(sub, lx, y + 12)
        ctx.shadowBlur = 0
      }
      const behind = planets.filter((p) => Math.sin(p.a) < 0)
      const front = planets.filter((p) => Math.sin(p.a) >= 0)
      behind.sort((a, b) => a.y - b.y).forEach(planet)
      // the sun: everything spent in the span
      const sunCol = src === 'codex' ? ['#eef0ff', '#7d8cff', '91,108,255'] : src === 'claude' ? ['#fff3e4', '#f0a070', '217,119,87'] : src === 'workbuddy' ? ['#ecfff8', '#6fd6b4', '47,165,133'] : ['#fffaf0', '#ffd08a', '255,190,120']
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, sunR * 3.4)
      halo.addColorStop(0, `rgba(${sunCol[2]},0.55)`)
      halo.addColorStop(1, `rgba(${sunCol[2]},0)`)
      ctx.fillStyle = halo
      ctx.beginPath()
      ctx.arc(cx, cy, sunR * 3.4 * (1 + 0.04 * Math.sin(t * 1.3)), 0, TAU)
      ctx.fill()
      const core = ctx.createRadialGradient(cx - sunR * 0.3, cy - sunR * 0.3, 0, cx, cy, sunR)
      core.addColorStop(0, sunCol[0])
      core.addColorStop(1, sunCol[1])
      ctx.fillStyle = core
      ctx.beginPath()
      ctx.arc(cx, cy, sunR, 0, TAU)
      ctx.fill()
      ctx.textAlign = 'center'
      ctx.font = '700 13px "Segoe UI", sans-serif'
      ctx.fillStyle = '#fff'
      ctx.fillText(money(sum), cx, cy + sunR + 18)
      ctx.font = '500 10.5px "Segoe UI", "Microsoft YaHei UI", sans-serif'
      ctx.fillStyle = 'rgba(200,210,245,0.75)'
      ctx.fillText(`${n} 个模型合计`, cx, cy + sunR + 32)
      front.sort((a, b) => a.y - b.y).forEach(planet)
      ;[...planets].sort((a, b) => b.share - a.share).forEach(label)
      spots = planets.map((p) => ({ name: p.m.name, x: p.x, y: p.y, r: p.r }))
    }
    const loop = (now: number) => draw(now)
    const ro = new ResizeObserver(() => {
      resize()
      draw(performance.now())
    })
    ro.observe(canvas)
    resize()
    draw(performance.now())
    redraw.current = () => draw(performance.now())
    const stop = level ? onFrame(30, (_dt, now) => loop(now), 'sky') : null
    const move = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect()
      const mx = e.clientX - r.left
      const my = e.clientY - r.top
      const s = spots.find((p) => Math.hypot(p.x - mx, p.y - my) < Math.max(10, p.r + 4))
      hover = s?.name ?? null
      const m = s ? live.current.list.find((x) => x.name === s.name) : null
      live.current.setHit(m && s ? { m, share: live.current.total > 0 ? m.cost / live.current.total : 0, x: s.x, y: s.y - s.r - 6 } : null)
      if (!level) draw(performance.now())
    }
    const leave = () => {
      hover = null
      live.current.setHit(null)
    }
    canvas.addEventListener('mousemove', move)
    canvas.addEventListener('mouseleave', leave)
    return () => {
      stop?.()
      ro.disconnect()
      canvas.removeEventListener('mousemove', move)
      canvas.removeEventListener('mouseleave', leave)
    }
  }, [level])
  useEffect(() => {
    if (!level) redraw.current()
  }, [level, list])

  return (
    <div className="planet-stage" ref={stage}>
      <canvas ref={ref} className="planet-canvas" />
      {!models.length && <div className="starmap-empty">这段时间还没有用量</div>}
      {hit && (
        <div className={`starmap-tip up${hit.x > (stage.current?.clientWidth ?? 600) - 300 ? ' left' : ''}`} style={{ left: hit.x, top: hit.y }}>
          <div className="starmap-tip-time">{hit.m.source === 'workbuddy' ? 'WorkBuddy 模型' : hit.m.source === 'codex' ? 'Codex 模型' : 'Claude 模型'}</div>
          <div className="starmap-tip-text">{hit.m.name}</div>
          <div className="starmap-tip-nums tnum">
            <b>{money(hit.m.cost)}</b> · 占 {Math.round(hit.share * 100)}% · {CN(hit.m.tokens)} Token · {hit.m.requests} 次请求
          </div>
        </div>
      )}
    </div>
  )
}
