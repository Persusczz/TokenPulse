import { useEffect, useRef } from 'react'
import type { Intensity } from '@shared/types'
import type { MotionScale } from '../state'

interface Star {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  /** palette index; 4 = white */
  c: number
  phase: number
  tw: number
  /** seconds left for burst stars; Infinity for the resident river */
  life: number
  max: number
}

const DENSITY: Record<MotionScale, number> = { 0: 0.8, 1: 0.6, 2: 1, 3: 1.45 }
const LINK = 110
const MAX_STARS = 900

/** soft round glow sprites, one per colour */
function sprites(colors: string[]): HTMLCanvasElement[] {
  return [...colors, '#ffffff'].map((c) => {
    const s = document.createElement('canvas')
    s.width = s.height = 32
    const g = s.getContext('2d')!
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16)
    grad.addColorStop(0, '#ffffff')
    grad.addColorStop(0.18, c)
    grad.addColorStop(0.45, c + '66')
    grad.addColorStop(1, c + '00')
    g.fillStyle = grad
    g.fillRect(0, 0, 32, 32)
    return s
  })
}

/** Where new usage bursts from: the hero spark, else the sidebar logo */
function origin(w: number, h: number): { x: number; y: number } {
  const el = document.querySelector('.hero-mark') ?? document.querySelector('.brand-mark')
  const r = el?.getBoundingClientRect()
  return r && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: w * 0.4, y: h * 0.3 }
}

/**
 * A river of light points drifting along a slowly turning current, linked
 * into constellations when close. Each `pulse` bursts stars out of the hero
 * spark; they slow down, join the river and fade. Faster with intensity;
 * rich motion also lets the pointer push stars aside.
 */
export function StarField({
  colors,
  intensity,
  level,
  pulse,
  size,
  dark,
  vivid
}: {
  colors: [string, string, string, string]
  intensity: Intensity
  level: MotionScale
  pulse: number
  /** tokens behind `pulse` */
  size: number
  dark: boolean
  vivid: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const st = useRef({
    intensity,
    level,
    dark,
    vivid,
    stars: [] as Star[],
    sprites: [] as HTMLCanvasElement[],
    w: 0,
    h: 0,
    t: 0,
    pointer: { x: -1e4, y: -1e4 },
    draw: (_dt: number) => {}
  })
  Object.assign(st.current, { intensity, level, dark, vivid })

  useEffect(() => {
    st.current.sprites = sprites(colors)
    if (!level) st.current.draw(0)
  }, [colors.join(), level]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const s = st.current
    if (!pulse || !level || !s.w) return
    const o = origin(s.w, s.h)
    const n = Math.round(Math.min(160, (24 + Math.log10(size + 10) * 14) * (level >= 3 ? 1.5 : level === 1 ? 0.5 : 1)))
    for (let i = 0; i < n && s.stars.length < MAX_STARS; i++) {
      const a = Math.random() * Math.PI * 2
      const v = 90 + Math.random() * 260
      const life = 4 + Math.random() * 4
      s.stars.push({
        x: o.x,
        y: o.y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        r: 0.8 + Math.random() * 1.8,
        c: Math.random() < 0.25 ? 4 : i % 4,
        phase: Math.random() * 6.28,
        tw: 1.5 + Math.random() * 3,
        life,
        max: life
      })
    }
  }, [pulse]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    const s = st.current
    const seed = () => {
      const n = Math.round(((s.w * s.h) / 9000) * DENSITY[s.level])
      s.stars = s.stars.filter((x) => x.life !== Infinity)
      for (let i = 0; i < n; i++) {
        s.stars.push({
          x: Math.random() * s.w,
          y: Math.random() * s.h,
          vx: 0,
          vy: 0,
          r: 0.6 + Math.random() * 1.6,
          c: Math.random() < 0.2 ? 4 : Math.floor(Math.random() * 4),
          phase: Math.random() * 6.28,
          tw: 0.6 + Math.random() * 2.2,
          life: Infinity,
          max: Infinity
        })
      }
    }
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      s.w = canvas.clientWidth
      s.h = canvas.clientHeight
      canvas.width = Math.round(s.w * dpr)
      canvas.height = Math.round(s.h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      seed()
      s.draw(0)
    }

    s.draw = (dt: number) => {
      const { w, h } = s
      if (!w || !h || !s.sprites.length) return
      s.t += dt
      const speed = (10 + s.intensity * 12) * (s.level >= 3 ? 1.3 : s.level === 1 ? 0.6 : 1)
      const alpha = Math.min(1, (s.dark ? 0.35 : 0.5) + s.vivid * 0.75)
      // on a light page the points need more size to read as light
      const grow = s.dark ? 1 : 1.35
      ctx.clearRect(0, 0, w, h)
      ctx.globalCompositeOperation = s.dark ? 'lighter' : 'source-over'

      const resident: Star[] = []
      s.stars = s.stars.filter((p) => {
        // the current: a slowly turning flow field
        const ang = Math.sin(p.x * 0.0035 + s.t * 0.08) * 1.3 + Math.cos(p.y * 0.0045 - s.t * 0.06) * 1.3 + 0.4
        const fx = Math.cos(ang) * speed
        const fy = Math.sin(ang) * speed * 0.6
        const drag = Math.exp(-dt * 1.7)
        p.vx = p.vx * drag + fx * (1 - drag)
        p.vy = p.vy * drag + fy * (1 - drag)
        if (s.level >= 3) {
          const dx = p.x - s.pointer.x
          const dy = p.y - s.pointer.y
          const d2 = dx * dx + dy * dy
          if (d2 < 120 * 120 && d2 > 1) {
            const f = (1 - Math.sqrt(d2) / 120) * 260 * dt
            p.vx += (dx / Math.sqrt(d2)) * f * 4
            p.vy += (dy / Math.sqrt(d2)) * f * 4
          }
        }
        p.x += p.vx * dt
        p.y += p.vy * dt
        if (p.life !== Infinity) {
          p.life -= dt
          if (p.life <= 0) return false
        } else {
          resident.push(p)
          if (p.x < -20) p.x += w + 40
          else if (p.x > w + 20) p.x -= w + 40
          if (p.y < -20) p.y += h + 40
          else if (p.y > h + 20) p.y -= h + 40
        }
        return true
      })

      // constellation lines between nearby resident stars
      if (s.level >= 2) {
        ctx.lineWidth = 0.8
        ctx.strokeStyle = s.dark ? '#ffffff' : '#7e6a5c'
        for (let i = 0; i < resident.length; i++) {
          const a = resident[i]
          for (let j = i + 1; j < resident.length; j++) {
            const b = resident[j]
            const dx = a.x - b.x
            if (dx > LINK || dx < -LINK) continue
            const dy = a.y - b.y
            const d = Math.hypot(dx, dy)
            if (d >= LINK) continue
            ctx.globalAlpha = (1 - d / LINK) * (s.dark ? 0.16 : 0.22) * alpha
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
            ctx.stroke()
          }
        }
      }

      for (const p of s.stars) {
        const fade = p.life === Infinity ? 1 : Math.min(1, p.life / 1.2, (p.max - p.life) / 0.15 + 0.3)
        const tw = 0.55 + 0.45 * Math.sin(s.t * p.tw + p.phase)
        ctx.globalAlpha = Math.max(0, alpha * fade * tw)
        const r = p.r * (p.life === Infinity ? 5 : 6) * grow
        ctx.drawImage(s.sprites[p.c], p.x - r, p.y - r, r * 2, r * 2)
      }
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    }

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()
    const move = (e: PointerEvent) => (s.pointer = { x: e.clientX, y: e.clientY })
    addEventListener('pointermove', move, { passive: true })
    if (!level) return () => (ro.disconnect(), removeEventListener('pointermove', move))

    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (now - last < 15) return
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      s.draw(dt)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      removeEventListener('pointermove', move)
    }
  }, [level])

  return <canvas ref={ref} className="star-field" />
}
