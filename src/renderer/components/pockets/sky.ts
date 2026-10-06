import { moonPhase } from '@shared/astro'
import type { Pocket } from '../Pocket'
import { drawMoon } from '../ThemeScenes3'
import { disc, drawStars, focus, glow, kick, pulses, rnd, starsOf, TAU, vgrad } from './kit'

/** a tapered ray from (x, y) */
function ray(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, len: number, wid: number, rgb: string, alpha: number): void {
  const ex = x + Math.cos(a) * len
  const ey = y + Math.sin(a) * len
  const g = ctx.createLinearGradient(x, y, ex, ey)
  g.addColorStop(0, `rgba(${rgb},${alpha})`)
  g.addColorStop(1, `rgba(${rgb},0)`)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(x + Math.cos(a + Math.PI / 2) * wid, y + Math.sin(a + Math.PI / 2) * wid)
  ctx.lineTo(ex, ey)
  ctx.lineTo(x + Math.cos(a - Math.PI / 2) * wid, y + Math.sin(a - Math.PI / 2) * wid)
  ctx.closePath()
  ctx.fill()
}

// ---------------------------------------------------------------- Claude 暖光

/** Warm light: slow rays turning round a glowing core, dust rising through them; new usage sends a ring out and lengthens the rays */
export function claude(): Pocket {
  const motes = Array.from({ length: 26 }, () => ({ u: Math.random(), v: Math.random(), s: rnd(0.6, 1.8), sp: rnd(0.015, 0.05), p: Math.random() * TAU }))
  const rays = Array.from({ length: 12 }, (_, i) => ({ a: (i / 12) * TAU + rnd(-0.12, 0.12), len: rnd(0.55, 1), w: rnd(0.035, 0.07) }))
  const fresh = pulses()
  let rings: number[] = []
  let spin = 0
  return {
    dark: (d) => d,
    draw(ctx, w, h, dt, l) {
      const f = focus(l.shape, w, h)
      const k = kick(l)
      if (fresh(l)) rings.push(0)
      vgrad(ctx, w, h, l.dark ? [[0, '#2b231e'], [1, '#1b1714']] : [[0, '#fbf5ec'], [1, '#f0e4d4']])
      glow(ctx, f.x, f.y, f.s * (0.95 + k * 0.3), '217,119,87', (l.dark ? 0.34 : 0.26) * (0.7 + l.vivid * 0.5) + k * 0.25)
      spin += dt * (0.07 + l.intensity * 0.05)
      ctx.globalCompositeOperation = l.dark ? 'lighter' : 'source-over'
      for (const r of rays) ray(ctx, f.x, f.y, r.a + spin, f.s * 0.85 * r.len * (1 + k * 0.45), f.s * r.w, l.dark ? '232,140,100' : '217,119,87', (l.dark ? 0.32 : 0.22) + k * 0.25)
      ctx.globalCompositeOperation = 'source-over'
      glow(ctx, f.x, f.y, f.s * 0.16, l.dark ? '255,226,200' : '255,240,225', 0.9)
      rings = rings.filter((a) => a < 1.4)
      ctx.lineWidth = 1.5
      for (let i = 0; i < rings.length; i++) {
        rings[i] += dt
        const a = rings[i] / 1.4
        ctx.strokeStyle = `rgba(217,119,87,${(1 - a) * 0.7})`
        ctx.beginPath()
        ctx.arc(f.x, f.y, f.s * (0.15 + a * 0.9), 0, TAU)
        ctx.stroke()
      }
      ctx.fillStyle = l.dark ? '#f2b89c' : '#c4683f'
      for (const m of motes) {
        m.v -= m.sp * dt * (1 + l.intensity * 0.4)
        if (m.v < -0.05) {
          m.v = 1.05
          m.u = Math.random()
        }
        ctx.globalAlpha = (0.25 + 0.5 * (0.5 + 0.5 * Math.sin(l.t * 1.7 + m.p))) * (l.dark ? 0.8 : 0.6)
        ctx.fillRect(m.u * w + Math.sin(l.t * 0.6 + m.p) * 6, m.v * h, m.s, m.s)
      }
      ctx.globalAlpha = 1
    },
    emblem(ctx, x, y, r, l) {
      const k = kick(l)
      glow(ctx, x, y, r * 1.05, '217,119,87', 0.35 + k * 0.4)
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU + l.t * 0.35
        const len = r * (i % 2 ? 0.62 : 0.92) * (1 + 0.07 * Math.sin(l.t * 2.2 + i) + k * 0.15)
        ctx.fillStyle = '#d97757'
        ctx.beginPath()
        ctx.moveTo(x + Math.cos(a + 1.4) * r * 0.1, y + Math.sin(a + 1.4) * r * 0.1)
        ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len)
        ctx.lineTo(x + Math.cos(a - 1.4) * r * 0.1, y + Math.sin(a - 1.4) * r * 0.1)
        ctx.fill()
      }
      disc(ctx, x, y, r * 0.16, '#f6cdb8')
    }
  }
}

// ---------------------------------------------------------------- Codex 夜色

const CODE = 'const fn=>{}();[]01ab#$%&*+<>/\\|?'
const LINES = ['codex exec', 'apply_patch', 'run tests ✓', 'git diff --stat', 'npm run build', 'read src/', 'plan → edit']

/** A terminal at night: faint code drifting up, a prompt typing away; new usage runs a scan line down and types a fresh line */
export function codex(): Pocket {
  const fresh = pulses()
  let line = 0
  let typed = 0
  let hold = 0
  let scan = -1
  return {
    dark: (d) => d,
    draw(ctx, w, h, dt, l) {
      const f = focus(l.shape, w, h)
      const k = kick(l)
      if (fresh(l)) {
        scan = 0
        line = (line + 1) % LINES.length
        typed = 0
        hold = 0
      }
      vgrad(ctx, w, h, l.dark ? [[0, '#0a0f1f'], [1, '#0f1729']] : [[0, '#f3f6fc'], [1, '#e5ebf6']])
      glow(ctx, f.x, f.y, f.s * 0.9, l.dark ? '107,124,255' : '107,124,255', (l.dark ? 0.22 : 0.14) + k * 0.2)
      // the code drifting up, thicker toward the busy side
      const cell = 13
      const off = (l.t * (6 + l.intensity * 4)) % cell
      ctx.font = '600 10px Consolas, "Cascadia Mono", monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const rgb = l.dark ? '150,165,255' : '70,85,170'
      for (let cx = w * 0.35; cx < w; cx += cell) {
        for (let cy = -off; cy < h + cell; cy += cell) {
          const n = Math.sin(cx * 12.9898 + Math.floor((cy + l.t * (6 + l.intensity * 4)) / cell) * 78.233) * 43758.5453
          const r = n - Math.floor(n)
          if (r < 0.45) continue
          ctx.fillStyle = `rgba(${rgb},${(0.05 + (r - 0.45) * 0.22) * ((cx - w * 0.35) / (w * 0.65))})`
          ctx.fillText(CODE[Math.floor(r * 997) % CODE.length], cx, cy)
        }
      }
      // the prompt, where there's room for it beside the numbers
      const text = LINES[line]
      if (typed < text.length) typed += dt * (14 + k * 30)
      else if ((hold += dt) > 2.4) {
        line = (line + 1) % LINES.length
        typed = 0
        hold = 0
      }
      if (l.shape === 'card') {
        const shown = `› ${text.slice(0, Math.floor(typed))}`
        const size = 11
        ctx.font = `600 ${size}px Consolas, "Cascadia Mono", monospace`
        ctx.textAlign = 'left'
        const tw = ctx.measureText(`› ${text}`).width
        const tx = w - tw - 16
        const ty = h * 0.66
        ctx.fillStyle = l.dark ? 'rgba(200,210,255,0.8)' : 'rgba(40,50,120,0.8)'
        ctx.fillText(shown, tx, ty)
        if (Math.sin(l.t * 6) > 0) {
          ctx.fillStyle = l.dark ? 'rgba(139,156,255,0.9)' : 'rgba(80,95,220,0.9)'
          ctx.fillRect(tx + ctx.measureText(shown).width + 2, ty - size / 2, size * 0.55, size)
        }
      }
      if (scan >= 0) {
        scan += dt / 0.9
        const y = scan * h
        const g = ctx.createLinearGradient(0, y - 18, 0, y)
        g.addColorStop(0, 'rgba(139,156,255,0)')
        g.addColorStop(1, `rgba(139,156,255,${0.35 * (1 - scan)})`)
        ctx.fillStyle = g
        ctx.fillRect(0, y - 18, w, 18)
        if (scan > 1) scan = -1
      }
    },
    emblem(ctx, x, y, r, l) {
      const k = kick(l)
      const s = r * 1.5
      const g = ctx.createLinearGradient(x - s / 2, y - s / 2, x + s / 2, y + s / 2)
      g.addColorStop(0, '#3d4fe0')
      g.addColorStop(1, '#8b5cf6')
      glow(ctx, x, y, r * 1.2, '120,110,255', 0.25 + k * 0.4)
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.roundRect(x - s / 2, y - s / 2, s, s, s * 0.28)
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = Math.max(1.2, r * 0.16)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(x - s * 0.24, y - s * 0.16)
      ctx.lineTo(x - s * 0.06, y)
      ctx.lineTo(x - s * 0.24, y + s * 0.16)
      ctx.stroke()
      if (Math.sin(l.t * 6) > -0.2) {
        ctx.beginPath()
        ctx.moveTo(x + s * 0.02, y + s * 0.18)
        ctx.lineTo(x + s * 0.24, y + s * 0.18)
        ctx.stroke()
      }
    }
  }
}

// ---------------------------------------------------------------- 星象

/** a constellation's stars, around its middle, in units of the scene's size */
const FIGURE: [number, number][] = [
  [-0.42, 0.1],
  [-0.24, -0.12],
  [-0.05, -0.04],
  [0.1, -0.24],
  [0.3, -0.14],
  [0.2, 0.12],
  [0.42, 0.22]
]

/** The night sky's figures: a constellation slowly turning inside a zodiac ring; new usage sends a shooting star across */
export function astral(): Pocket {
  const stars = starsOf(70)
  const fresh = pulses()
  let shoot: { x: number; y: number; t: number } | null = null
  return {
    dark: (d) => d,
    draw(ctx, w, h, dt, l) {
      const f = focus(l.shape, w, h)
      const k = kick(l)
      vgrad(ctx, w, h, l.dark ? [[0, '#070b20'], [1, '#141b3c']] : [[0, '#eef1fb'], [1, '#dbe1f4']])
      glow(ctx, f.x, f.y, f.s * 0.9, l.dark ? '120,110,230' : '120,130,220', l.dark ? 0.22 : 0.16)
      drawStars(ctx, stars, w, h, l.t, l.dark ? 0.9 : 0.5, l.dark ? '#ffffff' : '#4a5590')
      const line = l.dark ? '190,200,255' : '70,80,150'
      // the zodiac ring
      const R = f.s * 0.52
      ctx.save()
      ctx.translate(f.x, f.y)
      ctx.rotate(l.t * 0.04)
      ctx.strokeStyle = `rgba(${line},0.28)`
      ctx.lineWidth = 1
      ctx.setLineDash([2, 5])
      ctx.beginPath()
      ctx.arc(0, 0, R, 0, TAU)
      ctx.stroke()
      ctx.setLineDash([])
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU
        ctx.strokeStyle = `rgba(${line},0.45)`
        ctx.beginPath()
        ctx.moveTo(Math.cos(a) * R * 0.92, Math.sin(a) * R * 0.92)
        ctx.lineTo(Math.cos(a) * R * 1.06, Math.sin(a) * R * 1.06)
        ctx.stroke()
      }
      // the figure inside it, turning the other way
      ctx.rotate(-l.t * 0.07)
      const pts = FIGURE.map(([u, v]) => [u * f.s * 0.95, v * f.s * 0.95] as const)
      ctx.strokeStyle = `rgba(${line},${0.4 + k * 0.4})`
      ctx.lineWidth = 1
      ctx.beginPath()
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.stroke()
      pts.forEach(([x, y], i) => {
        const tw = 0.6 + 0.4 * Math.sin(l.t * 2 + i * 1.7)
        glow(ctx, x, y, 7 + k * 6, l.dark ? '200,210,255' : '90,100,190', 0.55 * tw + k * 0.3)
        disc(ctx, x, y, 1.6, l.dark ? '#fff' : '#3a4590')
      })
      ctx.restore()
      if (fresh(l)) shoot = { x: rnd(0.1, 0.5) * w, y: rnd(0, 0.3) * h, t: 0 }
      if (shoot) {
        shoot.t += dt
        const x = shoot.x + shoot.t * w * 0.9
        const y = shoot.y + shoot.t * h * 0.5
        const g = ctx.createLinearGradient(x - 40, y - 22, x, y)
        g.addColorStop(0, 'rgba(255,255,255,0)')
        g.addColorStop(1, `rgba(255,255,255,${0.9 * (1 - shoot.t / 0.8)})`)
        ctx.strokeStyle = g
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.moveTo(x - 40, y - 22)
        ctx.lineTo(x, y)
        ctx.stroke()
        if (shoot.t > 0.8) shoot = null
      }
    },
    emblem(ctx, x, y, r, l) {
      const k = kick(l)
      glow(ctx, x, y, r * 1.1, '140,130,255', 0.3 + k * 0.4)
      ctx.strokeStyle = 'rgba(190,200,255,0.65)'
      ctx.lineWidth = Math.max(1, r * 0.07)
      ctx.beginPath()
      ctx.arc(x, y, r * 0.78, 0, TAU)
      ctx.stroke()
      for (let i = 0; i < 3; i++) {
        const a = l.t * 0.8 + (i / 3) * TAU
        disc(ctx, x + Math.cos(a) * r * 0.78, y + Math.sin(a) * r * 0.78, r * 0.07, '#cfd6ff')
      }
      const s = r * (0.62 + 0.06 * Math.sin(l.t * 2) + k * 0.15)
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.moveTo(x, y - s)
      ctx.quadraticCurveTo(x, y, x + s * 0.45, y)
      ctx.quadraticCurveTo(x, y, x, y + s)
      ctx.quadraticCurveTo(x, y, x - s * 0.45, y)
      ctx.quadraticCurveTo(x, y, x, y - s)
      ctx.fill()
    }
  }
}

// ---------------------------------------------------------------- 天体仪

const PLANETS = [
  { r: 0.17, c: '#7fd1ff', s: 0.06 },
  { r: 0.28, c: '#ffb38a', s: 0.075 },
  { r: 0.4, c: '#c6a0ff', s: 0.09 },
  { r: 0.53, c: '#9be08f', s: 0.07 }
]

/** A brass orrery: planets on tilted orbits round a small sun, faster with usage; new usage flares the sun and spurs them on */
export function orrery(): Pocket {
  const ang = PLANETS.map(() => Math.random() * TAU)
  const stars = starsOf(40)
  return {
    dark: (d) => d,
    draw(ctx, w, h, dt, l) {
      const f = focus(l.shape, w, h)
      const k = kick(l, 2.2)
      vgrad(ctx, w, h, l.dark ? [[0, '#0b0919'], [1, '#18112c']] : [[0, '#f7f1e5'], [1, '#ebe0cc']])
      if (l.dark) drawStars(ctx, stars, w, h, l.t, 0.6)
      const ring = l.dark ? '205,190,255' : '140,100,40'
      const tilt = -0.18
      const sx = f.x
      const sy = f.y
      const R = f.s * (l.shape === 'card' ? 1.15 : 1)
      const pos = PLANETS.map((p, i) => {
        ang[i] += dt * (p.s / Math.pow(p.r, 1.5)) * 0.12 * (1 + l.intensity * 0.35 + k * 3)
        const rx = p.r * R
        const ry = rx * 0.4
        const x0 = Math.cos(ang[i]) * rx
        const y0 = Math.sin(ang[i]) * ry
        return { x: sx + x0 * Math.cos(tilt) - y0 * Math.sin(tilt), y: sy + x0 * Math.sin(tilt) + y0 * Math.cos(tilt), back: Math.sin(ang[i]) < 0, p }
      })
      ctx.strokeStyle = `rgba(${ring},0.28)`
      ctx.lineWidth = 1
      for (const p of PLANETS) {
        ctx.beginPath()
        ctx.ellipse(sx, sy, p.r * R, p.r * R * 0.4, tilt, 0, TAU)
        ctx.stroke()
      }
      const planet = (q: (typeof pos)[number]) => {
        const r = R * 0.035 * (q.p.r + 0.6)
        glow(ctx, q.x, q.y, r * 3, l.dark ? '200,200,255' : '255,255,255', q.back ? 0.15 : 0.3)
        disc(ctx, q.x, q.y, r, q.p.c)
      }
      pos.filter((q) => q.back).forEach(planet)
      glow(ctx, sx, sy, R * (0.32 + k * 0.25), '255,196,90', 0.55 + k * 0.35)
      disc(ctx, sx, sy, R * 0.065, l.dark ? '#ffe2a8' : '#ffcf70')
      pos.filter((q) => !q.back).forEach(planet)
    },
    emblem(ctx, x, y, r, l) {
      const k = kick(l)
      glow(ctx, x, y, r * (0.8 + k * 0.4), '255,196,90', 0.55)
      ctx.strokeStyle = 'rgba(230,210,160,0.7)'
      ctx.lineWidth = Math.max(1, r * 0.08)
      ctx.beginPath()
      ctx.ellipse(x, y, r * 0.85, r * 0.36, -0.3, 0, TAU)
      ctx.stroke()
      disc(ctx, x, y, r * 0.26, '#ffd27a')
      const a = l.t * 1.4
      const px = x + Math.cos(a) * r * 0.85 * Math.cos(-0.3) - Math.sin(a) * r * 0.36 * Math.sin(-0.3)
      const py = y + Math.cos(a) * r * 0.85 * Math.sin(-0.3) + Math.sin(a) * r * 0.36 * Math.cos(-0.3)
      disc(ctx, px, py, r * 0.13, '#7fd1ff')
    }
  }
}

// ---------------------------------------------------------------- 月相

/** Tonight's moon, in its real phase, with thin clouds drifting past; new usage rings it with a halo */
export function lunar(): Pocket {
  const stars = starsOf(55, 0.8)
  const clouds = Array.from({ length: 5 }, (_, i) => ({ u: Math.random(), v: 0.2 + i * 0.16 + rnd(-0.05, 0.05), s: rnd(0.6, 1.2), sp: rnd(0.006, 0.014) }))
  let phase = moonPhase(Date.now()).phase
  let checked = 0
  return {
    dark: (d) => d,
    draw(ctx, w, h, dt, l) {
      const f = focus(l.shape, w, h)
      const k = kick(l, 2)
      if (l.t - checked > 60) {
        checked = l.t
        phase = moonPhase(Date.now()).phase
      }
      vgrad(ctx, w, h, l.dark ? [[0, '#0a1124'], [1, '#1a2542']] : [[0, '#e9eff9'], [1, '#d4dcec']])
      if (l.dark) drawStars(ctx, stars, w, h, l.t, 0.8)
      const R = f.s * 0.2
      glow(ctx, f.x, f.y, R * (3.2 + k), '225,232,255', (l.dark ? 0.3 : 0.4) + k * 0.25)
      if (k > 0) {
        ctx.strokeStyle = `rgba(230,236,255,${k * 0.6})`
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(f.x, f.y, R * (1.5 + (1 - k) * 1.6), 0, TAU)
        ctx.stroke()
      }
      drawMoon(ctx, f.x, f.y, R, phase, l.dark)
      for (const c of clouds) {
        c.u += c.sp * dt * (1 + l.intensity * 0.3)
        if (c.u > 1.3) c.u = -0.3
        const x = c.u * w
        const y = c.v * h
        const s = c.s * Math.min(h * 0.9, 80)
        for (let i = 0; i < 3; i++) glow(ctx, x + (i - 1) * s * 0.55, y + (i === 1 ? -s * 0.08 : 0), s * 0.5, l.dark ? '150,165,205' : '255,255,255', l.dark ? 0.16 : 0.5)
      }
    },
    emblem(ctx, x, y, r, l) {
      if (l.t - checked > 60) {
        checked = l.t
        phase = moonPhase(Date.now()).phase
      }
      glow(ctx, x, y, r * (1.2 + kick(l) * 0.5), '220,228,255', 0.35)
      drawMoon(ctx, x, y, r * 0.78, phase, true)
    }
  }
}

// ---------------------------------------------------------------- 日食

/** Totality: the black disc, the corona's streamers turning slowly, the diamond ring on its rim; new usage flares the corona */
export function eclipse(): Pocket {
  const streams = Array.from({ length: 40 }, () => ({ a: Math.random() * TAU, len: rnd(0.5, 1), w: rnd(0.6, 1.6), f: rnd(0.3, 1.2) }))
  const stars = starsOf(35)
  return {
    dark: () => true,
    draw(ctx, w, h, _dt, l) {
      const f = focus(l.shape, w, h)
      const k = kick(l, 2)
      vgrad(ctx, w, h, [
        [0, '#040408'],
        [1, '#0d0b18']
      ])
      drawStars(ctx, stars, w, h, l.t, 0.55)
      const R = f.s * 0.16
      glow(ctx, f.x, f.y, R * (4 + k * 1.5), '255,214,170', 0.32 + k * 0.3)
      ctx.globalCompositeOperation = 'lighter'
      ctx.lineCap = 'round'
      for (const s of streams) {
        const a = s.a + l.t * 0.02
        const len = R * (1.2 + s.len * (1.4 + 0.4 * Math.sin(l.t * s.f + s.a)) * (1 + k * 0.8))
        const g = ctx.createLinearGradient(f.x + Math.cos(a) * R, f.y + Math.sin(a) * R, f.x + Math.cos(a) * len, f.y + Math.sin(a) * len)
        g.addColorStop(0, 'rgba(255,240,220,0.5)')
        g.addColorStop(1, 'rgba(255,200,150,0)')
        ctx.strokeStyle = g
        ctx.lineWidth = s.w
        ctx.beginPath()
        ctx.moveTo(f.x + Math.cos(a) * R, f.y + Math.sin(a) * R)
        ctx.lineTo(f.x + Math.cos(a) * len, f.y + Math.sin(a) * len)
        ctx.stroke()
      }
      ctx.globalCompositeOperation = 'source-over'
      ctx.strokeStyle = 'rgba(255,245,230,0.9)'
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.arc(f.x, f.y, R, 0, TAU)
      ctx.stroke()
      disc(ctx, f.x, f.y, R - 0.6, '#000')
      // the diamond ring
      const a = l.t * 0.25
      const dx = f.x + Math.cos(a) * R
      const dy = f.y + Math.sin(a) * R
      glow(ctx, dx, dy, R * (0.9 + k), '255,255,255', 0.85)
    },
    emblem(ctx, x, y, r, l) {
      const k = kick(l)
      glow(ctx, x, y, r * (1.25 + k * 0.4), '255,214,170', 0.45)
      ctx.strokeStyle = 'rgba(255,240,220,0.95)'
      ctx.lineWidth = Math.max(1.2, r * 0.09)
      ctx.beginPath()
      ctx.arc(x, y, r * 0.62, 0, TAU)
      ctx.stroke()
      disc(ctx, x, y, r * 0.58, '#000')
      const a = l.t * 0.6
      glow(ctx, x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62, r * 0.5, '255,255,255', 0.9)
    }
  }
}

// ---------------------------------------------------------------- 星轨

/** A long exposure: star trails wheeling round the pole above a hill with a lit tent; new usage sends a meteor through */
export function trails(): Pocket {
  const arcs = Array.from({ length: 64 }, () => ({ r: Math.pow(Math.random(), 0.85), a: Math.random() * TAU, len: rnd(0.35, 0.9), c: Math.random() }))
  const fresh = pulses()
  let meteor = -1
  return {
    dark: () => true,
    draw(ctx, w, h, dt, l) {
      const k = kick(l)
      vgrad(ctx, w, h, [
        [0, '#050813'],
        [0.75, '#0e1630'],
        [1, '#1a1e3a']
      ])
      const px = l.shape === 'orb' ? w * 0.5 : w * 0.9
      const py = l.shape === 'orb' ? h * 0.32 : h * 0.12
      const span = Math.hypot(w, h) * 0.85
      const turn = l.t * 0.03 * (1 + l.intensity * 0.3)
      ctx.lineCap = 'round'
      for (const s of arcs) {
        const R = 6 + s.r * span
        const end = s.a + turn
        const col = s.c < 0.6 ? '220,230,255' : s.c < 0.85 ? '170,200,255' : '255,210,170'
        for (let i = 0; i < 4; i++) {
          ctx.strokeStyle = `rgba(${col},${(0.16 + i * 0.2) * (0.85 + k * 0.4)})`
          ctx.lineWidth = 1.1
          ctx.beginPath()
          ctx.arc(px, py, R, end - s.len * (1 - i / 4), end - s.len * (1 - (i + 1) / 4))
          ctx.stroke()
        }
      }
      disc(ctx, px, py, 1.6, '#fff')
      // the hill and the tent
      ctx.fillStyle = '#05070d'
      ctx.beginPath()
      ctx.moveTo(0, h)
      ctx.quadraticCurveTo(w * 0.35, h * 0.72, w * 0.7, h * 0.86)
      ctx.quadraticCurveTo(w * 0.86, h * 0.92, w, h * 0.84)
      ctx.lineTo(w, h)
      ctx.fill()
      const tx = w * 0.6
      const ty = h * 0.84
      const ts = Math.min(h * 0.14, 12)
      glow(ctx, tx, ty - ts * 0.4, ts * 3, '255,190,110', 0.35 + 0.08 * Math.sin(l.t * 3))
      ctx.fillStyle = '#ffb46a'
      ctx.beginPath()
      ctx.moveTo(tx - ts, ty)
      ctx.lineTo(tx, ty - ts)
      ctx.lineTo(tx + ts, ty)
      ctx.fill()
      if (fresh(l)) meteor = 0
      if (meteor >= 0) {
        meteor += dt / 0.7
        const x = w * (0.2 + meteor * 0.6)
        const y = h * (0.05 + meteor * 0.4)
        const g = ctx.createLinearGradient(x - 50, y - 25, x, y)
        g.addColorStop(0, 'rgba(255,255,255,0)')
        g.addColorStop(1, `rgba(255,250,235,${1 - meteor})`)
        ctx.strokeStyle = g
        ctx.lineWidth = 1.8
        ctx.beginPath()
        ctx.moveTo(x - 50, y - 25)
        ctx.lineTo(x, y)
        ctx.stroke()
        if (meteor >= 1) meteor = -1
      }
    },
    emblem(ctx, x, y, r, l) {
      glow(ctx, x, y, r * 1.1, '150,170,255', 0.25 + kick(l) * 0.4)
      ctx.lineCap = 'round'
      for (let i = 0; i < 4; i++) {
        const R = r * (0.28 + i * 0.2)
        const a = l.t * (0.5 + i * 0.12) + i * 1.3
        ctx.strokeStyle = i % 2 ? 'rgba(255,214,170,0.85)' : 'rgba(205,220,255,0.9)'
        ctx.lineWidth = Math.max(1, r * 0.08)
        ctx.beginPath()
        ctx.arc(x, y, R, a, a + 2.2)
        ctx.stroke()
      }
      disc(ctx, x, y, r * 0.09, '#fff')
    }
  }
}

// ---------------------------------------------------------------- 雨夜

/** Rain on a night window: city lights out of focus, streaks falling, drops sliding down the glass; new usage flashes lightning */
export function rain(): Pocket {
  const bokeh = Array.from({ length: 12 }, () => ({ u: rnd(0.3, 1), v: rnd(0.1, 0.9), r: rnd(0.08, 0.2), c: ['255,190,120', '120,170,255', '255,140,170', '160,230,210'][Math.floor(Math.random() * 4)], p: Math.random() * TAU }))
  const drops = Array.from({ length: 60 }, () => ({ u: Math.random(), v: Math.random(), len: rnd(0.04, 0.09), sp: rnd(0.9, 1.5) }))
  const glass = Array.from({ length: 9 }, () => ({ u: Math.random(), v: Math.random(), r: rnd(1.5, 3.5), sp: rnd(0.01, 0.05), wait: rnd(0, 3) }))
  const fresh = pulses()
  let flash = 0
  return {
    dark: (d) => d,
    draw(ctx, w, h, dt, l) {
      if (fresh(l)) flash = 1
      vgrad(ctx, w, h, l.dark ? [[0, '#0b111d'], [1, '#121c2d']] : [[0, '#e1e7ef'], [1, '#cfd8e4']])
      for (const b of bokeh) glow(ctx, b.u * w, b.v * h, b.r * Math.min(h * 1.4, 120), b.c, (l.dark ? 0.28 : 0.3) * (0.75 + 0.25 * Math.sin(l.t * 0.8 + b.p)))
      const fall = 1 + l.intensity * 0.35 + flash * 0.8
      ctx.strokeStyle = l.dark ? 'rgba(190,210,240,0.35)' : 'rgba(80,100,135,0.35)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (const d of drops) {
        d.v += d.sp * dt * fall
        if (d.v > 1.1) {
          d.v = -0.1
          d.u = Math.random()
        }
        const x = d.u * w - d.v * h * 0.15
        const y = d.v * h
        ctx.moveTo(x, y)
        ctx.lineTo(x - d.len * h * 0.15, y - d.len * h)
      }
      ctx.stroke()
      for (const g of glass) {
        if (g.wait > 0) g.wait -= dt
        else g.v += g.sp * dt * (Math.sin(l.t * 2 + g.u * 9) > 0.6 ? 6 : 1)
        if (g.v > 1.1) {
          g.v = -0.05
          g.u = Math.random()
          g.wait = rnd(0, 2)
        }
        const x = g.u * w
        const y = g.v * h
        disc(ctx, x, y, g.r, l.dark ? 'rgba(170,190,220,0.18)' : 'rgba(255,255,255,0.45)')
        disc(ctx, x - g.r * 0.35, y - g.r * 0.35, g.r * 0.35, 'rgba(255,255,255,0.7)')
      }
      if (flash > 0) {
        ctx.fillStyle = `rgba(220,230,255,${flash * flash * 0.32})`
        ctx.fillRect(0, 0, w, h)
        flash = Math.max(0, flash - dt * 1.6)
      }
    },
    emblem(ctx, x, y, r, l) {
      const k = kick(l)
      for (let i = 0; i < 2; i++) {
        const a = (l.t * 0.7 + i * 0.5) % 1
        ctx.strokeStyle = `rgba(150,200,255,${(1 - a) * 0.6})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.ellipse(x, y + r * 0.62, r * (0.2 + a * 0.75), r * (0.07 + a * 0.22), 0, 0, TAU)
        ctx.stroke()
      }
      const s = r * (0.62 + k * 0.1)
      const by = y - r * 0.1 + Math.sin(l.t * 2) * r * 0.05
      const g = ctx.createLinearGradient(x, by - s, x, by + s * 0.6)
      g.addColorStop(0, '#bfe0ff')
      g.addColorStop(1, '#4d8fe0')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.moveTo(x, by - s)
      ctx.bezierCurveTo(x + s * 0.2, by - s * 0.45, x + s * 0.62, by - s * 0.05, x + s * 0.62, by + s * 0.25)
      ctx.arc(x, by + s * 0.25, s * 0.62, 0, Math.PI)
      ctx.bezierCurveTo(x - s * 0.62, by - s * 0.05, x - s * 0.2, by - s * 0.45, x, by - s)
      ctx.fill()
      disc(ctx, x - s * 0.22, by + s * 0.15, s * 0.13, 'rgba(255,255,255,0.75)')
    }
  }
}

// ---------------------------------------------------------------- 萤火

/** A summer field at night: grass swaying, fireflies drifting and blinking; new usage lifts a swarm from the grass */
export function firefly(): Pocket {
  const blades = Array.from({ length: 46 }, () => ({ u: Math.random(), h: rnd(0.18, 0.42), p: Math.random() * TAU, c: Math.random() < 0.5 ? '#0d2617' : '#123420' }))
  type Fly = { u: number; v: number; a: number; p: number; f: number; life: number }
  let flies: Fly[] = Array.from({ length: 14 }, () => ({ u: Math.random(), v: rnd(0.2, 0.85), a: Math.random() * TAU, p: Math.random() * TAU, f: rnd(1, 2.2), life: Infinity }))
  const fresh = pulses()
  return {
    dark: () => true,
    draw(ctx, w, h, dt, l) {
      const f = focus(l.shape, w, h)
      if (fresh(l)) for (let i = 0; i < 9; i++) flies.push({ u: f.x / w + rnd(-0.08, 0.08), v: 0.95, a: -Math.PI / 2 + rnd(-0.6, 0.6), p: Math.random() * TAU, f: rnd(2, 3), life: rnd(3, 5) })
      vgrad(ctx, w, h, [
        [0, '#05100b'],
        [0.7, '#0a1a12'],
        [1, '#0e2016']
      ])
      glow(ctx, w * 0.85, h * 0.1, Math.min(w, h) * 0.6, '200,230,180', 0.08)
      const sp = 0.06 * (1 + l.intensity * 0.3)
      flies = flies.filter((q) => {
        q.life -= dt
        q.a += rnd(-1.4, 1.4) * dt
        q.u += Math.cos(q.a) * sp * dt * (h / w)
        q.v += Math.sin(q.a) * sp * dt - (q.life < Infinity ? 0.08 * dt : 0)
        if (q.v < 0.12 || q.v > 0.92) q.a = -q.a
        if (q.u < 0) q.u += 1
        if (q.u > 1) q.u -= 1
        const blink = Math.max(0, Math.sin(l.t * q.f + q.p)) ** 2
        const fade = q.life < Infinity ? Math.min(1, q.life / 1.5) : 1
        glow(ctx, q.u * w, q.v * h, 8 + blink * 6, '210,255,120', (0.15 + blink * 0.75) * fade)
        disc(ctx, q.u * w, q.v * h, 1.1, `rgba(245,255,200,${(0.4 + blink * 0.6) * fade})`)
        return q.life > 0
      })
      for (const b of blades) {
        const x = b.u * w
        const bend = Math.sin(l.t * 1.1 + b.p) * 6 * (1 + l.intensity * 0.2)
        ctx.strokeStyle = b.c
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.moveTo(x, h + 2)
        ctx.quadraticCurveTo(x + bend * 0.4, h * (1 - b.h * 0.5), x + bend, h * (1 - b.h))
        ctx.stroke()
      }
    },
    emblem(ctx, x, y, r, l) {
      const blink = 0.4 + 0.6 * Math.max(0, Math.sin(l.t * 2.4)) ** 2
      const px = x + Math.cos(l.t * 0.9) * r * 0.3
      const py = y + Math.sin(l.t * 1.3) * r * 0.25
      ctx.strokeStyle = 'rgba(210,255,120,0.25)'
      ctx.lineWidth = Math.max(1, r * 0.08)
      ctx.beginPath()
      for (let i = 0; i <= 10; i++) {
        const tt = l.t - i * 0.08
        const qx = x + Math.cos(tt * 0.9) * r * 0.3
        const qy = y + Math.sin(tt * 1.3) * r * 0.25
        if (i) ctx.lineTo(qx, qy)
        else ctx.moveTo(qx, qy)
      }
      ctx.stroke()
      glow(ctx, px, py, r * (0.9 + kick(l) * 0.5), '210,255,120', blink)
      disc(ctx, px, py, r * 0.16, '#f4ffd0')
    }
  }
}

// ---------------------------------------------------------------- 熔岩灯

/** A lava lamp: soft blobs rising, merging and sinking in the warm glass; new usage heats it and sends them up */
export function lava(): Pocket {
  const blobs = Array.from({ length: 7 }, (_, i) => ({ u: 0.56 + Math.random() * 0.42, r: rnd(0.09, 0.17), p: Math.random() * TAU, sp: rnd(0.08, 0.16), hue: i % 2 }))
  let heat = 0
  const fresh = pulses()
  return {
    dark: (d) => d,
    draw(ctx, w, h, dt, l) {
      const f = focus(l.shape, w, h)
      if (fresh(l)) heat = 1
      heat = Math.max(0, heat - dt * 0.5)
      vgrad(ctx, w, h, l.dark ? [[0, '#1a0611'], [1, '#2e0b18']] : [[0, '#fff1e3'], [1, '#fbd8c0']])
      glow(ctx, f.x, h, Math.max(w, h) * 0.7, '255,110,60', (l.dark ? 0.25 : 0.2) + heat * 0.3)
      ctx.globalCompositeOperation = l.dark ? 'lighter' : 'source-over'
      const S = Math.min(h * 1.1, w * 0.5)
      for (const b of blobs) {
        b.p += dt * b.sp * (1 + l.intensity * 0.3 + heat * 2)
        const v = 0.5 + 0.42 * Math.sin(b.p)
        const x = (l.shape === 'orb' ? 0.2 + (b.u - 0.56) * 1.4 : b.u) * w + Math.sin(b.p * 1.7) * S * 0.08
        const y = v * h
        const r = b.r * S * (1 + 0.12 * Math.sin(b.p * 3))
        const g = ctx.createRadialGradient(x, y, 0, x, y, r)
        const c = b.hue ? '255,92,64' : '255,160,70'
        g.addColorStop(0, `rgba(${c},${l.dark ? 0.85 : 0.75})`)
        g.addColorStop(0.55, `rgba(${c},${l.dark ? 0.55 : 0.45})`)
        g.addColorStop(1, `rgba(${c},0)`)
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.ellipse(x, y, r, r * (1 + 0.15 * Math.sin(b.p * 2)), 0, 0, TAU)
        ctx.fill()
      }
      ctx.globalCompositeOperation = 'source-over'
    },
    emblem(ctx, x, y, r, l) {
      const k = kick(l)
      glow(ctx, x, y, r * 1.2, '255,110,60', 0.35 + k * 0.4)
      const g = ctx.createRadialGradient(x - r * 0.2, y - r * 0.3, r * 0.1, x, y, r * 0.8)
      g.addColorStop(0, '#ffd08a')
      g.addColorStop(1, '#ff4d3d')
      ctx.fillStyle = g
      for (let i = 0; i < 3; i++) {
        const a = l.t * (0.9 + i * 0.3) + i * 2.1
        const d = r * 0.22 * (1 + 0.3 * Math.sin(l.t * 1.3 + i))
        ctx.beginPath()
        ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.42 - i * 0.06), 0, TAU)
        ctx.fill()
      }
    }
  }
}

export const SKY_POCKETS = { claude, codex, astral, orrery, lunar, eclipse, trails, rain, firefly, lava }
