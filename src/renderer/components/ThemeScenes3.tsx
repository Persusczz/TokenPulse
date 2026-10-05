import { useRef } from 'react'
import { heliocentric, moonPhase, PLANETS } from '@shared/astro'
import { rand, since, TAU, useLive, useScene, type SceneProps } from './ThemeScenes'
import { layer } from './ThemeScenes2'

const RAD = Math.PI / 180

/** a soft round glow sprite in one colour, drawn once */
function glowSprite(rgb: string, size = 64): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const r = size / 2
  const grad = g.createRadialGradient(r, r, 0, r, r, r)
  grad.addColorStop(0, `rgba(${rgb},1)`)
  grad.addColorStop(0.25, `rgba(${rgb},0.55)`)
  grad.addColorStop(1, `rgba(${rgb},0)`)
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  return c
}

/** a stable pseudo-random number for an integer pair */
const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return s - Math.floor(s)
}

function meteor(ctx: CanvasRenderingContext2D, x: number, y: number, vx: number, vy: number, a: number, rgb: string, len = 0.14, width = 2): void {
  const g = ctx.createLinearGradient(x, y, x - vx * len, y - vy * len)
  g.addColorStop(0, `rgba(${rgb},${a})`)
  g.addColorStop(1, `rgba(${rgb},0)`)
  ctx.strokeStyle = g
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x - vx * len, y - vy * len)
  ctx.stroke()
}

// ---------------------------------------------------------------- 行星仪

/**
 * A brass orrery seen at a slant: the eight planets stand where they really
 * are today (heliocentric longitudes), joined to the sun by thin arms; light
 * runs along the orbits, the asteroid belt turns, Earth's moon and Jupiter's
 * four moons circle. New usage launches a probe from Earth to an outer planet.
 */
export function Orrery(p: SceneProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useLive(p)
  const dark = p.dark !== false
  const lastPulse = useRef(0)
  useScene(
    ref,
    p.level,
    live,
    () => {
      let field: HTMLCanvasElement | null = null
      let belt: { k: number; a: number; r: number; s: number }[] = []
      let probes: { sx: number; sy: number; to: number; t: number; bend: number }[] = []
      let flashes: { x: number; y: number; t: number }[] = []
      let lons: number[] = []
      let lonAt = -1e9
      let t = 0
      return {
        init(w, h) {
          field = layer(w, h, (g) => {
            const bg = g.createRadialGradient(w * 0.6, h * 0.54, 0, w * 0.6, h * 0.54, Math.max(w, h) * 0.85)
            if (dark) {
              bg.addColorStop(0, '#1a1526')
              bg.addColorStop(0.5, '#0f0c18')
              bg.addColorStop(1, '#07060c')
            } else {
              bg.addColorStop(0, '#f6eedb')
              bg.addColorStop(0.7, '#ecdfc2')
              bg.addColorStop(1, '#dccaa2')
            }
            g.fillStyle = bg
            g.fillRect(0, 0, w, h)
            for (let i = 0; i < (w * h) / (dark ? 2400 : 9000); i++) {
              g.globalAlpha = rand(0.15, dark ? 0.75 : 0.25)
              g.fillStyle = dark ? '#fff7e6' : '#6b5330'
              g.beginPath()
              g.arc(Math.random() * w, Math.random() * h, Math.random() < 0.95 ? rand(0.3, 0.9) : rand(1, 1.6), 0, TAU)
              g.fill()
            }
            g.globalAlpha = 1
            // an engraved scale around the edge, like an astronomical chart
            g.strokeStyle = dark ? 'rgba(201,162,94,0.12)' : 'rgba(110,80,40,0.16)'
            g.lineWidth = 1
            const cx = w * 0.6
            const cy = h * 0.54
            for (let i = 0; i < 72; i++) {
              const a = (i / 72) * TAU
              const r1 = Math.max(w, h) * 0.62
              const r2 = r1 + (i % 6 ? 8 : 18)
              g.beginPath()
              g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * 0.38)
              g.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2 * 0.38)
              g.stroke()
            }
          })
          belt = Array.from({ length: Math.round(Math.min(360, (w * h) / 3200)) }, () => ({ k: rand(0.2, 0.8), a: Math.random() * TAU, r: rand(0.5, 1.4), s: rand(0.6, 1.3) }))
          probes = []
        },
        draw(ctx, w, h, dt, l) {
          t += dt
          if (performance.now() - lonAt > 60_000) {
            const now = Date.now()
            lons = PLANETS.map((pl) => heliocentric(pl.key, now).lon * RAD)
            lonAt = performance.now()
          }
          const glow = 0.6 + l.vivid * 0.5
          const ink = dark ? '201,162,94' : '110,80,40'
          if (field) ctx.drawImage(field, 0, 0, w, h)
          const cx = w * 0.6
          const cy = h * 0.54
          const R0 = Math.min(w, h) * 0.085
          const Rmax = Math.max(w * 0.5, 480)
          const TILT = 0.38
          const rx = (k: number) => R0 + (Rmax - R0) * (k / 7) ** 0.92
          const pos = (k: number, lon: number) => [cx + rx(k) * Math.cos(lon), cy - rx(k) * TILT * Math.sin(lon)] as const
          const scale = Math.max(0.9, Math.min(1.5, Math.min(w, h) / 620))
          // orbits, each with a light running along it
          ctx.lineWidth = 1
          for (let k = 0; k < 8; k++) {
            ctx.strokeStyle = `rgba(${ink},${0.22 * glow})`
            ctx.beginPath()
            ctx.ellipse(cx, cy, rx(k), rx(k) * TILT, 0, 0, TAU)
            ctx.stroke()
            const run = -(t * (0.22 - k * 0.018) + k * 1.7)
            for (let s = 0; s < 6; s++) {
              ctx.strokeStyle = `rgba(${dark ? '255,226,160' : '150,100,40'},${(0.09 * (s + 1) * glow).toFixed(3)})`
              ctx.lineWidth = 1.4
              ctx.beginPath()
              ctx.ellipse(cx, cy, rx(k), rx(k) * TILT, 0, run + s * 0.05, run + (s + 1) * 0.05)
              ctx.stroke()
            }
          }
          // the asteroid belt, between Mars and Jupiter
          ctx.fillStyle = dark ? `rgba(230,210,170,${0.4 * glow})` : `rgba(110,80,40,${0.35 * glow})`
          for (const b of belt) {
            b.a += dt * 0.025 * b.s * (1 + l.intensity * 0.3)
            const r = rx(3) + (rx(4) - rx(3)) * b.k
            ctx.fillRect(cx + r * Math.cos(b.a), cy - r * TILT * Math.sin(b.a), b.r, b.r)
          }
          // planets behind the sun first, then the sun, then the rest
          const order = PLANETS.map((pl, i) => ({ pl, i, xy: pos(i, lons[i] ?? 0) })).sort((a, b) => a.xy[1] - b.xy[1])
          const drawPlanet = ({ pl, i, xy }: (typeof order)[number]) => {
            const [x, y] = xy
            // the brass arm from the hub
            ctx.strokeStyle = `rgba(${ink},${0.16 * glow})`
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(cx, cy)
            ctx.lineTo(x, y)
            ctx.stroke()
            const s = pl.size * scale
            if (pl.key === 'saturn') {
              ctx.strokeStyle = dark ? 'rgba(240,220,170,0.7)' : 'rgba(120,90,40,0.7)'
              ctx.lineWidth = 1.2
              ctx.beginPath()
              ctx.ellipse(x, y, s * 2.3, s * 0.75, -0.35, 0, TAU)
              ctx.stroke()
            }
            const d = Math.hypot(cx - x, cy - y) || 1
            const hx = x + ((cx - x) / d) * s * 0.45
            const hy = y + ((cy - y) / d) * s * 0.45
            const g = ctx.createRadialGradient(hx, hy, s * 0.1, x, y, s * 1.1)
            g.addColorStop(0, '#fffaf0')
            g.addColorStop(0.35, pl.color)
            g.addColorStop(1, dark ? 'rgba(10,8,16,0.95)' : 'rgba(60,40,20,0.9)')
            ctx.fillStyle = g
            ctx.beginPath()
            ctx.arc(x, y, s, 0, TAU)
            ctx.fill()
            if (pl.key === 'earth') {
              const a = t * 0.9
              ctx.fillStyle = dark ? '#e8e4da' : '#5a4a32'
              ctx.beginPath()
              ctx.arc(x + Math.cos(a) * s * 2.6, y + Math.sin(a) * s * 1.1, 1.4, 0, TAU)
              ctx.fill()
            }
            if (pl.key === 'jupiter') {
              ctx.fillStyle = dark ? 'rgba(255,240,210,0.85)' : 'rgba(90,70,40,0.8)'
              ;[2.1, 2.9, 3.9, 5.2].forEach((m, j) => {
                const ox = Math.sin(t * (1.1 / (j + 1)) + j * 2) * s * m
                ctx.fillRect(x + ox - 0.6, y - 0.6, 1.3, 1.3)
              })
            }
            ctx.font = `12px ${dark ? "'Source Serif 4 Variable', serif" : "'Source Serif 4 Variable', serif"}`
            ctx.fillStyle = `rgba(${dark ? '240,225,190' : '90,62,30'},${0.55 * glow})`
            ctx.fillText(pl.name, x + s + 5, y - s - 3)
            return i
          }
          for (const o of order) if (o.xy[1] < cy) drawPlanet(o)
          // the sun and the brass hub
          const pulse = Math.max(0, 1 - since(l) / 2)
          const sg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 80 * scale)
          sg.addColorStop(0, dark ? 'rgba(255,236,180,0.95)' : 'rgba(255,190,90,0.9)')
          sg.addColorStop(0.18, dark ? `rgba(255,190,90,${0.5 + pulse * 0.3})` : 'rgba(240,150,60,0.45)')
          sg.addColorStop(1, 'rgba(255,170,60,0)')
          ctx.fillStyle = sg
          ctx.fillRect(cx - 80 * scale, cy - 80 * scale, 160 * scale, 160 * scale)
          ctx.fillStyle = dark ? '#fff1c9' : '#f7b75a'
          ctx.beginPath()
          ctx.arc(cx, cy, 10 * scale, 0, TAU)
          ctx.fill()
          ctx.strokeStyle = `rgba(${ink},${0.45 * glow})`
          ctx.lineWidth = 1
          for (const [r, n, dir] of [
            [20, 24, 1],
            [27, 36, -1]
          ] as const) {
            ctx.beginPath()
            ctx.arc(cx, cy, r * scale, 0, TAU)
            ctx.stroke()
            for (let i = 0; i < n; i++) {
              const a = dir * t * 0.1 + (i / n) * TAU
              ctx.beginPath()
              ctx.moveTo(cx + Math.cos(a) * r * scale, cy + Math.sin(a) * r * scale)
              ctx.lineTo(cx + Math.cos(a) * (r + 3) * scale, cy + Math.sin(a) * (r + 3) * scale)
              ctx.stroke()
            }
          }
          for (const o of order) if (o.xy[1] >= cy) drawPlanet(o)
          // probes from Earth to an outer planet on new usage
          if (l.pulseAt > lastPulse.current) {
            lastPulse.current = l.pulseAt
            const [ex, ey] = pos(2, lons[2] ?? 0)
            probes.push({ sx: ex, sy: ey, to: 3 + Math.floor(Math.random() * 5), t: 0, bend: rand(-0.4, 0.4) })
          }
          probes = probes.filter((pr) => {
            pr.t += dt / 3.4
            const [tx, ty] = pos(pr.to, lons[pr.to] ?? 0)
            const mx = (pr.sx + tx) / 2 + (ty - pr.sy) * pr.bend
            const my = (pr.sy + ty) / 2 - (tx - pr.sx) * pr.bend
            const at = (u: number) => [(1 - u) ** 2 * pr.sx + 2 * (1 - u) * u * mx + u * u * tx, (1 - u) ** 2 * pr.sy + 2 * (1 - u) * u * my + u * u * ty] as const
            const u = Math.min(1, pr.t)
            ctx.fillStyle = dark ? 'rgba(160,220,255,0.55)' : 'rgba(40,90,140,0.55)'
            for (let k = 0; k < 40; k++) {
              const v = (k / 40) * u
              const [x, y] = at(v)
              ctx.fillRect(x - 0.6, y - 0.6, 1.2, 1.2)
            }
            const [x, y] = at(u)
            const g = ctx.createRadialGradient(x, y, 0, x, y, 9)
            g.addColorStop(0, dark ? 'rgba(220,245,255,1)' : 'rgba(40,90,140,0.9)')
            g.addColorStop(1, 'rgba(160,220,255,0)')
            ctx.fillStyle = g
            ctx.fillRect(x - 9, y - 9, 18, 18)
            if (pr.t >= 1) {
              flashes.push({ x: tx, y: ty, t: 0 })
              return false
            }
            return true
          })
          flashes = flashes.filter((f) => {
            f.t += dt
            if (f.t > 1.4) return false
            ctx.strokeStyle = dark ? `rgba(180,230,255,${(1 - f.t / 1.4) * 0.8})` : `rgba(40,90,140,${(1 - f.t / 1.4) * 0.7})`
            ctx.lineWidth = 1.5
            ctx.beginPath()
            ctx.arc(f.x, f.y, 6 + f.t * 26, 0, TAU)
            ctx.stroke()
            return true
          })
          // the date the positions are for
          const d = new Date()
          ctx.font = "12px 'Source Serif 4 Variable', serif"
          ctx.textAlign = 'right'
          ctx.fillStyle = `rgba(${dark ? '230,210,170' : '90,62,30'},${0.42 * glow})`
          ctx.fillText(`${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · 行星的真实位置`, w - 18, h - 14)
          ctx.textAlign = 'start'
        }
      }
    },
    1,
    30
  )
  return <canvas ref={ref} className="scene-canvas" />
}

// ---------------------------------------------------------------- 月夜

/** draws the moon at (x, y) with the real lit fraction: waxing lit on the right, waning on the left */
export function drawMoon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, phase: number, dark: boolean, tilt = -0.35): void {
  const k = (1 - Math.cos(phase * TAU)) / 2
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(tilt)
  if (phase > 0.5) ctx.scale(-1, 1)
  // the unlit disc, faintly lit by the Earth
  ctx.fillStyle = dark ? 'rgba(52,62,86,0.85)' : 'rgba(170,180,200,0.55)'
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, TAU)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false)
  const rx = r * Math.abs(1 - 2 * k)
  ctx.ellipse(0, 0, Math.max(0.01, rx), r, 0, Math.PI / 2, -Math.PI / 2, k < 0.5)
  ctx.closePath()
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r)
  g.addColorStop(0, '#fffdf4')
  g.addColorStop(1, dark ? '#e3dfcf' : '#f2efe4')
  ctx.fillStyle = g
  ctx.fill()
  // maria, only where it is lit
  ctx.clip()
  ctx.fillStyle = 'rgba(150,150,140,0.28)'
  for (const [mx, my, mr] of [
    [-0.25, -0.28, 0.24],
    [0.18, -0.1, 0.2],
    [-0.05, 0.25, 0.28],
    [0.32, 0.3, 0.14],
    [-0.42, 0.12, 0.12]
  ]) {
    ctx.beginPath()
    ctx.arc(mx * r, my * r, mr * r, 0, TAU)
    ctx.fill()
  }
  ctx.restore()
}

/**
 * A night at sea: tonight's real moon phase with its halo, thin clouds lit at
 * their edges, a silver glitter path on the water and a lighthouse sweeping
 * its beam on a far headland. New usage sends a shooting star and a bright
 * wave along the glitter path.
 */
export function Lunar(p: SceneProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useLive(p)
  const dark = p.dark !== false
  const lastPulse = useRef(0)
  useScene(
    ref,
    p.level,
    live,
    () => {
      let sky: HTMLCanvasElement | null = null
      let clouds: { img: HTMLCanvasElement; x: number; y: number; v: number; a: number }[] = []
      let waves: { x: number; y: number; len: number; ph: number }[] = []
      let meteors: { x: number; y: number; vx: number; vy: number; life: number }[] = []
      let swell = -1
      let phase = 0.5
      let phaseAt = -1e9
      let t = 0
      const cloud = (cw: number, ch: number) =>
        layer(cw, ch, (g) => {
          for (let i = 0; i < 26; i++) {
            const x = rand(ch * 0.6, cw - ch * 0.6)
            const y = ch / 2 + rand(-ch * 0.18, ch * 0.18)
            const r = rand(ch * 0.25, ch * 0.5)
            const gr = g.createRadialGradient(x, y, 0, x, y, r)
            gr.addColorStop(0, dark ? 'rgba(120,140,175,0.22)' : 'rgba(255,255,255,0.35)')
            gr.addColorStop(1, 'rgba(120,140,175,0)')
            g.fillStyle = gr
            g.fillRect(x - r, y - r, r * 2, r * 2)
          }
        })
      return {
        init(w, h) {
          const hz = h * 0.7
          sky = layer(w, h, (g) => {
            const bg = g.createLinearGradient(0, 0, 0, hz)
            if (dark) {
              bg.addColorStop(0, '#040914')
              bg.addColorStop(0.6, '#0b1730')
              bg.addColorStop(1, '#1a2c4e')
            } else {
              bg.addColorStop(0, '#5f78ad')
              bg.addColorStop(0.65, '#a9a8cf')
              bg.addColorStop(1, '#efc3a6')
            }
            g.fillStyle = bg
            g.fillRect(0, 0, w, hz)
            for (let i = 0; i < (w * hz) / (dark ? 2200 : 7000); i++) {
              g.globalAlpha = rand(0.15, dark ? 0.8 : 0.4)
              g.fillStyle = '#fffaf0'
              g.beginPath()
              g.arc(Math.random() * w, Math.random() * hz * 0.92, rand(0.3, 1.1), 0, TAU)
              g.fill()
            }
            g.globalAlpha = 1
            const sea = g.createLinearGradient(0, hz, 0, h)
            sea.addColorStop(0, dark ? '#122340' : '#7d86ad')
            sea.addColorStop(1, dark ? '#040a16' : '#3f4f7c')
            g.fillStyle = sea
            g.fillRect(0, hz, w, h - hz)
            // a far headland with the lighthouse, on the left
            g.fillStyle = dark ? '#050b17' : '#3a4568'
            g.beginPath()
            g.moveTo(0, hz + 2)
            g.lineTo(0, hz - 26)
            g.bezierCurveTo(w * 0.06, hz - 34, w * 0.12, hz - 18, w * 0.2, hz - 6)
            g.lineTo(w * 0.27, hz + 2)
            g.closePath()
            g.fill()
            g.fillRect(w * 0.115, hz - 52, 6, 30)
          })
          clouds = Array.from({ length: 5 }, (_, i) => {
            const cw = rand(320, 620)
            const ch = rand(50, 110)
            return { img: cloud(cw, ch), x: rand(-cw, w), y: hz * (0.1 + i * 0.12) + rand(-20, 20), v: rand(4, 10), a: rand(0.6, 1) }
          })
          waves = Array.from({ length: Math.round(w / 9) }, () => ({ x: Math.random() * w, y: hz + 4 + Math.random() ** 1.6 * (h - hz), len: rand(10, 46), ph: Math.random() * TAU }))
        },
        draw(ctx, w, h, dt, l) {
          t += dt
          if (performance.now() - phaseAt > 300_000) {
            phase = moonPhase(Date.now()).phase
            phaseAt = performance.now()
          }
          const lit = (1 - Math.cos(phase * TAU)) / 2
          const glow = 0.6 + l.vivid * 0.5
          const hz = h * 0.7
          if (sky) ctx.drawImage(sky, 0, 0, w, h)
          const mx = w * 0.8
          const my = h * 0.2
          const mr = Math.max(24, Math.min(52, Math.min(w, h) * 0.05))
          const halo = ctx.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 7)
          halo.addColorStop(0, `rgba(220,230,255,${(0.1 + lit * 0.28) * glow})`)
          halo.addColorStop(1, 'rgba(220,230,255,0)')
          ctx.fillStyle = halo
          ctx.fillRect(mx - mr * 7, my - mr * 7, mr * 14, mr * 14)
          drawMoon(ctx, mx, my, mr, phase, dark)
          // clouds drift past, brighter near the moon
          for (const c of clouds) {
            c.x += c.v * dt * (1 + l.intensity * 0.5)
            if (c.x > w + 40) c.x = -c.img.width / (window.devicePixelRatio || 1) - 40
            const cw = c.img.width / (window.devicePixelRatio || 1)
            const chh = c.img.height / (window.devicePixelRatio || 1)
            const near = Math.max(0, 1 - Math.hypot(c.x + cw / 2 - mx, c.y + chh / 2 - my) / (w * 0.35))
            ctx.globalAlpha = c.a * (0.7 + near * 0.6)
            ctx.drawImage(c.img, c.x, c.y, cw, chh)
          }
          ctx.globalAlpha = 1
          // the horizon and the waves
          ctx.fillStyle = `rgba(200,215,255,${0.12 * glow})`
          ctx.fillRect(0, hz, w, 1)
          ctx.lineWidth = 1
          for (const wv of waves) {
            const x = (wv.x + t * 6) % (w + 60) - 30
            const a = (0.05 + 0.08 * Math.max(0, Math.sin(t * 0.8 + wv.ph))) * glow
            ctx.strokeStyle = `rgba(200,215,255,${a})`
            ctx.beginPath()
            ctx.moveTo(x, wv.y)
            ctx.lineTo(x + wv.len * (0.4 + (wv.y - hz) / (h - hz)), wv.y)
            ctx.stroke()
          }
          // the glitter path under the moon
          if (l.pulseAt > lastPulse.current) {
            lastPulse.current = l.pulseAt
            swell = 0
            meteors.push({ x: w * rand(0.35, 0.95), y: rand(0, h * 0.2), vx: -rand(420, 700), vy: rand(160, 300), life: 1 })
          }
          if (swell >= 0) swell += dt * 0.5
          if (swell > 1.2) swell = -1
          const rows = Math.floor((h - hz) / 3)
          for (let i = 0; i < rows; i++) {
            const y = hz + 2 + i * 3
            const depth = (y - hz) / (h - hz)
            const width = mr * 0.8 + depth * w * 0.16
            const boost = swell >= 0 ? Math.max(0, 1 - Math.abs(depth - swell) * 6) : 0
            for (let j = 0; j < 3; j++) {
              const n = hash(i, j)
              const f = 0.5 + 0.5 * Math.sin(t * (2 + n * 3) + n * 20)
              const a = (f ** 3 * (0.25 + lit * 0.6) + boost * 0.6) * glow * (1 - depth * 0.4)
              if (a < 0.02) continue
              const x = mx + (n - 0.5) * width * 2 + Math.sin(t * 0.6 + i) * 3
              ctx.fillStyle = `rgba(240,242,230,${Math.min(1, a)})`
              ctx.fillRect(x, y, 4 + n * 14 * (0.5 + depth), 1.2)
            }
          }
          // the lighthouse beam sweeping
          const lx = w * 0.118
          const ly = hz - 52
          const sweep = Math.cos(t * 0.6)
          const reach = w * 0.45
          const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, reach)
          lg.addColorStop(0, `rgba(255,236,190,${0.32 * glow * Math.abs(sweep) ** 0.5})`)
          lg.addColorStop(1, 'rgba(255,236,190,0)')
          ctx.fillStyle = lg
          ctx.beginPath()
          ctx.moveTo(lx, ly)
          ctx.lineTo(lx + reach * sweep, ly - 14)
          ctx.lineTo(lx + reach * sweep, ly + 10)
          ctx.closePath()
          ctx.fill()
          const lamp = ctx.createRadialGradient(lx + 3, ly, 0, lx + 3, ly, 10)
          lamp.addColorStop(0, 'rgba(255,240,200,0.95)')
          lamp.addColorStop(1, 'rgba(255,240,200,0)')
          ctx.fillStyle = lamp
          ctx.fillRect(lx - 7, ly - 10, 20, 20)
          meteors = meteors.filter((m) => {
            m.x += m.vx * dt
            m.y += m.vy * dt
            m.life -= dt * 1.2
            if (m.life <= 0 || m.y > hz) return false
            meteor(ctx, m.x, m.y, m.vx, m.vy, m.life, '255,250,235')
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

// ---------------------------------------------------------------- 日冕

/**
 * Totality: the black disc of the moon ringed by pearly coronal streamers that
 * slowly shimmer, pink prominences at the limb, a sunset glow all around the
 * horizon and Venus bright nearby. New usage flashes a diamond ring.
 */
export function Eclipse(p: SceneProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useLive(p)
  const dark = p.dark !== false
  const lastPulse = useRef(0)
  useScene(
    ref,
    p.level,
    live,
    () => {
      let sky: HTMLCanvasElement | null = null
      let corona: HTMLCanvasElement[] = []
      let ring = { t: -1, a: 3.9 }
      let t = 0
      let R = 50
      const makeCorona = (r: number, seed: number) => {
        const S = r * 9
        return layer(S, S, (g) => {
          g.globalCompositeOperation = 'lighter'
          const c = S / 2
          for (let i = 0; i < 140; i++) {
            const a = (i / 140) * TAU + hash(i, seed) * 0.08
            // longer along the solar equator: two broad lobes
            const lobe = 0.45 + 0.55 * Math.abs(Math.cos(a - 0.3)) ** 2
            const len = r * (0.6 + hash(seed, i) * 2.4 * lobe + (hash(i * 3, seed) > 0.93 ? 1.4 : 0))
            const wdt = r * (0.03 + hash(i, seed * 7) * 0.09)
            const grad = g.createRadialGradient(c, c, r * 0.95, c, c, r + len)
            grad.addColorStop(0, `rgba(255,252,244,${0.16 + hash(i, 9) * 0.12})`)
            grad.addColorStop(0.4, 'rgba(240,236,255,0.06)')
            grad.addColorStop(1, 'rgba(240,236,255,0)')
            g.fillStyle = grad
            const nx = Math.cos(a)
            const ny = Math.sin(a)
            g.beginPath()
            g.moveTo(c + nx * r - ny * wdt, c + ny * r + nx * wdt)
            g.lineTo(c + nx * (r + len), c + ny * (r + len))
            g.lineTo(c + nx * r + ny * wdt, c + ny * r - nx * wdt)
            g.closePath()
            g.fill()
          }
        })
      }
      return {
        init(w, h) {
          R = Math.max(30, Math.min(64, Math.min(w, h) * 0.065))
          sky = layer(w, h, (g) => {
            const bg = g.createLinearGradient(0, 0, 0, h)
            if (dark) {
              bg.addColorStop(0, '#04050b')
              bg.addColorStop(0.55, '#0b1026')
              bg.addColorStop(0.8, '#251a35')
              bg.addColorStop(0.92, '#9a4a3c')
              bg.addColorStop(1, '#e07a4c')
            } else {
              bg.addColorStop(0, '#3b4370')
              bg.addColorStop(0.55, '#6b6a92')
              bg.addColorStop(0.82, '#c38d8a')
              bg.addColorStop(0.93, '#f2a777')
              bg.addColorStop(1, '#ffd29a')
            }
            g.fillStyle = bg
            g.fillRect(0, 0, w, h)
            for (let i = 0; i < (w * h) / 9000; i++) {
              g.globalAlpha = rand(0.15, dark ? 0.7 : 0.35)
              g.fillStyle = '#fff'
              g.beginPath()
              g.arc(Math.random() * w, Math.random() * h * 0.7, rand(0.3, 1), 0, TAU)
              g.fill()
            }
            g.globalAlpha = 1
            // distant hills against the 360° sunset
            g.fillStyle = dark ? '#06060a' : '#2e2533'
            g.beginPath()
            g.moveTo(0, h)
            for (let x = 0; x <= w; x += 20) g.lineTo(x, h - 26 - Math.sin(x * 0.006) * 14 - Math.sin(x * 0.017 + 1) * 7 - hash(x, 3) * 4)
            g.lineTo(w, h)
            g.closePath()
            g.fill()
          })
          corona = [makeCorona(R, 1), makeCorona(R, 2)]
        },
        draw(ctx, w, h, dt, l) {
          t += dt
          const glow = 0.6 + l.vivid * 0.5
          if (sky) ctx.drawImage(sky, 0, 0, w, h)
          const cx = w * 0.78
          const cy = h * 0.25
          // the horizon glow breathes
          const hg = ctx.createLinearGradient(0, h * 0.78, 0, h)
          hg.addColorStop(0, 'rgba(255,140,90,0)')
          hg.addColorStop(1, `rgba(255,150,90,${(0.12 + 0.06 * Math.sin(t * 0.4)) * glow})`)
          ctx.fillStyle = hg
          ctx.fillRect(0, h * 0.78, w, h * 0.22)
          // two corona layers crossfade and turn a little: the shimmer
          const S = R * 9
          corona.forEach((c, i) => {
            ctx.save()
            ctx.translate(cx, cy)
            ctx.rotate(Math.sin(t * 0.04 + i * 2) * 0.05)
            ctx.globalAlpha = (0.55 + 0.45 * Math.sin(t * 0.35 + i * Math.PI)) * glow * (1 + l.intensity * 0.1)
            ctx.drawImage(c, -S / 2, -S / 2, S, S)
            ctx.restore()
          })
          ctx.globalAlpha = 1
          const inner = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.7)
          inner.addColorStop(0, `rgba(255,252,245,${0.95 * glow})`)
          inner.addColorStop(0.25, `rgba(250,246,255,${0.35 * glow})`)
          inner.addColorStop(1, 'rgba(250,246,255,0)')
          ctx.fillStyle = inner
          ctx.fillRect(cx - R * 2, cy - R * 2, R * 4, R * 4)
          // prominences
          for (const [a, s] of [
            [0.7, 1],
            [2.5, 0.7],
            [4.4, 0.85],
            [5.6, 0.5]
          ]) {
            const k = s * (0.85 + 0.15 * Math.sin(t * 0.7 + a))
            const px = cx + Math.cos(a) * R
            const py = cy + Math.sin(a) * R
            const pg = ctx.createRadialGradient(px, py, 0, px, py, R * 0.16 * k)
            pg.addColorStop(0, 'rgba(255,120,150,0.95)')
            pg.addColorStop(1, 'rgba(255,90,130,0)')
            ctx.fillStyle = pg
            ctx.beginPath()
            ctx.ellipse(px, py, R * 0.16 * k, R * 0.08 * k, a, 0, TAU)
            ctx.fill()
          }
          // the moon
          ctx.fillStyle = dark ? '#020205' : '#16141c'
          ctx.beginPath()
          ctx.arc(cx, cy, R * 1.005, 0, TAU)
          ctx.fill()
          // Venus
          const vx = cx - R * 5.2
          const vy = cy + R * 2.4
          const vg = ctx.createRadialGradient(vx, vy, 0, vx, vy, 8)
          vg.addColorStop(0, 'rgba(255,250,235,1)')
          vg.addColorStop(1, 'rgba(255,250,235,0)')
          ctx.fillStyle = vg
          ctx.fillRect(vx - 8, vy - 8, 16, 16)
          // the diamond ring on new usage
          if (l.pulseAt > lastPulse.current) {
            lastPulse.current = l.pulseAt
            ring = { t: 0, a: rand(3.3, 4.6) }
          }
          if (ring.t >= 0) {
            ring.t += dt
            const k = Math.max(0, 1 - ring.t / 1.8)
            if (k <= 0) ring.t = -1
            else {
              const dx = cx + Math.cos(ring.a) * R
              const dy = cy + Math.sin(ring.a) * R
              const dg = ctx.createRadialGradient(dx, dy, 0, dx, dy, R * 1.4 * k + 4)
              dg.addColorStop(0, `rgba(255,255,255,${k})`)
              dg.addColorStop(0.2, `rgba(255,250,235,${k * 0.6})`)
              dg.addColorStop(1, 'rgba(255,250,235,0)')
              ctx.fillStyle = dg
              ctx.fillRect(dx - R * 1.6, dy - R * 1.6, R * 3.2, R * 3.2)
              ctx.strokeStyle = `rgba(255,255,255,${k * 0.8})`
              ctx.lineWidth = 1.2
              for (let i = 0; i < 6; i++) {
                const a = (i / 6) * TAU + t * 0.2
                const len = R * (i % 2 ? 1.1 : 2.2) * k
                ctx.beginPath()
                ctx.moveTo(dx - Math.cos(a) * len, dy - Math.sin(a) * len)
                ctx.lineTo(dx + Math.cos(a) * len, dy + Math.sin(a) * len)
                ctx.stroke()
              }
              // Baily's beads beside it
              for (const off of [-0.18, -0.1, 0.12]) {
                const bx = cx + Math.cos(ring.a + off) * R
                const by = cy + Math.sin(ring.a + off) * R
                ctx.fillStyle = `rgba(255,255,250,${k * 0.9})`
                ctx.beginPath()
                ctx.arc(bx, by, 1.6, 0, TAU)
                ctx.fill()
              }
            }
          }
        }
      }
    },
    1,
    30
  )
  return <canvas ref={ref} className="scene-canvas" />
}

// ---------------------------------------------------------------- 星轨

/**
 * A long exposure: stars draw coloured concentric arcs around the celestial
 * pole as the sky turns, above a ridge with a tent glowing warm. Meteors fall
 * now and then; new usage sends a fireball that leaves a glowing train.
 */
export function Trails(p: SceneProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useLive(p)
  const dark = p.dark !== false
  const lastPulse = useRef(0)
  useScene(
    ref,
    p.level,
    live,
    () => {
      let back: HTMLCanvasElement | null = null
      let front: HTMLCanvasElement | null = null
      let arcs: HTMLCanvasElement | null = null
      let heads: { r: number; a: number; c: string; s: number; ph: number }[] = []
      let falls: { x: number; y: number; vx: number; vy: number; life: number; big: boolean }[] = []
      let trains: { x1: number; y1: number; x2: number; y2: number; t: number }[] = []
      let RL = 0
      let rot = 0
      let t = 0
      let nextFall = 4
      const SCALE = 0.7
      const COLORS = ['159,196,255', '207,224,255', '255,244,224', '255,217,160', '255,176,138']
      return {
        init(w, h) {
          const px = w * 0.7
          const py = h * 0.13
          RL = Math.hypot(Math.max(px, w - px), Math.max(py, h - py)) + 20
          back = layer(w, h, (g) => {
            const bg = g.createLinearGradient(0, 0, 0, h)
            if (dark) {
              bg.addColorStop(0, '#03060f')
              bg.addColorStop(0.7, '#0a1328')
              bg.addColorStop(1, '#16233c')
            } else {
              bg.addColorStop(0, '#16285a')
              bg.addColorStop(0.65, '#3d5a98')
              bg.addColorStop(1, '#e6a983')
            }
            g.fillStyle = bg
            g.fillRect(0, 0, w, h)
          })
          // the arcs, drawn once around the pole and turned every frame
          const size = Math.ceil(RL * 2 * SCALE)
          arcs = document.createElement('canvas')
          arcs.width = arcs.height = size
          const g = arcs.getContext('2d')!
          g.scale(SCALE, SCALE)
          g.lineCap = 'round'
          const n = Math.min(900, Math.round((Math.PI * RL * RL) / 1700))
          heads = []
          for (let i = 0; i < n; i++) {
            const r = Math.sqrt(Math.random()) * RL
            const a = Math.random() * TAU
            const span = rand(0.35, 1.05)
            const c = COLORS[Math.floor(Math.random() ** 1.4 * COLORS.length)]
            const bright = Math.random() < 0.12
            const alpha = bright ? rand(0.6, 0.95) : rand(0.15, 0.5)
            g.lineWidth = bright ? rand(1.2, 2) : rand(0.5, 1.1)
            const SEG = 10
            for (let s = 0; s < SEG; s++) {
              // the head is at angle a, the tail trails behind (larger angles on screen)
              g.strokeStyle = `rgba(${c},${((1 - s / SEG) * alpha).toFixed(3)})`
              g.beginPath()
              g.arc(RL, RL, r, a + (s / SEG) * span, a + ((s + 1) / SEG) * span)
              g.stroke()
            }
            if (bright) heads.push({ r, a, c, s: g.lineWidth, ph: Math.random() * TAU })
          }
          front = layer(w, h, (fg) => {
            fg.fillStyle = dark ? '#020409' : '#0f1a33'
            fg.beginPath()
            fg.moveTo(0, h)
            const ridge = (x: number) => h * 0.86 - Math.sin(x * 0.004 + 1) * h * 0.05 - Math.sin(x * 0.013) * h * 0.02 - Math.max(0, 1 - Math.abs(x - w * 0.3) / (w * 0.25)) * h * 0.08
            for (let x = 0; x <= w; x += 8) fg.lineTo(x, ridge(x))
            fg.lineTo(w, h)
            fg.closePath()
            fg.fill()
            // a few pines on the ridge
            for (let i = 0; i < 14; i++) {
              const x = w * (0.45 + i * 0.04) + rand(-8, 8)
              const base = ridge(x) + 2
              const th = rand(14, 34)
              fg.beginPath()
              fg.moveTo(x, base - th)
              fg.lineTo(x - th * 0.28, base)
              fg.lineTo(x + th * 0.28, base)
              fg.closePath()
              fg.fill()
            }
          })
          falls = []
          trains = []
        },
        draw(ctx, w, h, dt, l) {
          t += dt
          rot -= dt * 0.012 * (1 + l.intensity * 0.25)
          const glow = 0.6 + l.vivid * 0.5
          const px = w * 0.7
          const py = h * 0.13
          if (back) ctx.drawImage(back, 0, 0, w, h)
          // a faint glow of the Milky Way across
          const mw = ctx.createLinearGradient(0, h * 0.9, w, h * 0.1)
          mw.addColorStop(0.3, 'rgba(200,210,255,0)')
          mw.addColorStop(0.5, `rgba(200,210,255,${0.05 * glow})`)
          mw.addColorStop(0.7, 'rgba(200,210,255,0)')
          ctx.fillStyle = mw
          ctx.fillRect(0, 0, w, h)
          if (arcs) {
            ctx.save()
            ctx.translate(px, py)
            ctx.rotate(rot)
            ctx.globalAlpha = (dark ? 1 : 0.7) * Math.min(1, glow)
            ctx.drawImage(arcs, -RL, -RL, RL * 2, RL * 2)
            ctx.restore()
            ctx.globalAlpha = 1
          }
          // the brightest heads twinkle
          for (const s of heads) {
            const a = s.a + rot
            const x = px + Math.cos(a) * s.r
            const y = py + Math.sin(a) * s.r
            if (x < -4 || y < -4 || x > w + 4 || y > h + 4) continue
            const tw = 0.6 + 0.4 * Math.sin(t * 2.2 + s.ph)
            ctx.fillStyle = `rgba(${s.c},${tw})`
            ctx.beginPath()
            ctx.arc(x, y, s.s * 0.9, 0, TAU)
            ctx.fill()
          }
          const pg = ctx.createRadialGradient(px, py, 0, px, py, 10)
          pg.addColorStop(0, 'rgba(255,255,255,0.95)')
          pg.addColorStop(1, 'rgba(255,255,255,0)')
          ctx.fillStyle = pg
          ctx.fillRect(px - 10, py - 10, 20, 20)
          // meteors, and a fireball on new usage
          nextFall -= dt * (1 + l.intensity * 0.5)
          const spawn = (big: boolean) => falls.push({ x: w * rand(0.2, 1), y: rand(-10, h * 0.3), vx: -rand(380, 640) * (big ? 0.8 : 1), vy: rand(180, 320), life: 1, big })
          if (nextFall <= 0) {
            spawn(false)
            nextFall = rand(6, 16)
          }
          if (l.pulseAt > lastPulse.current) {
            lastPulse.current = l.pulseAt
            spawn(true)
          }
          falls = falls.filter((m) => {
            const ox = m.x
            const oy = m.y
            m.x += m.vx * dt
            m.y += m.vy * dt
            m.life -= dt * (m.big ? 0.75 : 1.3)
            if (m.big) trains.push({ x1: ox, y1: oy, x2: m.x, y2: m.y, t: 0 })
            if (m.life <= 0) return false
            meteor(ctx, m.x, m.y, m.vx, m.vy, m.life, m.big ? '255,240,200' : '235,245,255', m.big ? 0.2 : 0.12, m.big ? 3 : 1.6)
            if (m.big) {
              const fg = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, 14)
              fg.addColorStop(0, `rgba(255,250,220,${m.life})`)
              fg.addColorStop(1, 'rgba(255,250,220,0)')
              ctx.fillStyle = fg
              ctx.fillRect(m.x - 14, m.y - 14, 28, 28)
            }
            return true
          })
          // the fireball's train lingers, greenish, and spreads
          trains = trains.filter((tr) => {
            tr.t += dt
            if (tr.t > 4) return false
            ctx.strokeStyle = `rgba(150,255,200,${0.22 * (1 - tr.t / 4)})`
            ctx.lineWidth = 1 + tr.t * 1.5
            ctx.beginPath()
            ctx.moveTo(tr.x1, tr.y1 + tr.t * 3)
            ctx.lineTo(tr.x2, tr.y2 + tr.t * 3)
            ctx.stroke()
            return true
          })
          if (front) ctx.drawImage(front, 0, 0, w, h)
          // the tent on the ridge, glowing
          const tx = w * 0.3
          const ty = h * 0.86 - Math.sin(tx * 0.004 + 1) * h * 0.05 - Math.sin(tx * 0.013) * h * 0.02 - h * 0.08
          const flick = 0.85 + 0.15 * Math.sin(t * 7) * Math.sin(t * 3.1)
          const tg = ctx.createRadialGradient(tx, ty - 6, 0, tx, ty - 6, 60)
          tg.addColorStop(0, `rgba(255,190,110,${0.45 * flick * glow})`)
          tg.addColorStop(1, 'rgba(255,190,110,0)')
          ctx.fillStyle = tg
          ctx.fillRect(tx - 60, ty - 66, 120, 120)
          ctx.fillStyle = `rgba(255,${Math.round(180 + 30 * flick)},120,0.95)`
          ctx.beginPath()
          ctx.moveTo(tx, ty - 16)
          ctx.lineTo(tx - 14, ty + 1)
          ctx.lineTo(tx + 14, ty + 1)
          ctx.closePath()
          ctx.fill()
        }
      }
    },
    1,
    30
  )
  return <canvas ref={ref} className="scene-canvas" />
}

// ---------------------------------------------------------------- 雨夜

/**
 * A rainy window at night: city lights out of focus behind the glass, beads of
 * water that gather and slide down in fits and starts, clearing a path through
 * the small droplets. Harder rain with more usage; new usage lights the sky
 * with a distant flash.
 */
export function Rain(p: SceneProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useLive(p)
  const dark = p.dark !== false
  const lastPulse = useRef(0)
  useScene(
    ref,
    p.level,
    live,
    () => {
      let bg: HTMLCanvasElement | null = null
      let glass: HTMLCanvasElement | null = null
      let gctx: CanvasRenderingContext2D | null = null
      let bokeh: { x: number; y: number; r: number; img: HTMLCanvasElement; a: number; vx: number; ph: number }[] = []
      let slides: { x: number; y: number; r: number; v: number; stall: number; trail: number }[] = []
      let streaks: { x: number; y: number; len: number; v: number }[] = []
      let drop: HTMLCanvasElement | null = null
      let flash = 0
      let acc = 0
      let dropAcc = 0
      let t = 0
      let W = 0
      let H = 0
      const PALETTE = dark ? ['255,158,94', '95,212,255', '255,94,180', '255,236,200', '150,130,255', '255,200,90'] : ['140,160,140', '210,190,150', '160,180,200', '230,210,180']
      const makeDrop = () => {
        const c = document.createElement('canvas')
        c.width = c.height = 32
        const g = c.getContext('2d')!
        const body = g.createRadialGradient(13, 12, 1, 16, 16, 15)
        body.addColorStop(0, dark ? 'rgba(200,215,255,0.1)' : 'rgba(255,255,255,0.45)')
        body.addColorStop(0.6, dark ? 'rgba(140,160,210,0.08)' : 'rgba(200,210,220,0.2)')
        body.addColorStop(0.88, dark ? 'rgba(0,0,0,0.5)' : 'rgba(60,70,80,0.35)')
        body.addColorStop(1, 'rgba(0,0,0,0)')
        g.fillStyle = body
        g.beginPath()
        g.arc(16, 16, 15, 0, TAU)
        g.fill()
        g.fillStyle = dark ? 'rgba(235,240,255,0.5)' : 'rgba(255,255,255,0.8)'
        g.beginPath()
        g.arc(11, 10, 1.8, 0, TAU)
        g.fill()
        // light gathered at the bottom edge, as in a real bead of water
        g.strokeStyle = dark ? 'rgba(220,230,255,0.25)' : 'rgba(255,255,255,0.5)'
        g.lineWidth = 1.4
        g.beginPath()
        g.arc(16, 16, 11.5, 0.35 * Math.PI, 0.75 * Math.PI)
        g.stroke()
        return c
      }
      const sprinkle = (n: number) => {
        if (!gctx || !drop) return
        for (let i = 0; i < n; i++) {
          const r = Math.random() < 0.85 ? rand(0.8, 2.2) : rand(2.4, 3.6)
          gctx.drawImage(drop, Math.random() * W - r, Math.random() * H - r, r * 2, r * 2.2)
        }
      }
      return {
        init(w, h) {
          W = w
          H = h
          drop = makeDrop()
          bg = layer(w, h, (g) => {
            const gr = g.createLinearGradient(0, 0, 0, h)
            if (dark) {
              gr.addColorStop(0, '#080a15')
              gr.addColorStop(0.6, '#111727')
              gr.addColorStop(1, '#1c1726')
            } else {
              gr.addColorStop(0, '#bfc8d1')
              gr.addColorStop(1, '#e3e8ec')
            }
            g.fillStyle = gr
            g.fillRect(0, 0, w, h)
          })
          const sprite = (rgb: string) =>
            layer(128, 128, (g) => {
              const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64)
              gr.addColorStop(0, `rgba(${rgb},0.8)`)
              gr.addColorStop(0.72, `rgba(${rgb},0.7)`)
              gr.addColorStop(0.86, `rgba(${rgb},0.95)`)
              gr.addColorStop(1, `rgba(${rgb},0)`)
              g.fillStyle = gr
              g.fillRect(0, 0, 128, 128)
            })
          const sprites = PALETTE.map(sprite)
          bokeh = Array.from({ length: Math.round(Math.min(60, (w * h) / 22000) + 14) }, () => ({
            x: Math.random() * w,
            y: h * (0.15 + Math.random() * 0.8),
            r: rand(16, 80),
            img: sprites[Math.floor(Math.random() * sprites.length)],
            a: rand(0.06, dark ? 0.24 : 0.18),
            vx: rand(-4, 4),
            ph: Math.random() * TAU
          }))
          glass = document.createElement('canvas')
          const dpr = window.devicePixelRatio || 1
          glass.width = Math.round(w * dpr)
          glass.height = Math.round(h * dpr)
          gctx = glass.getContext('2d')!
          gctx.scale(dpr, dpr)
          sprinkle(Math.round((w * h) / 700))
          slides = []
          streaks = Array.from({ length: 70 }, () => ({ x: Math.random() * w, y: Math.random() * h, len: rand(12, 34), v: rand(500, 900) }))
        },
        draw(ctx, w, h, dt, l) {
          t += dt
          const glow = 0.6 + l.vivid * 0.5
          if (bg) ctx.drawImage(bg, 0, 0, w, h)
          if (l.pulseAt > lastPulse.current) {
            lastPulse.current = l.pulseAt
            flash = 1
          }
          flash = Math.max(0, flash - dt * 0.9)
          // the city out of focus
          for (const b of bokeh) {
            b.x += b.vx * dt
            if (b.x < -b.r) b.x = w + b.r
            if (b.x > w + b.r) b.x = -b.r
            ctx.globalAlpha = Math.min(1, b.a * glow * (0.8 + 0.2 * Math.sin(t * 0.7 + b.ph)) * (1 + flash * 0.8))
            ctx.drawImage(b.img, b.x - b.r, b.y - b.r, b.r * 2, b.r * 2)
          }
          ctx.globalAlpha = 1
          // rain falling outside
          ctx.strokeStyle = dark ? `rgba(180,200,240,${0.07 * glow})` : `rgba(90,100,120,${0.1 * glow})`
          ctx.lineWidth = 1
          ctx.beginPath()
          for (const s of streaks) {
            s.y += s.v * dt
            s.x -= s.v * dt * 0.12
            if (s.y > h) {
              s.y = -s.len
              s.x = Math.random() * w * 1.1
            }
            ctx.moveTo(s.x, s.y)
            ctx.lineTo(s.x - s.len * 0.12, s.y + s.len)
          }
          ctx.stroke()
          // the lightning flash
          if (flash > 0) {
            const k = flash * (0.55 + 0.45 * Math.abs(Math.sin(t * 38)))
            ctx.fillStyle = dark ? `rgba(190,200,255,${0.22 * k})` : `rgba(255,255,255,${0.35 * k})`
            ctx.fillRect(0, 0, w, h)
          }
          // new droplets keep settling; beads gather and slide
          dropAcc += dt * (6 + l.intensity * 10)
          if (dropAcc > 1) {
            sprinkle(Math.floor(dropAcc))
            dropAcc %= 1
          }
          acc += dt * (0.35 + l.intensity * 0.6)
          while (acc > 1 && slides.length < 40) {
            acc -= 1
            slides.push({ x: Math.random() * w, y: rand(-20, h * 0.6), r: rand(3, 6.5), v: 0, stall: rand(0, 1.5), trail: 0 })
          }
          if (gctx && glass) {
            ctx.drawImage(glass, 0, 0, w, h)
            slides = slides.filter((s) => {
              if (s.stall > 0) s.stall -= dt
              else {
                s.v = Math.min(s.v + 600 * dt, 120 + s.r * 30)
                if (Math.random() < dt * 0.8) {
                  s.stall = rand(0.1, 0.8)
                  s.v = 0
                }
              }
              const oy = s.y
              s.y += s.v * dt
              s.x += Math.sin(s.y * 0.05) * 0.3
              // wipe a path through the small droplets and leave a few behind
              gctx!.globalCompositeOperation = 'destination-out'
              gctx!.lineWidth = s.r * 1.6
              gctx!.lineCap = 'round'
              gctx!.beginPath()
              gctx!.moveTo(s.x, oy)
              gctx!.lineTo(s.x, s.y)
              gctx!.stroke()
              gctx!.globalCompositeOperation = 'source-over'
              s.trail += s.y - oy
              if (s.trail > 14 && drop) {
                s.trail = 0
                const r = rand(0.8, 1.6)
                gctx!.drawImage(drop, s.x - r + rand(-1, 1), s.y - s.r * 3, r * 2, r * 2.2)
              }
              if (drop) ctx.drawImage(drop, s.x - s.r, s.y - s.r * 1.1, s.r * 2, s.r * 2.3)
              return s.y < h + 20
            })
          }
        }
      }
    },
    1,
    30
  )
  return <canvas ref={ref} className="scene-canvas" />
}

// ---------------------------------------------------------------- 萤火

/**
 * A summer night in the woods: layered tree shadows, low mist, and fireflies
 * that wander and blink, reflected in the water below. More fireflies with
 * more usage; new usage lifts a swarm out of the grass. In light mode it is
 * dusk, with golden motes in the low sun.
 */
export function Firefly(p: SceneProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useLive(p)
  const dark = p.dark !== false
  const lastPulse = useRef(0)
  useScene(
    ref,
    p.level,
    live,
    () => {
      let back: HTMLCanvasElement | null = null
      let front: HTMLCanvasElement | null = null
      let sprite: HTMLCanvasElement | null = null
      let flies: { x: number; y: number; vx: number; vy: number; ph: number; per: number; seed: number; front: boolean; life: number }[] = []
      let t = 0
      const RGB = dark ? '217,255,122' : '255,214,120'
      const fly = (w: number, h: number, x?: number, y?: number, swarm = false) => ({
        x: x ?? Math.random() * w,
        y: y ?? h * rand(0.35, 0.85),
        vx: rand(-8, 8),
        vy: swarm ? -rand(25, 55) : rand(-5, 5),
        ph: Math.random() * TAU,
        per: rand(2.2, 5),
        seed: Math.random() * 100,
        front: Math.random() < 0.4,
        life: swarm ? rand(6, 10) : Infinity
      })
      const pine = (g: CanvasRenderingContext2D, x: number, base: number, ht: number) => {
        const n = Math.max(4, Math.round(ht / 45))
        g.beginPath()
        for (let k = 0; k < n; k++) {
          const y0 = base - ht * 0.12 - (k / n) * ht * 0.7
          const wd = ht * 0.24 * (1 - (k / n) * 0.75)
          g.moveTo(x, y0 - ht * 0.28)
          g.lineTo(x - wd, y0)
          g.lineTo(x + wd, y0)
        }
        g.closePath()
        g.fill()
        g.fillRect(x - ht * 0.015, base - ht * 0.14, ht * 0.03, ht * 0.14)
      }
      return {
        init(w, h) {
          sprite = glowSprite(RGB)
          const waterY = h * 0.88
          back = layer(w, h, (g) => {
            const bg = g.createLinearGradient(0, 0, 0, h)
            if (dark) {
              bg.addColorStop(0, '#040b0a')
              bg.addColorStop(0.55, '#0a1a15')
              bg.addColorStop(1, '#10261d')
            } else {
              bg.addColorStop(0, '#f9e7c4')
              bg.addColorStop(0.55, '#f2c48f')
              bg.addColorStop(1, '#e3a576')
            }
            g.fillStyle = bg
            g.fillRect(0, 0, w, h)
            // a low moon (or the setting sun) behind the trees
            const sx = w * 0.32
            const sy = h * 0.42
            const sg = g.createRadialGradient(sx, sy, 0, sx, sy, h * 0.45)
            sg.addColorStop(0, dark ? 'rgba(200,230,210,0.22)' : 'rgba(255,240,200,0.75)')
            sg.addColorStop(1, 'rgba(255,240,200,0)')
            g.fillStyle = sg
            g.fillRect(0, 0, w, h)
            // far trees, pale in the mist
            g.fillStyle = dark ? 'rgba(22,48,38,0.85)' : 'rgba(160,110,80,0.45)'
            for (let x = -20; x < w + 20; x += rand(14, 30)) pine(g, x, h * 0.66 + rand(-6, 6), rand(70, 130))
            g.fillRect(0, h * 0.66, w, h)
            g.fillStyle = dark ? 'rgba(12,30,23,0.95)' : 'rgba(110,80,55,0.6)'
            for (let x = -20; x < w + 20; x += rand(26, 50)) pine(g, x, h * 0.76 + rand(-8, 8), rand(110, 190))
            g.fillRect(0, h * 0.76, w, h)
          })
          front = layer(w, h, (g) => {
            g.fillStyle = dark ? '#030806' : '#3b2c22'
            // tall trees framing the sides
            for (const x of [w * 0.03, w * 0.1, w * 0.92, w * 0.985]) pine(g, x, waterY + 6, rand(h * 0.36, h * 0.52))
            // the bank and the grass
            g.beginPath()
            g.moveTo(0, waterY + 2)
            for (let x = 0; x <= w; x += 6) g.lineTo(x, waterY - 4 - Math.sin(x * 0.02) * 3 - hash(x, 1) * 9)
            g.lineTo(w, waterY + 2)
            g.closePath()
            g.fill()
            const water = g.createLinearGradient(0, waterY, 0, h)
            water.addColorStop(0, dark ? '#06120e' : '#7a5a48')
            water.addColorStop(1, dark ? '#020605' : '#4a3328')
            g.fillStyle = water
            g.fillRect(0, waterY + 2, w, h - waterY)
          })
          flies = Array.from({ length: 30 }, () => fly(w, h))
        },
        draw(ctx, w, h, dt, l) {
          t += dt
          const glow = 0.6 + l.vivid * 0.5
          const waterY = h * 0.88
          if (back) ctx.drawImage(back, 0, 0, w, h)
          // low mist drifting
          for (let i = 0; i < 3; i++) {
            const y = h * (0.62 + i * 0.08)
            const x = ((t * (6 + i * 3) + i * 300) % (w + 600)) - 300
            const mg = ctx.createRadialGradient(x, y, 0, x, y, w * 0.45)
            mg.addColorStop(0, dark ? `rgba(150,190,170,${0.07 * glow})` : `rgba(255,240,220,${0.18 * glow})`)
            mg.addColorStop(1, 'rgba(150,190,170,0)')
            ctx.save()
            ctx.translate(x, y)
            ctx.scale(1, 0.18)
            ctx.translate(-x, -y)
            ctx.fillStyle = mg
            ctx.fillRect(x - w * 0.45, y - w * 0.45, w * 0.9, w * 0.9)
            ctx.restore()
          }
          // keep the count up with usage; new usage lifts a swarm out of the grass
          const want = 22 + l.intensity * 14
          if (flies.filter((f) => f.life === Infinity).length < want && Math.random() < dt * 2) flies.push(fly(w, h))
          if (l.pulseAt > lastPulse.current) {
            lastPulse.current = l.pulseAt
            const x0 = w * rand(0.25, 0.85)
            for (let i = 0; i < 14; i++) flies.push(fly(w, h, x0 + rand(-40, 40), waterY - rand(0, 14), true))
          }
          const drawFly = (f: (typeof flies)[number]) => {
            const b = Math.max(0, Math.sin(t * (TAU / f.per) + f.ph)) ** (dark ? 4 : 2)
            const a = (0.15 + b * 0.85) * glow * Math.min(1, f.life)
            const r = 5 + b * 13
            if (!sprite) return
            ctx.globalAlpha = Math.min(1, a)
            ctx.drawImage(sprite, f.x - r, f.y - r, r * 2, r * 2)
            ctx.globalAlpha = 1
          }
          /** its reflection, drawn over the water */
          const mirror = (f: (typeof flies)[number]) => {
            const ry = 2 * waterY - f.y
            if (!sprite || ry <= waterY || ry >= h) return
            const b = Math.max(0, Math.sin(t * (TAU / f.per) + f.ph)) ** (dark ? 4 : 2)
            const r = 5 + b * 13
            ctx.globalAlpha = Math.min(1, (0.15 + b * 0.85) * glow * Math.min(1, f.life) * 0.35)
            ctx.drawImage(sprite, f.x - r + Math.sin(t * 3 + f.seed) * 2, ry - r * 0.6, r * 2, r * 1.2)
            ctx.globalAlpha = 1
          }
          for (const f of flies) {
            f.vx += (Math.sin(t * 0.7 + f.seed) * 10 - f.vx * 0.5) * dt
            f.vy += (Math.cos(t * 0.53 + f.seed * 1.3) * 8 - f.vy * (f.life === Infinity ? 0.5 : 0.12)) * dt
            f.x += f.vx * dt
            f.y += f.vy * dt
            if (f.y > waterY - 6) f.vy -= 30 * dt
            if (f.y < h * 0.15) f.vy += 20 * dt
            if (f.x < -20) f.x = w + 20
            if (f.x > w + 20) f.x = -20
            if (f.life !== Infinity) f.life -= dt
          }
          flies = flies.filter((f) => f.life > 0)
          for (const f of flies) if (!f.front) drawFly(f)
          if (front) ctx.drawImage(front, 0, 0, w, h)
          for (const f of flies) mirror(f)
          for (const f of flies) if (f.front) drawFly(f)
        }
      }
    },
    1,
    30
  )
  return <canvas ref={ref} className="scene-canvas" />
}
