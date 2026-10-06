import { useRef } from 'react'
import { fmtTokens } from '@shared/format'
import { rand, TAU, useLive, useScene, type SceneProps } from './ThemeScenes'
import { layer } from './ThemeScenes2'
import { bez, clamp, cssSize, drawBand, drawBird, gapW, gapX, glow, hash, neonText, noiseBand, SIDEBAR, smoothstep } from './sceneKit'

// ---------------------------------------------------------------- 诡秘世界

/** the arcana that drift through the fog: a name and a numeral each */
const ARCANA = [
  { name: '愚者', num: '0' },
  { name: '月亮', num: 'XVIII' },
  { name: '高塔', num: 'XVI' },
  { name: '命运之轮', num: 'X' },
  { name: '星星', num: 'XVII' },
  { name: '隐者', num: 'IX' }
]
const GLYPHS = '☉☽☿♀♂♃♄♅♆♈♉♊♋♌♍♎♏♐♑♒♓'
const GOLD = '#c9a45c'

/** the symbol on an arcanum, in gold line art around (0, 0) */
function arcanumSymbol(g: CanvasRenderingContext2D, i: number, r: number): void {
  g.beginPath()
  switch (i) {
    case 0: {
      // an eye in a triangle
      g.moveTo(0, -r)
      g.lineTo(r * 0.92, r * 0.62)
      g.lineTo(-r * 0.92, r * 0.62)
      g.closePath()
      g.moveTo(-r * 0.5, r * 0.12)
      g.quadraticCurveTo(0, -r * 0.32, r * 0.5, r * 0.12)
      g.quadraticCurveTo(0, r * 0.52, -r * 0.5, r * 0.12)
      g.moveTo(r * 0.14, r * 0.12)
      g.arc(0, r * 0.12, r * 0.14, 0, TAU)
      break
    }
    case 1: {
      // a crescent over falling drops
      g.arc(0, -r * 0.15, r * 0.62, 0.7, TAU - 0.7)
      g.arc(r * 0.28, -r * 0.15, r * 0.5, TAU - 0.95, 0.95, true)
      for (const [x, y] of [
        [-r * 0.5, r * 0.75],
        [0, r * 0.9],
        [r * 0.5, r * 0.75]
      ]) {
        g.moveTo(x, y - r * 0.18)
        g.lineTo(x, y)
      }
      break
    }
    case 2: {
      // a tower struck by lightning
      g.rect(-r * 0.32, -r * 0.35, r * 0.64, r * 1.2)
      g.moveTo(-r * 0.42, -r * 0.35)
      g.lineTo(0, -r * 0.75)
      g.lineTo(r * 0.42, -r * 0.35)
      g.moveTo(r * 0.9, -r * 1)
      g.lineTo(r * 0.35, -r * 0.5)
      g.lineTo(r * 0.62, -r * 0.45)
      g.lineTo(r * 0.12, -r * 0.05)
      break
    }
    case 3: {
      // the wheel
      g.arc(0, 0, r * 0.82, 0, TAU)
      g.moveTo(r * 0.3, 0)
      g.arc(0, 0, r * 0.3, 0, TAU)
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU
        g.moveTo(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3)
        g.lineTo(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82)
      }
      break
    }
    case 4: {
      // an eight-pointed star
      for (let k = 0; k <= 16; k++) {
        const a = (k / 16) * TAU - Math.PI / 2
        const rr = k % 2 ? r * 0.36 : r * 0.95
        if (k) g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
        else g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr)
      }
      break
    }
    default: {
      // the hermit's lantern
      g.rect(-r * 0.36, -r * 0.4, r * 0.72, r * 0.95)
      g.moveTo(-r * 0.46, -r * 0.4)
      g.lineTo(0, -r * 0.78)
      g.lineTo(r * 0.46, -r * 0.4)
      g.moveTo(0, -r * 0.78)
      g.lineTo(0, -r * 1.05)
      g.moveTo(r * 0.14, r * 0.12)
      g.arc(0, r * 0.12, r * 0.14, 0, TAU)
    }
  }
  g.stroke()
}

const CARD_W = 58
const CARD_H = 96

function arcanumCard(i: number): HTMLCanvasElement {
  return layer(CARD_W, CARD_H, (g) => {
    const bg = g.createLinearGradient(0, 0, 0, CARD_H)
    bg.addColorStop(0, '#2c1a24')
    bg.addColorStop(1, '#140a12')
    g.fillStyle = bg
    g.beginPath()
    g.roundRect(0.5, 0.5, CARD_W - 1, CARD_H - 1, 4)
    g.fill()
    g.strokeStyle = GOLD
    g.lineWidth = 1.4
    g.stroke()
    g.strokeStyle = 'rgba(201,164,92,0.45)'
    g.lineWidth = 0.8
    g.strokeRect(5, 5, CARD_W - 10, CARD_H - 10)
    g.fillStyle = GOLD
    g.textAlign = 'center'
    g.font = "600 8px 'Palatino Linotype', 'Book Antiqua', serif"
    g.fillText(ARCANA[i].num, CARD_W / 2, 15)
    g.font = "10px KaiTi, STKaiti, serif"
    g.fillText(ARCANA[i].name, CARD_W / 2, CARD_H - 10)
    g.translate(CARD_W / 2, CARD_H / 2 + 2)
    g.shadowColor = 'rgba(255,200,120,0.8)'
    g.shadowBlur = 6
    g.strokeStyle = '#e6c27a'
    g.lineWidth = 1.3
    g.lineJoin = 'round'
    arcanumSymbol(g, i, 15)
  })
}

function cardBack(): HTMLCanvasElement {
  return layer(CARD_W, CARD_H, (g) => {
    const bg = g.createLinearGradient(0, 0, CARD_W, CARD_H)
    bg.addColorStop(0, '#6a1020')
    bg.addColorStop(1, '#2a0510')
    g.fillStyle = bg
    g.beginPath()
    g.roundRect(0.5, 0.5, CARD_W - 1, CARD_H - 1, 4)
    g.fill()
    g.strokeStyle = GOLD
    g.lineWidth = 1.4
    g.stroke()
    g.strokeStyle = 'rgba(230,194,122,0.7)'
    g.lineWidth = 0.9
    g.translate(CARD_W / 2, CARD_H / 2)
    g.beginPath()
    g.arc(0, 0, 17, 0, TAU)
    g.stroke()
    // a hexagram inside the circle
    g.beginPath()
    for (let k = 0; k < 2; k++) {
      for (let j = 0; j <= 3; j++) {
        const a = (j / 3) * TAU + k * (Math.PI / 3) - Math.PI / 2
        if (j) g.lineTo(Math.cos(a) * 17, Math.sin(a) * 17)
        else g.moveTo(Math.cos(a) * 17, Math.sin(a) * 17)
      }
    }
    g.stroke()
    g.fillStyle = 'rgba(230,194,122,0.8)'
    for (const [x, y] of [
      [-21, -38],
      [21, -38],
      [-21, 38],
      [21, 38]
    ]) {
      g.beginPath()
      g.arc(x, y, 1.6, 0, TAU)
      g.fill()
    }
  })
}

/** a ring of the seal around the moon: circles, ticks, a star polygon and glyphs */
function sealRing(R: number, kind: 0 | 1): HTMLCanvasElement {
  const S = R * 2 + 40
  return layer(S, S, (g) => {
    g.translate(S / 2, S / 2)
    g.strokeStyle = kind ? 'rgba(201,164,92,0.9)' : 'rgba(220,60,70,0.9)'
    g.fillStyle = g.strokeStyle
    g.lineWidth = 1.1
    g.beginPath()
    g.arc(0, 0, R, 0, TAU)
    g.stroke()
    g.beginPath()
    g.arc(0, 0, R - 9, 0, TAU)
    g.stroke()
    if (kind === 0) {
      for (let k = 0; k < 72; k++) {
        const a = (k / 72) * TAU
        const l = k % 6 ? 3 : 7
        g.beginPath()
        g.moveTo(Math.cos(a) * (R - 9), Math.sin(a) * (R - 9))
        g.lineTo(Math.cos(a) * (R - 9 + l), Math.sin(a) * (R - 9 + l))
        g.stroke()
      }
    } else {
      // a heptagram {7/3} and the glyphs between the rings
      g.beginPath()
      for (let k = 0; k <= 7; k++) {
        const a = ((k * 3) / 7) * TAU - Math.PI / 2
        if (k) g.lineTo(Math.cos(a) * (R - 9), Math.sin(a) * (R - 9))
        else g.moveTo(Math.cos(a) * (R - 9), Math.sin(a) * (R - 9))
      }
      g.stroke()
      g.font = "9px 'Segoe UI Symbol', serif"
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      const glyphs = [...GLYPHS]
      glyphs.forEach((ch, k) => {
        const a = (k / glyphs.length) * TAU
        g.save()
        g.rotate(a)
        g.fillText(ch, 0, -(R - 4.5))
        g.restore()
      })
    }
  })
}

type Roof = 'pitch' | 'spire' | 'dome' | 'gable' | 'flat'

/**
 * Gothic city blocks along the bottom of a w×h layer: pitched roofs with
 * chimneys, spires, domes, stepped gables; lit windows are returned so a few
 * can switch on and off.
 */
function gothicCity(w: number, h: number, o: { color: string; seed: number; min: number; max: number; lit: number; window: string }): HTMLCanvasElement {
  return layer(w, h, (g) => {
    let x = -20
    let i = 0
    while (x < w + 20) {
      const bw = 24 + hash(i, o.seed) * 58
      const bh = h * (o.min + hash(i, o.seed + 1) * (o.max - o.min))
      const top = h - bh
      const r = hash(i, o.seed + 2)
      const roof: Roof = r < 0.34 ? 'pitch' : r < 0.52 ? 'spire' : r < 0.64 ? 'dome' : r < 0.8 ? 'gable' : 'flat'
      g.fillStyle = o.color
      g.beginPath()
      g.rect(x, top, bw, bh)
      if (roof === 'pitch') {
        g.moveTo(x - 2, top)
        g.lineTo(x + bw / 2, top - bw * 0.42)
        g.lineTo(x + bw + 2, top)
        g.rect(x + bw * 0.72, top - bw * 0.36, 5, bw * 0.3)
      } else if (roof === 'spire') {
        const tw = bw * 0.46
        const th = h * 0.05 + hash(i, o.seed + 3) * h * 0.05
        g.rect(x + (bw - tw) / 2, top - th, tw, th)
        g.moveTo(x + (bw - tw) / 2 - 3, top - th)
        g.lineTo(x + bw / 2, top - th - bw * 1.3)
        g.lineTo(x + (bw + tw) / 2 + 3, top - th)
        // pinnacles on the corners
        for (const px of [x + 1, x + bw - 1]) {
          g.moveTo(px - 3, top)
          g.lineTo(px, top - bw * 0.35)
          g.lineTo(px + 3, top)
        }
      } else if (roof === 'dome') {
        g.moveTo(x + bw, top)
        g.arc(x + bw / 2, top, bw / 2, 0, Math.PI, true)
        g.rect(x + bw / 2 - 1, top - bw / 2 - 12, 2, 12)
      } else if (roof === 'gable') {
        const steps = 4
        for (let k = 0; k < steps; k++) {
          const inset = (bw / 2 / steps) * k
          g.rect(x + inset, top - k * 6 - 6, bw - inset * 2, 6)
        }
      } else {
        g.rect(x - 2, top - 3, bw + 4, 3)
        for (let k = 0; k < 3; k++) g.rect(x + 4 + k * (bw / 3), top - 10, 4, 10)
      }
      g.fill()
      // windows: warm lamplight in some, Gothic arches in the spires
      g.fillStyle = o.window
      for (let wy = top + 8; wy < h - 6; wy += 13) {
        for (let wx = x + 5; wx < x + bw - 6; wx += 9) {
          const k = hash(Math.round(wx * 7 + wy), o.seed + 9)
          if (k > o.lit) continue
          g.globalAlpha = 0.55 + hash(Math.round(wx + wy * 3), o.seed) * 0.45
          if (roof === 'spire') {
            g.beginPath()
            g.rect(wx, wy + 2, 3.2, 5)
            g.arc(wx + 1.6, wy + 2, 1.6, Math.PI, 0)
            g.fill()
          } else g.fillRect(wx, wy, 3.2, 4.5)
        }
      }
      g.globalAlpha = 1
      x += bw + (hash(i, o.seed + 4) < 0.25 ? 6 + hash(i, o.seed + 5) * 14 : -2)
      i++
    }
  })
}

/**
 * 诡秘世界: a Victorian city under a crimson moon. A slowly turning seal of
 * rings and glyphs around the moon, grey fog rolling through the streets in
 * layers, gas lamps flickering, arcana cards drifting up through the fog and
 * turning over, ravens crossing the moon, and a clock tower in the sidebar
 * that keeps the real time. New usage turns up an arcanum in a flash of gold,
 * flares the seal and tolls the clock; more usage thickens and quickens the fog.
 */
export function Mystic(p: SceneProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useLive(p)
  const lastPulse = useRef(0)
  useScene(
    ref,
    p.level,
    live,
    () => {
      let W = 0
      let H = 0
      let sky: HTMLCanvasElement | null = null
      let moon: HTMLCanvasElement | null = null
      let ringA: HTMLCanvasElement | null = null
      let ringB: HTMLCanvasElement | null = null
      let far: HTMLCanvasElement | null = null
      let near: HTMLCanvasElement | null = null
      let fogs: { c: HTMLCanvasElement; y: number; h: number; v: number; a: number }[] = []
      let red: HTMLCanvasElement | null = null
      let warm: HTMLCanvasElement | null = null
      let gold: HTMLCanvasElement | null = null
      let wisp: HTMLCanvasElement | null = null
      let fronts: HTMLCanvasElement[] = []
      let back: HTMLCanvasElement | null = null
      let lamps: { x: number; y: number; ph: number }[] = []
      let twinkles: { x: number; y: number; r: number; ph: number }[] = []
      let embers: { x: number; y: number; v: number; s: number; ph: number; gold: boolean }[] = []
      let cards: { x: number; y: number; vx: number; vy: number; rot: number; spin: number; flip: number; i: number; s: number; glow: number; settle: boolean }[] = []
      let ravens: { x: number; y: number; vx: number; s: number; ph: number }[] = []
      let tolls: number[] = []
      let mx = 0
      let my = 0
      let mr = 0
      let tx = 0
      let fy = 0
      let fr = 0
      let t = 0
      let flare = 0
      let nextRaven = 5
      let lastHour = -1

      const newCard = (anywhere: boolean) => ({
        x: rand(0.04, 0.96) * W,
        y: anywhere ? rand(0.05, 1) * H : H + rand(60, 260),
        vx: rand(-5, 5),
        vy: -rand(5, 11),
        rot: rand(-0.3, 0.3),
        spin: rand(0.25, 0.55) * (Math.random() < 0.5 ? 1 : -1),
        flip: Math.random() * TAU,
        i: Math.floor(Math.random() * ARCANA.length),
        s: rand(0.65, 1.05),
        glow: 0,
        settle: false
      })

      return {
        init(w, h) {
          W = w
          H = h
          mx = gapX(w)
          mr = clamp(Math.min(w, h) * 0.072, 40, 78)
          my = Math.min(h * 0.12, mr + 36)
          tx = Math.min(140, w * 0.1)
          fy = h * 0.6
          fr = 22
          red = glow('220,40,60', 128, 0.2, 0.5)
          warm = glow('255,200,120', 64, 0.25, 0.55)
          gold = glow('255,214,140', 96, 0.2, 0.45)
          wisp = glow('34,16,38', 64, 0.3, 0.75)
          sky = layer(w, h, (g) => {
            const gr = g.createLinearGradient(0, 0, 0, h)
            gr.addColorStop(0, '#06040a')
            gr.addColorStop(0.45, '#150a19')
            gr.addColorStop(0.75, '#2a0f1f')
            gr.addColorStop(1, '#3b1525')
            g.fillStyle = gr
            g.fillRect(0, 0, w, h)
            for (let i = 0; i < (w * h) / 6000; i++) {
              g.globalAlpha = 0.15 + Math.random() * 0.45
              g.fillStyle = Math.random() < 0.3 ? '#ffb0a8' : '#f2e6ea'
              const s = Math.random() < 0.08 ? 1.6 : 0.9
              g.fillRect(Math.random() * w, Math.random() * h * 0.6, s, s)
            }
          })
          twinkles = Array.from({ length: 34 }, () => ({ x: Math.random() * w, y: Math.random() * h * 0.5, r: rand(0.8, 1.8), ph: Math.random() * TAU }))
          // the crimson moon, with darker seas and a lit rim
          const S = Math.ceil(mr * 2 + 4)
          moon = layer(S, S, (g) => {
            const c = S / 2
            const gr = g.createRadialGradient(c - mr * 0.3, c - mr * 0.3, mr * 0.1, c, c, mr)
            gr.addColorStop(0, '#ff8a6a')
            gr.addColorStop(0.5, '#d62a3c')
            gr.addColorStop(0.85, '#8e1222')
            gr.addColorStop(1, '#4e0814')
            g.fillStyle = gr
            g.beginPath()
            g.arc(c, c, mr, 0, TAU)
            g.fill()
            g.save()
            g.clip()
            for (const [x, y, r] of [
              [-0.3, -0.2, 0.3],
              [0.22, -0.05, 0.22],
              [-0.05, 0.32, 0.3],
              [0.4, 0.36, 0.14],
              [-0.48, 0.2, 0.14]
            ]) {
              const sg = g.createRadialGradient(c + x * mr, c + y * mr, 0, c + x * mr, c + y * mr, r * mr)
              sg.addColorStop(0, 'rgba(70,0,14,0.4)')
              sg.addColorStop(1, 'rgba(70,0,14,0)')
              g.fillStyle = sg
              g.fillRect(0, 0, S, S)
            }
            g.restore()
            g.strokeStyle = 'rgba(255,170,150,0.45)'
            g.lineWidth = 1.2
            g.beginPath()
            g.arc(c, c, mr - 0.6, Math.PI * 0.9, Math.PI * 1.6)
            g.stroke()
          })
          ringA = sealRing(mr * 1.55, 0)
          ringB = sealRing(mr * 2.15, 1)
          far = gothicCity(w, h, { color: '#1c1022', seed: 3, min: 0.16, max: 0.36, lit: 0.12, window: '#e8a860' })
          // the near street, with the clock tower in the sidebar and the lamp posts
          lamps = []
          for (let x = 60; x < w; x += 150 + hash(x, 2) * 60) lamps.push({ x, y: h * 0.935, ph: Math.random() * TAU })
          near = layer(w, h, (g) => {
            const city = gothicCity(w, h, { color: '#0b070e', seed: 11, min: 0.07, max: 0.22, lit: 0.08, window: '#ffc070' })
            g.drawImage(city, 0, 0, w, h)
            g.fillStyle = '#0b070e'
            // the clock tower: body, belfry, spire with pinnacles
            const bw = fr * 3
            g.beginPath()
            g.rect(tx - bw / 2, fy - fr * 1.6, bw, h - fy + fr * 1.6)
            g.rect(tx - bw * 0.4, fy - fr * 3.3, bw * 0.8, fr * 1.8)
            g.moveTo(tx - bw * 0.48, fy - fr * 3.3)
            g.lineTo(tx, fy - fr * 7.2)
            g.lineTo(tx + bw * 0.48, fy - fr * 3.3)
            for (const s of [-1, 1]) {
              const px = tx + (s * bw) / 2
              g.moveTo(px - 4, fy - fr * 1.6)
              g.lineTo(px, fy - fr * 3)
              g.lineTo(px + 4, fy - fr * 1.6)
            }
            g.fill()
            // the belfry's arches, faintly lit
            g.fillStyle = 'rgba(255,150,110,0.18)'
            for (const s of [-1, 1]) {
              g.beginPath()
              g.rect(tx + s * bw * 0.18 - 4, fy - fr * 2.8, 8, fr * 0.9)
              g.arc(tx + s * bw * 0.18, fy - fr * 2.8, 4, Math.PI, 0)
              g.fill()
            }
            g.fillStyle = '#0b070e'
            g.beginPath()
            g.arc(tx, fy, fr + 5, 0, TAU)
            g.fill()
            // lamp posts
            for (const l of lamps) {
              g.fillRect(l.x - 1.2, l.y, 2.4, h - l.y)
              g.fillRect(l.x - 5, l.y - 3, 10, 3)
              g.beginPath()
              g.moveTo(l.x - 4, l.y - 3)
              g.lineTo(l.x, l.y - 13)
              g.lineTo(l.x + 4, l.y - 3)
              g.fill()
            }
          })
          // fog in layers: high wisps, between the skylines, in the street, and a thin one in front
          const fogShape = (yk: number) => smoothstep(0, 0.45, yk) * (1 - smoothstep(0.85, 1, yk) * 0.3)
          fogs = [
            { c: noiseBand(w, h * 0.22, { rgb: '150,138,170', cells: 6, seed: 4, lo: 0.42, hi: 0.78, alpha: 0.3, shape: (y) => Math.sin(y * Math.PI) }), y: h * 0.28, h: h * 0.22, v: 6, a: 1 },
            { c: noiseBand(w, h * 0.32, { rgb: '128,116,148', cells: 5, seed: 7, lo: 0.32, hi: 0.72, alpha: 0.55, shape: fogShape }), y: h * 0.5, h: h * 0.32, v: 10, a: 1 },
            { c: noiseBand(w, h * 0.3, { rgb: '112,102,132', cells: 7, seed: 9, lo: 0.28, hi: 0.68, alpha: 0.7, shape: fogShape }), y: h * 0.72, h: h * 0.3, v: 16, a: 1 },
            { c: noiseBand(w, h * 0.18, { rgb: '170,160,190', cells: 9, seed: 13, lo: 0.55, hi: 0.85, alpha: 0.3, shape: (y) => Math.sin(y * Math.PI) }), y: h * 0.56, h: h * 0.18, v: 26, a: 1 }
          ]
          fronts = ARCANA.map((_, i) => arcanumCard(i))
          back = cardBack()
          embers = Array.from({ length: 40 }, () => ({ x: Math.random() * w, y: Math.random() * h, v: rand(8, 22), s: rand(0.8, 2.2), ph: Math.random() * TAU, gold: Math.random() < 0.35 }))
          cards = Array.from({ length: 5 }, () => newCard(true))
          ravens = []
          tolls = []
        },
        draw(ctx, w, h, dt, l) {
          t += dt
          const speed = 1 + l.intensity * 0.4
          flare = Math.max(0, flare - dt * 0.45)
          if (sky) ctx.drawImage(sky, 0, 0, w, h)
          ctx.fillStyle = '#ffe8ee'
          for (const s of twinkles) {
            ctx.globalAlpha = 0.25 + 0.6 * Math.max(0, Math.sin(t * 1.6 + s.ph))
            ctx.fillRect(s.x, s.y, s.r, s.r)
          }
          ctx.globalAlpha = 1

          // ---- the crimson moon in its turning seal
          const breathe = 0.8 + 0.2 * Math.sin(t * 0.6)
          if (red) {
            ctx.globalAlpha = Math.min(1, (0.7 + 0.3 * flare) * breathe * (0.75 + l.vivid * 0.4))
            ctx.drawImage(red, mx - mr * 5.5, my - mr * 5.5, mr * 11, mr * 11)
            ctx.globalAlpha = 1
          }
          ctx.save()
          ctx.globalCompositeOperation = 'lighter'
          for (const [ring, sp, a] of [
            [ringA, 0.035, 0.32],
            [ringB, -0.022, 0.26]
          ] as const) {
            if (!ring) continue
            const S = ring === ringA ? mr * 3.1 + 40 : mr * 4.3 + 40
            ctx.save()
            ctx.translate(mx, my)
            ctx.rotate(t * sp * (1 + flare * 3) * speed)
            ctx.globalAlpha = Math.min(1, a * (1 + flare * 2.2) * (0.6 + l.vivid * 0.5))
            ctx.drawImage(ring, -S / 2, -S / 2, S, S)
            ctx.restore()
          }
          ctx.restore()
          if (moon) ctx.drawImage(moon, mx - mr - 2, my - mr - 2, mr * 2 + 4, mr * 2 + 4)
          // dark wisps of cloud passing over the moon
          if (wisp) {
            for (let i = 0; i < 3; i++) {
              const span = w * 0.5
              const x = mx - span / 2 + ((t * (7 + i * 3) + i * 170) % span)
              const y = my - mr * 0.5 + i * mr * 0.45
              ctx.globalAlpha = 0.55 * Math.sin(((x - mx + span / 2) / span) * Math.PI)
              ctx.drawImage(wisp, x - mr * 1.4, y - mr * 0.18, mr * 2.8, mr * 0.36)
            }
            ctx.globalAlpha = 1
          }

          // ---- ravens across the moon
          nextRaven -= dt
          if (nextRaven <= 0) {
            const dir = Math.random() < 0.5 ? 1 : -1
            const n = Math.random() < 0.4 ? 3 : 1
            for (let k = 0; k < n; k++) ravens.push({ x: dir > 0 ? -40 - k * 46 : w + 40 + k * 46, y: my + rand(-mr, mr * 1.6) + k * 14, vx: dir * rand(70, 110), s: rand(7, 11), ph: Math.random() * TAU })
            nextRaven = rand(12, 26)
          }
          ctx.fillStyle = '#07040a'
          ravens = ravens.filter((r) => {
            r.x += r.vx * dt
            const flap = Math.sin(t * 7 + r.ph)
            drawBird(ctx, r.x, r.y + Math.sin(t * 1.3 + r.ph) * 6, r.s, flap, Math.sign(r.vx))
            return r.x > -120 && r.x < w + 120
          })

          // ---- the far city, fog, the near street with its tower and lamps, more fog
          if (far) ctx.drawImage(far, 0, 0, w, h)
          const [f0, f1, f2, f3] = fogs
          const fogA = 0.85 + l.intensity * 0.06
          ctx.globalAlpha = fogA
          if (f0) drawBand(ctx, f0.c, t * f0.v * speed, f0.y + Math.sin(t * 0.2) * 6, w, f0.h)
          if (f1) {
            drawBand(ctx, f1.c, t * f1.v * speed, f1.y, w, f1.h)
            ctx.globalAlpha = fogA * 0.5
            drawBand(ctx, f1.c, -t * f1.v * 0.6 * speed + w * 0.4, f1.y + 10, w, f1.h)
          }
          ctx.globalAlpha = 1
          if (near) ctx.drawImage(near, 0, 0, w, h)

          // the clock face keeps the real time; it tolls on the hour and for new usage
          const now = new Date()
          if (now.getMinutes() === 0 && now.getHours() !== lastHour) {
            lastHour = now.getHours()
            tolls.push(0)
          }
          if (warm) {
            ctx.globalAlpha = 0.55 + flare * 0.4
            ctx.drawImage(warm, tx - fr * 4, fy - fr * 4, fr * 8, fr * 8)
            ctx.globalAlpha = 1
          }
          const face = ctx.createRadialGradient(tx, fy, 0, tx, fy, fr)
          face.addColorStop(0, '#fff2cc')
          face.addColorStop(0.75, '#efc979')
          face.addColorStop(1, '#9c6d34')
          ctx.fillStyle = face
          ctx.beginPath()
          ctx.arc(tx, fy, fr, 0, TAU)
          ctx.fill()
          ctx.strokeStyle = '#3a2410'
          ctx.lineCap = 'round'
          for (let k = 0; k < 12; k++) {
            const a = (k / 12) * TAU
            ctx.lineWidth = k % 3 ? 1 : 2
            ctx.beginPath()
            ctx.moveTo(tx + Math.cos(a) * fr * 0.76, fy + Math.sin(a) * fr * 0.76)
            ctx.lineTo(tx + Math.cos(a) * fr * 0.92, fy + Math.sin(a) * fr * 0.92)
            ctx.stroke()
          }
          const hand = (a: number, len: number, width: number, color: string) => {
            ctx.strokeStyle = color
            ctx.lineWidth = width
            ctx.beginPath()
            ctx.moveTo(tx - Math.cos(a) * fr * 0.12, fy - Math.sin(a) * fr * 0.12)
            ctx.lineTo(tx + Math.cos(a) * len, fy + Math.sin(a) * len)
            ctx.stroke()
          }
          const hh = (now.getHours() % 12) + now.getMinutes() / 60
          const mm = now.getMinutes() + now.getSeconds() / 60
          hand((hh / 12) * TAU - Math.PI / 2, fr * 0.5, 2.6, '#2a1808')
          hand((mm / 60) * TAU - Math.PI / 2, fr * 0.78, 1.6, '#2a1808')
          hand((now.getSeconds() / 60) * TAU - Math.PI / 2, fr * 0.84, 0.8, '#a01828')
          tolls = tolls.map((k) => k + dt / 3).filter((k) => k < 1)
          ctx.lineWidth = 1.5
          for (const k of tolls) {
            ctx.strokeStyle = `rgba(255,214,150,${((1 - k) * 0.5).toFixed(3)})`
            for (const lag of [0, 0.12]) {
              const q = k - lag
              if (q <= 0) continue
              ctx.beginPath()
              ctx.arc(tx, fy, fr + q * 190, 0, TAU)
              ctx.stroke()
            }
          }

          // gas lamps flicker in the fog
          if (warm) {
            for (const lp of lamps) {
              const fl = 0.78 + 0.16 * Math.sin(t * 9 + lp.ph) * Math.sin(t * 3.1 + lp.ph * 2) + (hash(Math.floor(t * 6), lp.ph * 100) < 0.02 ? -0.5 : 0)
              ctx.globalAlpha = 0.35 * fl
              ctx.drawImage(warm, lp.x - 70, lp.y - 78, 140, 140)
              ctx.globalAlpha = fl
              ctx.drawImage(warm, lp.x - 9, lp.y - 17, 18, 18)
            }
            ctx.globalAlpha = 1
          }
          ctx.globalAlpha = fogA
          if (f2) {
            drawBand(ctx, f2.c, t * f2.v * speed, f2.y, w, f2.h)
            ctx.globalAlpha = fogA * 0.55
            drawBand(ctx, f2.c, -t * f2.v * 0.7 * speed + w * 0.3, f2.y + 18, w, f2.h)
          }
          ctx.globalAlpha = 1

          // ---- arcana drifting up through the fog; new usage turns one up in gold
          if (l.pulseAt > lastPulse.current) {
            lastPulse.current = l.pulseAt
            const n = l.size > 1_000_000 ? 3 : 1
            for (let k = 0; k < n; k++) {
              const c = newCard(true)
              c.x = mx + (k - (n - 1) / 2) * 90 + rand(-20, 20)
              c.y = my + mr * 1.9 + rand(-10, 30)
              c.spin = 7 + k
              c.glow = 1
              c.settle = true
              c.s = 1.15
              cards.push(c)
            }
            flare = 1
            tolls.push(0)
          }
          const want = 5 + l.intensity
          if (cards.length < want) cards.push(newCard(false))
          cards = cards.filter((c) => {
            c.x += (c.vx + Math.sin(t * 0.4 + c.i) * 3) * dt
            c.y += c.vy * dt * (c.glow > 0.2 ? 0.2 : 1)
            if (c.settle) {
              // spin fast, slow down and come to rest face up
              c.spin *= Math.pow(0.35, dt)
              if (Math.abs(c.spin) < 0.6) {
                const target = Math.round(c.flip / TAU) * TAU
                c.flip += (target - c.flip) * Math.min(1, dt * 3)
                if (Math.abs(target - c.flip) < 0.01) {
                  c.settle = false
                  c.spin = 0.3
                }
              } else c.flip += c.spin * dt
            } else c.flip += c.spin * dt
            c.glow = Math.max(0, c.glow - dt * 0.18)
            const k = Math.cos(c.flip)
            if (c.glow > 0.02 && gold) {
              ctx.globalAlpha = c.glow * 0.9
              ctx.drawImage(gold, c.x - CARD_H * 1.3, c.y - CARD_H * 1.3, CARD_H * 2.6, CARD_H * 2.6)
            }
            ctx.globalAlpha = Math.min(1, (0.55 + 0.45 * c.glow) * clamp((h + 40 - c.y) / 120, 0, 1) * clamp((c.y + 60) / 120, 0, 1))
            ctx.save()
            ctx.translate(c.x, c.y)
            ctx.rotate(c.rot + Math.sin(t * 0.5 + c.i) * 0.08)
            ctx.scale(Math.max(0.03, Math.abs(k)) * c.s, c.s)
            const img = k >= 0 ? fronts[c.i] : back
            if (img) ctx.drawImage(img, -CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H)
            ctx.restore()
            return c.y > -120 && c.x > -120 && c.x < w + 120
          })
          ctx.globalAlpha = 1

          // embers of red and gold rising, and the thin fog in front of it all
          ctx.globalCompositeOperation = 'lighter'
          for (const e of embers) {
            e.y -= e.v * dt * speed
            e.x += Math.sin(t * 0.8 + e.ph) * 6 * dt
            if (e.y < -10) {
              e.y = h + 10
              e.x = Math.random() * w
            }
            ctx.globalAlpha = 0.25 + 0.45 * Math.max(0, Math.sin(t * 2 + e.ph))
            ctx.fillStyle = e.gold ? '#ffcf80' : '#ff5a5a'
            ctx.fillRect(e.x, e.y, e.s, e.s)
          }
          ctx.globalCompositeOperation = 'source-over'
          ctx.globalAlpha = fogA * 0.8
          if (f3) drawBand(ctx, f3.c, t * f3.v * speed, f3.y + Math.sin(t * 0.3) * 10, w, f3.h)
          ctx.globalAlpha = 1
        }
      }
    },
    1,
    30
  )
  return <canvas ref={ref} className="scene-canvas" />
}

// ---------------------------------------------------------------- 赛博朋克

const CYAN = '0,240,255'
const PINK = '255,42,109'
const YELLOW = '252,238,10'
const ADS = ['夜之城 · 神经超频', 'TOKENPULSE · 24H ONLINE', '拉面 · 义体 · 电子街', '今夜全城在线', 'NEURAL LINK · 已同步']

/** a skyline of towers for one depth, windows in rows of lit and unlit */
function towers(w: number, h: number, o: { color: string; seed: number; min: number; max: number; lit: number; windows: string[] }): HTMLCanvasElement {
  return layer(w, h, (g) => {
    let x = -10
    let i = 0
    while (x < w + 10) {
      const bw = 34 + hash(i, o.seed) * 70
      const bh = h * (o.min + hash(i, o.seed + 1) ** 1.6 * (o.max - o.min))
      const top = h - bh
      g.fillStyle = o.color
      g.fillRect(x, top, bw, bh)
      // set-backs and antennas on the tall ones
      if (bh > h * (o.min + (o.max - o.min) * 0.5)) {
        g.fillRect(x + bw * 0.2, top - 16, bw * 0.6, 16)
        g.fillRect(x + bw * 0.48, top - 16 - h * 0.04, 2, h * 0.04)
      }
      const cw = 4
      const gapW = 3
      for (let wy = top + 6; wy < h - 4; wy += 7) {
        const rowLit = hash(Math.round(wy), i + o.seed) < 0.75
        for (let wx = x + 4; wx < x + bw - 5; wx += cw + gapW) {
          if (!rowLit || hash(Math.round(wx * 3 + wy), o.seed + 7) > o.lit) continue
          g.globalAlpha = 0.35 + hash(Math.round(wx + wy), o.seed) * 0.6
          g.fillStyle = o.windows[Math.floor(hash(Math.round(wx), Math.round(wy)) * o.windows.length)]
          g.fillRect(wx, wy, cw, 2.4)
        }
      }
      g.globalAlpha = 1
      x += bw + (hash(i, o.seed + 3) < 0.3 ? 8 : 1)
      i++
    }
  })
}

/** the twelve vertices of an icosahedron and its thirty edges */
const PHI = (1 + Math.sqrt(5)) / 2
const ICO_V: [number, number, number][] = [
  [-1, PHI, 0],
  [1, PHI, 0],
  [-1, -PHI, 0],
  [1, -PHI, 0],
  [0, -1, PHI],
  [0, 1, PHI],
  [0, -1, -PHI],
  [0, 1, -PHI],
  [PHI, 0, -1],
  [PHI, 0, 1],
  [-PHI, 0, -1],
  [-PHI, 0, 1]
]
const ICO_E: [number, number][] = []
for (let a = 0; a < 12; a++)
  for (let b = a + 1; b < 12; b++) {
    const d = Math.hypot(ICO_V[a][0] - ICO_V[b][0], ICO_V[a][1] - ICO_V[b][1], ICO_V[a][2] - ICO_V[b][2])
    if (Math.abs(d - 2) < 0.01) ICO_E.push([a, b])
  }

/**
 * 赛博朋克: a rainy megacity at night. Three depths of towers with flickering
 * windows, vertical neon signs (one glowing down the sidebar), searchlights
 * sweeping the smog, lanes of flying cars with light trails, rain, and a
 * holographic billboard on the central tower with a turning wireframe and
 * ad copy typing itself out. New usage glitches the billboard, puts the
 * tokens on it in yellow and sends a patrol car howling past.
 */
export function Cyberpunk(p: SceneProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useLive(p)
  const lastPulse = useRef(0)
  useScene(
    ref,
    p.level,
    live,
    () => {
      let W = 0
      let H = 0
      let bg: HTMLCanvasElement | null = null
      let smog: HTMLCanvasElement | null = null
      let far: HTMLCanvasElement | null = null
      let mid: HTMLCanvasElement | null = null
      let near: HTMLCanvasElement | null = null
      let signs: { c: HTMLCanvasElement; x: number; y: number; seed: number; off: number }[] = []
      let cars: { y: number; x: number; v: number; d: number; dir: number }[] = []
      let patrol: { x: number; y: number; v: number } | null = null
      let rainA: { x: number; y: number; l: number }[] = []
      let rainB: { x: number; y: number; l: number }[] = []
      let pinkGlow: HTMLCanvasElement | null = null
      let cyanGlow: HTMLCanvasElement | null = null
      let bill = { x: 0, y: 0, w: 0, h: 0 }
      let t = 0
      let glitch = 0
      let nextGlitch = 9
      let flash: { text: string; t: number } | null = null
      const lanes = [0.07, 0.13, 0.2, 0.28, 0.36, 0.46]

      const newCar = (anywhere: boolean) => {
        const li = Math.floor(Math.random() * lanes.length)
        const d = 0.45 + (li / lanes.length) * 0.9 + rand(-0.1, 0.1)
        const dir = li % 2 ? -1 : 1
        return { y: lanes[li] * H + rand(-6, 6), x: anywhere ? Math.random() * W : dir > 0 ? -40 : W + 40, v: (50 + 150 * d) * rand(0.8, 1.2), d, dir }
      }

      return {
        init(w, h) {
          W = w
          H = h
          const gx = gapX(w)
          const bw = clamp(gapW(w) * 0.78, 190, 330)
          bill = { x: gx, y: Math.min(h * 0.12, 112), w: bw, h: bw * 0.42 }
          bg = layer(w, h, (g) => {
            const gr = g.createLinearGradient(0, 0, 0, h)
            gr.addColorStop(0, '#05040c')
            gr.addColorStop(0.35, '#140a24')
            gr.addColorStop(0.7, '#2a0c34')
            gr.addColorStop(1, '#3a0d2e')
            g.fillStyle = gr
            g.fillRect(0, 0, w, h)
            // the city's glow on the low cloud
            const cg = g.createRadialGradient(w * 0.5, h * 0.9, 0, w * 0.5, h * 0.9, h * 0.9)
            cg.addColorStop(0, 'rgba(255,42,109,0.28)')
            cg.addColorStop(0.5, 'rgba(120,40,200,0.12)')
            cg.addColorStop(1, 'rgba(0,0,0,0)')
            g.fillStyle = cg
            g.fillRect(0, 0, w, h)
          })
          smog = noiseBand(w, h * 0.4, { rgb: '120,40,110', lit: '255,90,170', cells: 5, seed: 21, lo: 0.35, hi: 0.8, alpha: 0.55, shape: (y) => Math.sin(y * Math.PI) ** 0.7 })
          far = towers(w, h, { color: '#120d26', seed: 1, min: 0.3, max: 0.72, lit: 0.22, windows: ['#3a6aa0', '#6a3a90', '#2a8aa0'] })
          mid = layer(w, h, (g) => {
            g.drawImage(towers(w, h, { color: '#0b0819', seed: 5, min: 0.22, max: 0.55, lit: 0.3, windows: ['#ffd060', '#4ae8ff', '#ff5fa0', '#c8d8ff'] }), 0, 0, w, h)
            // the billboard's tower, rising into the header gap
            g.fillStyle = '#0a0716'
            g.fillRect(bill.x - bill.w * 0.24, bill.y + bill.h / 2, bill.w * 0.48, h)
            g.fillStyle = 'rgba(0,240,255,0.35)'
            g.fillRect(bill.x - bill.w * 0.24, bill.y + bill.h / 2, 1.5, h)
            g.fillRect(bill.x + bill.w * 0.24 - 1.5, bill.y + bill.h / 2, 1.5, h)
          })
          near = towers(w, h, { color: '#05040b', seed: 9, min: 0.08, max: 0.3, lit: 0.12, windows: ['#ffb040', '#ff4f8b'] })
          // neon signs: one tall sign down the sidebar, others on the towers
          // the tall sign hangs at the sidebar's right edge, the small ones in its empty middle
          const sx = Math.min(SIDEBAR - 22, w * 0.15)
          signs = [
            { c: neonText('電子街', { color: '#ff2a6d', size: 24, vertical: true }), x: sx, y: h * 0.3, seed: 1, off: 0 },
            { c: neonText('拉麵', { color: '#00f0ff', size: 18, vertical: true, box: true }), x: sx - 54, y: h * 0.56, seed: 2, off: 0 },
            { c: neonText('OPEN 24H', { color: '#fcee0a', size: 12, box: true }), x: sx - 128, y: h * 0.6, seed: 3, off: 0 },
            { c: neonText('義体診所', { color: '#00f0ff', size: 18 }), x: w * 0.36, y: h * 0.52, seed: 4, off: 0 },
            { c: neonText('BAR', { color: '#ff2a6d', size: 20, box: true }), x: w - 18, y: h * 0.58, seed: 5, off: 0 },
            { c: neonText('酒', { color: '#fcee0a', size: 22, vertical: true, box: true }), x: w - 16, y: h * 0.72, seed: 6, off: 0 },
            { c: neonText('NEURAL', { color: '#b46cff', size: 16 }), x: w * 0.72, y: h * 0.6, seed: 7, off: 0 },
            { c: neonText('夜', { color: '#ff2a6d', size: 30, box: true }), x: w * 0.56, y: h * 0.7, seed: 8, off: 0 }
          ]
          pinkGlow = glow(PINK, 64, 0.2, 0.5)
          cyanGlow = glow(CYAN, 64, 0.2, 0.5)
          cars = Array.from({ length: 16 }, () => newCar(true))
          rainA = Array.from({ length: Math.round((w * h) / 9000) }, () => ({ x: Math.random() * w, y: Math.random() * h, l: rand(14, 26) }))
          rainB = Array.from({ length: Math.round((w * h) / 14000) }, () => ({ x: Math.random() * w, y: Math.random() * h, l: rand(7, 12) }))
        },
        draw(ctx, w, h, dt, l) {
          t += dt
          const speed = 1 + l.intensity * 0.35
          if (bg) ctx.drawImage(bg, 0, 0, w, h)
          // searchlights through the smog
          ctx.save()
          ctx.globalCompositeOperation = 'lighter'
          for (const [bx, ph, rgb] of [
            [0.24, 0, '160,200,255'],
            [0.8, 2.1, '255,140,220']
          ] as const) {
            const a = -Math.PI / 2 + 0.38 * Math.sin(t * 0.14 + ph)
            const len = h * 1.5
            const x0 = w * bx
            const g = ctx.createLinearGradient(x0, h, x0 + Math.cos(a) * len, h + Math.sin(a) * len)
            g.addColorStop(0, `rgba(${rgb},0)`)
            g.addColorStop(0.35, `rgba(${rgb},${(0.09 * (0.6 + l.vivid * 0.5)).toFixed(3)})`)
            g.addColorStop(1, `rgba(${rgb},0)`)
            ctx.fillStyle = g
            ctx.beginPath()
            ctx.moveTo(x0, h)
            ctx.lineTo(x0 + Math.cos(a - 0.045) * len, h + Math.sin(a - 0.045) * len)
            ctx.lineTo(x0 + Math.cos(a + 0.045) * len, h + Math.sin(a + 0.045) * len)
            ctx.closePath()
            ctx.fill()
          }
          ctx.restore()
          if (smog) drawBand(ctx, smog, t * 8, -h * 0.04, w, h * 0.4)
          if (far) ctx.drawImage(far, 0, 0, w, h)

          // flying cars in their lanes: headlights going right, tail lights going left
          if (l.pulseAt > lastPulse.current) {
            lastPulse.current = l.pulseAt
            glitch = 0.7
            flash = { text: `+${fmtTokens(l.size)} TOKENS`, t: 4.5 }
            patrol = { x: -120, y: h * rand(0.16, 0.3), v: 900 }
            for (const s of signs) s.off = rand(0.05, 0.35)
          }
          ctx.save()
          ctx.globalCompositeOperation = 'lighter'
          ctx.lineCap = 'round'
          const want = 14 + l.intensity * 5
          while (cars.length < want) cars.push(newCar(false))
          cars = cars.filter((c, i) => {
            c.x += c.v * c.dir * dt * speed
            const trail = c.v * 0.32
            const rgb = c.dir > 0 ? '220,246,255' : '255,59,92'
            const g = ctx.createLinearGradient(c.x, c.y, c.x - c.dir * trail, c.y)
            g.addColorStop(0, `rgba(${rgb},${(0.85 * c.d).toFixed(3)})`)
            g.addColorStop(1, `rgba(${rgb},0)`)
            ctx.strokeStyle = g
            ctx.lineWidth = 1.2 + c.d * 1.4
            ctx.beginPath()
            ctx.moveTo(c.x, c.y)
            ctx.lineTo(c.x - c.dir * trail, c.y)
            ctx.stroke()
            if (c.d > 1.05 && (i % 2 ? pinkGlow : cyanGlow)) {
              ctx.globalAlpha = 0.5
              ctx.drawImage((i % 2 ? pinkGlow : cyanGlow)!, c.x - c.dir * 10 - 14, c.y - 4, 28, 14)
              ctx.globalAlpha = 1
            }
            return c.x > -80 && c.x < w + 80
          })
          if (patrol) {
            patrol.x += patrol.v * dt
            const blink = Math.floor(t * 8) % 2
            const g = ctx.createLinearGradient(patrol.x, patrol.y, patrol.x - 260, patrol.y)
            g.addColorStop(0, 'rgba(255,255,255,0.9)')
            g.addColorStop(1, 'rgba(255,255,255,0)')
            ctx.strokeStyle = g
            ctx.lineWidth = 3
            ctx.beginPath()
            ctx.moveTo(patrol.x, patrol.y)
            ctx.lineTo(patrol.x - 260, patrol.y)
            ctx.stroke()
            const lg = blink ? pinkGlow : cyanGlow
            if (lg) ctx.drawImage(lg, patrol.x - 40, patrol.y - 22, 44, 44)
            if (patrol.x > w + 300) patrol = null
          }
          ctx.restore()

          if (mid) ctx.drawImage(mid, 0, 0, w, h)

          // ---- the holographic billboard
          glitch = Math.max(0, glitch - dt)
          nextGlitch -= dt
          if (nextGlitch <= 0) {
            glitch = 0.25
            nextGlitch = rand(7, 16)
          }
          if (flash) flash.t -= dt
          const B = bill
          const drawBill = (dx: number, tint: string | null) => {
            const x0 = B.x - B.w / 2 + dx
            const y0 = B.y - B.h / 2
            ctx.save()
            ctx.globalCompositeOperation = 'lighter'
            ctx.fillStyle = tint ? `rgba(${tint},0.06)` : 'rgba(0,40,60,0.35)'
            ctx.fillRect(x0, y0, B.w, B.h)
            ctx.strokeStyle = tint ? `rgba(${tint},0.6)` : `rgba(${CYAN},0.85)`
            ctx.lineWidth = 1.5
            ctx.strokeRect(x0, y0, B.w, B.h)
            ctx.strokeStyle = `rgba(${CYAN},0.18)`
            ctx.lineWidth = 6
            ctx.strokeRect(x0 - 2, y0 - 2, B.w + 4, B.h + 4)
            // the turning wireframe on the left
            const cx = x0 + B.h * 0.55
            const cy = y0 + B.h / 2
            const R = B.h * 0.3
            const ay = t * 0.9
            const ax = t * 0.5
            const pts = ICO_V.map(([x, y, z]) => {
              const x1 = x * Math.cos(ay) - z * Math.sin(ay)
              const z1 = x * Math.sin(ay) + z * Math.cos(ay)
              const y1 = y * Math.cos(ax) - z1 * Math.sin(ax)
              return [cx + (x1 / PHI) * R * 0.85, cy + (y1 / PHI) * R * 0.85]
            })
            ctx.strokeStyle = tint ? `rgba(${tint},0.7)` : `rgba(${PINK},0.85)`
            ctx.lineWidth = 1
            ctx.beginPath()
            for (const [a, b] of ICO_E) {
              ctx.moveTo(pts[a][0], pts[a][1])
              ctx.lineTo(pts[b][0], pts[b][1])
            }
            ctx.stroke()
            // the copy: the tokens for a moment after new usage, otherwise the ads typing out
            const tx = x0 + B.h * 1.05
            const showFlash = flash && flash.t > 0
            ctx.fillStyle = tint ? `rgba(${tint},0.8)` : showFlash ? `rgb(${YELLOW})` : `rgb(${CYAN})`
            ctx.font = `700 ${Math.round(B.h * 0.27)}px Bahnschrift, 'Segoe UI', sans-serif`
            ctx.textBaseline = 'middle'
            ctx.fillText(showFlash ? flash!.text.split(' ')[0] : 'TOKEN', tx, y0 + B.h * 0.38)
            ctx.font = `600 ${Math.round(B.h * 0.13)}px 'Microsoft YaHei UI', Bahnschrift, sans-serif`
            const ad = ADS[Math.floor(t / 5) % ADS.length]
            const typed = showFlash ? 'TOKENS · 已入账' : ad.slice(0, Math.min(ad.length, Math.floor(((t % 5) / 1.6) * ad.length) + 1))
            ctx.fillStyle = tint ? `rgba(${tint},0.7)` : `rgba(${PINK},0.95)`
            ctx.fillText(typed + (Math.floor(t * 3) % 2 && !showFlash ? '▌' : ''), tx, y0 + B.h * 0.7)
            // scan lines rolling down
            ctx.fillStyle = 'rgba(0,240,255,0.08)'
            const off = (t * 20) % 4
            for (let y = y0 + off; y < y0 + B.h; y += 4) ctx.fillRect(x0, y, B.w, 1)
            ctx.restore()
          }
          if (glitch > 0) {
            const j = glitch * 14
            drawBill(-j, PINK)
            drawBill(j, CYAN)
            ctx.save()
            ctx.beginPath()
            const sy = B.y - B.h / 2 + Math.random() * B.h * 0.7
            ctx.rect(B.x - B.w / 2 - 20, sy, B.w + 40, B.h * 0.2)
            ctx.clip()
            drawBill(rand(-12, 12), null)
            ctx.restore()
          }
          ctx.globalAlpha = 0.85 + 0.15 * Math.sin(t * 23) * Math.sin(t * 7)
          drawBill(0, null)
          ctx.globalAlpha = 1

          if (near) ctx.drawImage(near, 0, 0, w, h)
          // neon signs: steady, with a stutter now and then (and all at once for new usage)
          for (const s of signs) {
            s.off = Math.max(0, s.off - dt)
            const stutter = hash(Math.floor(t * 9), s.seed) < 0.025 || (s.off > 0 && Math.floor(t * 18 + s.seed) % 2 === 0)
            const [sw, sh] = cssSize(s.c)
            ctx.globalAlpha = stutter ? 0.18 : 0.92 + 0.08 * Math.sin(t * 40 + s.seed)
            ctx.drawImage(s.c, s.x - sw / 2, s.y, sw, sh)
          }
          ctx.globalAlpha = 1

          // rain, two depths, and the wet glow of the street
          ctx.strokeStyle = 'rgba(190,225,255,0.26)'
          ctx.lineWidth = 1
          ctx.beginPath()
          for (const d of rainA) {
            d.y += 980 * dt
            d.x -= 140 * dt
            if (d.y > h) {
              d.y -= h + 30
              d.x = Math.random() * (w + 200)
            }
            if (d.x < -20) d.x += w + 40
            ctx.moveTo(d.x, d.y)
            ctx.lineTo(d.x + d.l * 0.14, d.y - d.l)
          }
          ctx.stroke()
          ctx.strokeStyle = 'rgba(190,225,255,0.13)'
          ctx.beginPath()
          for (const d of rainB) {
            d.y += 620 * dt
            d.x -= 80 * dt
            if (d.y > h) {
              d.y -= h + 20
              d.x = Math.random() * (w + 100)
            }
            if (d.x < -20) d.x += w + 40
            ctx.moveTo(d.x, d.y)
            ctx.lineTo(d.x + d.l * 0.13, d.y - d.l)
          }
          ctx.stroke()
          const street = ctx.createLinearGradient(0, h * 0.9, 0, h)
          street.addColorStop(0, 'rgba(255,42,109,0)')
          street.addColorStop(1, `rgba(255,42,109,${(0.16 + 0.05 * Math.sin(t * 2)).toFixed(3)})`)
          ctx.fillStyle = street
          ctx.fillRect(0, h * 0.9, w, h * 0.1)
        }
      }
    },
    1,
    30
  )
  return <canvas ref={ref} className="scene-canvas" />
}

// ---------------------------------------------------------------- 云海仙山

/**
 * A karst peak rising out of the clouds: a rounded pillar of rock, darker at
 * the top and fading into the cloud sea at its foot, lit on one side by the
 * moon, with pines on top (and a pavilion with a lantern on some).
 */
function karst(w: number, h: number, seed: number, o: { top: string; rim: string; pines: number; pavilion?: boolean; fade?: number }): HTMLCanvasElement {
  return layer(w, h, (g) => {
    const cx = w / 2
    const tw = w * (0.42 + hash(seed, 1) * 0.2)
    const N = 28
    const left: [number, number][] = []
    const right: [number, number][] = []
    for (let i = 0; i <= N; i++) {
      const k = i / N
      const y = h - k * h * 0.92
      const half = (w / 2) * (1 - k) + (tw / 2) * k
      const jag = (hash(i, seed) - 0.5) * w * 0.06 + Math.sin(k * 9 + seed) * w * 0.02
      left.push([cx - half + jag, y])
      right.push([cx + half + (hash(i, seed + 5) - 0.5) * w * 0.06, y])
    }
    const top = h * 0.08
    const path = new Path2D()
    path.moveTo(left[0][0], h)
    for (const [x, y] of left) path.lineTo(x, y)
    // a rounded, lumpy top
    path.bezierCurveTo(cx - tw * 0.4, top - h * 0.04, cx + tw * 0.4, top - h * 0.04, right[N][0], right[N][1])
    for (let i = N; i >= 0; i--) path.lineTo(right[i][0], right[i][1])
    path.closePath()
    const gr = g.createLinearGradient(0, 0, 0, h)
    gr.addColorStop(0, o.top)
    gr.addColorStop(1 - (o.fade ?? 0.35), o.top)
    gr.addColorStop(1, 'rgba(200,200,230,0)')
    g.fillStyle = gr
    g.fill(path)
    // the cracks and strata of the rock, like ink strokes
    g.save()
    g.clip(path)
    g.strokeStyle = 'rgba(0,0,0,0.28)'
    g.lineWidth = 1.2
    for (let i = 0; i < 9; i++) {
      const x = cx + (hash(i, seed + 9) - 0.5) * tw
      g.beginPath()
      g.moveTo(x, top + hash(i, seed + 3) * h * 0.2)
      g.bezierCurveTo(x + 6, h * 0.35, x - 8, h * 0.55, x + (hash(i, seed + 4) - 0.5) * 30, h * 0.8)
      g.stroke()
    }
    // the moonlit side
    const rim = g.createLinearGradient(cx, 0, cx + w / 2, 0)
    rim.addColorStop(0, 'rgba(0,0,0,0)')
    rim.addColorStop(1, o.rim)
    g.fillStyle = rim
    g.fillRect(cx, 0, w / 2, h * 0.75)
    g.restore()
    // pines on the top, leaning out
    g.fillStyle = o.top
    for (let i = 0; i < o.pines; i++) {
      const px = cx + (hash(i, seed + 11) - 0.5) * tw * 0.8
      const ph = 10 + hash(i, seed + 12) * 14
      const base = top + Math.abs(px - cx) * 0.08
      for (let k = 0; k < 3; k++) {
        const y0 = base - k * ph * 0.28
        const half = ph * (0.42 - k * 0.1)
        g.beginPath()
        g.moveTo(px - half, y0)
        g.lineTo(px + (hash(i, seed) - 0.5) * 4, y0 - ph * 0.42)
        g.lineTo(px + half, y0)
        g.fill()
      }
    }
    if (o.pavilion) {
      // a small pavilion: platform, posts, an upswept roof
      const px = cx - tw * 0.12
      const py = top + 2
      g.fillStyle = o.top
      g.fillRect(px - 13, py - 3, 26, 3)
      g.fillRect(px - 9, py - 14, 2, 11)
      g.fillRect(px + 7, py - 14, 2, 11)
      g.beginPath()
      g.moveTo(px - 18, py - 13)
      g.quadraticCurveTo(px - 8, py - 15, px, py - 24)
      g.quadraticCurveTo(px + 8, py - 15, px + 18, py - 13)
      g.quadraticCurveTo(px, py - 17, px - 18, py - 13)
      g.fill()
    }
  })
}

/** a red-crowned crane in flight, facing `dir`, half wing span `s` */
function drawCrane(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, flap: number, dir: number): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(dir * s, s)
  const f = flap
  // the far wing, a little darker
  ctx.fillStyle = 'rgba(215,220,226,0.92)'
  ctx.beginPath()
  ctx.moveTo(0.2, -0.04)
  ctx.quadraticCurveTo(-0.1, -0.5 * f - 0.1, -0.5, -1.1 * f - 0.05)
  ctx.lineTo(-0.38, -0.04)
  ctx.closePath()
  ctx.fill()
  // legs trailing, tail
  ctx.strokeStyle = '#1b1b1b'
  ctx.lineWidth = 0.05
  ctx.beginPath()
  ctx.moveTo(-0.45, 0.03)
  ctx.lineTo(-1.45, 0.1)
  ctx.moveTo(-0.45, 0.06)
  ctx.lineTo(-1.42, 0.16)
  ctx.stroke()
  // body and neck
  ctx.fillStyle = '#f6f6f2'
  ctx.beginPath()
  ctx.ellipse(-0.05, 0.02, 0.5, 0.13, 0, 0, TAU)
  ctx.fill()
  ctx.fillStyle = '#1b1b1b'
  ctx.beginPath()
  ctx.moveTo(0.35, -0.02)
  ctx.quadraticCurveTo(0.8, -0.1, 1.15, -0.08)
  ctx.lineTo(1.15, -0.02)
  ctx.quadraticCurveTo(0.8, -0.03, 0.35, 0.06)
  ctx.fill()
  ctx.fillStyle = '#f6f6f2'
  ctx.beginPath()
  ctx.arc(1.2, -0.06, 0.07, 0, TAU)
  ctx.fill()
  ctx.fillStyle = '#d8302c'
  ctx.beginPath()
  ctx.arc(1.21, -0.11, 0.035, 0, TAU)
  ctx.fill()
  ctx.strokeStyle = '#9a8a5a'
  ctx.lineWidth = 0.035
  ctx.beginPath()
  ctx.moveTo(1.26, -0.05)
  ctx.lineTo(1.5, -0.03)
  ctx.stroke()
  ctx.fillStyle = '#1b1b1b'
  ctx.beginPath()
  ctx.moveTo(-0.5, -0.02)
  ctx.lineTo(-0.82, 0.04)
  ctx.lineTo(-0.5, 0.1)
  ctx.fill()
  // the near wing, white with black flight feathers at the tip
  ctx.fillStyle = '#fbfbf8'
  ctx.beginPath()
  ctx.moveTo(0.22, -0.02)
  ctx.quadraticCurveTo(-0.05, -0.62 * f - 0.08, -0.42, -1.3 * f - 0.06)
  ctx.lineTo(-0.36, -0.02)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#161616'
  ctx.beginPath()
  ctx.moveTo(-0.3, -1.0 * f - 0.05)
  ctx.lineTo(-0.42, -1.3 * f - 0.06)
  ctx.lineTo(-0.52, -1.08 * f - 0.03)
  ctx.lineTo(-0.4, -0.75 * f - 0.03)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/**
 * 云海仙山: peaks floating on a sea of clouds under a great pale moon. Cloud
 * bands flow at three depths, the peaks bob as if afloat, a floating island
 * with a pavilion and a waterfall hangs in the sidebar, cranes cross the
 * moon, spirit motes rise. New usage sends a flying sword streaking across
 * the sky in a trail of light (three for a big batch); more usage quickens
 * the clouds.
 */
export function Xianxia(p: SceneProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useLive(p)
  const lastPulse = useRef(0)
  useScene(
    ref,
    p.level,
    live,
    () => {
      let W = 0
      let H = 0
      let sky: HTMLCanvasElement | null = null
      let moonGlow: HTMLCanvasElement | null = null
      let mist: HTMLCanvasElement | null = null
      let lantern: HTMLCanvasElement | null = null
      let jade: HTMLCanvasElement | null = null
      let peaks: { c: HTMLCanvasElement; x: number; base: number; w: number; h: number; ph: number; layer: number }[] = []
      let island: { c: HTMLCanvasElement; x: number; y: number; w: number; h: number; fallX: number; lamp: [number, number] } | null = null
      let bands: { c: HTMLCanvasElement; y: number; h: number; v: number }[] = []
      let cranes: { x: number; y: number; vx: number; s: number; ph: number }[] = []
      let swords: { p: [number, number][]; k: number; dur: number; trail: [number, number][]; done: number }[] = []
      let motes: { x: number; y: number; v: number; s: number; ph: number; gold: boolean }[] = []
      let mx = 0
      let my = 0
      let mr = 0
      let t = 0
      let nextCrane = 3
      let nextSword = 14

      const newSword = (k: number) => {
        const ltr = Math.random() < 0.5
        const y0 = H * rand(0.06, 0.3) + k * 26
        const y2 = H * rand(0.04, 0.24) + k * 26
        const x0 = ltr ? -60 : W + 60
        const x2 = ltr ? W + 60 : -60
        swords.push({ p: [[x0, y0], [W * rand(0.35, 0.65), Math.min(y0, y2) - H * rand(0.04, 0.12)], [x2, y2]], k: -k * 0.12, dur: rand(1.6, 2.3), trail: [], done: 0 })
      }

      return {
        init(w, h) {
          W = w
          H = h
          mx = gapX(w)
          mr = clamp(Math.min(w, h) * 0.075, 42, 82)
          my = Math.min(h * 0.12, mr + 30)
          sky = layer(w, h, (g) => {
            const gr = g.createLinearGradient(0, 0, 0, h)
            gr.addColorStop(0, '#081426')
            gr.addColorStop(0.35, '#13304a')
            gr.addColorStop(0.58, '#2c5466')
            gr.addColorStop(0.72, '#c9a77a')
            gr.addColorStop(1, '#e6cfa6')
            g.fillStyle = gr
            g.fillRect(0, 0, w, h)
            for (let i = 0; i < (w * h) / 7000; i++) {
              g.globalAlpha = 0.2 + Math.random() * 0.5
              g.fillStyle = '#eef6ff'
              g.fillRect(Math.random() * w, Math.random() * h * 0.45, 1, 1)
            }
            // the moon itself: pale gold with soft seas
            g.globalAlpha = 1
            const mg = g.createRadialGradient(mx - mr * 0.25, my - mr * 0.25, mr * 0.1, mx, my, mr)
            mg.addColorStop(0, '#fffbea')
            mg.addColorStop(0.8, '#f6e6b8')
            mg.addColorStop(1, '#e2c88c')
            g.fillStyle = mg
            g.beginPath()
            g.arc(mx, my, mr, 0, TAU)
            g.fill()
            g.fillStyle = 'rgba(180,160,110,0.18)'
            for (const [x, y, r] of [
              [-0.3, -0.25, 0.26],
              [0.2, 0.05, 0.22],
              [-0.1, 0.35, 0.2]
            ]) {
              g.beginPath()
              g.arc(mx + x * mr, my + y * mr, r * mr, 0, TAU)
              g.fill()
            }
          })
          moonGlow = glow('255,236,190', 128, 0.18, 0.45)
          mist = glow('230,226,245', 64, 0.3, 0.6)
          lantern = glow('255,190,110', 48, 0.25, 0.6)
          jade = glow('140,255,215', 24, 0.3, 0.6)
          // peaks at three depths; the near ones frame the window's edges
          const spec: [number, number, number, number, number][] = [
            // x, base, width, height, layer
            [0.22, 0.7, 0.07, 0.22, 0],
            [0.42, 0.7, 0.06, 0.18, 0],
            [0.63, 0.7, 0.08, 0.26, 0],
            [0.82, 0.7, 0.06, 0.2, 0],
            [0.34, 0.84, 0.1, 0.34, 1],
            [0.55, 0.84, 0.09, 0.4, 1],
            [0.9, 0.84, 0.11, 0.42, 1],
            [0.72, 1.0, 0.13, 0.48, 2],
            [0.99, 1.0, 0.12, 0.6, 2]
          ]
          const cols = [
            { top: '#3d6070', rim: 'rgba(255,230,180,0.18)', fade: 0.4 },
            { top: '#1e3d44', rim: 'rgba(255,225,170,0.22)', fade: 0.38 },
            { top: '#0f2428', rim: 'rgba(255,220,160,0.2)', fade: 0.3 }
          ]
          peaks = spec.map(([fx, fb, fw, fh, li], i) => {
            const pw = Math.max(60, fw * w)
            const ph = fh * h
            return { c: karst(pw, ph, i * 7 + 1, { ...cols[li], pines: 3 + (i % 3), pavilion: i === 5 }), x: fx * w, base: fb * h, w: pw, h: ph, ph: Math.random() * TAU, layer: li }
          })
          // the floating island in the sidebar: a rock hanging under a flat top with a pavilion
          const iw = Math.min(170, w * 0.11)
          const ih = iw * 0.95
          const ix = Math.min(135, w * 0.09)
          const iy = h * 0.55
          island = {
            c: layer(iw, ih, (g) => {
              const top = ih * 0.36
              g.fillStyle = '#16302f'
              g.beginPath()
              g.moveTo(0, top)
              for (let i = 0; i <= 12; i++) {
                const k = i / 12
                const x = iw * k
                const depth = Math.sin(k * Math.PI) ** 0.8 * (ih - top) * (0.75 + hash(i, 4) * 0.25)
                g.lineTo(x, top + depth)
              }
              g.lineTo(iw, top)
              g.closePath()
              g.fill()
              g.fillStyle = 'rgba(0,0,0,0.3)'
              for (let i = 0; i < 5; i++) {
                g.fillRect(iw * (0.2 + i * 0.14), top + 6, 1.4, (ih - top) * (0.3 + hash(i, 6) * 0.4))
              }
              // grass on the top, pines, and the pavilion
              g.fillStyle = '#2f6a58'
              g.beginPath()
              g.ellipse(iw / 2, top, iw / 2, 5, 0, 0, TAU)
              g.fill()
              g.fillStyle = '#10241f'
              for (const [px, ph] of [
                [0.14, 26],
                [0.26, 18],
                [0.84, 22]
              ]) {
                for (let k = 0; k < 3; k++) {
                  g.beginPath()
                  g.moveTo(iw * px - ph * (0.4 - k * 0.1), top - k * ph * 0.26)
                  g.lineTo(iw * px, top - ph * 0.42 - k * ph * 0.26)
                  g.lineTo(iw * px + ph * (0.4 - k * 0.1), top - k * ph * 0.26)
                  g.fill()
                }
              }
              const px = iw * 0.55
              g.fillRect(px - 16, top - 4, 32, 4)
              g.fillRect(px - 11, top - 18, 2.5, 14)
              g.fillRect(px + 9, top - 18, 2.5, 14)
              g.beginPath()
              g.moveTo(px - 22, top - 16)
              g.quadraticCurveTo(px - 10, top - 19, px, top - 30)
              g.quadraticCurveTo(px + 10, top - 19, px + 22, top - 16)
              g.quadraticCurveTo(px, top - 21, px - 22, top - 16)
              g.fill()
              g.fillStyle = '#c23a2c'
              g.fillRect(px - 1, top - 30, 2, 4)
            }),
            x: ix - iw / 2,
            y: iy - ih * 0.36,
            w: iw,
            h: ih,
            fallX: ix + iw * 0.3,
            lamp: [ix + iw * 0.05, iy - 12]
          }
          const seaShape = (y: number) => smoothstep(0, 0.4, y)
          bands = [
            { c: noiseBand(w, h * 0.22, { rgb: '196,192,224', lit: '255,240,214', cells: 6, seed: 31, lo: 0.3, hi: 0.62, alpha: 0.85, shape: seaShape }), y: h * 0.6, h: h * 0.22, v: 5 },
            { c: noiseBand(w, h * 0.26, { rgb: '206,202,232', lit: '255,244,222', cells: 5, seed: 33, lo: 0.26, hi: 0.6, alpha: 0.9, shape: seaShape }), y: h * 0.72, h: h * 0.26, v: 9 },
            { c: noiseBand(w, h * 0.24, { rgb: '220,216,240', lit: '255,248,230', cells: 7, seed: 35, lo: 0.22, hi: 0.55, alpha: 0.95, shape: seaShape }), y: h * 0.82, h: h * 0.2, v: 14 },
            { c: noiseBand(w, h * 0.14, { rgb: '220,226,246', cells: 8, seed: 37, lo: 0.52, hi: 0.85, alpha: 0.35, shape: (y) => Math.sin(y * Math.PI) }), y: h * 0.42, h: h * 0.14, v: 20 }
          ]
          motes = Array.from({ length: 56 }, () => ({ x: Math.random() * w, y: Math.random() * h, v: rand(6, 16), s: rand(5, 11), ph: Math.random() * TAU, gold: Math.random() < 0.35 }))
          cranes = []
          swords = []
        },
        draw(ctx, w, h, dt, l) {
          t += dt
          const speed = 1 + l.intensity * 0.4
          if (sky) ctx.drawImage(sky, 0, 0, w, h)
          if (moonGlow) {
            // the halo behind the moon breathes a little
            ctx.save()
            ctx.globalCompositeOperation = 'lighter'
            ctx.globalAlpha = (0.42 + 0.06 * Math.sin(t * 0.5)) * (0.7 + l.vivid * 0.4)
            ctx.drawImage(moonGlow, mx - mr * 4.5, my - mr * 4.5, mr * 9, mr * 9)
            ctx.restore()
          }
          // thin clouds across the moon
          if (mist) {
            for (let i = 0; i < 3; i++) {
              const span = w * 0.6
              const x = mx - span / 2 + ((t * (5 + i * 2) + i * 230) % span)
              ctx.globalAlpha = 0.35 * Math.sin(((x - mx + span / 2) / span) * Math.PI)
              ctx.drawImage(mist, x - mr * 1.6, my - mr * 0.1 + i * mr * 0.38, mr * 3.2, mr * 0.3)
            }
            ctx.globalAlpha = 1
          }

          // cranes across the sky
          nextCrane -= dt
          if (nextCrane <= 0) {
            const dir = Math.random() < 0.6 ? -1 : 1
            const n = 2 + Math.floor(Math.random() * 3)
            const y = my + rand(-mr * 0.6, mr * 1.8)
            for (let k = 0; k < n; k++) cranes.push({ x: (dir < 0 ? w + 60 : -60) - dir * k * 70, y: y + k * 18 + rand(-4, 4), vx: dir * rand(26, 34), s: rand(20, 27), ph: k * 0.7 + Math.random() })
            nextCrane = rand(22, 38)
          }
          cranes = cranes.filter((c) => {
            c.x += c.vx * dt
            const flap = Math.sin(t * 3.4 + c.ph)
            drawCrane(ctx, c.x, c.y + Math.sin(t * 0.9 + c.ph) * 5 - flap * 2, c.s, flap, Math.sign(c.vx))
            return c.x > -200 && c.x < w + 200
          })

          // peaks and the sea of clouds, far to near; each peak bobs as if afloat
          const drawPeaks = (li: number) => {
            for (const pk of peaks) {
              if (pk.layer !== li) continue
              const bob = Math.sin(t * 0.25 + pk.ph) * (3 + li * 2)
              ctx.drawImage(pk.c, pk.x - pk.w / 2, pk.base - pk.h + bob, pk.w, pk.h)
            }
          }
          drawPeaks(0)
          const [b0, b1, b2, b3] = bands
          if (b0) drawBand(ctx, b0.c, t * b0.v * speed, b0.y + Math.sin(t * 0.2) * 5, w, b0.h)
          drawPeaks(1)
          // the floating island and its waterfall
          if (island) {
            const bob = Math.sin(t * 0.4) * 6
            const fallTop = island.y + island.h * 0.36 + bob
            const fallLen = h * 0.24
            const fg = ctx.createLinearGradient(0, fallTop, 0, fallTop + fallLen)
            fg.addColorStop(0, 'rgba(235,245,255,0.8)')
            fg.addColorStop(1, 'rgba(235,245,255,0)')
            ctx.fillStyle = fg
            ctx.fillRect(island.fallX - 3, fallTop, 6, fallLen)
            ctx.fillStyle = 'rgba(255,255,255,0.75)'
            for (let k = 0; k < 14; k++) {
              const y = (t * 70 + k * (fallLen / 14)) % fallLen
              ctx.globalAlpha = 0.7 * (1 - y / fallLen)
              ctx.fillRect(island.fallX - 2 + Math.sin(k * 3) * 1.5, fallTop + y, 1.6, 9)
            }
            ctx.globalAlpha = 1
            if (mist) ctx.drawImage(mist, island.fallX - 40, fallTop + fallLen * 0.75, 80, 36)
            ctx.drawImage(island.c, island.x, island.y + bob, island.w, island.h)
            if (lantern) {
              ctx.globalAlpha = 0.75 + 0.25 * Math.sin(t * 5) * Math.sin(t * 1.7)
              ctx.drawImage(lantern, island.lamp[0] - 14, island.lamp[1] + bob - 14, 28, 28)
              ctx.globalAlpha = 1
            }
          }
          if (b1) drawBand(ctx, b1.c, t * b1.v * speed + w * 0.3, b1.y + Math.sin(t * 0.17 + 1) * 6, w, b1.h)
          drawPeaks(2)
          if (b2) drawBand(ctx, b2.c, t * b2.v * speed + w * 0.6, b2.y + Math.sin(t * 0.13 + 2) * 7, w, b2.h)

          // flying swords: one for each batch of new usage, now and then on their own
          if (l.pulseAt > lastPulse.current) {
            lastPulse.current = l.pulseAt
            const n = l.size > 1_000_000 ? 3 : 1
            for (let k = 0; k < n; k++) newSword(k)
          }
          nextSword -= dt
          if (nextSword <= 0) {
            newSword(0)
            nextSword = rand(28, 50)
          }
          ctx.save()
          ctx.globalCompositeOperation = 'lighter'
          ctx.lineCap = 'round'
          swords = swords.filter((s) => {
            s.k += dt / s.dur
            if (s.k < 0) return true
            const k = Math.min(1, s.k)
            const x = bez(s.p[0][0], s.p[1][0], s.p[2][0], k)
            const y = bez(s.p[0][1], s.p[1][1], s.p[2][1], k)
            if (s.k <= 1) s.trail.push([x, y])
            else s.done += dt
            if (s.trail.length > 26 || (s.done > 0 && s.trail.length)) s.trail.shift()
            const n = s.trail.length
            for (let i = 1; i < n; i++) {
              const q = i / n
              ctx.strokeStyle = `rgba(190,255,240,${(q * q * 0.85).toFixed(3)})`
              ctx.lineWidth = 0.6 + q * 3.2
              ctx.beginPath()
              ctx.moveTo(s.trail[i - 1][0], s.trail[i - 1][1])
              ctx.lineTo(s.trail[i][0], s.trail[i][1])
              ctx.stroke()
            }
            if (s.k <= 1 && n > 1 && jade) {
              const [px, py] = s.trail[n - 2]
              const a = Math.atan2(y - py, x - px)
              ctx.drawImage(jade, x - 22, y - 22, 44, 44)
              // the blade itself
              ctx.save()
              ctx.translate(x, y)
              ctx.rotate(a)
              ctx.fillStyle = 'rgba(240,255,250,0.95)'
              ctx.beginPath()
              ctx.moveTo(10, 0)
              ctx.lineTo(-8, -1.6)
              ctx.lineTo(-8, 1.6)
              ctx.closePath()
              ctx.fill()
              ctx.restore()
              // sparks shed along the way
              if (Math.random() < 0.6) motes.push({ x, y, v: rand(4, 10), s: rand(3, 6), ph: -1, gold: false })
            }
            return s.k <= 1 || n > 1
          })
          // spirit motes rising (sparks from swords fade away instead of looping)
          motes = motes.filter((m) => {
            m.y -= m.v * dt
            m.x += Math.sin(t * 0.7 + m.ph) * 5 * dt
            if (m.ph === -1) {
              m.s -= dt * 3
              if (m.s <= 0) return false
            } else if (m.y < -10) {
              m.y = h + 10
              m.x = Math.random() * w
            }
            const img = m.gold ? lantern : jade
            if (img) {
              ctx.globalAlpha = (m.ph === -1 ? 0.8 : 0.3 + 0.5 * Math.max(0, Math.sin(t * 1.8 + m.ph))) * (0.6 + l.vivid * 0.4)
              ctx.drawImage(img, m.x - m.s / 2, m.y - m.s / 2, m.s, m.s)
            }
            return true
          })
          ctx.restore()
          ctx.globalAlpha = 1
          if (b3) drawBand(ctx, b3.c, t * b3.v * speed, b3.y + Math.sin(t * 0.3) * 8, w, b3.h)
        }
      }
    },
    1,
    30
  )
  return <canvas ref={ref} className="scene-canvas" />
}
