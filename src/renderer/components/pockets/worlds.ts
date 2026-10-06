import { placeOf } from '@shared/astro'
import { skyAt, type SkyState } from '@shared/daycycle'
import type { Pocket } from '../Pocket'
import { dayNow } from '../DayCycle'
import { drawMoon } from '../ThemeScenes3'
import { bird, type Bit, clamp, disc, drawStars, focus, glow, kick, pulses, ridge, rnd, starsOf, stepBits, TAU, vgrad } from './kit'

// ---------------------------------------------------------------- 水墨

/** Ink wash: misty ranges in layered washes, a bird crossing, a red seal; new usage drops ink that blooms in the water */
export function ink(): Pocket {
  const fresh = pulses()
  let blooms: { u: number; v: number; age: number }[] = []
  let flight = rnd(0, 6)
  return {
    dark: (d) => d,
    draw(ctx, w, h, dt, l) {
      const f = focus(l.shape, w, h)
      if (fresh(l)) blooms.push({ u: f.x / w + rnd(-0.05, 0.05), v: f.y / h + rnd(-0.1, 0.1), age: 0 })
      ctx.fillStyle = l.dark ? '#1b1a17' : '#f4efe4'
      ctx.fillRect(0, 0, w, h)
      const inkc = l.dark ? '225,218,200' : '30,30,32'
      const wash = (a: number, top: number) => {
        const g = ctx.createLinearGradient(0, h * top, 0, h)
        g.addColorStop(0, `rgba(${inkc},${a})`)
        g.addColorStop(0.7, `rgba(${inkc},${a * 0.25})`)
        g.addColorStop(1, `rgba(${inkc},0)`)
        return g
      }
      const drift = l.t * 0.004
      ridge(ctx, w, h, [0.3, 0.52, 0.36, 0.6, 0.42, 0.55, 0.34], 0.95, wash(l.dark ? 0.13 : 0.14, 0.35), drift)
      ridge(ctx, w, h, [0.2, 0.36, 0.5, 0.3, 0.44, 0.26, 0.38], 0.98, wash(l.dark ? 0.2 : 0.24, 0.45), drift * 1.8 + 0.4)
      ridge(ctx, w, h, [0.08, 0.2, 0.12, 0.26, 0.1, 0.18, 0.06], 1, wash(l.dark ? 0.3 : 0.42, 0.65), drift * 3 + 0.7)
      // a band of mist through the middle
      glow(ctx, ((l.t * 0.01) % 1.4) * w - w * 0.2, h * 0.62, Math.max(w, h) * 0.35, l.dark ? '27,26,23' : '244,239,228', 0.5)
      flight += dt
      const cross = (flight % 16) / 9
      if (cross < 1) bird(ctx, w * (1.05 - cross * 1.1), h * (0.28 + Math.sin(cross * 5) * 0.04), Math.min(h * 0.06, 6), l.t * 7, `rgba(${inkc},0.7)`)
      blooms = blooms.filter((b) => (b.age += dt) < 4)
      for (const b of blooms) {
        const k = b.age / 4
        for (let i = 0; i < 4; i++) {
          const r = Math.min(w, h) * (0.06 + k * 0.32) * (0.6 + i * 0.18)
          glow(ctx, b.u * w + Math.sin(i * 2.1) * r * 0.2, b.v * h + Math.cos(i * 1.7) * r * 0.15, r, inkc, (1 - k) * (l.dark ? 0.3 : 0.45))
        }
      }
      // the seal
      const s = Math.min(h * 0.16, 14)
      const sx = w - s * 1.8
      const sy = h - s * 1.8
      ctx.fillStyle = '#b8392d'
      ctx.fillRect(sx, sy, s, s)
      ctx.fillStyle = l.dark ? '#1b1a17' : '#f4efe4'
      ctx.font = `700 ${s * 0.78}px "KaiTi", "STKaiti", serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('脉', sx + s / 2, sy + s / 2 + 0.5)
    },
    emblem(ctx, x, y, r, l) {
      // an ensō: one sweep of the brush, thick to thin, turning slowly
      const a0 = l.t * 0.4
      for (let i = 0; i < 26; i++) {
        const k = i / 25
        const a = a0 + k * TAU * 0.86
        disc(ctx, x + Math.cos(a) * r * 0.66, y + Math.sin(a) * r * 0.66, r * (0.2 - k * 0.15), `rgba(240,234,220,${0.9 - k * 0.3})`)
      }
      disc(ctx, x + r * 0.05, y + r * 0.05, r * (0.12 + kick(l) * 0.08), '#c8402f')
    }
  }
}

// ---------------------------------------------------------------- 深海

function jelly(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number, flash: number): void {
  const beat = 0.5 + 0.5 * Math.sin(t * 2.2)
  const bw = s * (0.55 + beat * 0.12)
  const bh = s * (0.42 - beat * 0.06)
  glow(ctx, x, y, s * 1.3, '120,200,255', 0.22 + flash * 0.5)
  ctx.strokeStyle = 'rgba(170,220,255,0.45)'
  ctx.lineWidth = Math.max(0.8, s * 0.035)
  for (let i = 0; i < 5; i++) {
    const bx = x + (i - 2) * bw * 0.32
    ctx.beginPath()
    ctx.moveTo(bx, y)
    for (let j = 1; j <= 8; j++) ctx.lineTo(bx + Math.sin(t * 2.4 + j * 0.8 + i) * s * 0.06, y + j * s * 0.14)
    ctx.stroke()
  }
  const g = ctx.createRadialGradient(x, y - bh * 0.4, 0, x, y, bw)
  g.addColorStop(0, `rgba(230,200,255,${0.85})`)
  g.addColorStop(0.7, 'rgba(130,160,255,0.55)')
  g.addColorStop(1, 'rgba(90,120,255,0.15)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.ellipse(x, y, bw, bh, 0, Math.PI, 0)
  ctx.quadraticCurveTo(x, y + bh * 0.25, x - bw, y)
  ctx.fill()
}

/** The deep: light falling in shafts, bubbles rising, a jellyfish pulsing its way up; new usage lights a ring of glowing plankton */
export function abyss(): Pocket {
  const bubbles = Array.from({ length: 22 }, () => ({ u: Math.random(), v: Math.random(), r: rnd(0.8, 2.6), sp: rnd(0.05, 0.12), p: Math.random() * TAU }))
  const specks = starsOf(40)
  const fresh = pulses()
  let rings: number[] = []
  return {
    dark: () => true,
    draw(ctx, w, h, dt, l) {
      const f = focus(l.shape, w, h)
      if (fresh(l)) rings.push(0)
      vgrad(ctx, w, h, [
        [0, '#03182c'],
        [0.6, '#031024'],
        [1, '#020812']
      ])
      ctx.globalCompositeOperation = 'lighter'
      for (let i = 0; i < 3; i++) {
        const x = w * (0.3 + i * 0.28) + Math.sin(l.t * 0.2 + i) * w * 0.04
        const g = ctx.createLinearGradient(0, 0, 0, h)
        g.addColorStop(0, 'rgba(90,170,220,0.16)')
        g.addColorStop(1, 'rgba(90,170,220,0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.moveTo(x - w * 0.03, 0)
        ctx.lineTo(x + w * 0.05, 0)
        ctx.lineTo(x + w * 0.16, h)
        ctx.lineTo(x + w * 0.02, h)
        ctx.fill()
      }
      ctx.globalCompositeOperation = 'source-over'
      drawStars(ctx, specks, w, h, l.t * 0.6, 0.4, '#9fd6ff')
      for (const b of bubbles) {
        b.v -= dt * b.sp * (1 + l.intensity * 0.3)
        if (b.v < -0.05) {
          b.v = 1.05
          b.u = Math.random()
        }
        const x = b.u * w + Math.sin(l.t * 2 + b.p) * 3
        ctx.strokeStyle = 'rgba(180,225,255,0.45)'
        ctx.lineWidth = 0.8
        ctx.beginPath()
        ctx.arc(x, b.v * h, b.r, 0, TAU)
        ctx.stroke()
      }
      const k = kick(l, 2)
      jelly(ctx, f.x + Math.sin(l.t * 0.3) * f.s * 0.08, f.y - Math.sin(l.t * 2.2) * f.s * 0.03, f.s * 0.42, l.t, k)
      rings = rings.filter((a) => a < 2)
      for (let i = 0; i < rings.length; i++) {
        rings[i] += dt
        const a = rings[i] / 2
        for (let j = 0; j < 18; j++) {
          const ang = (j / 18) * TAU + a
          glow(ctx, f.x + Math.cos(ang) * f.s * (0.2 + a * 0.6), f.y + Math.sin(ang) * f.s * (0.2 + a * 0.6), 4, '120,255,230', (1 - a) * 0.9)
        }
      }
    },
    emblem(ctx, x, y, r, l) {
      jelly(ctx, x, y - r * 0.15, r * 1.25, l.t, kick(l))
    }
  }
}

// ---------------------------------------------------------------- 昼夜

/** the sun's or moon's place over a surface: rising on the left, setting on the right */
function skyPos(az: number, alt: number, w: number, horizon: number): [number, number] {
  const u = clamp((((az - 60) % 360) + 360) % 360 / 240, 0, 1)
  return [w * (0.08 + u * 0.84), horizon - clamp(alt / 55, -0.2, 1) * horizon * 0.82]
}

/**
 * The real sky over the place set for 昼夜: its colours for the hour, the
 * sun or the moon where they are, clouds lit by them, stars at night, hills
 * in the hour's light; new usage hangs a rainbow by day, sends a shooting
 * star by night.
 */
export function daylight(): Pocket {
  let sky: SkyState | null = null
  let at = -1e9
  const stars = starsOf(60, 0.75)
  const clouds = Array.from({ length: 4 }, (_, i) => ({ u: Math.random(), v: 0.18 + i * 0.12, s: rnd(0.7, 1.2), sp: rnd(0.006, 0.012) }))
  const fresh = pulses()
  let show = -1
  let birds = rnd(0, 10)
  const look = (l: { t: number; place: { lat: number; lon: number; name: string } | null }) => {
    if (!sky || l.t - at > 20) {
      at = l.t
      sky = skyAt(dayNow(), l.place ?? placeOf(null))
    }
    return sky
  }
  return {
    dark: () => true,
    draw(ctx, w, h, dt, l) {
      const s = look(l)
      if (fresh(l)) show = 0
      const hy = h * (l.shape === 'orb' ? 0.66 : 0.72)
      const g = ctx.createLinearGradient(0, 0, 0, hy)
      g.addColorStop(0, s.zenith)
      g.addColorStop(0.65, s.middle)
      g.addColorStop(1, s.horizon)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
      if (s.stars > 0.02) drawStars(ctx, stars, w, hy, l.t, s.stars)
      const [sx, sy] = skyPos(s.az, s.alt, w, hy)
      if (s.alt > -8) {
        glow(ctx, sx, sy, Math.min(w, h) * 0.7, `${parseInt(s.sun.slice(1, 3), 16)},${parseInt(s.sun.slice(3, 5), 16)},${parseInt(s.sun.slice(5, 7), 16)}`, 0.45 * s.glow)
        disc(ctx, sx, sy, Math.min(h * 0.09, 9), s.alt > 0 ? '#fff6dc' : s.sun)
      }
      if (s.moon.alt > -4 && s.stars > 0.15) {
        const [mx, my] = skyPos(s.moon.az, s.moon.alt, w, hy)
        glow(ctx, mx, my, Math.min(h * 0.5, 40), '220,228,255', 0.3 * s.stars)
        drawMoon(ctx, mx, my, Math.min(h * 0.08, 8), s.moon.phase, true)
      }
      for (const c of clouds) {
        c.u += c.sp * dt * (1 + l.intensity * 0.3)
        if (c.u > 1.3) c.u = -0.3
        const cs = c.s * Math.min(h * 0.8, 70)
        for (let i = 0; i < 3; i++) {
          const cx = c.u * w + (i - 1) * cs * 0.5
          const cy = c.v * hy + (i === 1 ? -cs * 0.12 : 0)
          glow(ctx, cx, cy, cs * 0.45, `${parseInt(s.cloudLit.slice(1, 3), 16)},${parseInt(s.cloudLit.slice(3, 5), 16)},${parseInt(s.cloudLit.slice(5, 7), 16)}`, 0.55 * (1 - s.dark * 0.6))
        }
      }
      // a rainbow by day, a shooting star by night
      if (show >= 0) {
        show += dt / 4
        const a = Math.sin(Math.min(1, show) * Math.PI)
        if (s.alt > 3) {
          const cx = w * 0.62
          const R = Math.min(w * 0.42, hy * 1.1)
          ;['255,90,90', '255,170,70', '255,235,100', '120,220,120', '90,170,255', '150,110,240'].forEach((c, i) => {
            ctx.strokeStyle = `rgba(${c},${0.32 * a})`
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.arc(cx, hy, R - i * 2, Math.PI, 0)
            ctx.stroke()
          })
        } else {
          const m = Math.min(1, show * 4)
          const x = w * (0.3 + m * 0.5)
          const y = hy * (0.1 + m * 0.35)
          const tg = ctx.createLinearGradient(x - 40, y - 18, x, y)
          tg.addColorStop(0, 'rgba(255,255,255,0)')
          tg.addColorStop(1, `rgba(255,255,255,${1 - m})`)
          ctx.strokeStyle = tg
          ctx.lineWidth = 1.6
          ctx.beginPath()
          ctx.moveTo(x - 40, y - 18)
          ctx.lineTo(x, y)
          ctx.stroke()
        }
        if (show >= 1) show = -1
      }
      birds += dt
      const b = (birds % 22) / 10
      if (b < 1 && s.alt > 4) for (let i = 0; i < 3; i++) bird(ctx, w * (0.15 + b * 0.8) + i * 9, hy * (0.35 + i * 0.05), 3.4, l.t * 8 + i, 'rgba(30,40,60,0.55)')
      // far hills on the horizon, nearer ones below, in the hour's light
      ridge(ctx, w, h, [0.06, 0.13, 0.08, 0.16, 0.1, 0.14], hy / h + 0.05, s.land[1])
      ridge(ctx, w, h, [0.05, 0.11, 0.07, 0.13, 0.06, 0.1], 1.02, s.land[3])
    },
    emblem(ctx, x, y, r, l) {
      const s = look(l)
      if (s.alt > -2) {
        const half = s.alt < 6
        glow(ctx, x, y, r * 1.2, '255,200,110', 0.45 + kick(l) * 0.3)
        ctx.save()
        if (half) {
          ctx.beginPath()
          ctx.rect(x - r, y - r, r * 2, r * 1.15)
          ctx.clip()
        }
        ctx.strokeStyle = '#ffd27a'
        ctx.lineWidth = Math.max(1, r * 0.1)
        ctx.lineCap = 'round'
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU + l.t * 0.4
          ctx.beginPath()
          ctx.moveTo(x + Math.cos(a) * r * 0.58, y + Math.sin(a) * r * 0.58)
          ctx.lineTo(x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85)
          ctx.stroke()
        }
        disc(ctx, x, y, r * 0.42, half ? '#ffb070' : '#ffe08a')
        ctx.restore()
        if (half) {
          ctx.strokeStyle = 'rgba(255,220,180,0.8)'
          ctx.beginPath()
          ctx.moveTo(x - r * 0.9, y + r * 0.15)
          ctx.lineTo(x + r * 0.9, y + r * 0.15)
          ctx.stroke()
        }
      } else {
        glow(ctx, x, y, r * 1.1, '210,220,255', 0.35 + kick(l) * 0.3)
        drawMoon(ctx, x, y, r * 0.7, s.moon.phase, true)
      }
    }
  }
}

// ---------------------------------------------------------------- 诡秘世界

function seal(ctx: CanvasRenderingContext2D, x: number, y: number, R: number, t: number, a: number): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.strokeStyle = `rgba(255,95,105,${a})`
  ctx.lineWidth = 1
  ctx.rotate(t * 0.15)
  ctx.beginPath()
  ctx.arc(0, 0, R, 0, TAU)
  ctx.arc(0, 0, R * 0.86, 0, TAU)
  ctx.stroke()
  for (let i = 0; i < 16; i++) {
    const g = (i / 16) * TAU
    ctx.beginPath()
    ctx.moveTo(Math.cos(g) * R * 0.86, Math.sin(g) * R * 0.86)
    ctx.lineTo(Math.cos(g) * R * (i % 2 ? 0.92 : 1), Math.sin(g) * R * (i % 2 ? 0.92 : 1))
    ctx.stroke()
  }
  ctx.rotate(-t * 0.35)
  for (let k = 0; k < 2; k++) {
    ctx.beginPath()
    for (let i = 0; i < 3; i++) {
      const g = (i / 3) * TAU + k * Math.PI - Math.PI / 2
      const px = Math.cos(g) * R * 0.8
      const py = Math.sin(g) * R * 0.8
      if (i) ctx.lineTo(px, py)
      else ctx.moveTo(px, py)
    }
    ctx.closePath()
    ctx.stroke()
  }
  ctx.restore()
}

/** a rook: a dark bird, bigger than the kit's */
function raven(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, flap: number): void {
  const up = Math.sin(flap) * s * 0.6
  ctx.fillStyle = 'rgba(8,4,10,0.9)'
  ctx.beginPath()
  ctx.moveTo(x - s * 1.1, y - up)
  ctx.quadraticCurveTo(x - s * 0.4, y - s * 0.3, x, y)
  ctx.quadraticCurveTo(x + s * 0.4, y - s * 0.3, x + s * 1.1, y - up)
  ctx.quadraticCurveTo(x + s * 0.4, y + s * 0.1, x, y + s * 0.18)
  ctx.quadraticCurveTo(x - s * 0.4, y + s * 0.1, x - s * 1.1, y - up)
  ctx.fill()
}

/** A gothic city under a crimson moon, a seal turning round it, fog drifting, a rook crossing; new usage turns a golden tarot card */
export function mystic(): Pocket {
  const towers = Array.from({ length: 14 }, (_, i) => ({ u: i / 13 + rnd(-0.02, 0.02), h: rnd(0.12, 0.34), spire: Math.random() < 0.5, lit: Math.random() }))
  const fresh = pulses()
  let card = -1
  let flight = rnd(0, 8)
  return {
    dark: () => true,
    draw(ctx, w, h, dt, l) {
      const f = focus(l.shape, w, h)
      if (fresh(l)) card = 0
      vgrad(ctx, w, h, [
        [0, '#0b0611'],
        [0.7, '#1c0c16'],
        [1, '#2a0f18']
      ])
      const R = f.s * 0.2
      const k = card >= 0 ? Math.sin(Math.min(1, card / 2.5) * Math.PI) : 0
      glow(ctx, f.x, f.y, R * 4.2, '190,20,40', 0.35 + k * 0.3)
      const mg = ctx.createRadialGradient(f.x - R * 0.3, f.y - R * 0.3, R * 0.1, f.x, f.y, R)
      mg.addColorStop(0, '#ff8a80')
      mg.addColorStop(1, '#8c1022')
      disc(ctx, f.x, f.y, R, mg)
      ctx.globalCompositeOperation = 'lighter'
      seal(ctx, f.x, f.y, R * 1.9, l.t * (1 + l.intensity * 0.3), 0.4 + k * 0.4)
      ctx.globalCompositeOperation = 'source-over'
      flight += dt
      const c = (flight % 13) / 5
      if (c < 1) raven(ctx, w * (1.05 - c * 1.1), f.y - R * 0.6 + Math.sin(c * 6) * R * 0.3, Math.min(h * 0.07, 7), l.t * 9)
      // the city
      ctx.fillStyle = '#07040a'
      for (const t of towers) {
        const x = t.u * w
        const tw = w * 0.05
        const th = h * t.h
        ctx.fillRect(x - tw / 2, h - th, tw, th)
        if (t.spire) {
          ctx.beginPath()
          ctx.moveTo(x - tw / 2, h - th)
          ctx.lineTo(x, h - th - tw * 1.4)
          ctx.lineTo(x + tw / 2, h - th)
          ctx.fill()
        }
      }
      for (const t of towers) {
        if (t.lit < 0.45) continue
        const flick = 0.6 + 0.4 * Math.sin(l.t * 3 + t.lit * 40)
        ctx.fillStyle = `rgba(255,180,90,${0.7 * flick})`
        ctx.fillRect(t.u * w - 1, h - h * t.h * 0.6, 2, 3)
      }
      // fog
      for (let i = 0; i < 3; i++) {
        const x = (((l.t * (0.012 + i * 0.006) + i * 0.37) % 1.6) - 0.3) * w
        glow(ctx, x, h * (0.72 + i * 0.09), Math.max(w, h) * 0.32, '120,100,130', 0.16)
      }
      if (card >= 0) {
        card += dt
        const life = card / 2.5
        const flip = Math.cos(Math.min(1, card / 0.8) * Math.PI)
        const cw = R * 1.1
        const ch = R * 1.8
        const cx = Math.min(w - cw * 0.7, f.x + R * 2.1)
        const cy = f.y + R * 0.2 - life * R * 0.4
        ctx.save()
        ctx.globalAlpha = Math.min(1, (1 - life) * 3)
        ctx.translate(cx, cy)
        ctx.scale(Math.abs(flip) + 0.02, 1)
        glow(ctx, 0, 0, ch, '255,210,120', 0.5)
        ctx.fillStyle = flip > 0 ? '#3a1530' : '#f2d27a'
        ctx.strokeStyle = '#ffd98a'
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.roundRect(-cw / 2, -ch / 2, cw, ch, 3)
        ctx.fill()
        ctx.stroke()
        if (flip <= 0) {
          disc(ctx, 0, -ch * 0.08, cw * 0.24, '#b3122a')
          ctx.strokeStyle = '#7a4a10'
          ctx.beginPath()
          ctx.arc(0, -ch * 0.08, cw * 0.34, 0, TAU)
          ctx.stroke()
        }
        ctx.restore()
        if (card > 2.5) card = -1
      }
    },
    emblem(ctx, x, y, r, l) {
      const k = kick(l)
      glow(ctx, x, y, r * 1.3, '190,20,40', 0.45 + k * 0.35)
      const mg = ctx.createRadialGradient(x - r * 0.15, y - r * 0.15, r * 0.05, x, y, r * 0.5)
      mg.addColorStop(0, '#ff8a80')
      mg.addColorStop(1, '#8c1022')
      disc(ctx, x, y, r * 0.48, mg)
      seal(ctx, x, y, r * 0.92, l.t * 2, 0.75)
    }
  }
}

// ---------------------------------------------------------------- 赛博朋克

/** A rain-soaked neon city: two layers of towers with lit windows, flickering signs, a flying car's trail; new usage glitches the picture */
export function cyber(): Pocket {
  const far = Array.from({ length: 16 }, (_, i) => ({ u: i / 15, h: rnd(0.3, 0.6) }))
  const near = Array.from({ length: 9 }, (_, i) => ({ u: i / 8 + rnd(-0.03, 0.03), h: rnd(0.28, 0.55), w: rnd(0.07, 0.12), win: Math.random() * 1000 }))
  const drops = Array.from({ length: 40 }, () => ({ u: Math.random(), v: Math.random(), sp: rnd(1.1, 1.8), c: Math.random() < 0.5 ? '255,80,200' : '80,220,255' }))
  const fresh = pulses()
  let glitch = 0
  let car = rnd(0, 4)
  return {
    dark: () => true,
    draw(ctx, w, h, dt, l) {
      const f = focus(l.shape, w, h)
      if (fresh(l)) glitch = 0.5
      vgrad(ctx, w, h, [
        [0, '#07040f'],
        [0.6, '#170a26'],
        [1, '#2b0d33']
      ])
      glow(ctx, f.x, h, Math.max(w, h) * 0.6, '255,60,180', 0.18)
      ctx.fillStyle = '#1d1030'
      for (const b of far) ctx.fillRect(b.u * w - w * 0.04, h * (1 - b.h), w * 0.075, h * b.h)
      // the flying car
      car += dt
      const c = (car % 7) / 2.2
      if (c < 1) {
        const x = w * (c * 1.3 - 0.15)
        const y = h * 0.3
        const g = ctx.createLinearGradient(x - 60, y, x, y)
        g.addColorStop(0, 'rgba(255,60,120,0)')
        g.addColorStop(1, 'rgba(255,90,140,0.8)')
        ctx.strokeStyle = g
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.moveTo(x - 60, y + 3)
        ctx.lineTo(x, y)
        ctx.stroke()
        glow(ctx, x, y, 8, '200,240,255', 0.9)
      }
      for (const b of near) {
        const bx = b.u * w - (b.w * w) / 2
        const by = h * (1 - b.h)
        ctx.fillStyle = '#0a0612'
        ctx.fillRect(bx, by, b.w * w, h * b.h)
        for (let wy = by + 4; wy < h - 3; wy += 5) {
          for (let wx = bx + 3; wx < bx + b.w * w - 3; wx += 5) {
            const n = Math.sin(b.win + wx * 12.9 + wy * 78.2) * 43758.5
            const r = n - Math.floor(n)
            if (r < 0.72) continue
            ctx.fillStyle = r > 0.95 ? 'rgba(255,90,210,0.8)' : r > 0.86 ? 'rgba(90,220,255,0.7)' : 'rgba(255,220,140,0.55)'
            ctx.fillRect(wx, wy, 1.6, 1.6)
          }
        }
      }
      // two signs, flickering
      const sign = (x: number, y: number, sw: number, sh: number, c: string, p: number) => {
        const on = Math.sin(l.t * 13 + p) > -0.9 || Math.sin(l.t * 2 + p) > 0
        if (!on) return
        ctx.shadowColor = `rgba(${c},0.9)`
        ctx.shadowBlur = 8
        ctx.strokeStyle = `rgba(${c},0.9)`
        ctx.lineWidth = 1.4
        ctx.strokeRect(x, y, sw, sh)
        ctx.shadowBlur = 0
      }
      sign(f.x - f.s * 0.15, h * 0.42, f.s * 0.12, h * 0.3, '255,70,200', 1)
      sign(f.x + f.s * 0.1, h * 0.55, f.s * 0.28, h * 0.1, '80,230,255', 2)
      ctx.lineWidth = 1
      for (const d of drops) {
        d.v += dt * d.sp
        if (d.v > 1.1) {
          d.v = -0.1
          d.u = Math.random()
        }
        ctx.strokeStyle = `rgba(${d.c},0.35)`
        ctx.beginPath()
        ctx.moveTo(d.u * w, d.v * h)
        ctx.lineTo(d.u * w - 2, d.v * h - h * 0.06)
        ctx.stroke()
      }
      if (glitch > 0) {
        glitch -= dt
        const dpr = ctx.getTransform().a
        for (let i = 0; i < 4; i++) {
          const y = Math.random() * h
          const bh = rnd(3, 10)
          const dx = rnd(-14, 14)
          ctx.drawImage(ctx.canvas, 0, y * dpr, w * dpr, bh * dpr, dx, y, w, bh)
        }
        ctx.globalCompositeOperation = 'lighter'
        ctx.fillStyle = `rgba(255,40,160,${glitch * 0.25})`
        ctx.fillRect(rnd(0, w * 0.5), 0, w * 0.4, h)
        ctx.fillStyle = `rgba(40,230,255,${glitch * 0.2})`
        ctx.fillRect(rnd(w * 0.3, w), 0, w * 0.3, h)
        ctx.globalCompositeOperation = 'source-over'
      }
    },
    emblem(ctx, x, y, r, l) {
      const flick = Math.sin(l.t * 17) > -0.85 || Math.sin(l.t * 1.3) > 0.2 ? 1 : 0.35
      const s = r * 1.5
      ctx.shadowColor = `rgba(255,70,200,${0.9 * flick})`
      ctx.shadowBlur = r * 0.6
      ctx.strokeStyle = `rgba(255,90,210,${flick})`
      ctx.lineWidth = Math.max(1.2, r * 0.1)
      ctx.strokeRect(x - s / 2, y - s / 2, s, s)
      ctx.shadowColor = `rgba(80,230,255,${flick})`
      ctx.fillStyle = `rgba(150,240,255,${flick})`
      ctx.font = `700 ${s * 0.68}px "Microsoft YaHei", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('電', x + (kick(l) > 0.3 ? rnd(-2, 2) : 0), y + s * 0.04)
      ctx.shadowBlur = 0
    }
  }
}

// ---------------------------------------------------------------- 云海仙山

function peaks(ctx: CanvasRenderingContext2D, w: number, h: number, list: { u: number; h: number; w: number }[], fill: string): void {
  ctx.fillStyle = fill
  for (const p of list) {
    const x = p.u * w
    const pw = p.w * w
    const top = h * (1 - p.h)
    ctx.beginPath()
    ctx.moveTo(x - pw, h)
    ctx.bezierCurveTo(x - pw * 0.55, h - (h - top) * 0.5, x - pw * 0.35, top, x, top)
    ctx.bezierCurveTo(x + pw * 0.35, top, x + pw * 0.55, h - (h - top) * 0.5, x + pw, h)
    ctx.fill()
  }
}

/** Karst peaks standing out of a sea of cloud, a crane crossing the moon (or the pale sun); new usage sends a flying sword through */
export function xianxia(): Pocket {
  const back = Array.from({ length: 6 }, (_, i) => ({ u: 0.2 + i * 0.16 + rnd(-0.04, 0.04), h: rnd(0.45, 0.7), w: rnd(0.07, 0.11) }))
  const front = Array.from({ length: 4 }, (_, i) => ({ u: 0.4 + i * 0.2 + rnd(-0.05, 0.05), h: rnd(0.3, 0.5), w: rnd(0.08, 0.13) }))
  const fresh = pulses()
  let sword = -1
  let sparks: Bit[] = []
  let flight = rnd(0, 6)
  return {
    dark: (d) => d,
    draw(ctx, w, h, dt, l) {
      const f = focus(l.shape, w, h)
      if (fresh(l)) sword = 0
      vgrad(ctx, w, h, l.dark ? [[0, '#0b1424'], [1, '#1d2c44']] : [[0, '#e3ecf1'], [1, '#f7f4ec']])
      glow(ctx, f.x, h * 0.28, f.s * 0.8, l.dark ? '220,230,255' : '255,240,210', l.dark ? 0.28 : 0.45)
      disc(ctx, f.x, h * 0.28, f.s * 0.09, l.dark ? '#eef2ff' : '#fff7e4')
      peaks(ctx, w, h, back, l.dark ? 'rgba(130,160,200,0.22)' : 'rgba(90,120,130,0.28)')
      const cloud = l.dark ? '190,205,230' : '255,255,255'
      for (let i = 0; i < 7; i++) {
        const x = (((l.t * 0.01 * (1 + (i % 3) * 0.4) + i * 0.17) % 1.4) - 0.2) * w
        glow(ctx, x, h * (0.66 + (i % 3) * 0.05), Math.min(w, h * 2) * 0.32, cloud, l.dark ? 0.2 : 0.55)
      }
      peaks(ctx, w, h, front, l.dark ? 'rgba(20,32,50,0.9)' : 'rgba(55,85,95,0.75)')
      for (let i = 0; i < 6; i++) {
        const x = (((l.t * 0.016 + i * 0.23) % 1.4) - 0.2) * w
        glow(ctx, x, h * (0.9 + (i % 2) * 0.06), Math.min(w, h * 2) * 0.28, cloud, l.dark ? 0.28 : 0.7)
      }
      flight += dt
      const c = (flight % 18) / 9
      if (c < 1) {
        const x = w * (1.05 - c * 1.1)
        const y = h * 0.3 + Math.sin(c * 4) * h * 0.05
        bird(ctx, x, y, Math.min(h * 0.08, 8), l.t * 4, l.dark ? 'rgba(235,240,250,0.85)' : 'rgba(40,50,55,0.8)')
      }
      if (sword >= 0) {
        sword += dt / 1.1
        const k = sword
        const x0 = -0.1 * w
        const y0 = h * 0.15
        const x1 = 1.1 * w
        const y1 = h * 0.55
        const x = x0 + (x1 - x0) * k
        const y = y0 + (y1 - y0) * k - Math.sin(k * Math.PI) * h * 0.15
        const g = ctx.createLinearGradient(x - w * 0.3, y - h * 0.05, x, y)
        g.addColorStop(0, 'rgba(120,255,220,0)')
        g.addColorStop(1, 'rgba(200,255,240,0.9)')
        ctx.strokeStyle = g
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(x - w * 0.3, y - h * 0.05)
        ctx.lineTo(x, y)
        ctx.stroke()
        glow(ctx, x, y, 10, '255,240,180', 0.95)
        sparks.push({ x, y, vx: rnd(-20, 20), vy: rnd(-20, 20), life: 0.6, max: 0.6, r: 1, c: '200,255,240' })
        if (sword >= 1) sword = -1
      }
      sparks = stepBits(sparks, dt)
      for (const s of sparks) disc(ctx, s.x, s.y, s.r, `rgba(${s.c},${s.life / s.max})`)
    },
    emblem(ctx, x, y, r, l) {
      glow(ctx, x, y, r * 1.2, '120,255,200', 0.3 + kick(l) * 0.4)
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r * 0.85)
      g.addColorStop(0, '#d9ffe9')
      g.addColorStop(0.6, '#6fcf9f')
      g.addColorStop(1, '#2e8a66')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, r * 0.8, 0, TAU)
      ctx.arc(x, y, r * 0.3, 0, TAU, true)
      ctx.fill('evenodd')
      const a = l.t * 0.9
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'
      ctx.lineWidth = Math.max(1, r * 0.08)
      ctx.beginPath()
      ctx.arc(x, y, r * 0.58, a, a + 0.9)
      ctx.stroke()
      const sa = -l.t * 1.6
      glow(ctx, x + Math.cos(sa) * r * 0.95, y + Math.sin(sa) * r * 0.95, r * 0.3, '255,240,180', 0.9)
    }
  }
}

// ---------------------------------------------------------------- 锦鲤池

const KOI = [
  { body: '#f4f1ea', spot: '#e0452e' },
  { body: '#ff8a2a', spot: '#ffd27a' },
  { body: '#f2c443', spot: '#fff1b8' }
]

/** a koi along its path, `at(k)` from the head (k = 0) to the root of the tail (k = 1): tapered sides, a fanned tail, spots */
function koiFish(ctx: CanvasRenderingContext2D, at: (k: number) => [number, number], t: number, s: number, look: (typeof KOI)[number]): void {
  const n = 9
  const pts: [number, number][] = []
  for (let i = 0; i < n; i++) pts.push(at(i / (n - 1)))
  const W = [0.16, 0.24, 0.26, 0.25, 0.22, 0.18, 0.13, 0.09, 0.05].map((v) => v * s)
  const left: [number, number][] = []
  const right: [number, number][] = []
  pts.forEach(([x, y], i) => {
    const [px, py] = pts[Math.max(0, i - 1)]
    const [qx, qy] = pts[Math.min(n - 1, i + 1)]
    const dx = px - qx
    const dy = py - qy
    const d = Math.hypot(dx, dy) || 1
    left.push([x - (dy / d) * W[i], y + (dx / d) * W[i]])
    right.push([x + (dy / d) * W[i], y - (dx / d) * W[i]])
  })
  // the shadow on the bottom
  ctx.fillStyle = 'rgba(0,30,30,0.18)'
  ctx.beginPath()
  left.forEach(([x, y], i) => (i ? ctx.lineTo(x + 4, y + 6) : ctx.moveTo(x + 4, y + 6)))
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i][0] + 4, right[i][1] + 6)
  ctx.fill()
  // the tail
  const [tx, ty] = pts[n - 1]
  const [ux, uy] = pts[n - 2]
  const a = Math.atan2(ty - uy, tx - ux)
  const sway = Math.sin(t * 7) * 0.45
  ctx.fillStyle = look.body
  ctx.globalAlpha = 0.8
  ctx.beginPath()
  ctx.moveTo(tx, ty)
  ctx.quadraticCurveTo(tx + Math.cos(a + sway) * s * 0.25, ty + Math.sin(a + sway) * s * 0.25, tx + Math.cos(a + 0.45 + sway) * s * 0.42, ty + Math.sin(a + 0.45 + sway) * s * 0.42)
  ctx.lineTo(tx + Math.cos(a - 0.45 + sway) * s * 0.42, ty + Math.sin(a - 0.45 + sway) * s * 0.42)
  ctx.closePath()
  ctx.fill()
  // the fins behind the head
  const [fx, fy] = pts[2]
  const [gx, gy] = pts[1]
  const b = Math.atan2(fy - gy, fx - gx)
  for (const side of [1, -1]) {
    ctx.beginPath()
    ctx.ellipse(fx + Math.cos(b + side * 1.6) * s * 0.24, fy + Math.sin(b + side * 1.6) * s * 0.24, s * 0.16, s * 0.07, b + side * (0.9 + Math.sin(t * 5) * 0.2), 0, TAU)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  const body = new Path2D()
  left.forEach(([x, y], i) => (i ? body.lineTo(x, y) : body.moveTo(x, y)))
  for (let i = n - 1; i >= 0; i--) body.lineTo(right[i][0], right[i][1])
  body.closePath()
  ctx.fillStyle = look.body
  ctx.fill(body)
  ctx.save()
  ctx.clip(body)
  disc(ctx, pts[2][0], pts[2][1], s * 0.17, look.spot)
  disc(ctx, pts[5][0] + s * 0.04, pts[5][1], s * 0.12, look.spot)
  ctx.restore()
}

/** A koi pond from above: light rippling over the bottom, lily pads, koi gliding; new usage scatters food and they come for it */
export function koi(): Pocket {
  const fish = KOI.map((look, i) => ({ look, r: rnd(0.16, 0.26), a: rnd(0, TAU), sp: rnd(0.3, 0.45) * (i % 2 ? -1 : 1), cx: rnd(0.6, 0.82), cy: 0.5 }))
  const pads = Array.from({ length: 3 }, (_, i) => ({ u: [0.42, 0.88, 0.66][i], v: [0.78, 0.22, 0.86][i], r: rnd(0.12, 0.17), rot: Math.random() * TAU, lotus: i === 1 }))
  const fresh = pulses()
  let food: { u: number; v: number; life: number }[] = []
  let ripples: { u: number; v: number; age: number }[] = []
  return {
    dark: (d) => d,
    draw(ctx, w, h, dt, l) {
      const f = focus(l.shape, w, h)
      if (fresh(l)) {
        for (let i = 0; i < 6; i++) food.push({ u: f.x / w + rnd(-0.06, 0.06), v: f.y / h + rnd(-0.15, 0.15), life: 5 })
        ripples.push({ u: f.x / w, v: f.y / h, age: 0 })
      }
      vgrad(ctx, w, h, l.dark ? [[0, '#07191d'], [1, '#0c2b31']] : [[0, '#c3e4de'], [1, '#93cbc2']])
      // light on the bottom
      ctx.strokeStyle = l.dark ? 'rgba(120,220,210,0.07)' : 'rgba(255,255,255,0.22)'
      ctx.lineWidth = 1.2
      for (let i = 0; i < 9; i++) {
        ctx.beginPath()
        for (let j = 0; j <= 24; j++) {
          const u = j / 24
          const y = h * ((i + 0.5) / 9) + Math.sin(u * 9 + l.t * 0.9 + i * 1.7) * h * 0.04 + Math.sin(u * 23 - l.t * 1.3 + i) * h * 0.015
          if (j) ctx.lineTo(u * w, y)
          else ctx.moveTo(u * w, y)
        }
        ctx.stroke()
      }
      const S = Math.min(h, w * 0.5)
      const hungry = food.length > 0
      fish.forEach((q) => {
        const tx = hungry ? food[0].u : q.cx
        const ty = hungry ? food[0].v : q.cy
        q.cx += (tx - q.cx) * dt * (hungry ? 0.8 : 0.1)
        q.cy += (ty - q.cy) * dt * (hungry ? 0.8 : 0.1)
        q.a += dt * q.sp * (1 + l.intensity * 0.25 + (hungry ? 1.2 : 0))
        // head to tail back along its oval, the body about four times as long as it is wide
        const rx = q.r * S * 1.5
        const ry = q.r * S * 0.75
        const size = S * 0.3
        const span = (size * 1.6) / ((rx + ry) / 2)
        const at = (k: number): [number, number] => {
          const a = q.a - Math.sign(q.sp) * k * span
          return [q.cx * w + Math.cos(a) * rx, q.cy * h + Math.sin(a) * ry]
        }
        koiFish(ctx, at, l.t, size, q.look)
      })
      food = food.filter((p) => {
        p.life -= dt
        disc(ctx, p.u * w, p.v * h, 1.6, `rgba(150,90,40,${Math.min(1, p.life)})`)
        return p.life > 0
      })
      ripples = ripples.filter((r) => (r.age += dt) < 2.5)
      for (const r of ripples) {
        const k = r.age / 2.5
        ctx.strokeStyle = `rgba(255,255,255,${(1 - k) * 0.6})`
        ctx.lineWidth = 1.2
        for (let i = 0; i < 2; i++) {
          ctx.beginPath()
          ctx.ellipse(r.u * w, r.v * h, S * (0.1 + k * 0.5 - i * 0.06), S * (0.06 + k * 0.3 - i * 0.04), 0, 0, TAU)
          ctx.stroke()
        }
      }
      for (const p of pads) {
        const x = p.u * w
        const y = p.v * h
        const r = p.r * S
        const a = p.rot + Math.sin(l.t * 0.3 + p.u * 5) * 0.1
        ctx.fillStyle = l.dark ? '#24563c' : '#5aa05e'
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.arc(x, y, r, a + 0.3, a + TAU - 0.05)
        ctx.closePath()
        ctx.fill()
        if (p.lotus) {
          for (let i = 0; i < 6; i++) {
            const b = (i / 6) * TAU + l.t * 0.05
            disc(ctx, x + Math.cos(b) * r * 0.25, y + Math.sin(b) * r * 0.25, r * 0.28, l.dark ? 'rgba(240,160,190,0.9)' : 'rgba(250,170,200,0.95)')
          }
          disc(ctx, x, y, r * 0.15, '#ffd76a')
        }
      }
    },
    emblem(ctx, x, y, r, l) {
      glow(ctx, x, y, r * 1.1, '255,150,80', 0.25 + kick(l) * 0.4)
      for (let i = 0; i < 2; i++) {
        const R = r * 0.5
        const at = (k: number): [number, number] => {
          const a = l.t * 1.4 + i * Math.PI - k * 2
          return [x + Math.cos(a) * R, y + Math.sin(a) * R]
        }
        koiFish(ctx, at, l.t, R * 1.15, KOI[i])
      }
    }
  }
}

// ---------------------------------------------------------------- 浮世绘

/** a row of waves: scalloped crests in Prussian blue with foam fingers */
function waveRow(ctx: CanvasRenderingContext2D, w: number, y: number, amp: number, len: number, off: number, fill: string, foam: string): void {
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.moveTo(-len, y + amp * 3)
  for (let x = -len + (off % len); x < w + len; x += len) {
    ctx.quadraticCurveTo(x + len * 0.25, y - amp, x + len * 0.55, y - amp * 0.6)
    ctx.quadraticCurveTo(x + len * 0.72, y - amp * 0.2, x + len * 0.62, y + amp * 0.2)
    ctx.quadraticCurveTo(x + len * 0.8, y + amp * 0.1, x + len, y + amp * 0.4)
  }
  ctx.lineTo(w + len, y + amp * 3)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = foam
  ctx.lineWidth = Math.max(1, amp * 0.18)
  ctx.lineCap = 'round'
  for (let x = -len + (off % len); x < w + len; x += len) {
    ctx.beginPath()
    ctx.moveTo(x + len * 0.3, y - amp * 0.72)
    ctx.quadraticCurveTo(x + len * 0.5, y - amp * 0.95, x + len * 0.62, y - amp * 0.55)
    ctx.stroke()
  }
}

/** A woodblock sea: rows of scalloped waves rolling under a red sun (a pale moon in dark); new usage raises a great crest with spray */
export function ukiyo(): Pocket {
  const fresh = pulses()
  let crest = -1
  let spray: Bit[] = []
  return {
    dark: (d) => d,
    draw(ctx, w, h, dt, l) {
      const f = focus(l.shape, w, h)
      if (fresh(l)) crest = 0
      if (l.dark) vgrad(ctx, w, h, [[0, '#0b1626'], [1, '#14253c']])
      else {
        ctx.fillStyle = '#f1e5cc'
        ctx.fillRect(0, 0, w, h)
        const g = ctx.createLinearGradient(0, 0, 0, h * 0.45)
        g.addColorStop(0, 'rgba(26,58,108,0.62)')
        g.addColorStop(1, 'rgba(26,58,108,0)')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h * 0.45)
      }
      const sy = h * 0.34
      disc(ctx, f.x, sy, f.s * 0.13, l.dark ? '#ece6d4' : '#d8452f')
      if (l.dark) glow(ctx, f.x, sy, f.s * 0.5, '230,225,210', 0.25)
      const deep = l.dark ? ['#1c3b66', '#244b80', '#2d5c98', '#3a70b0'] : ['#9cbbe0', '#86a9d6', '#7098c9', '#5d88bd']
      const foam = l.dark ? 'rgba(230,236,245,0.85)' : 'rgba(250,246,236,0.95)'
      const sp = 1 + l.intensity * 0.3
      const low = l.shape === 'card' || l.shape === 'capsule' ? 0.62 : 0.5
      const step = l.shape === 'card' || l.shape === 'capsule' ? 0.1 : 0.14
      for (let i = 0; i < 4; i++) {
        const y = h * (low + i * step)
        waveRow(ctx, w, y, h * (0.04 + i * 0.01), Math.max(26, h * (0.42 + i * 0.1)), l.t * (8 + i * 6) * sp * (i % 2 ? -1 : 1), deep[i], foam)
      }
      if (crest >= 0) {
        crest += dt / 1.8
        const k = Math.sin(Math.min(1, crest) * Math.PI)
        const cx = f.x
        const base = h * 0.95
        const top = base - h * 0.5 * k
        const sw = f.s * 0.7
        ctx.fillStyle = deep[2]
        ctx.beginPath()
        ctx.moveTo(cx - sw * 0.6, base)
        ctx.quadraticCurveTo(cx - sw * 0.3, top, cx + sw * 0.1, top)
        ctx.quadraticCurveTo(cx + sw * 0.35, top + h * 0.05, cx + sw * 0.2, top + h * 0.18)
        ctx.quadraticCurveTo(cx + sw * 0.4, base - h * 0.2, cx + sw * 0.6, base)
        ctx.fill()
        ctx.strokeStyle = foam
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(cx - sw * 0.2, top + h * 0.08)
        ctx.quadraticCurveTo(cx + sw * 0.05, top - h * 0.04, cx + sw * 0.25, top + h * 0.1)
        ctx.stroke()
        if (crest > 0.45 && crest < 0.6) for (let i = 0; i < 6; i++) spray.push({ x: cx + sw * rnd(0, 0.3), y: top, vx: rnd(-40, 50), vy: rnd(-70, -20), life: 1, max: 1, r: rnd(1, 2.2), c: l.dark ? '250,246,236' : '255,255,255' })
        if (crest >= 1) crest = -1
      }
      spray = stepBits(spray, dt, 120)
      for (const s of spray) disc(ctx, s.x, s.y, s.r, `rgba(${s.c},${s.life})`)
    },
    emblem(ctx, x, y, r, l) {
      disc(ctx, x + r * 0.12, y - r * 0.18, r * 0.5, '#d8452f')
      ctx.save()
      ctx.beginPath()
      ctx.arc(x, y, r, 0, TAU)
      ctx.clip()
      const lift = Math.sin(l.t * 1.6) * r * 0.06 + kick(l) * r * 0.15
      ctx.fillStyle = '#2a5596'
      ctx.beginPath()
      ctx.moveTo(x - r, y + r)
      ctx.lineTo(x - r, y + r * 0.2 - lift)
      ctx.quadraticCurveTo(x - r * 0.2, y - r * 0.55 - lift, x + r * 0.35, y - r * 0.2 - lift)
      ctx.quadraticCurveTo(x + r * 0.05, y - r * 0.1 - lift, x + r * 0.1, y + r * 0.2)
      ctx.quadraticCurveTo(x + r * 0.5, y + r * 0.1, x + r, y + r * 0.35)
      ctx.lineTo(x + r, y + r)
      ctx.fill()
      ctx.strokeStyle = '#faf6ec'
      ctx.lineWidth = Math.max(1, r * 0.1)
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(x - r * 0.45, y - r * 0.12 - lift)
      ctx.quadraticCurveTo(x - r * 0.05, y - r * 0.5 - lift, x + r * 0.28, y - r * 0.22 - lift)
      ctx.stroke()
      ctx.restore()
    }
  }
}

// ---------------------------------------------------------------- 像素冒险

const DIGITS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '+': ['000', '010', '111', '010', '000'],
  '.': ['000', '000', '000', '000', '010'],
  K: ['101', '110', '100', '110', '101'],
  M: ['101', '111', '111', '101', '101']
}

function pixText(g: CanvasRenderingContext2D, text: string, x: number, y: number, c: string): void {
  g.fillStyle = c
  let cx = x
  for (const ch of text) {
    const rows = DIGITS[ch]
    if (rows) rows.forEach((row, j) => [...row].forEach((b, i) => b === '1' && g.fillRect(cx + i, y + j, 1, 1)))
    cx += 4
  }
}

const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : `${Math.round(n)}`)

/** An 8-bit world drawn big-pixel: clouds, stepped hills, a ? block bobbing with coins spinning; new usage bumps the block and pops a coin and the count */
export function pixel(): Pocket {
  const PX = 3
  const buf = document.createElement('canvas')
  const g = buf.getContext('2d')!
  const fresh = pulses()
  let bump = -1
  let pops: { y: number; life: number; text: string }[] = []
  return {
    dark: (d) => d,
    draw(ctx, w, h, dt, l) {
      const bw = Math.max(8, Math.ceil(w / PX))
      const bh = Math.max(8, Math.ceil(h / PX))
      if (buf.width !== bw || buf.height !== bh) {
        buf.width = bw
        buf.height = bh
      }
      if (fresh(l)) {
        bump = 0
        pops.push({ y: 0, life: 1.4, text: `+${short(l.size)}` })
      }
      const sky = l.dark ? ['#1a1a40', '#24245a', '#2f2f70'] : ['#6ab4f8', '#82c4fa', '#9ad2fc']
      sky.forEach((c, i) => {
        g.fillStyle = c
        g.fillRect(0, Math.floor((i / 3) * bh), bw, Math.ceil(bh / 3) + 1)
      })
      const f = focus(l.shape, w, h)
      const fx = Math.floor(f.x / PX)
      const fy = Math.floor(f.y / PX)
      if (l.dark) {
        g.fillStyle = '#fff'
        for (let i = 0; i < 18; i++) if (Math.sin(l.t * 2 + i * 7) > -0.3) g.fillRect((i * 37) % bw, (i * 13) % Math.floor(bh * 0.6), 1, 1)
        g.fillStyle = '#f4f0d8'
        g.fillRect(bw - 10, 3, 4, 4)
      } else {
        g.fillStyle = '#ffe36a'
        g.fillRect(bw - 11, 3, 5, 5)
      }
      // clouds
      g.fillStyle = l.dark ? '#3c3c7a' : '#ffffff'
      for (let i = 0; i < 3; i++) {
        const cx = Math.floor((((l.t * (2 + i) + i * 40) % (bw + 30)) - 15))
        const cy = 4 + i * 5
        g.fillRect(cx, cy, 10, 2)
        g.fillRect(cx + 2, cy - 2, 5, 2)
      }
      // hills, stepped
      const scroll = l.t * 4
      g.fillStyle = l.dark ? '#1f4a3a' : '#3fae5a'
      for (let x = 0; x < bw; x++) {
        const hh = Math.floor(bh * 0.22 + Math.abs(Math.sin((x + scroll * 0.4) * 0.07)) * bh * 0.16)
        g.fillRect(x, bh - hh, 1, hh)
      }
      g.fillStyle = l.dark ? '#5a3a24' : '#c8783a'
      g.fillRect(0, bh - 3, bw, 3)
      g.fillStyle = l.dark ? '#2f6a3a' : '#5cd068'
      g.fillRect(0, bh - 4, bw, 1)
      // the ? block, bobbing; bumped by new usage
      let by = fy - 4 + Math.round(Math.sin(l.t * 2) * 1)
      if (bump >= 0) {
        bump += dt / 0.3
        by -= Math.round(Math.sin(Math.min(1, bump) * Math.PI) * 3)
        if (bump >= 1) bump = -1
      }
      g.fillStyle = '#7a3a10'
      g.fillRect(fx - 4, by - 4, 9, 9)
      g.fillStyle = '#f5a623'
      g.fillRect(fx - 3, by - 3, 7, 7)
      g.fillStyle = '#fff3c0'
      g.fillRect(fx - 1, by - 2, 3, 1)
      g.fillRect(fx + 1, by - 1, 1, 1)
      g.fillRect(fx, by, 1, 1)
      g.fillRect(fx, by + 2, 1, 1)
      // coins spinning on both sides
      for (let i = 0; i < 2; i++) {
        const cw = Math.max(1, Math.round(Math.abs(Math.cos(l.t * 3 + i)) * 3))
        const cx = fx + (i ? 9 : -10)
        g.fillStyle = '#ffd23a'
        g.fillRect(cx - Math.floor(cw / 2), fy - 6, cw, 5)
      }
      pops = pops.filter((p) => (p.life -= dt) > 0)
      for (const p of pops) {
        p.y += dt * 14
        const y = Math.max(1, by - 8 - Math.floor(p.y))
        g.fillStyle = '#ffd23a'
        g.fillRect(fx - 1, y + 6, 3, 4)
        pixText(g, p.text, Math.min(bw - p.text.length * 4, fx - Math.floor((p.text.length * 4) / 2)), y, '#ffffff')
      }
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(buf, 0, 0, bw * PX, bh * PX)
      ctx.imageSmoothingEnabled = true
      // scanlines
      ctx.fillStyle = 'rgba(0,0,0,0.08)'
      for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1)
    },
    emblem(ctx, x, y, r, l) {
      const s = Math.max(1, Math.round(r / 5))
      const cw = Math.max(1, Math.round(Math.abs(Math.cos(l.t * 3)) * 5))
      ctx.imageSmoothingEnabled = false
      glow(ctx, x, y, r * 1.1, '255,210,60', 0.25 + kick(l) * 0.4)
      ctx.fillStyle = '#7a4a00'
      ctx.fillRect(x - ((cw + 2) * s) / 2, y - 4 * s, (cw + 2) * s, 8 * s)
      ctx.fillStyle = '#ffd23a'
      ctx.fillRect(x - (cw * s) / 2, y - 3 * s, cw * s, 6 * s)
      if (cw > 2) {
        ctx.fillStyle = '#fff3a0'
        ctx.fillRect(x - (cw * s) / 2 + s, y - 2 * s, s, 3 * s)
      }
    }
  }
}

export const WORLD_POCKETS = { ink, abyss, daylight, mystic, cyber, xianxia, koi, ukiyo, pixel }
