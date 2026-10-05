import { useEffect, useRef } from 'react'
import type { ZodiacInfo } from '@shared/types'
import { rand, since, TAU, useLive, useScene, type SceneProps } from './ThemeScenes'

/** an offscreen canvas at device resolution, drawn once */
export function layer(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas')
  const dpr = window.devicePixelRatio || 1
  c.width = Math.max(1, Math.round(w * dpr))
  c.height = Math.max(1, Math.round(h * dpr))
  const g = c.getContext('2d')!
  g.scale(dpr, dpr)
  draw(g)
  return c
}

/** fine paper grain as a repeating pattern */
function grainPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const g = document.createElement('canvas')
  g.width = g.height = 96
  const gc = g.getContext('2d')!
  const img = gc.createImageData(96, 96)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v
    img.data[i + 3] = 255
  }
  gc.putImageData(img, 0, 0)
  return ctx.createPattern(g, 'repeat')
}

/** a small Claude asterisk: eight thin rays */
function asterisk(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number): void {
  ctx.beginPath()
  for (let i = 0; i < 8; i++) {
    const a = rot + (i / 8) * TAU
    const len = i % 2 ? r * 0.62 : r
    ctx.moveTo(x + Math.cos(a) * r * 0.18, y + Math.sin(a) * r * 0.18)
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len)
  }
  ctx.stroke()
}

// ---------------------------------------------------------------- Claude 暖光

/**
 * Claude's warm light: soft clay, amber and sage shapes drift and breathe like
 * the brand's illustrations, a few hand-drawn lines wander through, and small
 * asterisks twinkle here and there; new usage sends a warm ripple from the top
 * and lets a handful of asterisks bloom.
 */
export function ClaudeGlow(p: SceneProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useLive(p)
  const dark = p.dark !== false
  const lastPulse = useRef(0)
  useScene(
    ref,
    p.level,
    live,
    () => {
      const COLS = ['217,119,87', '232,170,110', '143,179,160', '196,160,214']
      let blobs: { x: number; y: number; r: number; ph: number; c: string; sp: number }[] = []
      let stars: { x: number; y: number; r: number; rot: number; vr: number; ph: number; vy: number; bloom: number }[] = []
      let ripples: number[] = []
      let grain: CanvasPattern | null = null
      let t = 0
      return {
        init(w, h) {
          const m = Math.max(w, h)
          blobs = [
            { x: 0.72, y: 0.1, r: 0.34, ph: 0, c: COLS[0], sp: 0.05 },
            { x: 0.12, y: 0.82, r: 0.3, ph: 2, c: COLS[1], sp: 0.04 },
            { x: 0.48, y: 0.55, r: 0.38, ph: 4, c: COLS[2], sp: 0.035 },
            { x: 0.92, y: 0.7, r: 0.26, ph: 1, c: COLS[3], sp: 0.045 },
            { x: 0.3, y: 0.2, r: 0.22, ph: 3, c: COLS[1], sp: 0.06 }
          ].map((b) => ({ ...b, x: b.x * w, y: b.y * h, r: b.r * m }))
          stars = Array.from({ length: Math.round((w * h) / 52000) + 10 }, () => ({ x: Math.random() * w, y: Math.random() * h, r: rand(3, 7), rot: Math.random() * TAU, vr: rand(-0.2, 0.2), ph: Math.random() * TAU, vy: rand(2, 7), bloom: 0 }))
          ripples = []
        },
        draw(ctx, w, h, dt, l) {
          t += dt
          grain ??= grainPattern(ctx)
          const glow = 0.55 + l.vivid * 0.6
          ctx.globalCompositeOperation = 'source-over'
          ctx.globalAlpha = 1
          const bg = ctx.createLinearGradient(0, 0, 0, h)
          if (dark) {
            bg.addColorStop(0, '#171411')
            bg.addColorStop(0.6, '#1d1814')
            bg.addColorStop(1, '#251b15')
          } else {
            bg.addColorStop(0, '#fbf7ef')
            bg.addColorStop(1, '#f3eadc')
          }
          ctx.fillStyle = bg
          ctx.fillRect(0, 0, w, h)
          // soft shapes, drifting and breathing
          ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over'
          const busy = 1 + l.intensity * 0.35
          for (const b of blobs) {
            const x = b.x + Math.sin(t * b.sp * busy + b.ph) * w * 0.07
            const y = b.y + Math.cos(t * b.sp * 0.8 * busy + b.ph) * h * 0.06
            const r = b.r * (1 + 0.06 * Math.sin(t * 0.3 + b.ph))
            const g = ctx.createRadialGradient(x, y, 0, x, y, r)
            const a = (dark ? 0.15 : 0.2) * glow
            g.addColorStop(0, `rgba(${b.c},${a})`)
            g.addColorStop(0.55, `rgba(${b.c},${a * 0.45})`)
            g.addColorStop(1, `rgba(${b.c},0)`)
            ctx.fillStyle = g
            ctx.fillRect(x - r, y - r, r * 2, r * 2)
          }
          ctx.globalCompositeOperation = 'source-over'
          // hand-drawn lines wandering through the header and the lower part
          ctx.lineCap = 'round'
          const pen = dark ? '232,170,140' : '160,90,60'
          for (const [base, amp, fr, sp] of [
            [h * 0.09, 14, 0.006, 0.18],
            [h * 0.16, 10, 0.009, -0.12],
            [h * 0.86, 18, 0.004, 0.1]
          ]) {
            ctx.strokeStyle = `rgba(${pen},${(dark ? 0.13 : 0.16) * glow})`
            ctx.lineWidth = 1.2
            ctx.beginPath()
            for (let x = -10; x <= w + 10; x += 10) {
              const y = base + Math.sin(x * fr + t * sp) * amp + Math.sin(x * fr * 2.7 - t * sp * 0.6) * amp * 0.3
              if (x < 0) ctx.moveTo(x, y)
              else ctx.lineTo(x, y)
            }
            ctx.stroke()
          }
          // new usage: a warm ripple from the top, and a few asterisks bloom
          if (l.pulseAt > lastPulse.current) {
            lastPulse.current = l.pulseAt
            ripples.push(0)
            const n = Math.max(2, Math.min(6, Math.round(Math.log10(l.size + 10) - 2)))
            for (let i = 0; i < n; i++) stars.push({ x: w * rand(0.3, 0.95), y: rand(30, 150), r: rand(5, 10), rot: Math.random() * TAU, vr: rand(-0.6, 0.6), ph: 0, vy: rand(4, 10), bloom: 1 })
          }
          ripples = ripples
            .map((k) => k + dt / 2.2)
            .filter((k) => {
              if (k >= 1) return false
              ctx.strokeStyle = `rgba(217,119,87,${(1 - k) ** 2 * 0.35 * glow})`
              ctx.lineWidth = 1.5
              ctx.beginPath()
              ctx.ellipse(w * 0.62, 70, w * 0.7 * k, w * 0.32 * k, 0, 0, TAU)
              ctx.stroke()
              return true
            })
          // little asterisks
          ctx.lineWidth = 1.3
          stars = stars.filter((s) => {
            s.rot += s.vr * dt
            s.y -= s.vy * dt
            if (s.y < -12) {
              if (s.bloom > 0) return false
              s.y = h + 12
              s.x = Math.random() * w
            }
            s.bloom = Math.max(0, s.bloom - dt * 0.35)
            const tw = 0.5 + 0.5 * Math.sin(t * 1.4 + s.ph)
            const a = Math.min(1, (0.18 + 0.4 * tw + s.bloom * 0.6) * glow)
            ctx.strokeStyle = dark ? `rgba(240,180,140,${a})` : `rgba(200,100,66,${a * 0.85})`
            asterisk(ctx, s.x, s.y, s.r * (1 + s.bloom * 0.8), s.rot)
            return true
          })
          if (grain) {
            ctx.globalAlpha = dark ? 0.03 : 0.045
            ctx.fillStyle = grain
            ctx.fillRect(0, 0, w, h)
            ctx.globalAlpha = 1
          }
        }
      }
    },
    0.75
  )
  return <canvas ref={ref} className="scene-canvas" />
}

// ---------------------------------------------------------------- Codex 夜终端

const GLYPHS = '{}[]()<>/=;:+-*&|!?_$#01λ'
const COMMANDS = ['> codex exec "修好失败的测试"', '$ npm test', '✓ 128 passed', '> apply_patch src/app.ts', '$ git diff --stat', '> thinking…', '$ rg TODO -n', '✓ build ok']

/**
 * A quiet terminal at night: a dot grid, a blue-violet glow drifting along the
 * top, a sparse network of nodes that connect when near (pulses run along the
 * links on new usage), faint code in the margins and the odd command typing
 * itself out.
 */
export function CodexNight(p: SceneProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useLive(p)
  const dark = p.dark !== false
  const lastPulse = useRef(0)
  useScene(
    ref,
    p.level,
    live,
    () => {
      let dots: HTMLCanvasElement | null = null
      let nodes: { x: number; y: number; vx: number; vy: number; f: number }[] = []
      let pulses: { a: number; b: number; k: number }[] = []
      let cols: { x: number; y: number; v: number; chars: string[] }[] = []
      let lines: { x: number; y: number; text: string; age: number }[] = []
      let t = 0
      let next = 2
      const LINK = 150
      return {
        init(w, h) {
          dots = layer(w, h, (g) => {
            g.fillStyle = dark ? 'rgba(124,138,255,0.12)' : 'rgba(91,108,255,0.14)'
            for (let x = 14; x < w; x += 28) for (let y = 14; y < h; y += 28) g.fillRect(x, y, 1.2, 1.2)
          })
          nodes = Array.from({ length: Math.round((w * h) / 42000) + 14 }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: rand(-8, 8), vy: rand(-6, 6), f: 0 }))
          cols = Array.from({ length: 7 }, (_, i) => ({ x: i < 4 ? 16 + i * 52 : w - 30 - (i - 4) * 44, y: Math.random() * h, v: rand(14, 30), chars: Array.from({ length: 10 }, () => GLYPHS[(Math.random() * GLYPHS.length) | 0]) }))
          lines = []
          pulses = []
        },
        draw(ctx, w, h, dt, l) {
          t += dt
          const glow = 0.55 + l.vivid * 0.6
          ctx.globalCompositeOperation = 'source-over'
          ctx.globalAlpha = 1
          const bg = ctx.createLinearGradient(0, 0, 0, h)
          if (dark) {
            bg.addColorStop(0, '#070912')
            bg.addColorStop(1, '#0b0f1e')
          } else {
            bg.addColorStop(0, '#f6f7fc')
            bg.addColorStop(1, '#eceffa')
          }
          ctx.fillStyle = bg
          ctx.fillRect(0, 0, w, h)
          if (dots) ctx.drawImage(dots, 0, 0, w, h)
          // the glow drifting along the top
          ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over'
          for (const [c, k, ph] of [
            ['91,108,255', 0.55, 0],
            ['139,92,246', 0.35, 2],
            ['158,231,255', 0.75, 4]
          ] as [string, number, number][]) {
            const x = w * (k + 0.18 * Math.sin(t * 0.05 + ph))
            const g = ctx.createRadialGradient(x, -h * 0.05, 0, x, -h * 0.05, w * 0.45)
            g.addColorStop(0, `rgba(${c},${(dark ? 0.2 : 0.14) * glow})`)
            g.addColorStop(1, `rgba(${c},0)`)
            ctx.fillStyle = g
            ctx.fillRect(0, 0, w, h * 0.6)
          }
          ctx.globalCompositeOperation = 'source-over'
          // the network
          const speed = 1 + l.intensity * 0.4
          for (const n of nodes) {
            n.x += n.vx * dt * speed
            n.y += n.vy * dt * speed
            if (n.x < 0 || n.x > w) n.vx *= -1
            if (n.y < 0 || n.y > h) n.vy *= -1
            n.f = Math.max(0, n.f - dt)
          }
          const link = dark ? '124,138,255' : '91,108,255'
          const near: [number, number][] = []
          ctx.lineWidth = 1
          for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
              const dx = nodes[i].x - nodes[j].x
              const dy = nodes[i].y - nodes[j].y
              const d = Math.hypot(dx, dy)
              if (d > LINK) continue
              near.push([i, j])
              ctx.strokeStyle = `rgba(${link},${(1 - d / LINK) * 0.16 * glow})`
              ctx.beginPath()
              ctx.moveTo(nodes[i].x, nodes[i].y)
              ctx.lineTo(nodes[j].x, nodes[j].y)
              ctx.stroke()
            }
          }
          if (l.pulseAt > lastPulse.current) {
            lastPulse.current = l.pulseAt
            for (let i = 0; i < Math.min(near.length, 8); i++) {
              const [a, b] = near[(Math.random() * near.length) | 0]
              pulses.push({ a, b, k: 0 })
            }
          }
          pulses = pulses.filter((q) => {
            q.k += dt / 0.9
            if (q.k >= 1) {
              nodes[q.b].f = 1
              return false
            }
            const A = nodes[q.a]
            const B = nodes[q.b]
            const x = A.x + (B.x - A.x) * q.k
            const y = A.y + (B.y - A.y) * q.k
            const g = ctx.createRadialGradient(x, y, 0, x, y, 7)
            g.addColorStop(0, `rgba(158,231,255,${0.9 * glow})`)
            g.addColorStop(1, 'rgba(158,231,255,0)')
            ctx.fillStyle = g
            ctx.fillRect(x - 7, y - 7, 14, 14)
            return true
          })
          for (const n of nodes) {
            ctx.fillStyle = n.f > 0 ? `rgba(158,231,255,${0.5 + n.f * 0.5})` : `rgba(${link},${0.45 * glow})`
            ctx.beginPath()
            ctx.arc(n.x, n.y, 1.6 + n.f * 2, 0, TAU)
            ctx.fill()
          }
          // faint code in the margins
          ctx.font = "12px 'Cascadia Code', Consolas, monospace"
          ctx.textBaseline = 'top'
          for (const c of cols) {
            c.y += c.v * dt * speed
            if (c.y - c.chars.length * 15 > h) c.y = -rand(0, h * 0.3)
            if (Math.random() < dt * 2) c.chars[(Math.random() * c.chars.length) | 0] = GLYPHS[(Math.random() * GLYPHS.length) | 0]
            for (let k = 0; k < c.chars.length; k++) {
              const y = c.y - k * 15
              if (y < -15 || y > h) continue
              ctx.fillStyle = `rgba(${link},${(k === 0 ? 0.32 : (1 - k / c.chars.length) * 0.12) * glow})`
              ctx.fillText(c.chars[k], c.x, y)
            }
          }
          // a command typing itself now and then
          next -= dt
          if (next <= 0) {
            next = rand(3.5, 6)
            const side = Math.random() < 0.5
            lines.push({ x: side ? rand(16, 40) : rand(w * 0.32, w * 0.56), y: side ? rand(h * 0.5, h * 0.72) : rand(18, 90), text: COMMANDS[(Math.random() * COMMANDS.length) | 0], age: 0 })
            if (lines.length > 3) lines.shift()
          }
          ctx.font = "12px 'Cascadia Code', Consolas, monospace"
          lines = lines.filter((ln) => {
            ln.age += dt
            const typed = Math.min(ln.text.length, Math.floor(ln.age * 22))
            const fade = ln.age > 4 ? Math.max(0, 1 - (ln.age - 4)) : 1
            if (fade <= 0) return false
            ctx.fillStyle = ln.text.startsWith('✓') ? `rgba(80,210,160,${0.5 * fade})` : dark ? `rgba(190,200,255,${0.45 * fade})` : `rgba(60,70,150,${0.55 * fade})`
            const s = ln.text.slice(0, typed)
            ctx.fillText(s, ln.x, ln.y)
            if (typed < ln.text.length || Math.sin(t * 7) > 0) ctx.fillRect(ln.x + ctx.measureText(s).width + 2, ln.y + 1, 6, 12)
            return true
          })
        }
      }
    },
    1,
    30
  )
  return <canvas ref={ref} className="scene-canvas" />
}

// ---------------------------------------------------------------- 樱花

/** a cherry branch grown from (x, y) toward `angle`, with blossoms at its tips */
function growBranch(g: CanvasRenderingContext2D, x: number, y: number, angle: number, len: number, width: number, depth: number, blossoms: [number, number][], dark: boolean): void {
  const x2 = x + Math.cos(angle) * len
  const y2 = y + Math.sin(angle) * len
  g.strokeStyle = dark ? '#3a2a33' : '#5b3b33'
  g.lineWidth = width
  g.lineCap = 'round'
  g.beginPath()
  g.moveTo(x, y)
  g.quadraticCurveTo(x + Math.cos(angle + 0.3) * len * 0.5, y + Math.sin(angle + 0.3) * len * 0.5, x2, y2)
  g.stroke()
  if (depth <= 0 || width < 1) {
    blossoms.push([x2, y2])
    return
  }
  if (depth < 3) blossoms.push([x + (x2 - x) * 0.6, y + (y2 - y) * 0.6])
  growBranch(g, x2, y2, angle + rand(0.2, 0.55), len * rand(0.62, 0.78), width * 0.66, depth - 1, blossoms, dark)
  growBranch(g, x2, y2, angle - rand(0.15, 0.5), len * rand(0.6, 0.76), width * 0.62, depth - 1, blossoms, dark)
}

function blossom(g: CanvasRenderingContext2D, x: number, y: number, r: number, dark: boolean): void {
  const rot = Math.random() * TAU
  for (let i = 0; i < 5; i++) {
    const a = rot + (i / 5) * TAU
    g.fillStyle = dark ? `rgba(255,${200 + Math.random() * 30},${225 + Math.random() * 20},0.9)` : `rgba(255,${170 + Math.random() * 40},${195 + Math.random() * 30},0.95)`
    g.beginPath()
    g.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.55, r * 0.38, a, 0, TAU)
    g.fill()
  }
  g.fillStyle = dark ? '#ffd6e6' : '#d8577f'
  g.beginPath()
  g.arc(x, y, r * 0.18, 0, TAU)
  g.fill()
}

/**
 * Cherry blossoms: branches reach in from the top corners, petals drift down
 * turning in the air (more while busy, with the odd gust); new usage shakes a
 * shower of petals loose. At night, under a pale moon.
 */
export function Sakura(p: SceneProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useLive(p)
  const dark = p.dark === true
  const lastPulse = useRef(0)
  useScene(
    ref,
    p.level,
    live,
    () => {
      let still: HTMLCanvasElement | null = null
      let tips: [number, number][] = []
      let petals: { x: number; y: number; vx: number; vy: number; s: number; rot: number; vr: number; flip: number; vf: number; c: string }[] = []
      let t = 0
      let gust = 0
      let acc = 0
      const petal = (w: number, x = Math.random() * w * 1.1, y = -10, vx = rand(-8, 14), vy = rand(18, 36)) => ({
        x,
        y,
        vx,
        vy,
        s: rand(4, 8),
        rot: Math.random() * TAU,
        vr: rand(-1.5, 1.5),
        flip: Math.random() * TAU,
        vf: rand(1.5, 3.5),
        c: dark ? `255,${205 + ((Math.random() * 30) | 0)},${228 + ((Math.random() * 20) | 0)}` : `255,${175 + ((Math.random() * 45) | 0)},${200 + ((Math.random() * 30) | 0)}`
      })
      return {
        init(w, h) {
          tips = []
          still = layer(w, h, (g) => {
            const sky = g.createLinearGradient(0, 0, 0, h)
            if (dark) {
              sky.addColorStop(0, '#141226')
              sky.addColorStop(0.6, '#221a36')
              sky.addColorStop(1, '#2c2038')
            } else {
              sky.addColorStop(0, '#fdf3f6')
              sky.addColorStop(0.55, '#fae6ec')
              sky.addColorStop(1, '#f6eee8')
            }
            g.fillStyle = sky
            g.fillRect(0, 0, w, h)
            if (dark) {
              const mx = w * 0.82
              const my = h * 0.16
              const halo = g.createRadialGradient(mx, my, 0, mx, my, h * 0.22)
              halo.addColorStop(0, 'rgba(255,240,250,0.35)')
              halo.addColorStop(1, 'rgba(255,240,250,0)')
              g.fillStyle = halo
              g.fillRect(0, 0, w, h)
              g.fillStyle = '#fff6fa'
              g.beginPath()
              g.arc(mx, my, Math.max(18, h * 0.04), 0, TAU)
              g.fill()
            }
            // far hills
            for (const [base, amp, col] of [
              [0.86, 0.1, dark ? 'rgba(70,50,90,0.6)' : 'rgba(232,196,206,0.6)'],
              [0.95, 0.07, dark ? 'rgba(50,36,66,0.8)' : 'rgba(222,178,190,0.55)']
            ] as [number, number, string][]) {
              g.fillStyle = col
              g.beginPath()
              g.moveTo(0, h)
              for (let x = 0; x <= w; x += 8) g.lineTo(x, h * base - Math.sin(x * 0.004 + base * 9) * h * amp * 0.6 - Math.sin(x * 0.011) * h * amp * 0.3)
              g.lineTo(w, h)
              g.fill()
            }
            // branches from the top corners
            growBranch(g, -10, Math.min(h * 0.08, 60), 0.25, Math.min(w, h) * 0.2, 9, 6, tips, dark)
            growBranch(g, w + 10, Math.min(h * 0.04, 30), Math.PI - 0.35, Math.min(w, h) * 0.15, 7, 5, tips, dark)
            for (const [x, y] of tips) for (let i = 0; i < 3; i++) blossom(g, x + rand(-10, 10), y + rand(-8, 8), rand(5, 8), dark)
          })
          petals = Array.from({ length: 30 }, () => petal(w, Math.random() * w, Math.random() * h))
        },
        draw(ctx, w, h, dt, l) {
          t += dt
          if (still) ctx.drawImage(still, 0, 0, w, h)
          // a gust now and then
          gust = Math.max(0, gust - dt * 0.4)
          if (Math.random() < dt * 0.04) gust = 1
          if (l.pulseAt > lastPulse.current) {
            lastPulse.current = l.pulseAt
            const n = Math.max(8, Math.min(40, Math.round(Math.log10(l.size + 10) * 6)))
            for (let i = 0; i < n; i++) {
              const [x, y] = tips[(Math.random() * tips.length) | 0] ?? [w * 0.2, 40]
              petals.push(petal(w, x, y, rand(-30, 60), rand(10, 50)))
            }
          }
          acc += dt * [1.2, 2.5, 4, 7][l.intensity]
          while (acc > 1) {
            acc -= 1
            petals.push(petal(w))
          }
          const glow = 0.6 + l.vivid * 0.5
          petals = petals.filter((q) => {
            q.x += (q.vx + Math.sin(t * 0.9 + q.flip) * 12 + gust * 70) * dt
            q.y += q.vy * dt
            q.rot += q.vr * dt
            q.flip += q.vf * dt
            if (q.y > h + 12 || q.x > w + 30) return false
            ctx.save()
            ctx.translate(q.x, q.y)
            ctx.rotate(q.rot)
            ctx.scale(1, Math.abs(Math.cos(q.flip)) * 0.8 + 0.2)
            ctx.fillStyle = `rgba(${q.c},${Math.min(1, 0.85 * glow)})`
            ctx.beginPath()
            // a petal with a notch
            ctx.moveTo(0, -q.s)
            ctx.quadraticCurveTo(q.s * 0.9, -q.s * 0.2, 0, q.s)
            ctx.quadraticCurveTo(-q.s * 0.9, -q.s * 0.2, 0, -q.s)
            ctx.fill()
            ctx.restore()
            return true
          })
          if (petals.length > 420) petals.splice(0, petals.length - 420)
        }
      }
    },
    0.85
  )
  return <canvas ref={ref} className="scene-canvas" />
}

// ---------------------------------------------------------------- 沙丘

/**
 * Dunes at golden hour (or under the desert night sky): layered sand curves
 * with lit crests, a low sun, and sand streaming off the ridges in the wind,
 * faster while busy; new usage sends a gust of sand across.
 */
export function Dune(p: SceneProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useLive(p)
  const dark = p.dark === true
  const lastPulse = useRef(0)
  useScene(
    ref,
    p.level,
    live,
    () => {
      let still: HTMLCanvasElement | null = null
      let crests: ((x: number) => number)[] = []
      let sand: { x: number; y: number; v: number; life: number; r: number }[] = []
      let stars: { x: number; y: number; p: number }[] = []
      let veil = -1
      let t = 0
      let acc = 0
      return {
        init(w, h) {
          const layers = dark
            ? [
                { base: 0.62, amp: 0.08, f: 0.0035, col: '#2b2440', lit: 'rgba(160,150,210,0.25)' },
                { base: 0.72, amp: 0.09, f: 0.0028, col: '#231d36', lit: 'rgba(150,140,200,0.22)' },
                { base: 0.84, amp: 0.08, f: 0.0042, col: '#1a1529', lit: 'rgba(140,130,190,0.2)' },
                { base: 0.96, amp: 0.06, f: 0.005, col: '#120f1e', lit: 'rgba(130,120,180,0.18)' }
              ]
            : [
                { base: 0.6, amp: 0.08, f: 0.0035, col: '#f2c193', lit: 'rgba(255,236,200,0.7)' },
                { base: 0.71, amp: 0.09, f: 0.0028, col: '#e8a876', lit: 'rgba(255,226,186,0.7)' },
                { base: 0.83, amp: 0.08, f: 0.0042, col: '#dc9262', lit: 'rgba(255,214,170,0.65)' },
                { base: 0.95, amp: 0.06, f: 0.005, col: '#cc7f50', lit: 'rgba(255,205,160,0.6)' }
              ]
          crests = layers.map((L, i) => (x: number) => h * L.base - (Math.sin(x * L.f + i * 2.1) * 0.6 + Math.sin(x * L.f * 2.3 + i) * 0.3 + Math.sin(x * L.f * 5.1 + i * 3) * 0.1) * h * L.amp)
          stars = dark ? Array.from({ length: Math.round((w * h) / 4500) }, () => ({ x: Math.random() * w, y: Math.random() * h * 0.6, p: Math.random() * TAU })) : []
          still = layer(w, h, (g) => {
            const sky = g.createLinearGradient(0, 0, 0, h)
            if (dark) {
              sky.addColorStop(0, '#0b0e22')
              sky.addColorStop(0.6, '#1c1734')
              sky.addColorStop(1, '#2a2040')
            } else {
              sky.addColorStop(0, '#ffe2b6')
              sky.addColorStop(0.45, '#ffc497')
              sky.addColorStop(0.7, '#f9b48a')
              sky.addColorStop(1, '#f2a87e')
            }
            g.fillStyle = sky
            g.fillRect(0, 0, w, h)
            // the moon up in the header band; the sun lower, over the far dunes, but clear of the main cards' middle
            const sx = dark ? w * 0.84 : w * 0.8
            const sy = dark ? h * 0.12 : h * 0.3
            const R = dark ? Math.max(18, h * 0.035) : Math.max(26, h * 0.06)
            const halo = g.createRadialGradient(sx, sy, 0, sx, sy, R * 7)
            halo.addColorStop(0, dark ? 'rgba(230,230,255,0.22)' : 'rgba(255,240,200,0.75)')
            halo.addColorStop(1, 'rgba(255,240,200,0)')
            if (!dark) {
              g.fillStyle = halo
              g.fillRect(0, 0, w, h)
            }
            g.fillStyle = dark ? '#f4f1ff' : '#fff1cf'
            g.beginPath()
            g.arc(sx, sy, R, 0, TAU)
            g.fill()
            if (dark) {
              // a crescent: the night sky itself covers most of the disc, and the glow lies over both
              g.fillStyle = sky
              g.beginPath()
              g.arc(sx + R * 0.42, sy - R * 0.18, R * 0.96, 0, TAU)
              g.fill()
              g.globalCompositeOperation = 'lighter'
              g.fillStyle = halo
              g.fillRect(0, 0, w, h)
              g.globalCompositeOperation = 'source-over'
            }
            layers.forEach((L, i) => {
              const crest = crests[i]
              const grad = g.createLinearGradient(0, h * (L.base - L.amp), 0, h)
              grad.addColorStop(0, L.col)
              grad.addColorStop(1, dark ? '#0c0a14' : '#b8693e')
              g.fillStyle = grad
              g.beginPath()
              g.moveTo(0, h)
              for (let x = 0; x <= w; x += 6) g.lineTo(x, crest(x))
              g.lineTo(w, h)
              g.fill()
              // the crest catching the light
              g.strokeStyle = L.lit
              g.lineWidth = 1.6
              g.beginPath()
              for (let x = 0; x <= w; x += 6) (x ? g.lineTo : g.moveTo).call(g, x, crest(x))
              g.stroke()
              // wind ripples on the nearer dunes
              if (i >= 2) {
                g.strokeStyle = dark ? 'rgba(255,255,255,0.04)' : 'rgba(120,60,30,0.12)'
                g.lineWidth = 1
                for (let k = 1; k < 7; k++) {
                  g.beginPath()
                  for (let x = 0; x <= w; x += 10) {
                    const y = crest(x) + k * 9 + Math.sin(x * 0.05 + k) * 2
                    if (x) g.lineTo(x, y)
                    else g.moveTo(x, y)
                  }
                  g.stroke()
                }
              }
            })
          })
          sand = []
        },
        draw(ctx, w, h, dt, l) {
          t += dt
          if (still) ctx.drawImage(still, 0, 0, w, h)
          const glow = 0.6 + l.vivid * 0.5
          for (const s of stars) {
            ctx.globalAlpha = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(t * 2 + s.p))
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(s.x, s.y, 1.2, 1.2)
          }
          ctx.globalAlpha = 1
          // sand blown off the crests
          acc += dt * [12, 26, 45, 80][l.intensity]
          while (acc > 1) {
            acc -= 1
            const i = (Math.random() * crests.length) | 0
            const x = Math.random() * w
            sand.push({ x, y: crests[i](x) - rand(0, 6), v: rand(40, 90), life: rand(1.5, 3.5), r: rand(0.6, 1.5) })
          }
          if (l.pulseAt > lastPulse.current) {
            lastPulse.current = l.pulseAt
            veil = 0
            for (let i = 0; i < 160; i++) sand.push({ x: rand(-w * 0.3, w), y: h * rand(0.45, 0.95), v: rand(160, 320), life: rand(1, 2.4), r: rand(0.6, 1.8) })
          }
          ctx.fillStyle = dark ? 'rgba(200,190,240,0.5)' : 'rgba(255,236,205,0.85)'
          sand = sand.filter((s) => {
            s.x += s.v * dt
            s.y -= s.v * dt * 0.08
            s.life -= dt
            if (s.life <= 0 || s.x > w + 10) return false
            ctx.globalAlpha = Math.min(1, s.life) * 0.8 * glow
            ctx.fillRect(s.x, s.y, s.r * 3, s.r)
            return true
          })
          ctx.globalAlpha = 1
          if (sand.length > 900) sand.splice(0, sand.length - 900)
          // a veil of sand sweeping across after new usage
          if (veil >= 0) {
            veil += dt / 1.6
            if (veil >= 1) veil = -1
            else {
              const x = -w * 0.4 + veil * w * 1.6
              const g = ctx.createLinearGradient(x - w * 0.25, 0, x + w * 0.25, 0)
              const c = dark ? '170,160,220' : '255,220,170'
              g.addColorStop(0, `rgba(${c},0)`)
              g.addColorStop(0.5, `rgba(${c},${0.28 * (1 - veil)})`)
              g.addColorStop(1, `rgba(${c},0)`)
              ctx.fillStyle = g
              ctx.fillRect(0, h * 0.35, w, h * 0.65)
            }
          }
        }
      }
    },
    0.85
  )
  return <canvas ref={ref} className="scene-canvas" />
}

// ---------------------------------------------------------------- 星图

const ZODIAC_SYMBOLS = ['♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓']
const ZODIAC_KEYS = ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces']

/**
 * A star atlas: the celestial grid and a ring of the twelve signs turn slowly,
 * today's sign is drawn large in the middle with as many stars lit as today's
 * usage has earned; new usage sends a shooting star, and a star that has just
 * been earned flares up.
 */
export function Astral(p: SceneProps & { zodiac?: ZodiacInfo | null }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useLive(p)
  const dark = p.dark !== false
  const zodiac = useRef<ZodiacInfo | null>(p.zodiac ?? null)
  useEffect(() => void (zodiac.current = p.zodiac ?? null), [p.zodiac])
  const lastPulse = useRef(0)
  useScene(
    ref,
    p.level,
    live,
    () => {
      let field: HTMLCanvasElement | null = null
      let twinkles: { x: number; y: number; p: number; r: number }[] = []
      let meteors: { x: number; y: number; vx: number; vy: number; life: number }[] = []
      let lastLit = -1
      let flare = 0
      let t = 0
      let rot = 0
      return {
        init(w, h) {
          field = layer(w, h, (g) => {
            const bg = g.createRadialGradient(w * 0.6, h * 0.45, 0, w * 0.6, h * 0.45, Math.max(w, h) * 0.8)
            if (dark) {
              bg.addColorStop(0, '#13204a')
              bg.addColorStop(0.6, '#0a1330')
              bg.addColorStop(1, '#050915')
            } else {
              bg.addColorStop(0, '#f6eed9')
              bg.addColorStop(0.7, '#ecdfc0')
              bg.addColorStop(1, '#dccba3')
            }
            g.fillStyle = bg
            g.fillRect(0, 0, w, h)
            g.fillStyle = dark ? 'rgba(255,255,255,0.7)' : 'rgba(40,50,90,0.55)'
            for (let i = 0; i < (w * h) / 2600; i++) {
              const r = Math.random() < 0.94 ? rand(0.4, 1) : rand(1.2, 1.8)
              g.globalAlpha = rand(0.2, 0.8)
              g.beginPath()
              g.arc(Math.random() * w, Math.random() * h, r, 0, TAU)
              g.fill()
            }
            g.globalAlpha = 1
          })
          twinkles = Array.from({ length: Math.round((w * h) / 30000) + 12 }, () => ({ x: Math.random() * w, y: Math.random() * h, p: Math.random() * TAU, r: rand(1, 2.2) }))
          meteors = []
        },
        draw(ctx, w, h, dt, l) {
          t += dt
          rot += dt * 0.012
          const glow = 0.6 + l.vivid * 0.5
          const ink = dark ? '214,182,110' : '40,56,110'
          if (field) ctx.drawImage(field, 0, 0, w, h)
          for (const s of twinkles) {
            const a = 0.25 + 0.75 * Math.max(0, Math.sin(t * 1.6 + s.p))
            ctx.fillStyle = dark ? `rgba(255,248,225,${a})` : `rgba(40,56,110,${a * 0.6})`
            ctx.beginPath()
            ctx.arc(s.x, s.y, s.r * (0.6 + a * 0.5), 0, TAU)
            ctx.fill()
          }
          // the celestial grid
          const cx = w * 0.62
          const cy = h * 0.46
          const R = Math.min(w, h) * 0.46
          ctx.lineWidth = 1
          ctx.strokeStyle = `rgba(${ink},${0.14 * glow})`
          for (const k of [0.3, 0.55, 0.8]) {
            ctx.beginPath()
            ctx.arc(cx, cy, R * k, 0, TAU)
            ctx.stroke()
          }
          ctx.setLineDash([2, 6])
          for (let i = 0; i < 24; i++) {
            const a = rot + (i / 24) * TAU
            ctx.beginPath()
            ctx.moveTo(cx + Math.cos(a) * R * 0.3, cy + Math.sin(a) * R * 0.3)
            ctx.lineTo(cx + Math.cos(a) * R * 1.25, cy + Math.sin(a) * R * 1.25)
            ctx.stroke()
          }
          ctx.setLineDash([])
          // the ring of signs
          const z = zodiac.current
          const cur = z ? ZODIAC_KEYS.indexOf(z.key) : -1
          ctx.strokeStyle = `rgba(${ink},${0.35 * glow})`
          ctx.lineWidth = 1.2
          for (const k of [1, 1.12]) {
            ctx.beginPath()
            ctx.arc(cx, cy, R * k, 0, TAU)
            ctx.stroke()
          }
          ctx.font = `${Math.max(14, R * 0.07)}px 'Segoe UI Symbol', 'Segoe UI', serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          for (let i = 0; i < 12; i++) {
            const a0 = -rot + (i / 12) * TAU
            ctx.strokeStyle = `rgba(${ink},${0.3 * glow})`
            ctx.beginPath()
            ctx.moveTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R)
            ctx.lineTo(cx + Math.cos(a0) * R * 1.12, cy + Math.sin(a0) * R * 1.12)
            ctx.stroke()
            const am = a0 + TAU / 24
            if (i === cur) {
              ctx.fillStyle = `rgba(${ink},${0.16 * glow})`
              ctx.beginPath()
              ctx.arc(cx, cy, R * 1.12, a0, a0 + TAU / 12)
              ctx.arc(cx, cy, R, a0 + TAU / 12, a0, true)
              ctx.fill()
            }
            ctx.fillStyle = `rgba(${ink},${(i === cur ? 0.95 : 0.45) * glow})`
            ctx.fillText(ZODIAC_SYMBOLS[i], cx + Math.cos(am) * R * 1.06, cy + Math.sin(am) * R * 1.06)
          }
          ctx.textAlign = 'start'
          ctx.textBaseline = 'alphabetic'
          // today's sign, large, lit as far as today's usage reaches
          if (z) {
            if (lastLit >= 0 && z.lit > lastLit) flare = 1
            lastLit = z.lit
            flare = Math.max(0, flare - dt * 0.6)
            const S = R * 1.25
            const pt = (i: number) => [cx - S / 2 + z.points[i][0] * S, cy - S / 2 + z.points[i][1] * S] as const
            const lit = (i: number) => i < z.lit
            for (const [a, b] of z.lines) {
              const on = lit(a) && lit(b)
              ctx.strokeStyle = `rgba(${ink},${(on ? 0.75 : 0.18) * glow})`
              ctx.lineWidth = on ? 1.6 : 1
              if (!on) ctx.setLineDash([3, 5])
              const [x1, y1] = pt(a)
              const [x2, y2] = pt(b)
              ctx.beginPath()
              ctx.moveTo(x1, y1)
              ctx.lineTo(x2, y2)
              ctx.stroke()
              ctx.setLineDash([])
            }
            z.points.forEach((_, i) => {
              const [x, y] = pt(i)
              const on = lit(i)
              const newest = on && i === z.lit - 1
              const r = on ? 3.4 + (newest ? flare * 6 : 0) + Math.sin(t * 2 + i) * 0.5 : 2
              if (on) {
                const g = ctx.createRadialGradient(x, y, 0, x, y, r * 5)
                g.addColorStop(0, dark ? `rgba(255,230,160,${0.6 * glow})` : `rgba(60,80,160,${0.35 * glow})`)
                g.addColorStop(1, 'rgba(255,230,160,0)')
                ctx.fillStyle = g
                ctx.fillRect(x - r * 5, y - r * 5, r * 10, r * 10)
              }
              ctx.fillStyle = on ? (dark ? '#fff4d6' : '#26346e') : `rgba(${ink},0.4)`
              ctx.beginPath()
              ctx.arc(x, y, r, 0, TAU)
              ctx.fill()
            })
          }
          // shooting stars on new usage
          if (l.pulseAt > lastPulse.current) {
            lastPulse.current = l.pulseAt
            meteors.push({ x: w * rand(0.3, 1), y: rand(0, h * 0.3), vx: -rand(500, 800), vy: rand(200, 360), life: 1 })
          }
          meteors = meteors.filter((m) => {
            m.x += m.vx * dt
            m.y += m.vy * dt
            m.life -= dt * 1.1
            if (m.life <= 0) return false
            const g = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * 0.12, m.y - m.vy * 0.12)
            g.addColorStop(0, dark ? `rgba(255,248,220,${m.life})` : `rgba(40,56,110,${m.life * 0.8})`)
            g.addColorStop(1, 'rgba(255,248,220,0)')
            ctx.strokeStyle = g
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.moveTo(m.x, m.y)
            ctx.lineTo(m.x - m.vx * 0.12, m.y - m.vy * 0.12)
            ctx.stroke()
            return true
          })
        }
      }
    },
    1,
    30
  )
  return <canvas ref={ref} className="scene-canvas" />
}

// ---------------------------------------------------------------- 纸笺

type Doodle = { kind: number; x: number; y: number; s: number; age: number; seed: number }

/** a doodle traced up to `k` (0–1) with a slightly shaky pencil */
function drawDoodle(ctx: CanvasRenderingContext2D, d: Doodle, k: number): void {
  const pts: [number, number][] = []
  const { x, y, s } = d
  switch (d.kind) {
    case 0: // a sparkline climbing
      for (let i = 0; i <= 12; i++) pts.push([x + (i / 12) * s * 2, y - Math.sin(i * 1.3 + d.seed) * s * 0.25 - (i / 12) * s * 0.6])
      break
    case 1: // a five-point star
      for (let i = 0; i <= 5; i++) {
        const a = -Math.PI / 2 + ((i * 2) % 5) * ((TAU / 5) * 1)
        pts.push([x + Math.cos(a) * s * 0.6, y + Math.sin(a) * s * 0.6])
      }
      break
    case 2: // a check mark
      pts.push([x - s * 0.5, y], [x - s * 0.1, y + s * 0.4], [x + s * 0.7, y - s * 0.5])
      break
    case 3: // a spiral
      for (let i = 0; i <= 40; i++) pts.push([x + Math.cos(i * 0.45) * i * s * 0.018, y + Math.sin(i * 0.45) * i * s * 0.018])
      break
    case 4: // an arrow
      pts.push([x - s, y + s * 0.2], [x + s * 0.6, y - s * 0.1], [x + s * 0.3, y - s * 0.4], [x + s * 0.6, y - s * 0.1], [x + s * 0.25, y + s * 0.2])
      break
    default: // a little cloud
      for (let i = 0; i <= 30; i++) {
        const a = Math.PI + (i / 30) * Math.PI
        const bump = 1 + 0.25 * Math.abs(Math.sin(i * 0.52))
        pts.push([x + Math.cos(a) * s * 0.8 * bump, y + Math.sin(a) * s * 0.45 * bump])
      }
      pts.push([x + s * 0.8, y], [x - s * 0.8, y])
  }
  const n = Math.max(2, Math.floor(pts.length * k))
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const jx = Math.sin(i * 7.3 + d.seed) * 0.8
    const jy = Math.cos(i * 5.1 + d.seed) * 0.8
    if (i) ctx.lineTo(pts[i][0] + jx, pts[i][1] + jy)
    else ctx.moveTo(pts[i][0] + jx, pts[i][1] + jy)
  }
  ctx.stroke()
}

/**
 * A desk of paper: warm sheets with fibres and a dotted grid, sunlight from a
 * window drifting slowly across, a faint coffee ring; each batch of new usage
 * sketches a little pencil doodle in the margins (a chart, a star, a tick …).
 */
export function PaperDesk(p: SceneProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useLive(p)
  const dark = p.dark === true
  const lastPulse = useRef(0)
  useScene(
    ref,
    p.level,
    live,
    () => {
      let sheet: HTMLCanvasElement | null = null
      let doodles: Doodle[] = []
      let t = 0
      return {
        init(w, h) {
          sheet = layer(w, h, (g) => {
            g.fillStyle = dark ? '#2a2620' : '#f7f1e3'
            g.fillRect(0, 0, w, h)
            // fibres
            g.strokeStyle = dark ? 'rgba(255,240,210,0.035)' : 'rgba(120,100,70,0.06)'
            g.lineWidth = 0.6
            for (let i = 0; i < (w * h) / 700; i++) {
              const x = Math.random() * w
              const y = Math.random() * h
              const a = Math.random() * TAU
              const len = rand(3, 12)
              g.beginPath()
              g.moveTo(x, y)
              g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len)
              g.stroke()
            }
            // dotted grid
            g.fillStyle = dark ? 'rgba(240,230,210,0.12)' : 'rgba(120,100,70,0.16)'
            for (let x = 11; x < w; x += 22) for (let y = 11; y < h; y += 22) g.fillRect(x, y, 1.3, 1.3)
            // the margin line
            g.strokeStyle = dark ? 'rgba(230,120,110,0.22)' : 'rgba(205,90,80,0.28)'
            g.lineWidth = 1.2
            g.beginPath()
            g.moveTo(276, 0)
            g.lineTo(276, h)
            g.stroke()
            // a coffee ring
            const rx = w * 0.88
            const ry = h * 0.82
            for (let i = 0; i < 3; i++) {
              g.strokeStyle = dark ? `rgba(160,110,70,${0.12 - i * 0.03})` : `rgba(140,90,40,${0.12 - i * 0.03})`
              g.lineWidth = 3 - i
              g.beginPath()
              g.ellipse(rx + i, ry - i, 46 + i * 2, 42 + i, 0.3, 0.2, TAU - 0.4)
              g.stroke()
            }
          })
          doodles = []
        },
        draw(ctx, w, h, dt, l) {
          t += dt
          if (sheet) ctx.drawImage(sheet, 0, 0, w, h)
          const glow = 0.6 + l.vivid * 0.5
          // sunlight through a window, drifting slowly
          const sx = w * (0.35 + 0.25 * Math.sin(t * 0.015))
          ctx.save()
          ctx.translate(sx, h * 0.4)
          ctx.rotate(-0.5)
          const lg = ctx.createLinearGradient(-w * 0.5, 0, w * 0.5, 0)
          lg.addColorStop(0, 'rgba(255,240,200,0)')
          lg.addColorStop(0.5, dark ? `rgba(255,220,160,${0.07 * glow})` : `rgba(255,246,220,${0.45 * glow})`)
          lg.addColorStop(1, 'rgba(255,240,200,0)')
          ctx.fillStyle = lg
          ctx.fillRect(-w * 0.5, -h, w, h * 2)
          // the window frame's shadow bars
          ctx.fillStyle = dark ? 'rgba(0,0,0,0.12)' : `rgba(120,95,60,${0.05 * glow})`
          ctx.fillRect(-w * 0.04, -h, w * 0.02, h * 2)
          ctx.fillRect(w * 0.16, -h, w * 0.02, h * 2)
          ctx.restore()
          // pencil doodles
          if (l.pulseAt > lastPulse.current) {
            lastPulse.current = l.pulseAt
            const inSide = Math.random() < 0.45
            doodles.push({ kind: (Math.random() * 6) | 0, x: inSide ? rand(40, 220) : rand(w * 0.32, w * 0.9), y: inSide ? rand(h * 0.45, h * 0.9) : rand(40, 120), s: rand(22, 40), age: 0, seed: Math.random() * 10 })
            if (doodles.length > 9) doodles.shift()
          }
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'
          ctx.lineWidth = 1.4
          doodles = doodles.filter((d) => {
            d.age += dt
            const k = Math.min(1, d.age / 1.3)
            const a = d.age < 4 ? 0.55 : Math.max(0.16, 0.55 - (d.age - 4) * 0.05)
            if (d.age > 120) return false
            ctx.strokeStyle = dark ? `rgba(240,235,220,${a * glow})` : `rgba(70,66,60,${a * glow})`
            drawDoodle(ctx, d, k)
            return true
          })
        }
      }
    },
    1,
    24
  )
  return <canvas ref={ref} className="scene-canvas" />
}
