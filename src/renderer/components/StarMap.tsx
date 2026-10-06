import { useEffect, useRef } from 'react'
import type { PromptCost, StarMap as StarMapData } from '@shared/types'
import { useMotionLevel } from '../state'
import { onFrame } from '../frames'

/**
 * The star map: every prompt of the last days is a star. Across: the days,
 * oldest on the left; down: the time of day, midnight at the top. The more a
 * prompt cost, the bigger and brighter its star; Claude's stars are warm,
 * Codex's cool; the prompts of one session are joined into a constellation.
 * Where you work most, a faint Milky Way gathers.
 */

const DAY = 86_400_000
const PAD = { l: 46, r: 14, t: 16, b: 30 }
const TAU = Math.PI * 2

const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10_000) / 10_000
}
const mixRgb = (a: number[], b: number[], k: number) => a.map((v, i) => Math.round(v + (b[i] - v) * k))

export interface StarHit {
  p: PromptCost
  x: number
  y: number
}

interface Star {
  p: PromptCost
  x: number
  y: number
  r: number
  a: number
  col: number[]
  tw: number
  bright: boolean
  day: number
}

export interface StarMapProps {
  map: StarMapData
  /** prompts whose text holds this light up; the rest dim */
  search: string
  project: string | null
  lines: boolean
  /** a star to flash (the brightest list's click) */
  flash: string | null
  onHover: (h: StarHit | null) => void
  onPick: (p: PromptCost) => void
}

export function StarMapCanvas(props: StarMapProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const level = useMotionLevel()
  const live = useRef(props)
  live.current = props
  const hoverKey = useRef<string | null>(null)
  const seen = useRef<Set<string> | null>(null)
  const redraw = useRef<() => void>(() => {})

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    let W = 0
    let H = 0
    let stars: Star[] = []
    let byDay: Star[][] = []
    let sessions = new Map<string, Star[]>()
    let glow: HTMLCanvasElement | null = null
    let dust: { x: number; y: number; a: number }[] = []
    let night: HTMLCanvasElement | null = null
    let colW = 0
    let built: StarMapData | null = null
    let sweptDays = 0
    const falling = new Map<string, { t0: number; fx: number; fy: number }>()
    let t0 = performance.now()

    const layout = () => {
      const m = live.current.map
      built = m
      const dpr = window.devicePixelRatio || 1
      W = canvas.clientWidth
      H = canvas.clientHeight
      canvas.width = Math.max(1, Math.round(W * dpr))
      canvas.height = Math.max(1, Math.round(H * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const days = m.days
      colW = (W - PAD.l - PAD.r) / days
      const ph = H - PAD.t - PAD.b
      const costs = m.prompts.map((p) => p.cost).filter((c) => c > 0).sort((a, b) => a - b)
      const ref95 = costs[Math.floor(costs.length * 0.95)] || costs[costs.length - 1] || 1
      const toks = m.prompts.map((p) => p.tokens).sort((a, b) => a - b)
      const tok95 = toks[Math.floor(toks.length * 0.95)] || 1
      const warm = [255, 241, 220]
      const hot = [255, 168, 120]
      const cool = [228, 236, 255]
      const blue = [140, 160, 255]
      stars = m.prompts.map((p) => {
        const d = new Date(p.ts)
        const day = Math.max(0, Math.min(days - 1, Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - m.from) / DAY)))
        const min = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
        const k = Math.min(1.6, Math.sqrt(p.cost > 0 ? p.cost / ref95 : p.tokens / tok95))
        const j = hash(p.key) - 0.5
        return {
          p,
          day,
          x: PAD.l + (day + 0.5 + j * 0.72) * colW,
          y: PAD.t + (min / 1440) * ph,
          r: 0.8 + 2.7 * Math.min(1, k) + (k > 1 ? (k - 1) * 1.5 : 0),
          a: 0.42 + 0.58 * Math.min(1, k),
          col: p.source === 'codex' ? mixRgb(cool, blue, Math.min(1, k) * 0.7) : mixRgb(warm, hot, Math.min(1, k) * 0.6),
          tw: hash(p.key + '~') * TAU,
          bright: k >= 0.8
        }
      })
      byDay = Array.from({ length: days }, () => [])
      sessions = new Map()
      for (const s of stars) {
        byDay[s.day].push(s)
        const l = sessions.get(s.p.sessionId)
        if (l) l.push(s)
        else sessions.set(s.p.sessionId, [s])
      }
      // where the work gathers: a soft glow from half-hour cells
      const cells = new Float32Array(days * 48)
      for (const s of stars) cells[s.day * 48 + Math.min(47, Math.floor(((s.y - PAD.t) / ph) * 48))] += s.p.tokens
      const peak = Math.max(1, ...cells)
      const small = document.createElement('canvas')
      small.width = days
      small.height = 48
      const sc = small.getContext('2d')!
      const img = sc.createImageData(days, 48)
      for (let d = 0; d < days; d++)
        for (let h = 0; h < 48; h++) {
          const v = Math.sqrt(cells[d * 48 + h] / peak)
          const o = (h * days + d) * 4
          img.data[o] = 150
          img.data[o + 1] = 140
          img.data[o + 2] = 255
          img.data[o + 3] = Math.round(v * 150)
        }
      sc.putImageData(img, 0, 0)
      glow = document.createElement('canvas')
      glow.width = Math.max(1, Math.round(W))
      glow.height = Math.max(1, Math.round(H))
      const gc = glow.getContext('2d')!
      gc.filter = `blur(${Math.max(8, colW * 0.9)}px)`
      gc.imageSmoothingEnabled = true
      gc.drawImage(small, PAD.l, PAD.t, W - PAD.l - PAD.r, ph)
      // the night behind the data, painted once: deep blue, a few nebulae, a band of the Milky Way, dust
      dust = Array.from({ length: Math.round((W * H) / 2600) }, (_, i) => ({ x: hash(`d${i}`) * W, y: hash(`e${i}`) * H, a: 0.05 + hash(`f${i}`) * 0.12 }))
      night = document.createElement('canvas')
      night.width = canvas.width
      night.height = canvas.height
      const nc = night.getContext('2d')!
      nc.setTransform(dpr, 0, 0, dpr, 0, 0)
      const bg = nc.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.45, Math.max(W, H) * 0.75)
      bg.addColorStop(0, '#111a3a')
      bg.addColorStop(1, '#05070f')
      nc.fillStyle = bg
      nc.fillRect(0, 0, W, H)
      for (const [x, y, r, c] of [
        [0.12, 0.25, 0.55, 'rgba(120,80,210,0.14)'],
        [0.9, 0.8, 0.6, 'rgba(217,119,87,0.10)'],
        [0.55, 0.05, 0.5, 'rgba(70,140,255,0.10)']
      ] as const) {
        const g = nc.createRadialGradient(x * W, y * H, 0, x * W, y * H, r * H)
        g.addColorStop(0, c)
        g.addColorStop(1, 'rgba(0,0,0,0)')
        nc.fillStyle = g
        nc.fillRect(0, 0, W, H)
      }
      nc.save()
      nc.translate(W / 2, H / 2)
      nc.rotate(0.38)
      nc.scale(1, 0.13)
      const band = nc.createRadialGradient(0, 0, 0, 0, 0, W * 0.65)
      band.addColorStop(0, 'rgba(200,195,255,0.12)')
      band.addColorStop(1, 'rgba(0,0,0,0)')
      nc.fillStyle = band
      nc.fillRect(-W, -H * 5, W * 2, H * 10)
      nc.restore()
      nc.fillStyle = '#c8d2ff'
      for (const d of dust) {
        nc.globalAlpha = d.a
        nc.fillRect(d.x, d.y, 0.7, 0.7)
      }
      for (let i = 0; i < (W * H) / 3000; i++) {
        // more dust along the band
        const u = hash(`m${i}`) * 2 - 1
        const v = (hash(`n${i}`) + hash(`o${i}`) - 1) * 0.1
        nc.globalAlpha = 0.06 + hash(`p${i}`) * 0.18
        nc.fillRect(W / 2 + u * W * 0.6 * Math.cos(0.38) - v * H * Math.sin(0.38), H / 2 + u * W * 0.6 * Math.sin(0.38) + v * H * Math.cos(0.38), 0.8, 0.8)
      }
      nc.globalAlpha = 1
      // prompts that arrived since the last look fall into place
      const prev = seen.current
      if (prev) for (const s of stars) if (!prev.has(s.p.key)) falling.set(s.p.key, { t0: performance.now(), fx: s.x + 180, fy: -40 })
      seen.current = new Set(stars.map((s) => s.p.key))
      // the sweep plays when the map opens or its span changes, not on every refresh
      if (sweptDays !== days) {
        sweptDays = days
        t0 = performance.now()
      }
    }

    const pick = (mx: number, my: number): Star | null => {
      if (!colW) return null
      const d = Math.floor((mx - PAD.l) / colW)
      let best: Star | null = null
      let bd = 14 * 14
      for (let k = d - 1; k <= d + 1; k++)
        for (const s of byDay[k] ?? []) {
          const dd = (s.x - mx) ** 2 + (s.y - my) ** 2
          if (dd < bd) {
            bd = dd
            best = s
          }
        }
      return best
    }

    const draw = (now: number) => {
      const P = live.current
      if (P.map !== built) layout()
      const m = P.map
      const t = (now - t0) / 1000
      const ph = H - PAD.t - PAD.b
      // the night sky of the card
      if (night) ctx.drawImage(night, 0, 0, W, H)
      if (glow) ctx.drawImage(glow, 0, 0, W, H)
      // hours down the side, a line at 6, 12 and 18
      ctx.font = '500 10.5px "Segoe UI", sans-serif'
      ctx.textAlign = 'right'
      for (const h of [0, 6, 12, 18, 24]) {
        const y = PAD.t + (h / 24) * ph
        ctx.fillStyle = 'rgba(200,210,255,0.45)'
        ctx.fillText(`${h} 时`, PAD.l - 8, y + 3.5)
        ctx.strokeStyle = 'rgba(200,210,255,0.07)'
        ctx.beginPath()
        ctx.moveTo(PAD.l, y)
        ctx.lineTo(W - PAD.r, y)
        ctx.stroke()
      }
      // days along the bottom; a line before each Monday
      ctx.textAlign = 'center'
      const every = m.days <= 7 ? 1 : m.days <= 31 ? 3 : 7
      for (let d = 0; d < m.days; d++) {
        const day = new Date(m.from + d * DAY + DAY / 2)
        const x = PAD.l + (d + 0.5) * colW
        if (day.getDay() === 1) {
          ctx.strokeStyle = 'rgba(200,210,255,0.06)'
          ctx.beginPath()
          ctx.moveTo(PAD.l + d * colW, PAD.t)
          ctx.lineTo(PAD.l + d * colW, H - PAD.b)
          ctx.stroke()
        }
        if ((m.days - 1 - d) % every === 0) {
          ctx.fillStyle = d === m.days - 1 ? 'rgba(255,220,170,0.85)' : 'rgba(200,210,255,0.45)'
          ctx.fillText(d === m.days - 1 ? '今天' : `${day.getMonth() + 1}/${day.getDate()}`, x, H - 10)
        }
      }
      // today: a faint band, and where the day is now
      const tx = PAD.l + (m.days - 1) * colW
      ctx.fillStyle = 'rgba(255,214,150,0.045)'
      ctx.fillRect(tx, PAD.t, colW, ph)
      const nd = new Date()
      const ny = PAD.t + ((nd.getHours() * 60 + nd.getMinutes()) / 1440) * ph
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.2)
      ctx.strokeStyle = `rgba(255,214,150,${0.25 + 0.3 * pulse})`
      ctx.beginPath()
      ctx.arc(tx + colW / 2, ny, 6 + pulse * 3, 0, TAU)
      ctx.stroke()

      const q = P.search.trim().toLowerCase()
      const dim = (s: Star) => (P.project && s.p.project !== P.project) || (q && !s.p.text.toLowerCase().includes(q))
      const hovered = hoverKey.current ? stars.find((s) => s.p.key === hoverKey.current) : null
      const focusSession = hovered?.p.sessionId ?? null
      // constellations: one line through each session's prompts, in order
      if (P.lines) {
        ctx.lineWidth = 0.8
        for (const [id, list] of sessions) {
          if (list.length < 2 || id === focusSession) continue
          const off = list.every(dim)
          ctx.strokeStyle = list[0].p.source === 'codex' ? `rgba(150,170,255,${off ? 0.04 : 0.16})` : `rgba(255,200,160,${off ? 0.04 : 0.16})`
          ctx.beginPath()
          list.forEach((s, i) => (i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y)))
          ctx.stroke()
        }
      }
      // the stars, swept in from the left when the map changes
      const sweep = level ? Math.min(1, t / 1.1) : 1
      const edge = PAD.l + sweep * (W - PAD.l)
      for (const s of stars) {
        if (s.x > edge + 30) continue
        const fall = falling.get(s.p.key)
        let x = s.x
        let y = s.y
        if (fall) {
          const k = Math.min(1, (now - fall.t0) / 1100)
          const e = 1 - (1 - k) ** 3
          x = fall.fx + (s.x - fall.fx) * e
          y = fall.fy + (s.y - fall.fy) * e
          if (k < 1) {
            const tail = ctx.createLinearGradient(x, y, x + 60 * (1 - e), y - 50 * (1 - e))
            tail.addColorStop(0, `rgba(${s.col.join(',')},0.9)`)
            tail.addColorStop(1, `rgba(${s.col.join(',')},0)`)
            ctx.strokeStyle = tail
            ctx.lineWidth = 1.5
            ctx.beginPath()
            ctx.moveTo(x, y)
            ctx.lineTo(x + 60 * (1 - e), y - 50 * (1 - e))
            ctx.stroke()
          } else falling.delete(s.p.key)
        }
        const fade = Math.min(1, (edge + 30 - s.x) / 60)
        const tw = level ? 0.82 + 0.18 * Math.sin(t * (1 + (s.tw % 1.3)) + s.tw) : 1
        const off = dim(s) || (focusSession && s.p.sessionId !== focusSession)
        const a = s.a * tw * fade * (off ? 0.16 : 1)
        if (s.bright && !off) {
          const g = ctx.createRadialGradient(x, y, 0, x, y, s.r * 5)
          g.addColorStop(0, `rgba(${s.col.join(',')},${(0.45 * a).toFixed(3)})`)
          g.addColorStop(1, `rgba(${s.col.join(',')},0)`)
          ctx.fillStyle = g
          ctx.fillRect(x - s.r * 5, y - s.r * 5, s.r * 10, s.r * 10)
          // a little cross of light on the brightest
          ctx.strokeStyle = `rgba(${s.col.join(',')},${(0.5 * a).toFixed(3)})`
          ctx.lineWidth = 0.7
          ctx.beginPath()
          ctx.moveTo(x - s.r * 3.4, y)
          ctx.lineTo(x + s.r * 3.4, y)
          ctx.moveTo(x, y - s.r * 3.4)
          ctx.lineTo(x, y + s.r * 3.4)
          ctx.stroke()
        }
        ctx.globalAlpha = a
        ctx.fillStyle = `rgb(${s.col.join(',')})`
        ctx.beginPath()
        ctx.arc(x, y, s.r, 0, TAU)
        ctx.fill()
        ctx.globalAlpha = 1
        if (q && !dim(s)) {
          ctx.strokeStyle = 'rgba(255,230,160,0.8)'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.arc(x, y, s.r + 4, 0, TAU)
          ctx.stroke()
        }
      }
      // the hovered session's constellation, drawn bright on top
      if (focusSession) {
        const list = sessions.get(focusSession) ?? []
        ctx.strokeStyle = 'rgba(255,236,200,0.85)'
        ctx.lineWidth = 1.3
        ctx.beginPath()
        list.forEach((s, i) => (i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y)))
        ctx.stroke()
        for (const s of list) {
          ctx.fillStyle = '#fff'
          ctx.beginPath()
          ctx.arc(s.x, s.y, s.r + 0.6, 0, TAU)
          ctx.fill()
        }
        if (hovered) {
          ctx.strokeStyle = 'rgba(255,255,255,0.9)'
          ctx.lineWidth = 1.2
          ctx.beginPath()
          ctx.arc(hovered.x, hovered.y, hovered.r + 6, 0, TAU)
          ctx.stroke()
        }
      }
      // a star picked from the list flashes
      if (P.flash) {
        const s = stars.find((x) => x.p.key === P.flash)
        if (s) {
          const k = (t * 1.2) % 1
          ctx.strokeStyle = `rgba(255,230,160,${(1 - k).toFixed(3)})`
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(s.x, s.y, s.r + 4 + k * 26, 0, TAU)
          ctx.stroke()
        }
      }
    }

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

    const rect = () => canvas.getBoundingClientRect()
    const move = (e: MouseEvent) => {
      const r = rect()
      const s = pick(e.clientX - r.left, e.clientY - r.top)
      const key = s?.p.key ?? null
      if (key !== hoverKey.current) {
        hoverKey.current = key
        live.current.onHover(s ? { p: s.p, x: s.x, y: s.y } : null)
        if (!level) draw(performance.now())
      }
      canvas.style.cursor = s ? 'pointer' : 'crosshair'
    }
    const leave = () => {
      hoverKey.current = null
      live.current.onHover(null)
      if (!level) draw(performance.now())
    }
    const click = (e: MouseEvent) => {
      const r = rect()
      const s = pick(e.clientX - r.left, e.clientY - r.top)
      if (s) live.current.onPick(s.p)
    }
    canvas.addEventListener('mousemove', move)
    canvas.addEventListener('mouseleave', leave)
    canvas.addEventListener('click', click)
    return () => {
      stop?.()
      ro.disconnect()
      canvas.removeEventListener('mousemove', move)
      canvas.removeEventListener('mouseleave', leave)
      canvas.removeEventListener('click', click)
    }
  }, [level])
  // with motion off nothing loops: draw again when what is shown changes
  useEffect(() => {
    if (!level) redraw.current()
  }, [level, props.map, props.search, props.project, props.lines, props.flash])

  return <canvas ref={ref} className="starmap-canvas" />
}
