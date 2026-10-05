import { useRef } from 'react'
import { rand, TAU, useLive, useScene, type SceneProps } from './ThemeScenes'
import { layer } from './ThemeScenes2'

/** a stable pseudo-random number for an integer pair */
const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return s - Math.floor(s)
}

/** a soft round glow in one colour */
function glow(rgb: string, size = 64, core = 0.25): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const r = size / 2
  const gr = g.createRadialGradient(r, r, 0, r, r, r)
  gr.addColorStop(0, `rgba(${rgb},1)`)
  gr.addColorStop(core, `rgba(${rgb},0.55)`)
  gr.addColorStop(1, `rgba(${rgb},0)`)
  g.fillStyle = gr
  g.fillRect(0, 0, size, size)
  return c
}

// ---------------------------------------------------------------- 熔岩灯

/**
 * A lava lamp: warm blobs rise, cool, sink and merge, drawn as a metaball
 * field at a low resolution and scaled up soft. More usage, more heat and
 * faster blobs; new usage sends a big blob surging up from the bottom.
 */
export function LavaLamp(p: SceneProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useLive(p)
  const dark = p.dark !== false
  const lastPulse = useRef(0)
  useScene(
    ref,
    p.level,
    live,
    () => {
      const S = 7
      let small: HTMLCanvasElement | null = null
      let sctx: CanvasRenderingContext2D | null = null
      let img: ImageData | null = null
      let bg: HTMLCanvasElement | null = null
      let blobs: { x: number; r: number; w: number; ph: number; sway: number; sp: number }[] = []
      let surges: { x: number; y: number; r: number; v: number; life: number }[] = []
      let cw = 0
      let ch = 0
      let t = 0
      // colour ramp: bottom hot, top cool
      const HOT = dark ? [255, 110, 50] : [255, 120, 80]
      const COOL = dark ? [255, 40, 130] : [235, 70, 140]
      return {
        init(w, h) {
          cw = Math.max(8, Math.ceil(w / S))
          ch = Math.max(8, Math.ceil(h / S))
          small = document.createElement('canvas')
          small.width = cw
          small.height = ch
          sctx = small.getContext('2d')!
          img = sctx.createImageData(cw, ch)
          bg = layer(w, h, (g) => {
            const gr = g.createLinearGradient(0, 0, 0, h)
            if (dark) {
              gr.addColorStop(0, '#12061a')
              gr.addColorStop(0.6, '#1f0a20')
              gr.addColorStop(1, '#341018')
            } else {
              gr.addColorStop(0, '#fff6ec')
              gr.addColorStop(1, '#ffe2d0')
            }
            g.fillStyle = gr
            g.fillRect(0, 0, w, h)
            // the heat at the bottom of the lamp
            const heat = g.createRadialGradient(w * 0.5, h * 1.05, 0, w * 0.5, h * 1.05, h * 0.7)
            heat.addColorStop(0, dark ? 'rgba(255,120,60,0.35)' : 'rgba(255,150,90,0.35)')
            heat.addColorStop(1, 'rgba(255,120,60,0)')
            g.fillStyle = heat
            g.fillRect(0, 0, w, h)
          })
          blobs = Array.from({ length: 11 }, (_, i) => ({ x: (i + 0.5) / 11, r: rand(0.05, 0.11), w: rand(0.05, 0.11), ph: Math.random() * TAU, sway: Math.random() * TAU, sp: rand(0.6, 1.2) }))
          surges = []
        },
        draw(ctx, w, h, dt, l) {
          t += dt * (0.7 + l.intensity * 0.35)
          if (bg) ctx.drawImage(bg, 0, 0, w, h)
          if (!sctx || !img || !small) return
          if (l.pulseAt > lastPulse.current) {
            lastPulse.current = l.pulseAt
            const big = 0.08 + Math.min(0.08, Math.log10(Math.max(10, l.size)) / 100)
            surges.push({ x: rand(0.25, 0.75), y: 1.15, r: big, v: 0.18, life: 1 })
          }
          // blob centres in field units (0–1 across the short side)
          const m = Math.min(cw, ch)
          const pts: { x: number; y: number; r2: number }[] = blobs.map((b) => {
            const y = 0.5 - 0.46 * Math.sin(t * b.w * b.sp + b.ph)
            return { x: (b.x + 0.06 * Math.sin(t * 0.21 + b.sway)) * cw, y: y * ch, r2: (b.r * m) ** 2 }
          })
          surges = surges.filter((s) => {
            s.y -= s.v * dt
            s.life -= dt * 0.12
            if (s.y < -0.2 || s.life <= 0) return false
            pts.push({ x: s.x * cw, y: s.y * ch, r2: (s.r * m) ** 2 })
            return true
          })
          const d = img.data
          for (let py = 0; py < ch; py++) {
            const k = py / ch
            const cr = COOL[0] + (HOT[0] - COOL[0]) * k
            const cg = COOL[1] + (HOT[1] - COOL[1]) * k
            const cb = COOL[2] + (HOT[2] - COOL[2]) * k
            for (let px = 0; px < cw; px++) {
              let f = 0
              for (let i = 0; i < pts.length; i++) {
                const dx = px - pts[i].x
                const dy = py - pts[i].y
                f += pts[i].r2 / (dx * dx + dy * dy + 1)
              }
              const o = (py * cw + px) * 4
              if (f < 0.6) {
                d[o + 3] = 0
                continue
              }
              const a = Math.min(1, (f - 0.6) / 0.5)
              const core = Math.min(1, Math.max(0, (f - 1.6) / 2))
              d[o] = cr + (255 - cr) * core * 0.6
              d[o + 1] = cg + (230 - cg) * core * 0.5
              d[o + 2] = cb + (200 - cb) * core * 0.4
              d[o + 3] = a * 255 * (0.55 + l.vivid * 0.45)
            }
          }
          sctx.putImageData(img, 0, 0)
          ctx.imageSmoothingEnabled = true
          ctx.imageSmoothingQuality = 'high'
          ctx.drawImage(small, 0, 0, w, h)
          // a soft glow around the blobs: the same field, a little larger
          ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over'
          ctx.globalAlpha = dark ? 0.28 : 0.14
          ctx.drawImage(small, -w * 0.03, -h * 0.03, w * 1.06, h * 1.06)
          ctx.globalAlpha = 1
          ctx.globalCompositeOperation = 'source-over'
        }
      }
    },
    1,
    30
  )
  return <canvas ref={ref} className="scene-canvas" />
}

// ---------------------------------------------------------------- 冰晶

/**
 * Low-poly ice: a field of facets that catch a slowly turning light, with a
 * prism glint here and there. New usage sends a ring of light across the
 * facets; more usage turns the light faster.
 */
export function Crystal(p: SceneProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useLive(p)
  const dark = p.dark !== false
  const lastPulse = useRef(0)
  useScene(
    ref,
    p.level,
    live,
    () => {
      let pts: { x: number; y: number; ph: number }[] = []
      let cols = 0
      let rows = 0
      let rings: { x: number; y: number; t: number }[] = []
      let t = 0
      let light = 0
      return {
        init(w, h) {
          const cell = Math.max(70, Math.min(110, Math.round(Math.min(w, h) / 9)))
          cols = Math.ceil(w / cell) + 3
          rows = Math.ceil(h / cell) + 3
          pts = []
          for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) pts.push({ x: (i - 1 + rand(-0.32, 0.32)) * cell, y: (j - 1 + rand(-0.32, 0.32)) * cell, ph: Math.random() * TAU })
          rings = []
        },
        draw(ctx, w, h, dt, l) {
          t += dt
          light += dt * (0.08 + l.intensity * 0.05)
          if (l.pulseAt > lastPulse.current) {
            lastPulse.current = l.pulseAt
            rings.push({ x: rand(0.2, 0.8) * w, y: rand(0.2, 0.8) * h, t: 0 })
          }
          rings = rings.filter((r) => (r.t += dt) < 3)
          const glowK = 0.6 + l.vivid * 0.5
          const lx = Math.cos(light)
          const ly = Math.sin(light)
          // heights breathe a little: z for the facet normals
          const z = (i: number) => Math.sin(t * 0.4 + pts[i].ph) * 22
          const tri = (a: number, b: number, c: number) => {
            const A = pts[a]
            const B = pts[b]
            const C = pts[c]
            const ux = B.x - A.x
            const uy = B.y - A.y
            const uz = z(b) - z(a)
            const vx = C.x - A.x
            const vy = C.y - A.y
            const vz = z(c) - z(a)
            let nx = uy * vz - uz * vy
            let ny = uz * vx - ux * vz
            let nz = ux * vy - uy * vx
            const len = Math.hypot(nx, ny, nz) || 1
            nx /= len
            ny /= len
            nz /= len
            if (nz < 0) {
              nx = -nx
              ny = -ny
              nz = -nz
            }
            let shade = 0.5 + 0.5 * (nx * lx + ny * ly) + nz * 0.15
            const cx = (A.x + B.x + C.x) / 3
            const cy = (A.y + B.y + C.y) / 3
            for (const r of rings) {
              const dist = Math.hypot(cx - r.x, cy - r.y)
              const front = r.t * 520
              shade += Math.max(0, 1 - Math.abs(dist - front) / 90) * (1 - r.t / 3) * 0.9
            }
            const k = cy / h
            let rr: number
            let gg: number
            let bb: number
            if (dark) {
              rr = 10 + 40 * k + shade * 70
              gg = 30 + 50 * k + shade * 110
              bb = 60 + 50 * k + shade * 140
            } else {
              rr = 200 + shade * 50
              gg = 220 + shade * 32
              bb = 236 + shade * 19
            }
            // a prism glint now and then
            ctx.fillStyle = `rgb(${Math.min(255, rr) | 0},${Math.min(255, gg) | 0},${Math.min(255, bb) | 0})`
            ctx.beginPath()
            ctx.moveTo(A.x, A.y)
            ctx.lineTo(B.x, B.y)
            ctx.lineTo(C.x, C.y)
            ctx.closePath()
            ctx.fill()
            // a prism glint now and then, over the facet's own colour
            if (hash(a, Math.floor(t * 0.5 + a)) > 0.985) {
              ctx.fillStyle = `hsla(${(a * 37 + t * 40) % 360},90%,${dark ? 70 : 78}%,${0.45 * glowK})`
              ctx.fill()
            }
            ctx.stroke()
          }
          ctx.lineWidth = 1
          ctx.strokeStyle = dark ? 'rgba(180,230,255,0.06)' : 'rgba(255,255,255,0.35)'
          for (let j = 0; j < rows - 1; j++) {
            for (let i = 0; i < cols - 1; i++) {
              const a = j * cols + i
              const b = a + 1
              const c = a + cols
              const d = c + 1
              if ((i + j) % 2) {
                tri(a, b, d)
                tri(a, d, c)
              } else {
                tri(a, b, c)
                tri(b, d, c)
              }
            }
          }
          // a frosty vignette
          const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75)
          v.addColorStop(0, 'rgba(0,0,0,0)')
          v.addColorStop(1, dark ? 'rgba(2,6,16,0.55)' : 'rgba(255,255,255,0.35)')
          ctx.fillStyle = v
          ctx.fillRect(0, 0, w, h)
        }
      }
    },
    1,
    30
  )
  return <canvas ref={ref} className="scene-canvas" />
}

// ---------------------------------------------------------------- 数字雨

const GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン0123456789ABCDEF<>{}=+*'

/**
 * Digital rain: columns of glyphs fall, their heads bright, their trails
 * fading; glyphs flicker as they fall. More usage, more and faster columns;
 * new usage lights a burst of columns from the top.
 */
export function DigitalRain(p: SceneProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useLive(p)
  const dark = p.dark !== false
  const lastPulse = useRef(0)
  useScene(
    ref,
    p.level,
    live,
    () => {
      const SIZE = 18
      let atlas: HTMLCanvasElement | null = null
      let heads: HTMLCanvasElement | null = null
      let cols: { y: number; v: number; len: number; on: boolean; glyphs: number[]; hot: number }[] = []
      let t = 0
      const N = GLYPHS.length
      const sprites = (color: string, shadow: string) => {
        const c = document.createElement('canvas')
        const dpr = window.devicePixelRatio || 1
        c.width = Math.ceil(N * SIZE * dpr)
        c.height = Math.ceil(SIZE * dpr)
        const g = c.getContext('2d')!
        g.scale(dpr, dpr)
        g.font = `600 ${SIZE - 3}px 'Cascadia Code', 'MS Gothic', Consolas, monospace`
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillStyle = color
        g.shadowColor = shadow
        g.shadowBlur = 6
        for (let i = 0; i < N; i++) g.fillText(GLYPHS[i], i * SIZE + SIZE / 2, SIZE / 2 + 1)
        return c
      }
      return {
        init(w, h) {
          atlas = sprites(dark ? '#3dff7a' : '#127a3a', dark ? 'rgba(61,255,122,0.8)' : 'rgba(18,122,58,0.4)')
          heads = sprites(dark ? '#eaffef' : '#0b3d1c', dark ? 'rgba(200,255,220,1)' : 'rgba(10,60,28,0.4)')
          const n = Math.ceil(w / SIZE)
          cols = Array.from({ length: n }, () => ({ y: rand(-h, h), v: rand(60, 160), len: Math.round(rand(8, 26)), on: Math.random() < 0.55, glyphs: Array.from({ length: 40 }, () => Math.floor(Math.random() * N)), hot: 0 }))
        },
        draw(ctx, w, h, dt, l) {
          t += dt
          const dpr = window.devicePixelRatio || 1
          ctx.fillStyle = dark ? '#020a05' : '#eef8f0'
          ctx.fillRect(0, 0, w, h)
          if (l.pulseAt > lastPulse.current) {
            lastPulse.current = l.pulseAt
            const start = Math.floor(Math.random() * cols.length)
            const n = 4 + Math.min(10, Math.round(Math.log10(Math.max(10, l.size))))
            for (let i = 0; i < n; i++) {
              const c = cols[(start + i * 3) % cols.length]
              c.on = true
              c.y = -rand(0, 120)
              c.v = rand(240, 360)
              c.hot = 1
            }
          }
          const want = 0.45 + l.intensity * 0.15
          const speed = 1 + l.intensity * 0.35
          // on a light page the rain stays in the background
          const glowK = Math.min(1, 0.55 + l.vivid * 0.5) * (dark ? 1 : 0.55)
          if (!atlas || !heads) return
          const sw = SIZE * dpr
          for (let ci = 0; ci < cols.length; ci++) {
            const c = cols[ci]
            if (!c.on) {
              if (Math.random() < dt * want * 0.3) {
                c.on = true
                c.y = -rand(0, 200)
                c.v = rand(60, 160)
                c.len = Math.round(rand(8, 26))
              }
              continue
            }
            c.y += c.v * speed * dt
            c.hot = Math.max(0, c.hot - dt * 0.4)
            // glyphs flicker as they fall
            if (Math.random() < dt * 6) c.glyphs[Math.floor(Math.random() * c.glyphs.length)] = Math.floor(Math.random() * N)
            const x = ci * SIZE
            const headRow = Math.floor(c.y / SIZE)
            for (let k = 0; k < c.len; k++) {
              const row = headRow - k
              const y = row * SIZE
              if (y < -SIZE || y > h) continue
              const g = c.glyphs[(row % 40 + 40) % 40]
              const a = k === 0 ? 1 : (1 - k / c.len) * (0.85 + c.hot * 0.15)
              ctx.globalAlpha = Math.max(0, a) * glowK
              ctx.drawImage(k === 0 ? heads : atlas, g * sw, 0, sw, sw, x, y, SIZE, SIZE)
            }
            if ((headRow - c.len) * SIZE > h) c.on = Math.random() < want
            if (!c.on) c.y = -rand(0, 200)
          }
          ctx.globalAlpha = 1
          // a faint scan line drifting down
          const sy = (t * 60) % (h + 200) - 100
          const sg = ctx.createLinearGradient(0, sy - 60, 0, sy)
          sg.addColorStop(0, 'rgba(61,255,122,0)')
          sg.addColorStop(1, dark ? 'rgba(61,255,122,0.06)' : 'rgba(18,122,58,0.05)')
          ctx.fillStyle = sg
          ctx.fillRect(0, sy - 60, w, 60)
        }
      }
    },
    1,
    30
  )
  return <canvas ref={ref} className="scene-canvas" />
}

// ---------------------------------------------------------------- 烟花

type Spark = { x: number; y: number; vx: number; vy: number; life: number; max: number; rgb: string; trail: number }

/**
 * A night city and fireworks over it: shells rise and burst into coloured
 * sparks that fall and fade. More usage, more shells; each batch of new
 * usage launches a firework sized by how many tokens it brought.
 */
export function Fireworks(p: SceneProps) {
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
      let city: HTMLCanvasElement | null = null
      let windows: { x: number; y: number; w: number; ph: number }[] = []
      let shells: { x: number; y: number; vy: number; ty: number; rgb: string; big: number }[] = []
      let sparks: Spark[] = []
      let acc = 0
      let t = 0
      const COLORS = ['255,90,120', '255,190,80', '120,200,255', '180,120,255', '120,255,170', '255,240,200', '255,120,60']
      return {
        init(w, h) {
          sky = layer(w, h, (g) => {
            const gr = g.createLinearGradient(0, 0, 0, h)
            if (dark) {
              gr.addColorStop(0, '#04061a')
              gr.addColorStop(0.7, '#0d1236')
              gr.addColorStop(1, '#2a1838')
            } else {
              gr.addColorStop(0, '#3a3f7a')
              gr.addColorStop(0.6, '#8c6f9e')
              gr.addColorStop(1, '#f2a988')
            }
            g.fillStyle = gr
            g.fillRect(0, 0, w, h)
            for (let i = 0; i < (w * h) / 6000; i++) {
              g.globalAlpha = rand(0.15, dark ? 0.7 : 0.3)
              g.fillStyle = '#fff'
              g.fillRect(Math.random() * w, Math.random() * h * 0.6, 1.2, 1.2)
            }
            g.globalAlpha = 1
          })
          windows = []
          city = layer(w, h, (g) => {
            g.fillStyle = dark ? '#05060f' : '#2a2340'
            let x = 0
            while (x < w) {
              const bw = rand(30, 90)
              const bh = h * rand(0.06, 0.22) * (Math.abs(x / w - 0.55) < 0.2 ? 1.4 : 1)
              g.fillRect(x, h - bh, bw - 2, bh)
              for (let wy = h - bh + 8; wy < h - 6; wy += 9) for (let wx = x + 5; wx < x + bw - 8; wx += 8) if (Math.random() < 0.28) windows.push({ x: wx, y: wy, w: 3, ph: Math.random() * TAU })
              x += bw
            }
          })
          shells = []
          sparks = []
        },
        draw(ctx, w, h, dt, l) {
          t += dt
          if (sky) ctx.drawImage(sky, 0, 0, w, h)
          const launch = (big: number) => shells.push({ x: w * rand(0.15, 0.85), y: h, vy: -rand(520, 680) * (0.9 + big * 0.1), ty: h * rand(0.12, 0.42), rgb: COLORS[Math.floor(Math.random() * COLORS.length)], big })
          acc += dt * (0.18 + l.intensity * 0.35)
          if (acc > 1) {
            acc = 0
            launch(1)
          }
          if (l.pulseAt > lastPulse.current) {
            lastPulse.current = l.pulseAt
            const big = 1 + Math.min(2, Math.max(0, Math.log10(Math.max(1, l.size)) - 4))
            launch(big)
            if (big > 2) launch(big * 0.7)
          }
          ctx.globalCompositeOperation = 'lighter'
          shells = shells.filter((s) => {
            s.y += s.vy * dt
            s.vy += 260 * dt
            ctx.strokeStyle = `rgba(${s.rgb},0.8)`
            ctx.lineWidth = 1.6
            ctx.beginPath()
            ctx.moveTo(s.x, s.y)
            ctx.lineTo(s.x + rand(-1, 1), s.y + 16)
            ctx.stroke()
            if (s.y > s.ty && s.vy < 0) return true
            // burst
            const n = Math.round(60 * s.big + rand(0, 30))
            const willow = Math.random() < 0.3
            for (let i = 0; i < n && sparks.length < 1400; i++) {
              const a = (i / n) * TAU + rand(-0.05, 0.05)
              const sp = rand(80, 210) * Math.sqrt(s.big)
              sparks.push({ x: s.x, y: s.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: willow ? rand(2.2, 3.2) : rand(1.2, 2), rgb: Math.random() < 0.15 ? '255,255,240' : s.rgb, trail: willow ? 0.12 : 0.05 })
            }
            return false
          })
          const glowK = 0.6 + l.vivid * 0.5
          sparks = sparks.filter((s) => {
            s.life += dt
            if (s.life >= s.max) return false
            s.vx *= 1 - 1.4 * dt
            s.vy = s.vy * (1 - 1.4 * dt) + 70 * dt
            s.x += s.vx * dt
            s.y += s.vy * dt
            const k = 1 - s.life / s.max
            const flick = s.life > s.max * 0.6 ? (Math.random() < 0.5 ? 0.4 : 1) : 1
            ctx.strokeStyle = `rgba(${s.rgb},${(k * 0.9 * glowK * flick).toFixed(3)})`
            ctx.lineWidth = 1.6
            ctx.beginPath()
            ctx.moveTo(s.x, s.y)
            ctx.lineTo(s.x - s.vx * s.trail, s.y - s.vy * s.trail)
            ctx.stroke()
            return true
          })
          ctx.globalCompositeOperation = 'source-over'
          // the city, its windows, and the glow of the show on the rooftops
          if (city) ctx.drawImage(city, 0, 0, w, h)
          const lit = Math.min(1, sparks.length / 600)
          if (lit > 0) {
            const gl = ctx.createLinearGradient(0, h * 0.7, 0, h)
            gl.addColorStop(0, 'rgba(255,170,120,0)')
            gl.addColorStop(1, `rgba(255,170,120,${0.12 * lit})`)
            ctx.fillStyle = gl
            ctx.fillRect(0, h * 0.7, w, h * 0.3)
          }
          for (const win of windows) {
            const a = 0.45 + 0.4 * Math.sin(t * 0.3 + win.ph)
            ctx.fillStyle = `rgba(255,214,140,${a})`
            ctx.fillRect(win.x, win.y, win.w, 4)
          }
        }
      }
    },
    1,
    30
  )
  return <canvas ref={ref} className="scene-canvas" />
}

// ---------------------------------------------------------------- 天灯

/**
 * Sky lanterns over a still lake: warm paper lanterns drift upward, swaying,
 * their flames flickering, mirrored in the water. More usage, more lanterns;
 * new usage releases a handful from the shore.
 */
export function Lanterns(p: SceneProps) {
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
      let halo: HTMLCanvasElement | null = null
      let list: { x: number; y: number; z: number; v: number; ph: number; f: number }[] = []
      let t = 0
      let W = 0
      let H = 0
      const make = (fromShore: boolean) => {
        const z = fromShore ? rand(0.7, 1) : Math.random() ** 1.6 * 0.9 + 0.1
        return { x: rand(0.04, 0.96) * W, y: fromShore ? H * 0.78 : rand(0.05, 0.75) * H, z, v: rand(10, 22) * (0.5 + z), ph: Math.random() * TAU, f: Math.random() * TAU }
      }
      return {
        init(w, h) {
          W = w
          H = h
          halo = glow('255,170,80', 64, 0.18)
          const lake = h * 0.8
          back = layer(w, h, (g) => {
            const gr = g.createLinearGradient(0, 0, 0, lake)
            if (dark) {
              gr.addColorStop(0, '#060a1f')
              gr.addColorStop(0.7, '#141a3c')
              gr.addColorStop(1, '#2b2346')
            } else {
              gr.addColorStop(0, '#3c3a6e')
              gr.addColorStop(0.6, '#a5708a')
              gr.addColorStop(1, '#f2a678')
            }
            g.fillStyle = gr
            g.fillRect(0, 0, w, lake)
            for (let i = 0; i < (w * h) / 5000; i++) {
              g.globalAlpha = rand(0.1, dark ? 0.6 : 0.25)
              g.fillStyle = '#fff'
              g.fillRect(Math.random() * w, Math.random() * lake * 0.7, 1.1, 1.1)
            }
            g.globalAlpha = 1
            // far hills
            g.fillStyle = dark ? '#0c0f24' : '#5a3f5e'
            g.beginPath()
            g.moveTo(0, lake)
            for (let x = 0; x <= w; x += 12) g.lineTo(x, lake - 30 - Math.sin(x * 0.005) * 22 - Math.sin(x * 0.013 + 2) * 10)
            g.lineTo(w, lake)
            g.closePath()
            g.fill()
            const water = g.createLinearGradient(0, lake, 0, h)
            water.addColorStop(0, dark ? '#141936' : '#7c5c78')
            water.addColorStop(1, dark ? '#05060f' : '#3a2a40')
            g.fillStyle = water
            g.fillRect(0, lake, w, h - lake)
          })
          list = Array.from({ length: 22 }, () => make(false))
        },
        draw(ctx, w, h, dt, l) {
          t += dt
          const lake = h * 0.8
          if (back) ctx.drawImage(back, 0, 0, w, h)
          if (l.pulseAt > lastPulse.current) {
            lastPulse.current = l.pulseAt
            const n = 3 + Math.min(4, Math.round(Math.log10(Math.max(10, l.size)) - 2))
            for (let i = 0; i < n; i++) list.push(make(true))
          }
          const want = 18 + l.intensity * 8
          if (list.length < want && Math.random() < dt * 0.8) list.push({ ...make(false), y: lake - 10 })
          const glowK = 0.6 + l.vivid * 0.5
          list.sort((a, b) => a.z - b.z)
          list = list.filter((n) => {
            n.y -= n.v * dt
            n.x += Math.sin(t * 0.5 + n.ph) * 6 * dt * n.z
            if (n.y < -40) {
              // gone into the sky: start again at the shore while the sky wants this many
              if (list.length > want) return false
              n.y = lake - 6
              n.x = rand(0.05, 0.95) * w
            }
            const s = 5 + n.z * 13
            const flick = 0.82 + 0.18 * Math.sin(t * 9 + n.f) * Math.sin(t * 5.3 + n.ph)
            const fade = Math.min(1, n.y / (h * 0.12)) * (0.35 + n.z * 0.65)
            if (halo) {
              ctx.globalAlpha = Math.min(1, 0.55 * flick * fade * glowK)
              ctx.drawImage(halo, n.x - s * 3, n.y - s * 3, s * 6, s * 6)
            }
            // the paper body: a rounded trapezoid, lit from inside
            const gr = ctx.createLinearGradient(0, n.y - s, 0, n.y + s)
            gr.addColorStop(0, `rgba(255,${Math.round(150 + 40 * flick)},90,${0.95 * fade})`)
            gr.addColorStop(1, `rgba(255,230,170,${fade})`)
            ctx.globalAlpha = 1
            ctx.fillStyle = gr
            ctx.beginPath()
            ctx.moveTo(n.x - s * 0.55, n.y - s)
            ctx.lineTo(n.x + s * 0.55, n.y - s)
            ctx.quadraticCurveTo(n.x + s * 0.8, n.y, n.x + s * 0.45, n.y + s)
            ctx.lineTo(n.x - s * 0.45, n.y + s)
            ctx.quadraticCurveTo(n.x - s * 0.8, n.y, n.x - s * 0.55, n.y - s)
            ctx.fill()
            // its reflection in the lake
            const ry = 2 * lake - n.y
            if (ry > lake && ry < h && halo) {
              ctx.globalAlpha = Math.min(1, 0.22 * fade * flick)
              ctx.drawImage(halo, n.x - s * 2 + Math.sin(t * 2 + n.ph) * 3, ry - s * 1.2, s * 4, s * 2.4)
            }
            ctx.globalAlpha = 1
            return true
          })
          // ripples on the water
          ctx.strokeStyle = dark ? 'rgba(255,200,140,0.06)' : 'rgba(255,230,200,0.12)'
          ctx.lineWidth = 1
          for (let i = 0; i < 26; i++) {
            const y = lake + 4 + hash(i, 1) * (h - lake - 8)
            const x = (hash(i, 2) * w + t * (8 + i)) % (w + 80) - 40
            ctx.beginPath()
            ctx.moveTo(x, y)
            ctx.lineTo(x + 20 + hash(i, 3) * 40, y)
            ctx.stroke()
          }
        }
      }
    },
    1,
    30
  )
  return <canvas ref={ref} className="scene-canvas" />
}

// ---------------------------------------------------------------- 包豪斯

type Module = { kind: number; color: string; rot: number; target: number; next: number; pop: number }

/**
 * Bauhaus: a grid of flat geometric modules in red, blue, yellow and black
 * on paper; each one snaps a quarter turn now and then. More usage, more
 * often; new usage makes a few modules pop.
 */
export function Bauhaus(p: SceneProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useLive(p)
  const dark = p.dark !== false
  const lastPulse = useRef(0)
  useScene(
    ref,
    p.level,
    live,
    () => {
      let mods: Module[] = []
      let cols = 0
      let rows = 0
      let cell = 0
      let paper: HTMLCanvasElement | null = null
      let t = 0
      const PALETTE = dark ? ['#e0533f', '#3d6fd1', '#f2b632', '#e9e2d0', '#e0533f'] : ['#d6402e', '#1f4e9c', '#f2b632', '#1a1a1a', '#d6402e']
      const ease = (x: number) => 1 - (1 - x) ** 3
      return {
        init(w, h) {
          cell = Math.max(120, Math.min(190, Math.round(Math.min(w, h) / 4.6)))
          cols = Math.ceil(w / cell)
          rows = Math.ceil(h / cell)
          mods = Array.from({ length: cols * rows }, (_, i) => {
            const empty = hash(i, 9) < 0.28
            return { kind: empty ? -1 : Math.floor(hash(i, 3) * 6), color: PALETTE[Math.floor(hash(i, 5) * PALETTE.length)], rot: Math.floor(hash(i, 7) * 4) * 90, target: 0, next: rand(1, 8), pop: 0 }
          })
          mods.forEach((m) => (m.target = m.rot))
          paper = layer(w, h, (g) => {
            g.fillStyle = dark ? '#1c1b1f' : '#f4efe4'
            g.fillRect(0, 0, w, h)
            const img = g.getImageData(0, 0, Math.min(w, 2048), Math.min(h, 2048))
            for (let i = 0; i < img.data.length; i += 4) {
              const n = (Math.random() - 0.5) * (dark ? 10 : 14)
              img.data[i] += n
              img.data[i + 1] += n
              img.data[i + 2] += n
            }
            g.putImageData(img, 0, 0)
          })
        },
        draw(ctx, w, h, dt, l) {
          t += dt
          if (paper) ctx.drawImage(paper, 0, 0, w, h)
          if (l.pulseAt > lastPulse.current) {
            lastPulse.current = l.pulseAt
            for (let i = 0; i < 4; i++) {
              const m = mods[Math.floor(Math.random() * mods.length)]
              if (m.kind < 0) m.kind = Math.floor(Math.random() * 6)
              m.pop = 1
              m.target += 90
            }
          }
          const rate = 1 + l.intensity * 0.6
          const alpha = dark ? 0.5 : 0.62
          for (let j = 0; j < rows; j++) {
            for (let i = 0; i < cols; i++) {
              const m = mods[j * cols + i]
              m.next -= dt * rate
              if (m.next <= 0) {
                m.target += Math.random() < 0.5 ? 90 : -90
                m.next = rand(4, 11)
              }
              m.rot += (m.target - m.rot) * Math.min(1, dt * 4)
              m.pop = Math.max(0, m.pop - dt * 1.5)
              if (m.kind < 0) continue
              const cx = i * cell + cell / 2
              const cy = j * cell + cell / 2
              const s = cell * 0.42 * (1 + ease(m.pop) * 0.12 * Math.sin(m.pop * Math.PI))
              ctx.save()
              ctx.translate(cx, cy)
              ctx.rotate((m.rot * Math.PI) / 180)
              ctx.globalAlpha = alpha * (0.55 + l.vivid * 0.45)
              ctx.fillStyle = m.color
              ctx.strokeStyle = m.color
              ctx.beginPath()
              switch (m.kind) {
                case 0: // a circle
                  ctx.arc(0, 0, s * 0.82, 0, TAU)
                  ctx.fill()
                  break
                case 1: // a half circle
                  ctx.arc(0, s, s * 1.0, Math.PI, TAU)
                  ctx.fill()
                  break
                case 2: // a quarter circle
                  ctx.moveTo(-s, s)
                  ctx.arc(-s, s, s * 2, -Math.PI / 2, 0)
                  ctx.closePath()
                  ctx.fill()
                  break
                case 3: // a triangle
                  ctx.moveTo(-s, s)
                  ctx.lineTo(s, s)
                  ctx.lineTo(-s, -s)
                  ctx.closePath()
                  ctx.fill()
                  break
                case 4: // bars
                  for (let k = 0; k < 3; k++) ctx.fillRect(-s, -s + k * s * 0.72, s * 2, s * 0.36)
                  break
                default: // a ring
                  ctx.lineWidth = s * 0.3
                  ctx.arc(0, 0, s * 0.68, 0, TAU)
                  ctx.stroke()
              }
              ctx.restore()
            }
          }
          ctx.globalAlpha = 1
        }
      }
    },
    1,
    30
  )
  return <canvas ref={ref} className="scene-canvas" />
}

