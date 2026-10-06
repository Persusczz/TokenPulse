import { TAU } from './ThemeScenes'

/**
 * Small drawing helpers shared by the 2.11 scenes (ThemeScenes5/6 and the
 * day cycle's new life): stable noise, soft sprites, tileable noise bands for
 * fog and cloud seas, neon text, and a few silhouettes.
 */

/** a stable pseudo-random number in [0, 1) for an integer pair */
export const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return s - Math.floor(s)
}
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k

/** the sidebar's width (styles.css .shell), CSS pixels */
export const SIDEBAR = 216
/** where the header leaves a gap between the page title and the range tabs: the most visible spot of the window */
export const gapX = (w: number) => clamp((w + 85) / 2, w * 0.4, w * 0.62)
/** how wide that gap is */
export const gapW = (w: number) => Math.max(0, w - 956)

/** a soft round glow in one colour */
export function glow(rgb: string, size = 64, core = 0.25, mid = 0.55): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const r = size / 2
  const gr = g.createRadialGradient(r, r, 0, r, r, r)
  gr.addColorStop(0, `rgba(${rgb},1)`)
  gr.addColorStop(core, `rgba(${rgb},${mid})`)
  gr.addColorStop(1, `rgba(${rgb},0)`)
  g.fillStyle = gr
  g.fillRect(0, 0, size, size)
  return c
}

/** 2D value noise, periodic in x with a period of `px` lattice cells */
export function noise2(x: number, y: number, px: number, seed: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const h = (i: number, j: number) => hash((((i % px) + px) % px) + seed * 57, j + seed * 131)
  const a = h(ix, iy)
  const b = h(ix + 1, iy)
  const c = h(ix, iy + 1)
  const d = h(ix + 1, iy + 1)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}

/** fractal noise, still periodic in x */
export function fbm2(x: number, y: number, px: number, seed: number, oct = 4): number {
  let v = 0
  let amp = 0.5
  let norm = 0
  for (let k = 0; k < oct; k++) {
    const f = 2 ** k
    v += amp * noise2(x * f, y * f, px * f, seed + k * 7)
    norm += amp
    amp *= 0.5
  }
  return v / norm
}

export interface BandOptions {
  rgb: string
  /** noise cells across the width (also the period) */
  cells: number
  seed: number
  /** noise values mapped to transparent → opaque */
  lo: number
  hi: number
  alpha: number
  /** opacity by height in the band, 0 top – 1 bottom */
  shape?: (yk: number) => number
  /** how much wider than tall the puffs are */
  stretch?: number
  /** brighter on the top of each puff (lit from above) */
  lit?: string
}

/**
 * A horizontally tileable band of soft noise — fog, smog, a sea of clouds —
 * worked out at a sixth of the size and scaled up soft when drawn.
 */
export function noiseBand(w: number, h: number, o: BandOptions): HTMLCanvasElement {
  const cw = Math.max(16, Math.round(w / 6))
  const ch = Math.max(4, Math.round(h / 6))
  const c = document.createElement('canvas')
  c.width = cw
  c.height = ch
  const g = c.getContext('2d')!
  const img = g.createImageData(cw, ch)
  const [r0, g0, b0] = o.rgb.split(',').map(Number)
  const lit = o.lit ? o.lit.split(',').map(Number) : null
  // lattice cells down the band: as many per pixel as across, times the stretch
  const yScale = ((o.cells * h) / w) * (o.stretch ?? 2.4)
  for (let j = 0; j < ch; j++) {
    const yk = j / (ch - 1)
    const env = o.shape ? o.shape(yk) : 1
    for (let i = 0; i < cw; i++) {
      const v = fbm2((i / cw) * o.cells, (j / ch) * yScale + 3, o.cells, o.seed)
      const a = smoothstep(o.lo, o.hi, v) * env * o.alpha
      const k = (j * cw + i) * 4
      if (lit) {
        // the upper side of a puff catches the light: compare with the noise a little higher
        const up = fbm2((i / cw) * o.cells, ((j - 2) / ch) * yScale + 3, o.cells, o.seed)
        const e = clamp((v - up) * 6, 0, 1)
        img.data[k] = r0 + (lit[0] - r0) * e
        img.data[k + 1] = g0 + (lit[1] - g0) * e
        img.data[k + 2] = b0 + (lit[2] - b0) * e
      } else {
        img.data[k] = r0
        img.data[k + 1] = g0
        img.data[k + 2] = b0
      }
      img.data[k + 3] = a * 255
    }
  }
  g.putImageData(img, 0, 0)
  return c
}

/** draws a tileable band scrolled by `x` */
export function drawBand(ctx: CanvasRenderingContext2D, band: HTMLCanvasElement, x: number, y: number, w: number, h: number): void {
  const o = ((x % w) + w) % w
  ctx.drawImage(band, o - w, y, w, h)
  ctx.drawImage(band, o, y, w, h)
}

/** neon lettering with its glow, horizontal or stacked vertically */
export function neonText(text: string, o: { color: string; size: number; font?: string; vertical?: boolean; box?: boolean; core?: string }): HTMLCanvasElement {
  const font = `600 ${o.size}px ${o.font ?? "Bahnschrift, 'Microsoft YaHei UI', sans-serif"}`
  const pad = Math.round(o.size * 0.9)
  const meas = document.createElement('canvas').getContext('2d')!
  meas.font = font
  const chars = [...text]
  const tw = o.vertical ? Math.max(...chars.map((ch) => meas.measureText(ch).width)) : meas.measureText(text).width
  const th = o.vertical ? chars.length * o.size * 1.08 : o.size * 1.1
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const c = document.createElement('canvas')
  const w = Math.ceil(tw + pad * 2)
  const h = Math.ceil(th + pad * 2)
  c.width = w * dpr
  c.height = h * dpr
  const g = c.getContext('2d')!
  g.scale(dpr, dpr)
  g.font = font
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const put = (fill: string, blur: number) => {
    g.shadowColor = o.color
    g.shadowBlur = blur
    g.fillStyle = fill
    if (o.vertical) chars.forEach((ch, i) => g.fillText(ch, w / 2, pad + o.size * 0.54 + i * o.size * 1.08))
    else g.fillText(text, w / 2, h / 2)
    if (o.box) {
      g.strokeStyle = fill
      g.lineWidth = Math.max(1.5, o.size / 14)
      g.beginPath()
      g.roundRect(pad * 0.45, pad * 0.45, w - pad * 0.9, h - pad * 0.9, o.size * 0.18)
      g.stroke()
    }
  }
  put(o.color, o.size * 0.7)
  put(o.color, o.size * 0.25)
  put(o.core ?? 'rgba(255,255,255,0.85)', 2)
  ;(c as HTMLCanvasElement & { cssW?: number; cssH?: number }).cssW = w
  ;(c as HTMLCanvasElement & { cssW?: number; cssH?: number }).cssH = h
  return c
}

/** the size a neonText canvas is drawn at, in CSS pixels */
export const cssSize = (c: HTMLCanvasElement) => [(c as HTMLCanvasElement & { cssW?: number }).cssW ?? c.width, (c as HTMLCanvasElement & { cssH?: number }).cssH ?? c.height] as const

/**
 * A bird in silhouette, filled: wings at `flap` (−1 down … 1 up), facing
 * `dir` (1 right, −1 left). `s` is half the wing span.
 */
export function drawBird(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, flap: number, dir: number): void {
  const f = flap * s * 0.9
  ctx.beginPath()
  ctx.moveTo(x - s * 1.6, y - f)
  ctx.quadraticCurveTo(x - s * 0.7, y - s * 0.32 - f * 0.25, x, y - s * 0.1)
  ctx.quadraticCurveTo(x + s * 0.7, y - s * 0.32 - f * 0.25, x + s * 1.6, y - f)
  ctx.quadraticCurveTo(x + s * 0.75, y + s * 0.05 - f * 0.2, x, y + s * 0.18)
  ctx.quadraticCurveTo(x - s * 0.75, y + s * 0.05 - f * 0.2, x - s * 1.6, y - f)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(x + dir * s * 0.12, y + s * 0.06, s * 0.55, s * 0.17, 0, 0, TAU)
  ctx.arc(x + dir * s * 0.66, y, s * 0.15, 0, TAU)
  ctx.moveTo(x - dir * s * 0.45, y + s * 0.02)
  ctx.lineTo(x - dir * s * 0.95, y - s * 0.08)
  ctx.lineTo(x - dir * s * 0.95, y + s * 0.2)
  ctx.closePath()
  ctx.fill()
}

/** a point on a quadratic Bézier curve */
export const bez = (p0: number, p1: number, p2: number, t: number) => (1 - t) * (1 - t) * p0 + 2 * (1 - t) * t * p1 + t * t * p2
