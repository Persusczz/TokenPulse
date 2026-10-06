import type { Pocket } from '../Pocket'
import { type Bit, clamp, disc, drawStars, focus, glow, kick, pulses, ridge, rnd, starsOf, stepBits, TAU, vgrad } from './kit'

// ---------------------------------------------------------------- 晶洞

/** a crystal's facets: tall diamonds leaning out from one root */
const SHARDS = [
  { a: -0.5, len: 0.62, w: 0.1 },
  { a: -0.18, len: 0.9, w: 0.13 },
  { a: 0.12, len: 0.74, w: 0.11 },
  { a: 0.42, len: 0.55, w: 0.09 },
  { a: -0.82, len: 0.4, w: 0.08 },
  { a: 0.7, len: 0.36, w: 0.07 }
]

/** A geode's crystals catching light: a glint sweeping their faces, sparkles round them; new usage splits a spectrum off the tip */
export function crystal(): Pocket {
  const fresh = pulses()
  let sparks: { u: number; v: number; life: number }[] = []
  let prism = 0
  return {
    dark: (d) => d,
    draw(ctx, w, h, dt, l) {
      const f = focus(l.shape, w, h)
      if (fresh(l)) prism = 1
      prism = Math.max(0, prism - dt * 0.6)
      vgrad(ctx, w, h, l.dark ? [[0, '#0c0a1e'], [1, '#1b1638']] : [[0, '#f4f1fc'], [1, '#e2dcf5']])
      glow(ctx, f.x, f.y, f.s * 0.9, '150,120,255', l.dark ? 0.25 : 0.18)
      const S = f.s * 0.85
      const rx = f.x
      const ry = f.y + S * 0.42
      const paths = SHARDS.map((s) => {
        const a = s.a - Math.PI / 2 + Math.sin(l.t * 0.4 + s.a * 3) * 0.015
        const tipx = rx + Math.cos(a) * S * s.len
        const tipy = ry + Math.sin(a) * S * s.len
        const n = a + Math.PI / 2
        const p = new Path2D()
        p.moveTo(rx, ry)
        p.lineTo(rx + Math.cos(a) * S * s.len * 0.75 + Math.cos(n) * S * s.w, ry + Math.sin(a) * S * s.len * 0.75 + Math.sin(n) * S * s.w)
        p.lineTo(tipx, tipy)
        p.lineTo(rx + Math.cos(a) * S * s.len * 0.75 - Math.cos(n) * S * s.w, ry + Math.sin(a) * S * s.len * 0.75 - Math.sin(n) * S * s.w)
        p.closePath()
        return { p, tipx, tipy, a }
      })
      for (const { p, tipx, tipy } of paths) {
        const g = ctx.createLinearGradient(rx, ry, tipx, tipy)
        g.addColorStop(0, l.dark ? 'rgba(90,60,200,0.85)' : 'rgba(120,90,220,0.75)')
        g.addColorStop(0.6, l.dark ? 'rgba(140,120,255,0.75)' : 'rgba(150,130,250,0.65)')
        g.addColorStop(1, l.dark ? 'rgba(160,230,255,0.9)' : 'rgba(120,210,255,0.85)')
        ctx.fillStyle = g
        ctx.fill(p)
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'
        ctx.lineWidth = 0.8
        ctx.stroke(p)
      }
      // the glint, sweeping every few seconds
      const sweep = (l.t % 4) / 1.2
      if (sweep < 1) {
        ctx.save()
        const clip = new Path2D()
        paths.forEach(({ p }) => clip.addPath(p))
        ctx.clip(clip)
        const gx = f.x - S * 0.7 + sweep * S * 1.4
        const g = ctx.createLinearGradient(gx - 14, 0, gx + 14, 0)
        g.addColorStop(0, 'rgba(255,255,255,0)')
        g.addColorStop(0.5, 'rgba(255,255,255,0.55)')
        g.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = g
        ctx.fillRect(gx - 14, 0, 28, h)
        ctx.restore()
      }
      // the spectrum split off the tallest tip
      if (prism > 0) {
        const tip = paths[1]
        ctx.globalCompositeOperation = l.dark ? 'lighter' : 'source-over'
        const cols = ['255,80,80', '255,170,60', '255,240,90', '90,230,120', '80,170,255', '160,100,255']
        cols.forEach((c, i) => {
          const a = -2.4 + i * 0.12
          const g = ctx.createLinearGradient(tip.tipx, tip.tipy, tip.tipx + Math.cos(a) * w, tip.tipy + Math.sin(a) * w)
          g.addColorStop(0, `rgba(${c},${0.55 * prism})`)
          g.addColorStop(1, `rgba(${c},0)`)
          ctx.strokeStyle = g
          ctx.lineWidth = 3
          ctx.beginPath()
          ctx.moveTo(tip.tipx, tip.tipy)
          ctx.lineTo(tip.tipx + Math.cos(a) * w, tip.tipy + Math.sin(a) * w)
          ctx.stroke()
        })
        ctx.globalCompositeOperation = 'source-over'
      }
      if (Math.random() < dt * (2 + l.intensity)) sparks.push({ u: (f.x + rnd(-S, S) * 0.7) / w, v: (f.y + rnd(-S, S) * 0.5) / h, life: 1 })
      sparks = sparks.filter((s) => (s.life -= dt * 1.4) > 0)
      for (const s of sparks) {
        const x = s.u * w
        const y = s.v * h
        const r = 4 * Math.sin(s.life * Math.PI)
        ctx.strokeStyle = `rgba(255,255,255,${s.life})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(x - r, y)
        ctx.lineTo(x + r, y)
        ctx.moveTo(x, y - r)
        ctx.lineTo(x, y + r)
        ctx.stroke()
      }
    },
    emblem(ctx, x, y, r, l) {
      glow(ctx, x, y, r * 1.2, '150,120,255', 0.3 + kick(l) * 0.4)
      const pts = Array.from({ length: 6 }, (_, i) => [x + Math.cos((i / 6) * TAU - Math.PI / 2) * r * 0.78, y + Math.sin((i / 6) * TAU - Math.PI / 2) * r * 0.78] as const)
      pts.forEach(([px, py], i) => {
        const [qx, qy] = pts[(i + 1) % 6]
        ctx.fillStyle = ['#8f7bff', '#b39dff', '#7fd0ff', '#6a5ae0', '#a58bff', '#5fb8f0'][i]
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(px, py)
        ctx.lineTo(qx, qy)
        ctx.fill()
      })
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'
      ctx.lineWidth = Math.max(0.8, r * 0.05)
      ctx.beginPath()
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)))
      ctx.closePath()
      ctx.stroke()
      const a = l.t * 1.5
      const s = r * 0.32 * (0.6 + 0.4 * Math.abs(Math.sin(l.t * 1.8)))
      const sx = x + Math.cos(a) * r * 0.35
      const sy = y - r * 0.3
      ctx.strokeStyle = '#fff'
      ctx.beginPath()
      ctx.moveTo(sx - s, sy)
      ctx.lineTo(sx + s, sy)
      ctx.moveTo(sx, sy - s)
      ctx.lineTo(sx, sy + s)
      ctx.stroke()
    }
  }
}

// ---------------------------------------------------------------- 代码雨

const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄ0123456789ﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎ'

/** Green glyphs raining down in columns, brighter away from the numbers; new usage sends every column racing */
export function matrix(): Pocket {
  let cols: { y: number; sp: number; len: number; seed: number }[] = []
  let made = 0
  const fresh = pulses()
  let rush = 0
  return {
    dark: () => true,
    draw(ctx, w, h, dt, l) {
      const cell = l.shape === 'island' ? 9 : 11
      const n = Math.ceil(w / cell)
      if (n !== made) {
        made = n
        cols = Array.from({ length: n }, () => ({ y: rnd(-10, h / cell), sp: rnd(4, 9), len: rnd(5, 12), seed: Math.random() * 1000 }))
      }
      if (fresh(l)) rush = 1
      rush = Math.max(0, rush - dt * 0.7)
      vgrad(ctx, w, h, [
        [0, '#020b05'],
        [1, '#041409']
      ])
      ctx.font = `${cell}px "MS Gothic", "Yu Gothic", monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      cols.forEach((c, i) => {
        c.y += dt * c.sp * (1 + l.intensity * 0.3 + rush * 2.5)
        if ((c.y - c.len) * cell > h) {
          c.y = rnd(-6, 0)
          c.sp = rnd(4, 9)
          c.len = rnd(5, 12)
        }
        const x = i * cell + cell / 2
        const side = l.shape === 'orb' ? 1 : 0.12 + 0.88 * (x / w) ** 1.4
        const head = Math.floor(c.y)
        for (let j = 0; j < c.len; j++) {
          const row = head - j
          if (row < 0 || row * cell > h) continue
          const ch = GLYPHS[Math.floor(Math.abs(Math.sin(c.seed + row * 7.3 + Math.floor(l.t * 3 + j) * 0.1)) * GLYPHS.length) % GLYPHS.length]
          if (j === 0) ctx.fillStyle = `rgba(220,255,225,${0.9 * side})`
          else ctx.fillStyle = `rgba(60,255,120,${(1 - j / c.len) * 0.6 * side + rush * 0.2})`
          ctx.fillText(ch, x, row * cell)
        }
      })
    },
    emblem(ctx, x, y, r, l) {
      const s = r * 1.5
      ctx.fillStyle = '#031208'
      ctx.beginPath()
      ctx.roundRect(x - s / 2, y - s / 2, s, s, s * 0.22)
      ctx.fill()
      glow(ctx, x, y, r * 1.2, '60,255,120', 0.2 + kick(l) * 0.4)
      ctx.save()
      ctx.beginPath()
      ctx.roundRect(x - s / 2, y - s / 2, s, s, s * 0.22)
      ctx.clip()
      const cell = s / 3.2
      ctx.font = `${cell}px "MS Gothic", monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      for (let i = 0; i < 3; i++) {
        const head = ((l.t * (2.4 + i * 0.7) + i * 1.3) % 5) - 1
        for (let j = 0; j < 4; j++) {
          ctx.fillStyle = j === 0 ? '#d8ffe0' : `rgba(60,255,120,${1 - j / 4})`
          ctx.fillText(GLYPHS[(i * 7 + j * 3 + Math.floor(l.t * 2)) % GLYPHS.length], x - s / 2 + cell * (i + 0.6), y - s / 2 + (head - j) * cell)
        }
      }
      ctx.restore()
    }
  }
}

// ---------------------------------------------------------------- 烟花

const FIRE = ['255,90,90', '255,190,70', '120,220,255', '190,120,255', '120,255,160', '255,140,220']

/** Fireworks over the dark: rockets climbing and bursting on the busy side, more of them with usage; new usage bursts one right there */
export function fireworks(): Pocket {
  let bits: Bit[] = []
  let rockets: { x: number; y: number; vy: number; top: number; c: string }[] = []
  let next = 0.5
  const fresh = pulses()
  const burst = (x: number, y: number, n: number, sp: number, c: string) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rnd(-0.05, 0.05)
      const v = sp * rnd(0.75, 1.05)
      bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(1, 1.6), max: 1.6, r: rnd(0.9, 1.6), c: Math.random() < 0.2 ? '255,255,255' : c })
    }
  }
  return {
    dark: () => true,
    draw(ctx, w, h, dt, l) {
      const f = focus(l.shape, w, h)
      const S = Math.min(h, w * 0.5)
      if (fresh(l)) {
        const c = FIRE[Math.floor(Math.random() * FIRE.length)]
        burst(f.x, f.y, 46, S * 1.1, c)
        burst(f.x, f.y, 24, S * 0.6, FIRE[Math.floor(Math.random() * FIRE.length)])
      }
      vgrad(ctx, w, h, [
        [0, '#05030d'],
        [1, '#140b28']
      ])
      if ((next -= dt * (1 + l.intensity * 0.6)) < 0) {
        next = rnd(1.1, 2.4)
        const x = (l.shape === 'orb' ? rnd(0.25, 0.75) : rnd(0.45, 0.95)) * w
        rockets.push({ x, y: h + 4, vy: -S * rnd(1.4, 1.9), top: h * rnd(0.18, 0.45), c: FIRE[Math.floor(Math.random() * FIRE.length)] })
      }
      rockets = rockets.filter((r) => {
        r.y += r.vy * dt
        glow(ctx, r.x, r.y, 5, '255,220,170', 0.8)
        bits.push({ x: r.x + rnd(-1, 1), y: r.y, vx: rnd(-6, 6), vy: rnd(8, 20), life: 0.4, max: 0.4, r: 0.8, c: '255,200,140' })
        if (r.y > r.top) return true
        burst(r.x, r.y, 36, S * 0.9, r.c)
        return false
      })
      bits = stepBits(bits, dt, S * 0.55, 1.6)
      ctx.globalCompositeOperation = 'lighter'
      for (const b of bits) {
        const a = clamp(b.life / b.max, 0, 1)
        ctx.fillStyle = `rgba(${b.c},${a})`
        ctx.fillRect(b.x - b.r / 2, b.y - b.r / 2, b.r * 1.4, b.r * 1.4)
      }
      ctx.globalCompositeOperation = 'source-over'
    },
    emblem(ctx, x, y, r, l) {
      const p = (l.t % 1.8) / 1.8
      const c = FIRE[Math.floor(l.t / 1.8) % FIRE.length]
      glow(ctx, x, y, r * (0.6 + p * 0.7), c, (1 - p) * 0.6 + kick(l) * 0.4)
      ctx.lineCap = 'round'
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU
        const r0 = r * (0.15 + p * 0.55)
        const r1 = r * (0.3 + p * 0.65)
        ctx.strokeStyle = `rgba(${i % 3 === 0 ? '255,255,255' : c},${1 - p * 0.85})`
        ctx.lineWidth = Math.max(1, r * 0.09)
        ctx.beginPath()
        ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0)
        ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1)
        ctx.stroke()
      }
    }
  }
}

// ---------------------------------------------------------------- 灯笼

/** a sky lantern, glowing */
function skyLantern(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, flick: number, a = 1): void {
  glow(ctx, x, y, s * 2.6, '255,170,80', 0.45 * flick * a)
  const g = ctx.createLinearGradient(x, y - s * 0.7, x, y + s * 0.7)
  g.addColorStop(0, `rgba(255,226,150,${a})`)
  g.addColorStop(1, `rgba(255,120,60,${a})`)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(x - s * 0.42, y - s * 0.62)
  ctx.lineTo(x + s * 0.42, y - s * 0.62)
  ctx.quadraticCurveTo(x + s * 0.58, y + s * 0.1, x + s * 0.34, y + s * 0.6)
  ctx.lineTo(x - s * 0.34, y + s * 0.6)
  ctx.quadraticCurveTo(x - s * 0.58, y + s * 0.1, x - s * 0.42, y - s * 0.62)
  ctx.fill()
  ctx.fillStyle = `rgba(110,40,20,${0.6 * a})`
  ctx.fillRect(x - s * 0.42, y - s * 0.68, s * 0.84, s * 0.1)
  glow(ctx, x, y + s * 0.42, s * 0.35, '255,250,210', 0.8 * flick * a)
}

/** Sky lanterns rising into the night, nearer ones bigger and brighter; new usage releases one, close, from the busy side */
export function lantern(): Pocket {
  const spot = () => 0.38 + Math.random() * 0.62
  let lamps = Array.from({ length: 11 }, () => ({ u: spot(), v: Math.random() * 1.1, d: rnd(0.35, 1), p: Math.random() * TAU, sp: rnd(0.02, 0.05) }))
  const fresh = pulses()
  return {
    dark: () => true,
    draw(ctx, w, h, dt, l) {
      const f = focus(l.shape, w, h)
      if (fresh(l)) lamps.push({ u: f.x / w, v: 1.15, d: 1.25, p: Math.random() * TAU, sp: 0.09 })
      vgrad(ctx, w, h, [
        [0, '#0e0713'],
        [0.7, '#22101f'],
        [1, '#3a1a22']
      ])
      glow(ctx, w * 0.7, h * 1.05, Math.max(w, h) * 0.6, '255,140,70', 0.18)
      lamps.sort((a, b) => a.d - b.d)
      const S = Math.min(h * 0.32, 26)
      lamps = lamps.filter((m) => {
        m.v -= dt * m.sp * m.d * (1 + l.intensity * 0.25)
        if (m.v < -0.2) {
          if (m.d > 1.1) return false
          m.v = 1.2
          m.u = l.shape === 'orb' ? Math.random() : spot()
        }
        const flick = 0.85 + 0.15 * Math.sin(l.t * 9 + m.p) * Math.sin(l.t * 3.7 + m.p)
        skyLantern(ctx, m.u * w + Math.sin(l.t * 0.5 + m.p) * 5 * m.d, m.v * h, S * m.d * 0.85, flick, 0.4 + m.d * 0.45)
        return true
      })
    },
    emblem(ctx, x, y, r, l) {
      const flick = 0.85 + 0.15 * Math.sin(l.t * 9) * Math.sin(l.t * 3.7)
      skyLantern(ctx, x + Math.sin(l.t * 1.2) * r * 0.06, y - Math.sin(l.t * 0.9) * r * 0.05, r * (1.1 + kick(l) * 0.15), flick)
    }
  }
}

// ---------------------------------------------------------------- 包豪斯

/** Primary shapes on cream (or charcoal): a circle, a square and a triangle drifting and turning; new usage makes them jump */
export function bauhaus(): Pocket {
  const fresh = pulses()
  let jump = 0
  let dir = 1
  return {
    dark: (d) => d,
    draw(ctx, w, h, dt, l) {
      const f = focus(l.shape, w, h)
      if (fresh(l)) {
        jump = 1
        dir = -dir
      }
      jump = Math.max(0, jump - dt * 1.6)
      const bump = 1 + Math.sin(jump * Math.PI) * 0.18
      ctx.fillStyle = l.dark ? '#1c1b19' : '#f2eadb'
      ctx.fillRect(0, 0, w, h)
      const S = f.s * 0.64
      const t = l.t * (1 + l.intensity * 0.2)
      ctx.fillStyle = l.dark ? 'rgba(242,234,219,0.12)' : 'rgba(20,20,20,0.85)'
      ctx.fillRect(f.x - S * 0.9, f.y + S * 0.36, S * 1.6, S * 0.05)
      ctx.fillRect(f.x + S * 0.52, f.y - S * 0.7, S * 0.05, S * 1.3)
      disc(ctx, f.x - S * 0.22 + Math.sin(t * 0.4) * S * 0.06, f.y - S * 0.06, S * 0.34 * bump, '#d6452b')
      ctx.save()
      ctx.translate(f.x + S * 0.24, f.y + S * 0.1 + Math.cos(t * 0.5) * S * 0.04)
      ctx.rotate(t * 0.18 * dir)
      ctx.fillStyle = '#2a4c9c'
      const q = S * 0.36 * bump
      ctx.fillRect(-q / 2, -q / 2, q, q)
      ctx.restore()
      ctx.save()
      ctx.translate(f.x + S * 0.02, f.y - S * 0.38 + Math.sin(t * 0.6) * S * 0.04)
      ctx.rotate(-t * 0.12 * dir)
      ctx.fillStyle = '#efb21f'
      const s = S * 0.28 * bump
      ctx.beginPath()
      ctx.moveTo(0, -s)
      ctx.lineTo(s * 0.9, s * 0.6)
      ctx.lineTo(-s * 0.9, s * 0.6)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
      ctx.strokeStyle = l.dark ? 'rgba(242,234,219,0.5)' : 'rgba(20,20,20,0.75)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(f.x - S * 0.62, f.y + S * 0.36, S * 0.2, Math.PI, 0)
      ctx.stroke()
    },
    emblem(ctx, x, y, r, l) {
      const k = kick(l)
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(l.t * 0.4)
      const s = r * (1 + Math.sin(k * Math.PI) * 0.12)
      disc(ctx, -s * 0.26, -s * 0.12, s * 0.42, '#d6452b')
      ctx.fillStyle = '#2a4c9c'
      ctx.fillRect(s * 0.0, s * 0.0, s * 0.62, s * 0.62)
      ctx.fillStyle = '#efb21f'
      ctx.beginPath()
      ctx.moveTo(s * 0.25, -s * 0.78)
      ctx.lineTo(s * 0.78, s * 0.02)
      ctx.lineTo(-s * 0.18, s * 0.02)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
  }
}

// ---------------------------------------------------------------- 樱花

function petal(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number, c: string): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rot)
  ctx.fillStyle = c
  ctx.beginPath()
  ctx.moveTo(0, -s)
  ctx.bezierCurveTo(s * 0.9, -s * 0.7, s * 0.7, s * 0.6, 0, s)
  ctx.bezierCurveTo(-s * 0.7, s * 0.6, -s * 0.9, -s * 0.7, -s * 0.18, -s * 0.85)
  ctx.lineTo(0, -s * 0.6)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function blossom(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number, dark: boolean): void {
  for (let i = 0; i < 5; i++) {
    const a = rot + (i / 5) * TAU
    petal(ctx, x + Math.cos(a) * s * 0.55, y + Math.sin(a) * s * 0.55, s * 0.55, a + Math.PI / 2, dark ? '#f2a6c2' : '#f7b3cb')
  }
  disc(ctx, x, y, s * 0.22, '#ffd36b')
}

/** A blossoming branch reaching in from the corner, petals drifting down; new usage sends a gust of petals off it */
export function sakura(): Pocket {
  let petals = Array.from({ length: 22 }, () => ({ u: Math.random(), v: Math.random(), s: rnd(2.2, 4.2), rot: Math.random() * TAU, spin: rnd(-1.5, 1.5), p: Math.random() * TAU, sp: rnd(0.04, 0.08), gust: false }))
  const flowers = [
    [0.18, 0.2, 1],
    [0.36, 0.46, 0.8],
    [0.52, 0.3, 0.9],
    [0.7, 0.62, 0.7],
    [0.32, 0.12, 0.65]
  ]
  const fresh = pulses()
  let gust = 0
  return {
    dark: (d) => d,
    draw(ctx, w, h, dt, l) {
      if (fresh(l)) {
        gust = 1
        for (let i = 0; i < 12; i++) petals.push({ u: rnd(0.65, 1), v: rnd(0, 0.4), s: rnd(2.4, 4.4), rot: Math.random() * TAU, spin: rnd(-3, 3), p: Math.random() * TAU, sp: rnd(0.08, 0.14), gust: true })
      }
      gust = Math.max(0, gust - dt * 0.5)
      vgrad(ctx, w, h, l.dark ? [[0, '#1d1320'], [1, '#2b1829']] : [[0, '#fdf0f4'], [1, '#f6d8e3']])
      // the branch, from the top right, swaying a little
      const S = Math.min(h * 1.2, w * 0.55)
      const sway = Math.sin(l.t * 0.6) * 0.02 + gust * 0.03
      ctx.save()
      ctx.translate(w + 4, -4)
      ctx.rotate(sway)
      ctx.strokeStyle = l.dark ? '#4a2f2c' : '#5c3b31'
      ctx.lineCap = 'round'
      ctx.lineWidth = Math.max(2, S * 0.05)
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.bezierCurveTo(-S * 0.3, S * 0.18, -S * 0.5, S * 0.22, -S * 0.82, S * 0.5)
      ctx.stroke()
      ctx.lineWidth = Math.max(1.2, S * 0.025)
      ctx.beginPath()
      ctx.moveTo(-S * 0.42, S * 0.21)
      ctx.quadraticCurveTo(-S * 0.5, S * 0.06, -S * 0.66, S * 0.02)
      ctx.moveTo(-S * 0.62, S * 0.34)
      ctx.quadraticCurveTo(-S * 0.62, S * 0.55, -S * 0.5, S * 0.7)
      ctx.stroke()
      for (const [u, v, s] of flowers) blossom(ctx, -S * u * 1.05, S * v, S * 0.09 * s, l.t * 0.1 + u * 5, l.dark)
      ctx.restore()
      petals = petals.filter((q) => {
        q.v += dt * q.sp * (1 + l.intensity * 0.25)
        q.u -= dt * (0.02 + gust * 0.12 + Math.sin(l.t + q.p) * 0.01)
        q.rot += q.spin * dt
        if (q.v > 1.08 || q.u < -0.05) {
          if (q.gust) return false
          q.v = -0.05
          q.u = rnd(0.2, 1.1)
        }
        petal(ctx, q.u * w, q.v * h, q.s, q.rot, l.dark ? 'rgba(240,160,195,0.85)' : 'rgba(244,150,186,0.85)')
        return true
      })
    },
    emblem(ctx, x, y, r, l) {
      glow(ctx, x, y, r * 1.1, '247,170,200', 0.3 + kick(l) * 0.4)
      blossom(ctx, x, y, r * 0.95, l.t * 0.3, true)
    }
  }
}

// ---------------------------------------------------------------- 沙丘

/** Dunes under the sun (a moon at night), sand streaming off the crests; new usage blows a gust across */
export function dune(): Pocket {
  const fresh = pulses()
  let gust = 0
  let sand: Bit[] = []
  const stars = starsOf(40, 0.6)
  return {
    dark: (d) => d,
    draw(ctx, w, h, dt, l) {
      const f = focus(l.shape, w, h)
      if (fresh(l)) gust = 1
      gust = Math.max(0, gust - dt * 0.4)
      vgrad(ctx, w, h, l.dark ? [[0, '#140e22'], [0.7, '#3a2434'], [1, '#4a2c34']] : [[0, '#fbe8cc'], [0.6, '#f6cf98'], [1, '#f2b97a']])
      if (l.dark) drawStars(ctx, stars, w, h, l.t, 0.7)
      const sy = l.shape === 'orb' ? h * 0.36 : h * 0.38
      glow(ctx, f.x, sy, f.s * 0.7, l.dark ? '220,220,255' : '255,200,110', l.dark ? 0.25 : 0.5)
      disc(ctx, f.x, sy, f.s * 0.11, l.dark ? '#f2efe6' : '#fff1c9')
      const drift = l.t * 0.006
      const layers = l.dark ? ['#3c2633', '#2c1b26', '#1d1219'] : ['#ebb979', '#d99a5b', '#bf7a43']
      ridge(ctx, w, h, [0.32, 0.4, 0.3, 0.36, 0.42, 0.33, 0.38], 0.98, layers[0], drift)
      ridge(ctx, w, h, [0.22, 0.3, 0.2, 0.28, 0.18, 0.26, 0.24], 0.98, layers[1], drift * 1.6 + 0.3)
      ridge(ctx, w, h, [0.12, 0.08, 0.16, 0.1, 0.14, 0.07, 0.12], 0.98, layers[2], drift * 2.4 + 0.6)
      if (Math.random() < dt * (10 + gust * 50 + l.intensity * 6)) sand.push({ x: rnd(0.3, 1.05) * w, y: h * rnd(0.55, 0.9), vx: -rnd(30, 70) * (1 + gust * 2), vy: rnd(-6, 2), life: rnd(1, 2), max: 2, r: rnd(0.6, 1.3), c: l.dark ? '200,170,190' : '255,240,210' })
      sand = stepBits(sand, dt)
      for (const b of sand) {
        ctx.fillStyle = `rgba(${b.c},${(b.life / b.max) * 0.7})`
        ctx.fillRect(b.x, b.y, b.r * 2.2, b.r)
      }
    },
    emblem(ctx, x, y, r, l) {
      glow(ctx, x, y - r * 0.1, r * 1.1, '255,190,100', 0.4 + kick(l) * 0.35)
      disc(ctx, x, y - r * 0.05, r * 0.5, '#ffd27a')
      ctx.fillStyle = '#c9803f'
      ctx.beginPath()
      ctx.moveTo(x - r, y + r * 0.45)
      ctx.quadraticCurveTo(x - r * 0.3, y - r * 0.05 + Math.sin(l.t) * r * 0.04, x + r * 0.25, y + r * 0.25)
      ctx.quadraticCurveTo(x + r * 0.6, y + r * 0.1, x + r, y + r * 0.3)
      ctx.lineTo(x + r, y + r)
      ctx.lineTo(x - r, y + r)
      ctx.fill()
    }
  }
}

// ---------------------------------------------------------------- 纸面

/** a figure the pen keeps writing, as points of one stroke (unit square) */
const STROKE = Array.from({ length: 90 }, (_, i) => {
  const t = (i / 89) * TAU * 1.5
  return [0.5 + Math.sin(t * 1.0) * 0.38 * (0.6 + 0.4 * Math.cos(t * 0.33)), 0.5 + Math.sin(t * 2.0 + 0.6) * 0.28] as const
})

/** Ruled paper with a pen writing a looping line, ink drying as it goes; new usage ticks a check mark with a splash of ink */
export function paper(): Pocket {
  const fresh = pulses()
  let check = -1
  let blots: { u: number; v: number; r: number }[] = []
  return {
    dark: (d) => d,
    draw(ctx, w, h, dt, l) {
      const f = focus(l.shape, w, h)
      if (fresh(l)) {
        check = 0
        blots = Array.from({ length: 5 }, () => ({ u: rnd(-0.5, 0.5), v: rnd(-0.4, 0.4), r: rnd(0.6, 2) }))
      }
      ctx.fillStyle = l.dark ? '#23211c' : '#f8f3e9'
      ctx.fillRect(0, 0, w, h)
      const gap = l.shape === 'island' ? 9 : 12
      ctx.strokeStyle = l.dark ? 'rgba(200,190,170,0.08)' : 'rgba(80,120,175,0.16)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let y = gap; y < h; y += gap) {
        ctx.moveTo(0, Math.round(y) + 0.5)
        ctx.lineTo(w, Math.round(y) + 0.5)
      }
      ctx.stroke()
      ctx.strokeStyle = l.dark ? 'rgba(220,110,100,0.25)' : 'rgba(210,80,70,0.35)'
      ctx.beginPath()
      ctx.moveTo(w * 0.55, 0)
      ctx.lineTo(w * 0.55, h)
      ctx.stroke()
      // the pen at work: the stroke grows over 5 s, dries, starts again
      const S = f.s * 0.85
      const cycle = (l.t % 7) / 5
      const n = Math.min(STROKE.length, Math.floor(cycle * STROKE.length))
      const ink = l.dark ? '200,214,240' : '35,55,95'
      const fade = cycle > 1 ? 1 - (cycle - 1) * 2.5 : 1
      ctx.strokeStyle = `rgba(${ink},${0.85 * Math.max(0, fade)})`
      ctx.lineWidth = 1.6
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()
      for (let i = 0; i < n; i++) {
        const [u, v] = STROKE[i]
        const x = f.x + (u - 0.5) * S * 1.3
        const y = f.y + (v - 0.5) * S
        if (i) ctx.lineTo(x, y)
        else ctx.moveTo(x, y)
      }
      ctx.stroke()
      if (cycle < 1 && n > 0) {
        const [u, v] = STROKE[n - 1]
        const x = f.x + (u - 0.5) * S * 1.3
        const y = f.y + (v - 0.5) * S
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(-0.8)
        ctx.fillStyle = l.dark ? '#c9b37a' : '#2c2a33'
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(4, -12)
        ctx.lineTo(0, -16)
        ctx.lineTo(-4, -12)
        ctx.closePath()
        ctx.fill()
        ctx.fillRect(-3, -30, 6, 15)
        ctx.restore()
      }
      if (check >= 0) {
        check += dt / 0.5
        const k = Math.min(1, check)
        const cx = f.x + S * 0.45
        const cy = f.y - S * 0.1
        ctx.strokeStyle = l.dark ? 'rgba(130,220,150,0.95)' : 'rgba(40,140,70,0.95)'
        ctx.lineWidth = 2.6
        ctx.beginPath()
        ctx.moveTo(cx - S * 0.12, cy)
        if (k < 0.4) ctx.lineTo(cx - S * 0.12 + (k / 0.4) * S * 0.08, cy + (k / 0.4) * S * 0.09)
        else {
          ctx.lineTo(cx - S * 0.04, cy + S * 0.09)
          const m = (k - 0.4) / 0.6
          ctx.lineTo(cx - S * 0.04 + m * S * 0.2, cy + S * 0.09 - m * S * 0.24)
        }
        ctx.stroke()
        for (const b of blots) disc(ctx, cx + b.u * S * 0.4, cy + b.v * S * 0.4, b.r, `rgba(${ink},${Math.max(0, 1 - (check - 1) * 0.3) * 0.6})`)
        if (check > 4) check = -1
      }
    },
    emblem(ctx, x, y, r, l) {
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(0.75 + Math.sin(l.t * 1.5) * 0.05)
      const s = r * 0.95
      const g = ctx.createLinearGradient(-s * 0.4, 0, s * 0.4, 0)
      g.addColorStop(0, '#b38b3e')
      g.addColorStop(0.5, '#f2d88f')
      g.addColorStop(1, '#a57c2f')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.moveTo(0, s)
      ctx.lineTo(s * 0.42, -s * 0.1)
      ctx.quadraticCurveTo(s * 0.4, -s * 0.7, 0, -s * 0.85)
      ctx.quadraticCurveTo(-s * 0.4, -s * 0.7, -s * 0.42, -s * 0.1)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = '#4a3714'
      ctx.lineWidth = Math.max(0.8, s * 0.05)
      ctx.beginPath()
      ctx.moveTo(0, s * 0.95)
      ctx.lineTo(0, -s * 0.2)
      ctx.stroke()
      disc(ctx, 0, -s * 0.22, s * 0.1, '#4a3714')
      ctx.restore()
      const drop = (l.t % 2) / 2
      disc(ctx, x - r * 0.62, y + r * 0.62 + drop * r * 0.2, r * 0.12 * (1 - drop * 0.4), `rgba(40,60,110,${1 - drop})`)
    }
  }
}

// ---------------------------------------------------------------- 霓虹

/** Synthwave: a striped sun sinking into a magenta grid racing in, wireframe hills on the horizon; new usage sends a scan wave down the grid */
export function neon(): Pocket {
  const fresh = pulses()
  let wave = -1
  return {
    dark: () => true,
    draw(ctx, w, h, dt, l) {
      const f = focus(l.shape, w, h)
      if (fresh(l)) wave = 0
      const hy = l.shape === 'orb' ? h * 0.56 : h * 0.6
      vgrad(ctx, w, h, [
        [0, '#14051f'],
        [hy / h, '#4a1150'],
        [Math.min(1, hy / h + 0.01), '#12031a'],
        [1, '#1c0628']
      ])
      // the sun, stripes cut out of its lower half
      const R = f.s * 0.3
      const sx = f.x
      const sy = hy - R * 0.2
      glow(ctx, sx, sy, R * 2.2, '255,80,180', 0.35)
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, w, hy)
      ctx.clip()
      const g = ctx.createLinearGradient(0, sy - R, 0, sy + R)
      g.addColorStop(0, '#ffe36e')
      g.addColorStop(0.55, '#ff7a6a')
      g.addColorStop(1, '#ff2fa8')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(sx, sy, R, 0, TAU)
      for (let i = 0; i < 6; i++) {
        const yy = sy + R * (0.05 + i * 0.17)
        const th = R * (0.03 + i * 0.03)
        ctx.rect(sx + R, yy, -R * 2, th)
      }
      ctx.fill('evenodd')
      ctx.restore()
      // wire hills on the horizon
      ctx.strokeStyle = 'rgba(80,230,255,0.55)'
      ctx.lineWidth = 1
      ctx.beginPath()
      const hill = [0, 0.12, 0.04, 0.2, 0.06, 0.16, 0.02, 0.1, 0]
      hill.forEach((v, i) => {
        const x = (i / (hill.length - 1)) * w
        const y = hy - v * h * 0.6
        if (i) ctx.lineTo(x, y)
        else ctx.moveTo(x, y)
      })
      ctx.stroke()
      // the grid
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, hy, w, h - hy)
      ctx.clip()
      const speed = 0.35 + l.intensity * 0.2
      ctx.strokeStyle = 'rgba(255,60,200,0.65)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let i = -12; i <= 12; i++) {
        ctx.moveTo(sx + i * w * 0.02, hy)
        ctx.lineTo(sx + i * w * 0.22, h)
      }
      const off = (l.t * speed) % 1
      for (let i = 0; i < 9; i++) {
        const z = (i + off) / 9
        const y = hy + (h - hy) * z * z
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
      }
      ctx.stroke()
      if (wave >= 0) {
        wave += dt / 1.1
        const y = hy + (h - hy) * wave * wave
        const gl = ctx.createLinearGradient(0, y - 6, 0, y + 2)
        gl.addColorStop(0, 'rgba(120,240,255,0)')
        gl.addColorStop(1, `rgba(160,250,255,${1 - wave})`)
        ctx.fillStyle = gl
        ctx.fillRect(0, y - 6, w, 8)
        if (wave >= 1) wave = -1
      }
      ctx.restore()
    },
    emblem(ctx, x, y, r, l) {
      glow(ctx, x, y, r * 1.2, '255,80,180', 0.35 + kick(l) * 0.4)
      ctx.save()
      ctx.beginPath()
      ctx.arc(x, y, r * 0.8, 0, TAU)
      ctx.clip()
      const g = ctx.createLinearGradient(0, y - r, 0, y + r)
      g.addColorStop(0, '#ffe36e')
      g.addColorStop(1, '#ff2fa8')
      ctx.fillStyle = g
      ctx.fillRect(x - r, y - r, r * 2, r * 2)
      const off = (l.t * 0.6) % 1
      ctx.fillStyle = '#1a0624'
      for (let i = 0; i < 5; i++) {
        const yy = y - r * 0.1 + ((i + off) / 5) * r
        ctx.fillRect(x - r, yy, r * 2, r * (0.04 + ((i + off) / 5) * 0.12))
      }
      ctx.restore()
    }
  }
}

// ---------------------------------------------------------------- 极光

/** The northern lights: curtains of green and violet waving over a dark ridge; new usage makes them flare */
export function borealis(): Pocket {
  const stars = starsOf(60, 0.7)
  const fresh = pulses()
  let flare = 0
  const bands = [
    { base: 0.42, amp: 0.1, f: 1.6, sp: 0.22, h: 0.42, c: ['90,255,170', '120,140,255'] },
    { base: 0.32, amp: 0.08, f: 2.3, sp: -0.17, h: 0.34, c: ['70,230,200', '200,110,255'] },
    { base: 0.52, amp: 0.06, f: 1.1, sp: 0.12, h: 0.28, c: ['120,255,140', '90,200,255'] }
  ]
  return {
    dark: () => true,
    draw(ctx, w, h, dt, l) {
      if (fresh(l)) flare = 1
      flare = Math.max(0, flare - dt * 0.45)
      vgrad(ctx, w, h, [
        [0, '#030c16'],
        [1, '#082230']
      ])
      drawStars(ctx, stars, w, h, l.t, 0.7)
      ctx.globalCompositeOperation = 'lighter'
      for (const b of bands) {
        const pts: [number, number][] = []
        for (let i = 0; i <= 30; i++) {
          const u = i / 30
          pts.push([u * w, h * (b.base + b.amp * Math.sin(u * b.f * TAU * 0.5 + l.t * b.sp) + 0.03 * Math.sin(u * 13 + l.t * 0.9))])
        }
        const H = h * b.h * (1 + flare * 0.4)
        const g = ctx.createLinearGradient(0, h * b.base - H, 0, h * b.base + h * 0.05)
        const a = (0.32 + l.vivid * 0.18 + flare * 0.35) * (0.8 + l.intensity * 0.08)
        g.addColorStop(0, `rgba(${b.c[1]},0)`)
        g.addColorStop(0.55, `rgba(${b.c[1]},${a * 0.35})`)
        g.addColorStop(0.9, `rgba(${b.c[0]},${a})`)
        g.addColorStop(1, `rgba(${b.c[0]},0)`)
        ctx.fillStyle = g
        ctx.beginPath()
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y - H) : ctx.moveTo(x, y - H)))
        for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i][0], pts[i][1] + h * 0.04)
        ctx.closePath()
        ctx.fill()
        // the curtain's folds
        ctx.strokeStyle = `rgba(${b.c[0]},${a * 0.22})`
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let i = 0; i < pts.length; i += 1) {
          const [x, y] = pts[i]
          ctx.moveTo(x + Math.sin(l.t + i) * 2, y)
          ctx.lineTo(x + Math.sin(l.t + i) * 2, y - H * (0.5 + 0.4 * Math.sin(i * 1.7 + l.t * 0.7)))
        }
        ctx.stroke()
      }
      ctx.globalCompositeOperation = 'source-over'
      ridge(ctx, w, h, [0.1, 0.16, 0.08, 0.14, 0.06, 0.12], 1, '#020910')
    },
    emblem(ctx, x, y, r, l) {
      glow(ctx, x, y, r * 1.1, '90,255,170', 0.25 + kick(l) * 0.4)
      ctx.lineCap = 'round'
      ;['90,255,170', '90,200,255', '200,110,255'].forEach((c, i) => {
        ctx.strokeStyle = `rgba(${c},0.9)`
        ctx.lineWidth = Math.max(1.2, r * 0.14)
        ctx.beginPath()
        for (let j = 0; j <= 12; j++) {
          const u = j / 12
          const px = x - r * 0.8 + u * r * 1.6
          const py = y - r * 0.35 + i * r * 0.32 + Math.sin(u * 5 + l.t * (1.2 + i * 0.4) + i) * r * 0.12
          if (j) ctx.lineTo(px, py)
          else ctx.moveTo(px, py)
        }
        ctx.stroke()
      })
    }
  }
}

export const CRAFT_POCKETS = { crystal, matrix, fireworks, lantern, bauhaus, sakura, dune, paper, neon, borealis }
