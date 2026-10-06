import { useRef } from 'react'
import { fmtTokens } from '@shared/format'
import { rand, TAU, useLive, useScene, type SceneProps } from './ThemeScenes'
import { layer } from './ThemeScenes2'
import { clamp, gapX, glow, hash, SIDEBAR, smoothstep } from './sceneKit'

// ---------------------------------------------------------------- 锦鲤池

interface KoiLook {
  base: string
  fin: string
  spots: { c: string; n: number; r: [number, number] }[]
  /** a single red mark on the head (tancho) */
  crown?: string
  sheen?: number
}
const LOOKS: KoiLook[] = [
  // kohaku, sanke, showa, ogon, tancho, asagi, yamabuki, chagoi
  { base: '#f6f1e7', fin: 'rgba(246,241,231,0.55)', spots: [{ c: '#e2412c', n: 3, r: [0.55, 0.95] }] },
  { base: '#f6f1e7', fin: 'rgba(246,241,231,0.55)', spots: [{ c: '#e2412c', n: 3, r: [0.5, 0.85] }, { c: '#1d1a1a', n: 5, r: [0.18, 0.32] }] },
  { base: '#1b1819', fin: 'rgba(40,36,36,0.6)', spots: [{ c: '#e0402e', n: 3, r: [0.55, 0.9] }, { c: '#f3eee4', n: 2, r: [0.35, 0.55] }] },
  { base: '#f2b53c', fin: 'rgba(250,210,120,0.55)', spots: [], sheen: 0.35 },
  { base: '#f6f1e7', fin: 'rgba(246,241,231,0.55)', spots: [], crown: '#e2412c' },
  { base: '#7d96ab', fin: 'rgba(160,180,196,0.5)', spots: [{ c: '#e8823e', n: 4, r: [0.3, 0.5] }] },
  { base: '#f7d556', fin: 'rgba(250,226,140,0.55)', spots: [], sheen: 0.25 },
  { base: '#a3794e', fin: 'rgba(180,140,100,0.5)', spots: [] }
]
const GOLDEN: KoiLook = { base: '#ffcf3a', fin: 'rgba(255,220,120,0.65)', spots: [{ c: '#ff9f1c', n: 2, r: [0.4, 0.6] }], sheen: 0.6 }
/** body width along the spine, head to tail */
const PROFILE = [0.62, 0.88, 1, 0.98, 0.92, 0.82, 0.7, 0.56, 0.42, 0.3, 0.2, 0.14]
const SEGS = PROFILE.length

interface Koi {
  x: number
  y: number
  a: number
  len: number
  look: KoiLook
  spine: [number, number][]
  tx: number
  ty: number
  retarget: number
  ph: number
  spots: { u: number; v: number; r: number; c: string }[]
  golden: boolean
  age: number
  leaving: boolean
}

function lilyPad(r: number, seed: number, flower: string | null): HTMLCanvasElement {
  const S = Math.ceil(r * 2 + 8)
  return layer(S, S, (g) => {
    g.translate(S / 2, S / 2)
    g.rotate(seed * 2.3)
    const notch = 0.2
    const path = new Path2D()
    path.moveTo(0, 0)
    path.arc(0, 0, r, notch, TAU - notch)
    path.closePath()
    const gr = g.createRadialGradient(-r * 0.2, -r * 0.2, 0, 0, 0, r)
    gr.addColorStop(0, '#6cbb5c')
    gr.addColorStop(0.7, '#3f8a3a')
    gr.addColorStop(1, '#2c6a2b')
    g.fillStyle = gr
    g.fill(path)
    g.strokeStyle = 'rgba(30,80,30,0.8)'
    g.lineWidth = 1.2
    g.stroke(path)
    g.strokeStyle = 'rgba(210,255,190,0.2)'
    g.lineWidth = 0.8
    for (let k = 0; k < 11; k++) {
      const a = notch + 0.2 + (k / 11) * (TAU - notch * 2 - 0.4)
      g.beginPath()
      g.moveTo(0, 0)
      g.quadraticCurveTo(Math.cos(a + 0.1) * r * 0.5, Math.sin(a + 0.1) * r * 0.5, Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92)
      g.stroke()
    }
    if (!flower) return
    g.rotate(-seed * 2.3)
    // a lotus: two rings of petals around a yellow heart
    const petal = (len: number, wid: number, a: number, fill: string | CanvasGradient) => {
      g.save()
      g.rotate(a)
      g.fillStyle = fill
      g.beginPath()
      g.moveTo(0, 0)
      g.quadraticCurveTo(wid, -len * 0.5, 0, -len)
      g.quadraticCurveTo(-wid, -len * 0.5, 0, 0)
      g.fill()
      g.restore()
    }
    const pr = r * 0.62
    const outer = g.createLinearGradient(0, -pr, 0, 0)
    outer.addColorStop(0, flower)
    outer.addColorStop(1, '#fff3f6')
    for (let k = 0; k < 10; k++) petal(pr, pr * 0.32, (k / 10) * TAU, outer)
    for (let k = 0; k < 7; k++) petal(pr * 0.66, pr * 0.26, (k / 7) * TAU + 0.3, '#ffe3ec')
    g.fillStyle = '#ffd34d'
    g.beginPath()
    g.arc(0, 0, pr * 0.2, 0, TAU)
    g.fill()
    g.fillStyle = '#c99a1a'
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU
      g.fillRect(Math.cos(a) * pr * 0.1 - 0.6, Math.sin(a) * pr * 0.1 - 0.6, 1.2, 1.2)
    }
  })
}

/** a tile of bright caustic lines: the borders between the cells of random points, seamless */
function causticTile(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const img = g.createImageData(size, size)
  const pts = Array.from({ length: 22 }, () => [Math.random() * size, Math.random() * size])
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let d1 = 1e9
      let d2 = 1e9
      for (const [px, py] of pts) {
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const dx = x - (px + ox * size)
            const dy = y - (py + oy * size)
            const d = dx * dx + dy * dy
            if (d < d1) {
              d2 = d1
              d1 = d
            } else if (d < d2) d2 = d
          }
        }
      }
      const e = Math.sqrt(d2) - Math.sqrt(d1)
      const v = Math.max(0, 1 - e / 5) ** 2
      const k = (y * size + x) * 4
      img.data[k] = 220
      img.data[k + 1] = 255
      img.data[k + 2] = 245
      img.data[k + 3] = v * 255
    }
  }
  g.putImageData(img, 0, 0)
  return c
}

/**
 * 锦鲤池: a koi pond seen from above. Koi of eight varieties swim with
 * swaying bodies and fins over a pebbled floor under moving caustics, lily
 * pads and lotus drift, petals float, rain rings the surface now and then.
 * Each batch of new usage scatters food and the koi rush over to it; a big
 * batch brings a golden koi for a while. More usage, livelier fish.
 */
export function KoiPond(p: SceneProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useLive(p)
  const dark = p.dark !== false
  const lastPulse = useRef(0)
  useScene(
    ref,
    p.level,
    live,
    () => {
      let W = 0
      let H = 0
      let floor: HTMLCanvasElement | null = null
      let rim: HTMLCanvasElement | null = null
      let caustic: CanvasPattern | null = null
      let sparkle: HTMLCanvasElement | null = null
      let fish: Koi[] = []
      let pads: { c: HTMLCanvasElement; x: number; y: number; r: number; rot: number; spin: number; vx: number; vy: number; ph: number }[] = []
      let petals: { x: number; y: number; rot: number; spin: number; vx: number; vy: number; s: number; c: string }[] = []
      let ripples: { x: number; y: number; k: number; max: number; strong: boolean }[] = []
      let food: { x: number; y: number; life: number }[] = []
      let t = 0
      let nextDrop = 2

      /** somewhere the koi like to go: often under the header and the sidebar, where they can be seen */
      const spot = (): [number, number] => {
        const r = Math.random()
        if (r < 0.3) return [rand(0.3, 0.95) * W, rand(0.03, 0.2) * H]
        if (r < 0.5) return [rand(0.01, 0.16) * W, rand(0.1, 0.9) * H]
        return [rand(0.05, 0.95) * W, rand(0.05, 0.95) * H]
      }
      const newKoi = (golden = false, fromEdge = false): Koi => {
        const look = golden ? GOLDEN : LOOKS[Math.floor(Math.random() * LOOKS.length)]
        const len = golden ? rand(110, 130) : rand(70, 118)
        let [x, y] = spot()
        if (fromEdge) [x, y] = Math.random() < 0.5 ? [Math.random() < 0.5 ? -len : W + len, rand(0.1, 0.9) * H] : [rand(0.1, 0.9) * W, Math.random() < 0.5 ? -len : H + len]
        const a = Math.random() * TAU
        const spots: Koi['spots'] = []
        look.spots.forEach((s, si) => {
          for (let k = 0; k < s.n; k++) spots.push({ u: rand(0.08, 0.78), v: rand(-0.55, 0.55), r: rand(s.r[0], s.r[1]), c: look.spots[si].c })
        })
        const [tx, ty] = spot()
        return { x, y, a, len, look, spine: Array.from({ length: SEGS }, (_, i) => [x - Math.cos(a) * i * (len / SEGS), y - Math.sin(a) * i * (len / SEGS)]), tx, ty, retarget: rand(4, 9), ph: Math.random() * TAU, spots, golden, age: 0, leaving: false }
      }

      const drawKoi = (ctx: CanvasRenderingContext2D, f: Koi, speed: number) => {
        const n = SEGS
        const maxW = f.len * 0.12
        const amp = f.len * 0.05 * (0.6 + speed * 0.4)
        // the spine swayed sideways by a travelling wave
        const P: [number, number][] = []
        const T: [number, number][] = []
        for (let i = 0; i < n; i++) {
          const a = f.spine[Math.max(0, i - 1)]
          const b = f.spine[Math.min(n - 1, i + 1)]
          let tx = a[0] - b[0]
          let ty = a[1] - b[1]
          const d = Math.hypot(tx, ty) || 1
          tx /= d
          ty /= d
          T.push([tx, ty])
          const off = Math.sin(f.ph - i * 0.55) * amp * (i / n) ** 1.3
          P.push([f.spine[i][0] - ty * off, f.spine[i][1] + tx * off])
        }
        const L: [number, number][] = []
        const R: [number, number][] = []
        for (let i = 0; i < n; i++) {
          const w = PROFILE[i] * maxW
          L.push([P[i][0] - T[i][1] * w, P[i][1] + T[i][0] * w])
          R.push([P[i][0] + T[i][1] * w, P[i][1] - T[i][0] * w])
        }
        const body = new Path2D()
        const nose: [number, number] = [P[0][0] + T[0][0] * maxW * 0.95, P[0][1] + T[0][1] * maxW * 0.95]
        body.moveTo(R[0][0], R[0][1])
        body.quadraticCurveTo(nose[0] + T[0][1] * maxW * 0.5, nose[1] - T[0][0] * maxW * 0.5, nose[0], nose[1])
        body.quadraticCurveTo(nose[0] - T[0][1] * maxW * 0.5, nose[1] + T[0][0] * maxW * 0.5, L[0][0], L[0][1])
        for (let i = 1; i < n; i++) body.quadraticCurveTo(L[i - 1][0], L[i - 1][1], (L[i - 1][0] + L[i][0]) / 2, (L[i - 1][1] + L[i][1]) / 2)
        body.lineTo(L[n - 1][0], L[n - 1][1])
        body.lineTo(R[n - 1][0], R[n - 1][1])
        for (let i = n - 1; i > 0; i--) body.quadraticCurveTo(R[i][0], R[i][1], (R[i - 1][0] + R[i][0]) / 2, (R[i - 1][1] + R[i][1]) / 2)
        body.closePath()
        // the tail: a fan swinging with the wave
        const [ex, ey] = P[n - 1]
        const [etx, ety] = T[n - 1]
        const wag = Math.sin(f.ph - n * 0.55) * 0.5
        const tl = f.len * 0.26
        const tail = new Path2D()
        tail.moveTo(P[n - 3][0], P[n - 3][1])
        const tip = (side: number): [number, number] => [ex - etx * tl + -ety * side * tl * (0.55 + wag * side * 0.4), ey - ety * tl + etx * side * tl * (0.55 + wag * side * 0.4)]
        const [l1x, l1y] = tip(1)
        const [l2x, l2y] = tip(-1)
        tail.quadraticCurveTo(ex - ety * tl * 0.3, ey + etx * tl * 0.3, l1x, l1y)
        tail.quadraticCurveTo(ex - etx * tl * 0.55, ey - ety * tl * 0.55, l2x, l2y)
        tail.quadraticCurveTo(ex + ety * tl * 0.3, ey - etx * tl * 0.3, P[n - 3][0], P[n - 3][1])
        // shadow on the floor
        ctx.save()
        ctx.translate(f.len * 0.08, f.len * 0.11)
        ctx.fillStyle = dark ? 'rgba(0,10,10,0.35)' : 'rgba(10,50,45,0.22)'
        ctx.fill(body)
        ctx.fill(tail)
        ctx.restore()
        // pectoral fins
        ctx.fillStyle = f.look.fin
        const flap = Math.sin(f.ph * 0.8) * 0.35
        for (const side of [1, -1]) {
          const i = 2
          const w = PROFILE[i] * maxW
          const bx = P[i][0] + -T[i][1] * w * side * 0.9
          const by = P[i][1] + T[i][0] * w * side * 0.9
          const ang = Math.atan2(T[i][1], T[i][0]) + side * (2.2 + flap)
          ctx.beginPath()
          ctx.ellipse(bx + Math.cos(ang) * f.len * 0.06, by + Math.sin(ang) * f.len * 0.06, f.len * 0.085, f.len * 0.04, ang, 0, TAU)
          ctx.fill()
        }
        ctx.fill(tail)
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'
        ctx.lineWidth = 0.6
        ctx.stroke(tail)
        // the body and its pattern
        ctx.fillStyle = f.look.base
        ctx.fill(body)
        ctx.save()
        ctx.clip(body)
        for (const s of f.spots) {
          const k = s.u * (n - 1)
          const i = Math.floor(k)
          const fr = k - i
          const j = Math.min(n - 1, i + 1)
          const x = P[i][0] + (P[j][0] - P[i][0]) * fr
          const y = P[i][1] + (P[j][1] - P[i][1]) * fr
          const w = PROFILE[i] * maxW
          ctx.fillStyle = s.c
          ctx.beginPath()
          ctx.arc(x - T[i][1] * w * s.v, y + T[i][0] * w * s.v, s.r * maxW, 0, TAU)
          ctx.fill()
        }
        if (f.look.crown) {
          ctx.fillStyle = f.look.crown
          ctx.beginPath()
          ctx.arc(P[0][0] + T[0][0] * maxW * 0.1, P[0][1] + T[0][1] * maxW * 0.1, maxW * 0.5, 0, TAU)
          ctx.fill()
        }
        // light along the back, darker flanks
        ctx.strokeStyle = `rgba(255,255,255,${(0.16 + (f.look.sheen ?? 0) * 0.4).toFixed(2)})`
        ctx.lineWidth = maxW * 0.5
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(P[1][0], P[1][1])
        for (let i = 2; i < n - 2; i++) ctx.lineTo(P[i][0], P[i][1])
        ctx.stroke()
        ctx.restore()
        ctx.strokeStyle = 'rgba(0,0,0,0.15)'
        ctx.lineWidth = 0.8
        ctx.stroke(body)
        // eyes
        ctx.fillStyle = '#141010'
        for (const side of [1, -1]) {
          ctx.beginPath()
          ctx.arc(P[0][0] + T[0][0] * maxW * 0.45 - T[0][1] * maxW * 0.5 * side, P[0][1] + T[0][1] * maxW * 0.45 + T[0][0] * maxW * 0.5 * side, maxW * 0.1, 0, TAU)
          ctx.fill()
        }
      }

      return {
        init(w, h) {
          W = w
          H = h
          floor = layer(w, h, (g) => {
            const gr = g.createRadialGradient(w * 0.55, h * 0.45, 0, w * 0.55, h * 0.45, Math.hypot(w, h) * 0.6)
            gr.addColorStop(0, dark ? '#135650' : '#5fb4a4')
            gr.addColorStop(0.6, dark ? '#0b3c39' : '#3d8e80')
            gr.addColorStop(1, dark ? '#052120' : '#256c62')
            g.fillStyle = gr
            g.fillRect(0, 0, w, h)
            // pebbles and weed on the floor
            for (let i = 0; i < (w * h) / 1400; i++) {
              const x = Math.random() * w
              const y = Math.random() * h
              const r = rand(1.5, 7)
              g.fillStyle = `rgba(${Math.random() < 0.5 ? '200,190,160' : '120,140,130'},${(dark ? rand(0.04, 0.1) : rand(0.06, 0.14)).toFixed(3)})`
              g.beginPath()
              g.ellipse(x, y, r, r * rand(0.6, 0.9), Math.random() * TAU, 0, TAU)
              g.fill()
            }
            g.strokeStyle = dark ? 'rgba(80,140,90,0.12)' : 'rgba(40,110,60,0.16)'
            g.lineWidth = 2
            for (let i = 0; i < 40; i++) {
              const x = Math.random() * w
              const y = Math.random() * h
              g.beginPath()
              g.moveTo(x, y)
              g.bezierCurveTo(x + rand(-20, 20), y - 20, x + rand(-30, 30), y - 40, x + rand(-30, 30), y - rand(50, 90))
              g.stroke()
            }
          })
          rim = layer(w, h, (g) => {
            // dark water at the edges and mossy stones poking in
            const v = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.62)
            v.addColorStop(0, 'rgba(0,0,0,0)')
            v.addColorStop(1, dark ? 'rgba(0,12,12,0.65)' : 'rgba(10,50,45,0.4)')
            g.fillStyle = v
            g.fillRect(0, 0, w, h)
            const stones: [number, number, number][] = []
            // smaller along the top, where the header sits over the water
            for (let x = -30; x < w + 30; x += rand(90, 170)) stones.push([x, rand(-30, -16), rand(24, 44)], [x + 40, h + rand(10, 34), rand(36, 70)])
            for (let y = 60; y < h; y += rand(90, 160)) stones.push([rand(-40, -14), y, rand(34, 60)], [w + rand(14, 40), y, rand(34, 60)])
            for (const [x, y, r] of stones) {
              const sg = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r)
              sg.addColorStop(0, dark ? '#5a5e58' : '#a8a89a')
              sg.addColorStop(1, dark ? '#23271f' : '#5d6052')
              g.fillStyle = 'rgba(0,0,0,0.25)'
              g.beginPath()
              g.ellipse(x + 6, y + 8, r, r * 0.8, 0.3, 0, TAU)
              g.fill()
              g.fillStyle = sg
              g.beginPath()
              g.ellipse(x, y, r, r * 0.8, 0.3, 0, TAU)
              g.fill()
              g.fillStyle = dark ? 'rgba(70,120,60,0.45)' : 'rgba(90,150,70,0.5)'
              g.beginPath()
              g.ellipse(x - r * 0.2, y - r * 0.35, r * 0.5, r * 0.22, -0.4, 0, TAU)
              g.fill()
            }
          })
          caustic = (document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D).createPattern(causticTile(192), 'repeat')
          sparkle = glow('255,236,150', 32, 0.2, 0.6)
          fish = Array.from({ length: 8 }, () => newKoi())
          const flowers = ['#ff8fb5', '#ffb3cf', '#ff6f9f']
          pads = Array.from({ length: Math.round(clamp((w * h) / 110_000, 8, 16)) }, (_, i) => {
            const r = rand(26, 48)
            const [x, y] = i < 4 ? [rand(0.3, 0.95) * w, rand(0.02, 0.18) * h] : [rand(0, 1) * w, rand(0, 1) * h]
            return { c: lilyPad(r, i + 1, i % 3 === 0 ? flowers[i % flowers.length] : null), x, y, r, rot: Math.random() * TAU, spin: rand(-0.03, 0.03), vx: rand(-3, 3), vy: rand(-2, 2), ph: Math.random() * TAU }
          })
          petals = Array.from({ length: 16 }, () => ({ x: Math.random() * w, y: Math.random() * h, rot: Math.random() * TAU, spin: rand(-0.4, 0.4), vx: rand(4, 10), vy: rand(-2, 2), s: rand(4, 7), c: Math.random() < 0.5 ? '#ffc6d9' : '#fff0f4' }))
          ripples = []
          food = []
        },
        draw(ctx, w, h, dt, l) {
          t += dt
          const speed = 1 + l.intensity * 0.3
          if (floor) ctx.drawImage(floor, 0, 0, w, h)
          // caustics: the same net twice, drifting apart
          if (caustic) {
            ctx.save()
            ctx.globalCompositeOperation = 'lighter'
            for (const [ox, oy, sc, a] of [
              [t * 9, t * 6, 1.6, 0.07],
              [-t * 7, t * 8, 2.3, 0.05]
            ]) {
              ctx.globalAlpha = a * (0.7 + l.vivid * 0.5) * (dark ? 1 : 1.3)
              ctx.save()
              ctx.scale(sc, sc)
              ctx.translate(ox % 192, oy % 192)
              ctx.fillStyle = caustic
              ctx.fillRect(-192, -192, w / sc + 384, h / sc + 384)
              ctx.restore()
            }
            ctx.restore()
          }

          // ---- the koi
          if (l.pulseAt > lastPulse.current) {
            lastPulse.current = l.pulseAt
            const [cx, cy] = Math.random() < 0.6 ? [gapX(w) + rand(-160, 160), rand(0.05, 0.16) * h] : [rand(0.04, 0.12) * w, rand(0.5, 0.65) * h]
            const n = 8 + Math.min(10, Math.round(Math.log10(Math.max(10, l.size)) * 1.5))
            for (let k = 0; k < n; k++) food.push({ x: cx + rand(-40, 40), y: cy + rand(-30, 30), life: 30 })
            ripples.push({ x: cx, y: cy, k: 0, max: 90, strong: true })
            if (l.size > 1_000_000 && !fish.some((f) => f.golden)) fish.push(newKoi(true, true))
          }
          const want = 7 + l.intensity
          if (fish.filter((f) => !f.leaving).length < want) fish.push(newKoi(false, true))
          food = food.filter((fd) => (fd.life -= dt) > 0)
          fish = fish.filter((f) => {
            f.age += dt
            // a golden koi stays a minute and a half, extra fish leave when it calms down
            if ((f.golden && f.age > 90) || (!f.golden && fish.filter((x) => !x.leaving && !x.golden).length > want + 1 && f.age > 20 && !f.leaving)) {
              f.leaving = true
              ;[f.tx, f.ty] = [f.x < w / 2 ? -200 : w + 200, f.y]
            }
            let fast = 1
            if (!f.leaving) {
              let best: (typeof food)[number] | null = null
              let bd = 520 * 520
              for (const fd of food) {
                const d = (fd.x - f.x) ** 2 + (fd.y - f.y) ** 2
                if (d < bd) {
                  bd = d
                  best = fd
                }
              }
              if (best) {
                f.tx = best.x
                f.ty = best.y
                fast = 2.1
                if (bd < 12 * 12) {
                  food.splice(food.indexOf(best), 1)
                  ripples.push({ x: f.x, y: f.y, k: 0, max: 26, strong: false })
                }
              } else {
                f.retarget -= dt
                if (f.retarget <= 0 || (f.tx - f.x) ** 2 + (f.ty - f.y) ** 2 < 50 * 50) {
                  ;[f.tx, f.ty] = spot()
                  f.retarget = rand(5, 11)
                  // now and then a koi comes up for air
                  if (Math.random() < 0.15) ripples.push({ x: f.x, y: f.y, k: 0, max: 30, strong: false })
                }
              }
            }
            const want2 = Math.atan2(f.ty - f.y, f.tx - f.x)
            let d = want2 - f.a
            d = Math.atan2(Math.sin(d), Math.cos(d))
            const turn = (fast > 1 ? 2.6 : 1.3) * dt
            f.a += clamp(d, -turn, turn)
            const v = (f.golden ? 24 : 18 + f.len * 0.08) * speed * fast * (0.85 + 0.15 * Math.sin(f.ph * 0.5))
            f.x += Math.cos(f.a) * v * dt
            f.y += Math.sin(f.a) * v * dt
            f.ph += dt * (3.2 + v * 0.06)
            const seg = f.len / SEGS
            f.spine[0] = [f.x, f.y]
            for (let i = 1; i < SEGS; i++) {
              const dx = f.spine[i - 1][0] - f.spine[i][0]
              const dy = f.spine[i - 1][1] - f.spine[i][1]
              const dd = Math.hypot(dx, dy)
              if (dd > seg) f.spine[i] = [f.spine[i - 1][0] - (dx / dd) * seg, f.spine[i - 1][1] - (dy / dd) * seg]
            }
            drawKoi(ctx, f, speed * fast)
            if (f.golden && sparkle) {
              ctx.globalCompositeOperation = 'lighter'
              for (let k = 0; k < 3; k++) {
                const [sx, sy] = f.spine[3 + k * 3]
                const a = 0.5 + 0.5 * Math.sin(t * 6 + k * 2)
                ctx.globalAlpha = a
                ctx.drawImage(sparkle, sx - 10 + Math.sin(t * 3 + k) * 6, sy - 10 + Math.cos(t * 2 + k) * 6, 20, 20)
              }
              ctx.globalAlpha = 1
              ctx.globalCompositeOperation = 'source-over'
            }
            return !(f.leaving && (f.x < -180 || f.x > w + 180 || f.y < -180 || f.y > h + 180))
          })
          // food pellets on the surface
          ctx.fillStyle = '#8a5a2c'
          for (const fd of food) {
            ctx.globalAlpha = Math.min(1, fd.life / 3)
            ctx.beginPath()
            ctx.arc(fd.x + Math.sin(t + fd.y) * 1.5, fd.y, 2.6, 0, TAU)
            ctx.fill()
          }
          ctx.globalAlpha = 1

          // ---- the surface: pads, petals, rings
          for (const pd of pads) {
            pd.x += pd.vx * dt
            pd.y += pd.vy * dt
            pd.rot += pd.spin * dt
            if (pd.x < -pd.r) pd.x = w + pd.r
            if (pd.x > w + pd.r) pd.x = -pd.r
            if (pd.y < -pd.r) pd.y = h + pd.r
            if (pd.y > h + pd.r) pd.y = -pd.r
            const S = pd.r * 2 + 8
            const bob = 1 + Math.sin(t * 0.8 + pd.ph) * 0.015
            ctx.fillStyle = dark ? 'rgba(0,10,10,0.3)' : 'rgba(10,50,45,0.2)'
            ctx.beginPath()
            ctx.ellipse(pd.x + 7, pd.y + 9, pd.r, pd.r * 0.96, 0, 0, TAU)
            ctx.fill()
            ctx.save()
            ctx.translate(pd.x, pd.y)
            ctx.rotate(pd.rot)
            ctx.scale(bob, bob)
            ctx.drawImage(pd.c, -S / 2, -S / 2, S, S)
            ctx.restore()
          }
          for (const pt of petals) {
            pt.x += pt.vx * dt
            pt.y += pt.vy * dt + Math.sin(t * 0.5 + pt.rot) * 2 * dt
            pt.rot += pt.spin * dt
            if (pt.x > w + 10) {
              pt.x = -10
              pt.y = Math.random() * h
            }
            ctx.save()
            ctx.translate(pt.x, pt.y)
            ctx.rotate(pt.rot)
            ctx.fillStyle = pt.c
            ctx.globalAlpha = 0.9
            ctx.beginPath()
            ctx.ellipse(0, 0, pt.s, pt.s * 0.6, 0, 0, TAU)
            ctx.fill()
            ctx.restore()
          }
          ctx.globalAlpha = 1
          nextDrop -= dt
          if (nextDrop <= 0) {
            ripples.push({ x: Math.random() * w, y: Math.random() * h, k: 0, max: rand(30, 60), strong: false })
            nextDrop = rand(0.8, 2.6) / speed
          }
          ripples = ripples.filter((r) => {
            r.k += dt / (r.strong ? 3 : 2.2)
            if (r.k >= 1) return false
            for (let i = 0; i < (r.strong ? 3 : 2); i++) {
              const q = r.k - i * 0.12
              if (q <= 0) continue
              ctx.strokeStyle = `rgba(225,255,248,${((1 - r.k) * (r.strong ? 0.55 : 0.35) * (0.7 + l.vivid * 0.4)).toFixed(3)})`
              ctx.lineWidth = r.strong ? 1.6 : 1.1
              ctx.beginPath()
              ctx.arc(r.x, r.y, q * r.max, 0, TAU)
              ctx.stroke()
            }
            return true
          })
          if (rim) ctx.drawImage(rim, 0, 0, w, h)
          // a soft sheen of the sky sliding over the water
          const sx = ((t * 14) % (w * 2)) - w * 0.5
          const sh = ctx.createLinearGradient(sx - 300, 0, sx + 300, h * 0.3)
          sh.addColorStop(0, 'rgba(255,255,255,0)')
          sh.addColorStop(0.5, `rgba(255,255,255,${dark ? 0.035 : 0.06})`)
          sh.addColorStop(1, 'rgba(255,255,255,0)')
          ctx.fillStyle = sh
          ctx.fillRect(0, 0, w, h)
        }
      }
    },
    1,
    30
  )
  return <canvas ref={ref} className="scene-canvas" />
}

// ---------------------------------------------------------------- 浮世绘

const PRUSSIAN = '#1f3b63'
const WAVE_COLORS = ['#3c6a98', '#2f5a88', '#284e7a', '#21436c', '#1c3a60']

type Pt = [number, number]
type Cubic = [Pt, Pt, Pt, Pt]
/** a point on a cubic Bézier curve */
function cubic(c: Cubic, t: number): Pt {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const d = 3 * u * t * t
  const e = t * t * t
  return [a * c[0][0] + b * c[1][0] + d * c[2][0] + e * c[3][0], a * c[0][1] + b * c[1][1] + d * c[2][1] + e * c[3][1]]
}
/** the unit direction of a cubic Bézier curve at t */
function cubicDir(c: Cubic, t: number): Pt {
  const u = 1 - t
  const x = 3 * u * u * (c[1][0] - c[0][0]) + 6 * u * t * (c[2][0] - c[1][0]) + 3 * t * t * (c[3][0] - c[2][0])
  const y = 3 * u * u * (c[1][1] - c[0][1]) + 6 * u * t * (c[2][1] - c[1][1]) + 3 * t * t * (c[3][1] - c[2][1])
  const d = Math.hypot(x, y) || 1
  return [x / d, y / d]
}

/**
 * 浮世绘: a woodblock-print sea. Prussian-blue bands at the top of the sky, a
 * red sun, pale mist bands drifting, a snow-capped mountain far off, rows of
 * waves with foam lines, long boats riding them, plovers in lines, and in
 * the sidebar a great wave that rises, curls its claws of foam over and
 * breaks, again and again. New usage throws spray off the great wave and
 * sends up a line of plovers; more usage, higher seas. Dark is the night print.
 */
export function Ukiyo(p: SceneProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useLive(p)
  const dark = p.dark === true
  const lastPulse = useRef(0)
  useScene(
    ref,
    p.level,
    live,
    () => {
      let W = 0
      let H = 0
      let paper: HTMLCanvasElement | null = null
      let mists: { x: number; y: number; w: number; h: number; v: number; c: string }[] = []
      let spray: { x: number; y: number; vx: number; vy: number; life: number; r: number }[] = []
      let plovers: { x: number; y: number; vx: number; ph: number; n: number }[] = []
      let boats: { row: number; x: number; v: number; len: number }[] = []
      let sun = { x: 0, y: 0, r: 0 }
      let t = 0
      let cycle = 0
      let nextPlover = 6
      const rows = [0.62, 0.7, 0.78, 0.87, 0.96]
      const crest = (u: number) => ((1 + Math.sin(u)) / 2) ** 2.4

      const rowY = (i: number, x: number, swell: number) => {
        const amp = H * (0.018 + i * 0.008) * swell
        const lam = 120 + i * 50
        return H * rows[i] - amp * crest((x / lam) * TAU - t * (0.6 + i * 0.12) + i * 1.7)
      }

      return {
        init(w, h) {
          W = w
          H = h
          sun = { x: gapX(w), y: Math.min(h * 0.11, 100), r: clamp(Math.min(w, h) * 0.045, 30, 52) }
          paper = layer(w, h, (g) => {
            g.fillStyle = dark ? '#1a2740' : '#efe2c4'
            g.fillRect(0, 0, w, h)
            // fibres in the paper
            for (let i = 0; i < (w * h) / 900; i++) {
              g.fillStyle = dark ? `rgba(200,210,240,${rand(0.02, 0.05).toFixed(3)})` : `rgba(120,90,50,${rand(0.03, 0.07).toFixed(3)})`
              g.fillRect(Math.random() * w, Math.random() * h, rand(1, 6), 0.7)
            }
            // the blue gradation across the top of the sky
            const top = g.createLinearGradient(0, 0, 0, h * 0.2)
            top.addColorStop(0, dark ? 'rgba(6,12,30,0.95)' : 'rgba(31,59,99,0.92)')
            top.addColorStop(0.5, dark ? 'rgba(6,12,30,0.5)' : 'rgba(31,59,99,0.42)')
            top.addColorStop(1, 'rgba(31,59,99,0)')
            g.fillStyle = top
            g.fillRect(0, 0, w, h * 0.2)
            if (dark) {
              for (let i = 0; i < 90; i++) {
                g.fillStyle = 'rgba(250,240,210,0.7)'
                const s = Math.random() < 0.2 ? 2 : 1.2
                g.fillRect(Math.random() * w, Math.random() * h * 0.45, s, s)
              }
            }
            // the far mountain with its snow
            const fx = w * 0.62
            const fb = h * 0.64
            const fw = w * 0.2
            const fh = h * 0.26
            g.fillStyle = dark ? '#22365a' : '#4a6f9c'
            g.beginPath()
            g.moveTo(fx - fw, fb)
            g.quadraticCurveTo(fx - fw * 0.4, fb - fh * 0.55, fx - fw * 0.12, fb - fh)
            g.lineTo(fx + fw * 0.12, fb - fh)
            g.quadraticCurveTo(fx + fw * 0.4, fb - fh * 0.55, fx + fw, fb)
            g.closePath()
            g.fill()
            g.fillStyle = dark ? '#dfe6f0' : '#fbf7ee'
            g.beginPath()
            g.moveTo(fx - fw * 0.12, fb - fh)
            g.lineTo(fx + fw * 0.12, fb - fh)
            g.lineTo(fx + fw * 0.3, fb - fh * 0.62)
            for (let k = 0; k <= 8; k++) {
              const x = fx + fw * 0.3 - (k / 8) * fw * 0.6
              g.lineTo(x, fb - fh * (0.62 + (k % 2 ? 0.08 : -0.04)))
            }
            g.closePath()
            g.fill()
          })
          mists = Array.from({ length: 6 }, (_, i) => ({ x: SIDEBAR + Math.random() * (w - SIDEBAR), y: h * [0.2, 0.26, 0.38, 0.46, 0.55, 0.62][i], w: rand(200, 420), h: rand(12, 20), v: rand(4, 10) * (i % 2 ? 1 : -1), c: i % 3 === 0 ? (dark ? 'rgba(120,140,180,0.35)' : 'rgba(232,168,140,0.45)') : dark ? 'rgba(170,180,210,0.25)' : 'rgba(250,242,222,0.8)' }))
          boats = [
            { row: 1, x: w * 0.55, v: 9, len: 90 },
            { row: 2, x: w * 0.82, v: 7, len: 110 }
          ]
          spray = []
          plovers = []
        },
        draw(ctx, w, h, dt, l) {
          t += dt
          const swell = 1 + l.intensity * 0.18
          if (paper) ctx.drawImage(paper, 0, 0, w, h)
          // the sun (the moon in the night print) with rings for new usage
          ctx.fillStyle = dark ? '#f2e3b0' : '#cf4a33'
          ctx.beginPath()
          ctx.arc(sun.x, sun.y, sun.r, 0, TAU)
          ctx.fill()
          // mist bands: flat pills with a thin outline, as cut in wood
          // mist bands only over the page: in the sidebar they would read as a highlighted item
          ctx.save()
          ctx.beginPath()
          ctx.rect(SIDEBAR, 0, w - SIDEBAR, h)
          ctx.clip()
          for (const m of mists) {
            m.x += m.v * dt
            if (m.x > w + m.w) m.x = SIDEBAR - m.w / 2
            if (m.x < SIDEBAR - m.w) m.x = w + m.w / 2
            ctx.fillStyle = m.c
            ctx.strokeStyle = dark ? 'rgba(200,210,240,0.25)' : 'rgba(110,70,50,0.35)'
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.roundRect(m.x - m.w / 2, m.y - m.h / 2, m.w, m.h, m.h / 2)
            ctx.fill()
            ctx.stroke()
          }
          ctx.restore()
          // plovers in lines
          nextPlover -= dt
          const spawnPlovers = (n: number) => plovers.push({ x: w + 30, y: h * rand(0.08, 0.3), vx: -rand(50, 70), ph: Math.random() * TAU, n })
          if (nextPlover <= 0) {
            spawnPlovers(4 + Math.floor(Math.random() * 4))
            nextPlover = rand(18, 34)
          }
          ctx.strokeStyle = dark ? '#d8deea' : '#2a2a2a'
          ctx.lineWidth = 1.4
          ctx.lineCap = 'round'
          plovers = plovers.filter((pl) => {
            pl.x += pl.vx * dt
            ctx.beginPath()
            for (let k = 0; k < pl.n; k++) {
              const x = pl.x + k * 20
              const y = pl.y + Math.sin(k * 0.8 + pl.ph) * 10 + k * 3
              const f = Math.sin(t * 8 + k) * 3
              ctx.moveTo(x - 6, y - 2 - f)
              ctx.quadraticCurveTo(x - 2, y - 3, x, y)
              ctx.quadraticCurveTo(x + 2, y - 3, x + 6, y - 2 - f)
            }
            ctx.stroke()
            return pl.x + pl.n * 20 > -40
          })

          // ---- rows of waves, far to near, with boats riding them
          rows.forEach((_, i) => {
            ctx.beginPath()
            ctx.moveTo(-10, h + 10)
            for (let x = -10; x <= w + 10; x += 8) ctx.lineTo(x, rowY(i, x, swell))
            ctx.lineTo(w + 10, h + 10)
            ctx.closePath()
            ctx.fillStyle = dark ? ['#20375e', '#1b3054', '#172a4a', '#132440', '#101f38'][i] : WAVE_COLORS[i]
            ctx.fill()
            // woodcut lines following the swell, and foam on the crests
            ctx.strokeStyle = dark ? 'rgba(160,190,230,0.3)' : 'rgba(190,215,240,0.45)'
            ctx.lineWidth = 1
            for (const off of [7, 15]) {
              ctx.beginPath()
              for (let x = -10; x <= w + 10; x += 10) {
                const y = rowY(i, x, swell) + off
                if (x === -10) ctx.moveTo(x, y)
                else ctx.lineTo(x, y)
              }
              ctx.stroke()
            }
            ctx.strokeStyle = dark ? 'rgba(235,240,250,0.85)' : '#f8f2e4'
            ctx.lineWidth = 2
            ctx.beginPath()
            for (let x = -10; x <= w + 10; x += 6) {
              const y = rowY(i, x, swell)
              if (x === -10) ctx.moveTo(x, y)
              else ctx.lineTo(x, y)
            }
            ctx.stroke()
            // little claws of foam where the crests peak
            const lam = 120 + i * 50
            ctx.fillStyle = dark ? 'rgba(235,240,250,0.9)' : '#fbf6ea'
            for (let x = -lam; x < w + lam; x += 4) {
              const u = (x / lam) * TAU - t * (0.6 + i * 0.12) + i * 1.7
              if (Math.sin(u) < 0.985) continue
              const y = rowY(i, x, swell)
              for (let k = 0; k < 4; k++) {
                ctx.beginPath()
                ctx.arc(x + k * 4 - 6, y - 2 + (k % 2) * 2, 2 + (k % 2), 0, TAU)
                ctx.fill()
              }
            }
            for (const b of boats) {
              if (b.row !== i) continue
              b.x += b.v * dt
              if (b.x > w + b.len) b.x = -b.len
              const y0 = rowY(i, b.x - b.len / 2, swell)
              const y1 = rowY(i, b.x + b.len / 2, swell)
              const a = Math.atan2(y1 - y0, b.len)
              ctx.save()
              ctx.translate(b.x, (y0 + y1) / 2 - 2)
              ctx.rotate(a)
              ctx.fillStyle = dark ? '#c9b48a' : '#6b4a2c'
              ctx.beginPath()
              ctx.moveTo(-b.len / 2, -6)
              ctx.quadraticCurveTo(0, 6, b.len / 2, -9)
              ctx.quadraticCurveTo(0, 1, -b.len / 2, -6)
              ctx.fill()
              ctx.fillStyle = dark ? '#e8e4da' : '#2a2a2a'
              for (let k = 0; k < 6; k++) {
                ctx.beginPath()
                ctx.arc(-b.len * 0.32 + k * b.len * 0.12, -5, 2.2, 0, TAU)
                ctx.fill()
              }
              ctx.restore()
            }
          })

          // ---- the great wave in the sidebar: it rises, its lip reaches out and curls over, it breaks; again
          cycle += (dt / 13) * (1 + l.intensity * 0.12)
          const q = cycle % 1
          const g = smoothstep(0, 0.5, q) * (1 - smoothstep(0.84, 1, q))
          const crash = smoothstep(0.66, 0.86, q) * (1 - smoothstep(0.9, 1, q))
          const cx = clamp(w * 0.08, 64, 140)
          const R = clamp(h * 0.16, 80, 150)
          const cy = h * (0.6 - 0.1 * g)
          const sway = Math.sin(t * 0.9) * R * 0.03
          const top: Pt = [cx + sway, cy - R * (0.78 + 0.25 * g)]
          const tip: Pt = [cx + R * (0.55 + 0.75 * g) + sway, cy + R * (-0.2 + 0.45 * g + 0.35 * crash)]
          const throat: Pt = [cx + R * 0.3 + sway, cy - R * 0.2 * (0.5 + 0.5 * g)]
          const trough: Pt = [cx + R * (0.62 + 0.5 * g), cy + R * 1.3]
          const back: Cubic = [[-20, cy + R * 1.5], [cx - R * 1.3, cy + R * 0.7], [cx - R * 0.85 + sway, top[1] + R * 0.06], top]
          const crest: Cubic = [top, [cx + R * 0.6 + sway, top[1] - R * 0.14], [tip[0] + R * 0.28, tip[1] - R * (0.75 + 0.2 * g)], tip]
          const under: Cubic = [tip, [tip[0] - R * 0.04, tip[1] - R * 0.32], [throat[0] + R * 0.42, throat[1] - R * 0.12], throat]
          const face: Cubic = [throat, [throat[0] - R * 0.28, throat[1] + R * 0.45], [trough[0] - R * 0.7, trough[1] - R * 0.12], trough]
          const xr = clamp(w * 0.34, 260, 460)
          const wave = new Path2D()
          wave.moveTo(back[0][0], back[0][1])
          for (const c of [back, crest, under, face]) wave.bezierCurveTo(c[1][0], c[1][1], c[2][0], c[2][1], c[3][0], c[3][1])
          wave.quadraticCurveTo(trough[0] + R * 0.8, trough[1] + R * 0.05, xr, trough[1] + R * 0.25)
          wave.lineTo(xr, h + 10)
          wave.lineTo(-20, h + 10)
          wave.closePath()
          const wg = ctx.createLinearGradient(0, top[1], 0, h)
          wg.addColorStop(0, dark ? '#1c335a' : PRUSSIAN)
          wg.addColorStop(1, dark ? '#132442' : '#2f5a88')
          ctx.fillStyle = wg
          ctx.fill(wave)
          // woodcut lines inside: along the back and crest, and down the hollow face
          ctx.save()
          ctx.clip(wave)
          ctx.lineCap = 'round'
          ctx.strokeStyle = dark ? 'rgba(120,160,215,0.35)' : 'rgba(120,165,215,0.55)'
          ctx.lineWidth = R * 0.16
          ctx.beginPath()
          ctx.moveTo(face[0][0], face[0][1])
          ctx.bezierCurveTo(face[1][0], face[1][1], face[2][0], face[2][1], face[3][0], face[3][1])
          ctx.stroke()
          ctx.strokeStyle = dark ? 'rgba(150,180,225,0.35)' : 'rgba(176,206,236,0.6)'
          ctx.lineWidth = 1.2
          for (let k = 1; k <= 5; k++) {
            ctx.beginPath()
            const dx = k * R * 0.05
            const dy = k * R * 0.12
            ctx.moveTo(back[0][0] + dx, back[0][1] + dy)
            for (const c of [back, crest]) ctx.bezierCurveTo(c[1][0] + dx, c[1][1] + dy, c[2][0] + dx, c[2][1] + dy, c[3][0] + dx, c[3][1] + dy)
            ctx.stroke()
          }
          for (let k = 1; k <= 3; k++) {
            ctx.beginPath()
            const dx = -k * R * 0.09
            ctx.moveTo(face[0][0] + dx, face[0][1])
            ctx.bezierCurveTo(face[1][0] + dx, face[1][1], face[2][0] + dx, face[2][1], face[3][0] + dx, face[3][1])
            ctx.stroke()
          }
          ctx.restore()
          // the foam along the crest, thickening toward the lip
          const foam = dark ? 'rgba(240,244,252,0.95)' : '#fbf6ea'
          ctx.strokeStyle = foam
          ctx.lineCap = 'round'
          const N = 28
          for (let i = Math.floor(N * 0.3); i < N; i++) {
            const [x0, y0] = cubic(crest, i / N)
            const [x1, y1] = cubic(crest, (i + 1) / N)
            ctx.lineWidth = 2 + (i / N) * 5
            ctx.beginPath()
            ctx.moveTo(x0, y0)
            ctx.lineTo(x1, y1)
            ctx.stroke()
          }
          // claws of foam reaching out from the lip, hooked forward
          ctx.fillStyle = foam
          const claws = Math.round(5 + 11 * g)
          for (let k = 0; k < claws; k++) {
            const u = 0.5 + (k / claws) * 0.5
            const [x, y] = cubic(crest, u)
            const [tx, ty] = cubicDir(crest, u)
            const nx = ty
            const ny = -tx
            const len = R * (0.05 + 0.09 * g) * (0.6 + 0.4 * Math.sin(k * 1.7 + t * 2) ** 2)
            ctx.beginPath()
            ctx.arc(x + nx * len * 0.45, y + ny * len * 0.45, len * 0.42, 0, TAU)
            ctx.arc(x + nx * len * 0.9 + tx * len * 0.45, y + ny * len * 0.9 + ty * len * 0.45, len * 0.24, 0, TAU)
            ctx.fill()
            ctx.beginPath()
            ctx.arc(x + nx * len * 0.75 + tx * len * 0.95, y + ny * len * 0.75 + ty * len * 0.95, len * 0.13, 0, TAU)
            ctx.fill()
          }
          // drops hanging from the underside of the lip
          for (let k = 0; k < 5; k++) {
            const [x, y] = cubic(under, 0.05 + k * 0.08)
            ctx.beginPath()
            ctx.arc(x - 2, y + 3 + Math.sin(t * 3 + k) * 2, 2 + (k % 2), 0, TAU)
            ctx.fill()
          }
          // spray off the lip as it breaks, and for new usage
          if (l.pulseAt > lastPulse.current) {
            lastPulse.current = l.pulseAt
            for (let k = 0; k < 46; k++) spray.push({ x: tip[0], y: tip[1], vx: rand(-20, 180), vy: rand(-170, -40), life: rand(1.2, 2.2), r: rand(1.5, 3.6) })
            spawnPlovers(7)
          }
          if (crash > 0.05 && Math.random() < 0.8) {
            const [lx, ly] = cubic(crest, rand(0.7, 1))
            spray.push({ x: lx, y: ly, vx: rand(10, 120), vy: rand(-90, 10), life: rand(0.8, 1.5), r: rand(1.2, 3) })
          }
          ctx.fillStyle = dark ? 'rgba(240,244,252,0.9)' : '#fbf6ea'
          spray = spray.filter((s) => {
            s.vy += 160 * dt
            s.x += s.vx * dt
            s.y += s.vy * dt
            s.life -= dt
            ctx.globalAlpha = Math.min(1, s.life)
            ctx.beginPath()
            ctx.arc(s.x, s.y, s.r, 0, TAU)
            ctx.fill()
            return s.life > 0
          })
          ctx.globalAlpha = 1
        }
      }
    },
    1,
    30
  )
  return <canvas ref={ref} className="scene-canvas" />
}

// ---------------------------------------------------------------- 像素冒险

const PX = 4
type PixelPhase = 'day' | 'dusk' | 'night'
const SKIES: Record<PixelPhase, { sky: string[]; far: string; snow: string; mid: string; tree: string; grass: string; dirt: string; dirt2: string; cloud: string; orb: string }> = {
  day: { sky: ['#3466c8', '#3d74d2', '#4882da', '#5592e2', '#64a2ea', '#76b2f0', '#8ac2f4', '#a2d2f8'], far: '#7d8fc8', snow: '#eef2ff', mid: '#4f7fb0', tree: '#2c6a3e', grass: '#52b04a', dirt: '#8a5a32', dirt2: '#6e4526', cloud: '#ffffff', orb: '#fff3a0' },
  dusk: { sky: ['#24184a', '#36205f', '#4f2872', '#73307a', '#a0407a', '#cc5a72', '#ea7f64', '#f6ab5c'], far: '#5a3a7c', snow: '#f0c8d8', mid: '#3a2a60', tree: '#1e2a40', grass: '#3d8a5c', dirt: '#5a3a2a', dirt2: '#46291d', cloud: '#ffc8b0', orb: '#ffe066' },
  night: { sky: ['#05070f', '#080c1a', '#0c1226', '#101832', '#141e3e', '#18244a', '#1c2a54', '#20305e'], far: '#1c2448', snow: '#8a96c8', mid: '#131a36', tree: '#0b1a24', grass: '#1f5040', dirt: '#2a1e1a', dirt2: '#201614', cloud: '#5a6488', orb: '#f4f0d0' }
}
const pixelPhase = (h: number): PixelPhase => (h >= 8 && h < 16 ? 'day' : (h >= 5 && h < 8) || (h >= 16 && h < 20) ? 'dusk' : 'night')

/** a tiny 3×5 font for the score that pops out of the blocks */
const FONT: Record<string, string> = {
  '0': '111101101101111',
  '1': '010110010010111',
  '2': '111001111100111',
  '3': '111001111001111',
  '4': '101101111001001',
  '5': '111100111001111',
  '6': '111100111101111',
  '7': '111001001001001',
  '8': '111101111101111',
  '9': '111101111001111',
  '.': '000000000000010',
  '+': '000010111010000',
  K: '101101110101101',
  M: '101111111101101',
  B: '110101110101110',
  T: '111010010010010',
  ' ': '000000000000000'
}

/** the little explorer: run frames and a jump, 8 × 10 */
const HERO: Record<string, string[]> = {
  run1: ['..HHHH..', '.HHHHHHH', '..SSES..', '..SSSS..', '.CCCCC..', 'S.CCCC.S', '..CCCC..', '..PPPP..', '.PP..PP.', '.BB...BB'],
  run2: ['..HHHH..', '.HHHHHHH', '..SSES..', '..SSSS..', '..CCCCC.', '.SCCCCS.', '..CCCC..', '..PPPP..', '..PPPP..', '..BBBB..'],
  jump: ['..HHHH..', '.HHHHHHH', '..SSES..', 'S.SSSS.S', '.CCCCCC.', '..CCCC..', '..CCCC..', '.PP..PP.', '.B....B.', '........']
}
const HERO_COLORS: Record<string, string> = { H: '#2ec4b6', S: '#ffd6a5', E: '#1a1a2e', C: '#ff7b54', P: '#3d5a80', B: '#4a2c2a' }

/**
 * 像素冒险: an 8-bit world drawn four screen pixels to a pixel. A banded,
 * dithered sky that follows the hour (day, dusk, night), blocky clouds,
 * mountains with snow, hills of pines and a grassy ground scrolling in
 * parallax; in the header gap a floating brick island where a little explorer
 * runs and hops between spinning coins and two ? blocks. Each batch of new
 * usage bumps a block: a coin pops out with the tokens in pixel digits.
 */
export function PixelQuest(p: SceneProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useLive(p)
  const lastPulse = useRef(0)
  useScene(
    ref,
    p.level,
    live,
    () => {
      let lw = 0
      let lh = 0
      let buf: HTMLCanvasElement | null = null
      let b: CanvasRenderingContext2D | null = null
      let skyC: HTMLCanvasElement | null = null
      let strips: { c: HTMLCanvasElement; v: number; y: number }[] = []
      let phase: PixelPhase | null = null
      let clouds: { x: number; y: number; cells: [number, number, number][]; v: number }[] = []
      let stars: { x: number; y: number; ph: number }[] = []
      let birds: { x: number; y: number; vx: number; ph: number }[] = []
      let pops: { x: number; y: number; t: number; text: string }[] = []
      let isle = { x0: 0, x1: 0, y: 0 }
      let blocks: { x: number; bump: number; used: number }[] = []
      let coins: { x: number; y: number; ph: number }[] = []
      let hero = { x: 0, y: 0, vy: 0, dir: 1, air: false }
      let t = 0
      let cam = 0
      let nextHop = 3
      let nextBird = 4

      const px = (x: number, y: number, w: number, h: number, c: string) => {
        b!.fillStyle = c
        b!.fillRect(Math.round(x), Math.round(y), w, h)
      }
      const text = (s: string, x: number, y: number, c: string) => {
        let cx = Math.round(x)
        for (const ch of s) {
          const bits = FONT[ch] ?? FONT[' ']
          for (let i = 0; i < 15; i++) {
            if (bits[i] !== '1') continue
            px(cx + (i % 3) + 1, y + Math.floor(i / 3) + 1, 1, 1, '#1a1030')
            px(cx + (i % 3), y + Math.floor(i / 3), 1, 1, c)
          }
          cx += 4
        }
      }
      const paintSky = (ph: PixelPhase) => {
        const P = SKIES[ph]
        skyC = document.createElement('canvas')
        skyC.width = lw
        skyC.height = lh
        const g = skyC.getContext('2d')!
        const band = Math.ceil((lh * 0.72) / P.sky.length)
        for (let i = 0; i < P.sky.length; i++) {
          g.fillStyle = P.sky[i]
          g.fillRect(0, i * band, lw, band + 1)
          // dithered seam into the next band
          if (i < P.sky.length - 1) {
            g.fillStyle = P.sky[i + 1]
            for (let y = (i + 1) * band - 2; y < (i + 1) * band; y++) for (let x = y % 2; x < lw; x += 2) g.fillRect(x, y, 1, 1)
          }
        }
        g.fillStyle = P.sky[P.sky.length - 1]
        g.fillRect(0, P.sky.length * band, lw, lh)
        // the sun or the moon, with stripes cut through it at dusk
        const ox = Math.round(gapX(lw * PX) / PX) + 44
        const oy = Math.round(Math.min(lh * 0.1, 24))
        const r = 9
        for (let y = -r; y <= r; y++) {
          for (let x = -r; x <= r; x++) {
            if (x * x + y * y > r * r + r) continue
            if (ph === 'dusk' && y > 2 && y % 3 === 0) continue
            g.fillStyle = ph === 'night' && x + 3 > 0 && (x - 3) * (x - 3) + (y + 2) * (y + 2) < r * r ? P.sky[1] : P.orb
            g.fillRect(ox + x, oy + y, 1, 1)
          }
        }
        // mountains, hills with pines, and the ground: strips twice as wide, to scroll
        const sw = lw * 2
        const mk = (draw: (g: CanvasRenderingContext2D) => void) => {
          const c = document.createElement('canvas')
          c.width = sw
          c.height = lh
          draw(c.getContext('2d')!)
          return c
        }
        const ridge = (x: number, period: number, seed: number) => {
          const u = (x / sw) * period
          const i = Math.floor(u)
          const f = u - i
          const a = hash(i % period, seed)
          const c = hash((i + 1) % period, seed)
          return a + (c - a) * f
        }
        strips = [
          {
            c: mk((g) => {
              for (let x = 0; x < sw; x++) {
                const top = Math.round(lh * (0.52 - 0.2 * ridge(x, 9, 1) - 0.05 * ridge(x, 31, 2)))
                g.fillStyle = P.far
                g.fillRect(x, top, 1, lh - top)
                if (top < lh * 0.4) {
                  g.fillStyle = P.snow
                  g.fillRect(x, top, 1, Math.max(1, Math.round((lh * 0.4 - top) * 0.6)))
                }
              }
            }),
            v: 2,
            y: 0
          },
          {
            c: mk((g) => {
              for (let x = 0; x < sw; x++) {
                const top = Math.round(lh * (0.66 - 0.08 * Math.sin((x / sw) * TAU * 5) - 0.05 * ridge(x, 23, 3)))
                g.fillStyle = P.mid
                g.fillRect(x, top, 1, lh - top)
              }
              for (let x = 3; x < sw - 6; x += 7 + Math.floor(hash(x, 4) * 6)) {
                const top = Math.round(lh * (0.66 - 0.08 * Math.sin((x / sw) * TAU * 5) - 0.05 * ridge(x, 23, 3)))
                const th = 6 + Math.floor(hash(x, 5) * 6)
                g.fillStyle = P.tree
                for (let k = 0; k < th; k++) {
                  const half = Math.floor(((th - k) / th) * 3)
                  g.fillRect(x - half, top - k + 2, half * 2 + 1, 1)
                }
              }
            }),
            v: 5,
            y: 0
          },
          {
            c: mk((g) => {
              const gy = lh - 10
              g.fillStyle = P.dirt
              g.fillRect(0, gy, sw, lh - gy)
              g.fillStyle = P.dirt2
              for (let y = gy + 3; y < lh; y += 3) for (let x = (y % 6 === 0 ? 0 : 3); x < sw; x += 6) g.fillRect(x, y, 1, 1)
              g.fillStyle = P.grass
              g.fillRect(0, gy, sw, 2)
              for (let x = 0; x < sw; x += 2) if (hash(x, 7) < 0.4) g.fillRect(x, gy - 1, 1, 1)
            }),
            v: 12,
            y: 0
          }
        ]
        clouds = Array.from({ length: 6 }, (_, i) => {
          const cells: [number, number, number][] = []
          const n = 3 + Math.floor(Math.random() * 3)
          for (let k = 0; k < n; k++) cells.push([k * 5 + Math.floor(Math.random() * 3), -Math.floor(Math.random() * 4), 5 + Math.floor(Math.random() * 4)])
          return { x: Math.random() * lw, y: Math.round(lh * (0.05 + i * 0.07)), cells, v: rand(1.2, 3) }
        })
      }

      return {
        init(w, h) {
          lw = Math.ceil(w / PX)
          lh = Math.ceil(h / PX)
          buf = document.createElement('canvas')
          buf.width = lw
          buf.height = lh
          b = buf.getContext('2d')!
          phase = null
          stars = Array.from({ length: 70 }, () => ({ x: Math.floor(Math.random() * lw), y: Math.floor(Math.random() * lh * 0.5), ph: Math.random() * TAU }))
          const cx = Math.round(gapX(w) / PX)
          isle = { x0: cx - 40, x1: cx + 40, y: Math.round(Math.min(h * 0.17, 150) / PX) }
          blocks = [
            { x: isle.x0 + 18, bump: 0, used: 0 },
            { x: isle.x1 - 26, bump: 0, used: 0 }
          ]
          coins = Array.from({ length: 5 }, (_, i) => ({ x: isle.x0 + 30 + i * 6, y: isle.y - 20, ph: i * 0.6 }))
          hero = { x: isle.x0 + 6, y: isle.y - 10, vy: 0, dir: 1, air: false }
          birds = []
          pops = []
        },
        draw(ctx, w, h, dt, l) {
          if (!b || !buf) return
          t += dt
          const ph = pixelPhase(new Date().getHours())
          if (ph !== phase) {
            phase = ph
            paintSky(ph)
          }
          const P = SKIES[ph]
          const speed = 1 + l.intensity * 0.35
          cam += dt * speed
          if (skyC) b.drawImage(skyC, 0, 0)
          if (ph === 'night') {
            for (const s of stars) if (Math.sin(t * 2 + s.ph) > -0.2) px(s.x, s.y, 1, 1, Math.sin(t * 2 + s.ph) > 0.8 ? '#ffffff' : '#9aa6d8')
          }
          for (const c of clouds) {
            c.x -= c.v * dt
            if (c.x < -30) c.x = lw + 10
            for (const [dx, dy, s] of c.cells) {
              px(c.x + dx, c.y + dy, s, 3 - dy, P.cloud)
              px(c.x + dx + 1, c.y + dy - 1, s - 2, 1, P.cloud)
            }
          }
          // birds flapping across
          nextBird -= dt
          if (nextBird <= 0) {
            birds.push({ x: lw + 4, y: Math.round(lh * rand(0.06, 0.3)), vx: -rand(10, 16), ph: Math.random() * TAU })
            nextBird = rand(6, 14)
          }
          birds = birds.filter((bd) => {
            bd.x += bd.vx * dt
            const up = Math.floor(t * 6 + bd.ph) % 2
            const c = ph === 'night' ? '#c8d0f0' : '#1a1030'
            px(bd.x, bd.y, 1, 1, c)
            px(bd.x - 1, bd.y - (up ? 1 : 0), 1, 1, c)
            px(bd.x + 1, bd.y - (up ? 1 : 0), 1, 1, c)
            px(bd.x - 2, bd.y - (up ? 2 : -1), 1, 1, c)
            px(bd.x + 2, bd.y - (up ? 2 : -1), 1, 1, c)
            return bd.x > -6
          })
          for (const s of strips) {
            const o = Math.floor((cam * s.v) % (lw * 2))
            b.drawImage(s.c, -o, s.y)
            b.drawImage(s.c, lw * 2 - o, s.y)
          }

          // ---- the floating island
          const bob = Math.floor(t * 1.2) % 2
          const iy = isle.y + bob
          for (let x = isle.x0; x < isle.x1; x++) {
            px(x, iy, 1, 2, P.grass)
            const brick = ((x - isle.x0) % 8 === 0 ? '#5a2a1a' : '#b8582c')
            px(x, iy + 2, 1, 5, brick)
            px(x, iy + 4, 1, 1, '#5a2a1a')
          }
          // roots and dirt hanging below
          for (let x = isle.x0 + 4; x < isle.x1 - 4; x += 3) px(x, iy + 7, 1, 1 + Math.floor(hash(x, 9) * 4), P.dirt2)
          // ? blocks: bumped by new usage, empty for a while after
          if (l.pulseAt > lastPulse.current) {
            lastPulse.current = l.pulseAt
            const bl = blocks.find((k) => k.used <= 0) ?? blocks[0]
            bl.bump = 0.25
            bl.used = 8
            pops.push({ x: bl.x + 1, y: iy - 26, t: 0, text: `+${fmtTokens(l.size).replace(/[^0-9.KMBT]/g, '')}` })
            hero.vy = -46
            hero.air = true
          }
          for (const bl of blocks) {
            bl.bump = Math.max(0, bl.bump - dt)
            bl.used = Math.max(0, bl.used - dt)
            const by = iy - 18 - (bl.bump > 0 ? 2 : 0)
            const shine = ['#fcbc3c', '#ffd86a', '#fcbc3c', '#c88a1c'][Math.floor(t * 4) % 4]
            px(bl.x, by, 8, 8, '#5a2a1a')
            px(bl.x + 1, by + 1, 6, 6, bl.used > 0 ? '#8a5a32' : shine)
            if (bl.used <= 0) {
              // the question mark
              for (const [x, y] of [
                [3, 2],
                [4, 2],
                [5, 3],
                [4, 4],
                [4, 6]
              ])
                px(bl.x + x, by + y, 1, 1, '#5a2a1a')
            }
          }
          // coins spinning over the island
          for (const c of coins) {
            const f = Math.floor(t * 6 + c.ph) % 4
            const wdt = [4, 2, 1, 2][f]
            const y = c.y + bob + Math.round(Math.sin(t * 2 + c.ph))
            px(c.x + (4 - wdt) / 2, y, wdt, 5, '#fcbc3c')
            if (wdt > 1) px(c.x + (4 - wdt) / 2, y + 1, 1, 3, '#fff1a8')
          }
          // the explorer runs back and forth, hopping now and then
          nextHop -= dt
          if (nextHop <= 0 && !hero.air) {
            hero.vy = -36
            hero.air = true
            nextHop = rand(2.5, 6)
          }
          hero.x += hero.dir * 9 * dt * speed
          if (hero.x > isle.x1 - 9) hero.dir = -1
          if (hero.x < isle.x0 + 1) hero.dir = 1
          if (hero.air) {
            hero.vy += 140 * dt
            hero.y += hero.vy * dt
            if (hero.y >= isle.y - 10) {
              hero.y = isle.y - 10
              hero.air = false
              hero.vy = 0
            }
          }
          const frame = hero.air ? HERO.jump : Math.floor(t * 8) % 2 ? HERO.run1 : HERO.run2
          for (let y = 0; y < frame.length; y++) {
            for (let x = 0; x < 8; x++) {
              const k = frame[y][hero.dir > 0 ? x : 7 - x]
              if (k !== '.') px(hero.x + x, hero.y + bob + y, 1, 1, HERO_COLORS[k])
            }
          }
          // coins and scores popping out
          pops = pops.filter((pp) => {
            pp.t += dt
            // rising, but never off the top of the window
            const y = Math.max(1, pp.y - Math.round(Math.min(1, pp.t * 2) * 6) - Math.round(pp.t * 2))
            if (pp.t < 0.7) {
              const f = Math.floor(pp.t * 12) % 4
              const wdt = [4, 2, 1, 2][f]
              px(pp.x + (6 - wdt) / 2, y + 7, wdt, 5, '#fcbc3c')
            }
            text(pp.text, pp.x - pp.text.length * 2 + 4, y, Math.floor(pp.t * 8) % 2 ? '#ffffff' : '#fcbc3c')
            return pp.t < 2.2
          })
          ctx.imageSmoothingEnabled = false
          ctx.drawImage(buf, 0, 0, lw * PX, lh * PX)
          ctx.imageSmoothingEnabled = true
          // a faint scanline over it all, like an old screen
          ctx.fillStyle = 'rgba(0,0,0,0.06)'
          for (let y = 0; y < h; y += PX) ctx.fillRect(0, y, w, 1)
        }
      }
    },
    1,
    30
  )
  return <canvas ref={ref} className="scene-canvas" />
}
