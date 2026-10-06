import { mix, rgbText, smooth, type SeasonState, type SkyState } from '@shared/daycycle'
import type { Live } from './ThemeScenes'
import { rand, TAU } from './ThemeScenes'
import { clamp, drawBird, hash, SIDEBAR } from './sceneKit'

/**
 * Everything that happens in the 昼夜 sky besides the sky itself, by the
 * hour and the season (DayCycle.tsx draws the sky, land and lake and calls
 * these in between its layers):
 *
 * - morning: hot-air balloons rise from behind the ridges, their burners flaring
 * - day: planes draw contrails, hawks circle on thermals, a sailboat crosses
 *   the lake, a fish jumps; now and then a shower passes and leaves a rainbow
 * - dusk: bats come out, the planes' lights blink, the chimney smokes
 * - night: satellites cross, fireflies blink by the shore in summer, and an
 *   aurora rises while usage is busy (the busier, the brighter)
 * - every season has its own drift across the window: petals in spring,
 *   seeds in summer, leaves in autumn, snow in winter (and snow caps on the
 *   far peaks, autumn colour on the hills — DayCycle mixes those in)
 *
 * A milestone in today's tokens brings a rainbow by day and an aurora by night.
 */

type Kind = 'leaf' | 'snow' | 'petal' | 'seed'
interface Drift {
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  spin: number
  s: number
  ph: number
  kind: Kind | null
  c: string
  wait: number
}
interface Balloon {
  x: number
  y: number
  vx: number
  vy: number
  s: number
  colors: [string, string]
  burn: number
  next: number
}
interface Plane {
  x: number
  y: number
  vx: number
  trail: { x: number; y: number; age: number }[]
  drop: number
}
interface Hawk {
  cx: number
  cy: number
  rx: number
  a: number
  va: number
  s: number
  alpha: number
}
interface Bat {
  x: number
  y: number
  vx: number
  vy: number
  ph: number
}
interface Fly {
  x: number
  y: number
  vx: number
  vy: number
  ph: number
  sp: number
}
interface Shower {
  x: number
  v: number
  age: number
  dur: number
  puffs: { dx: number; dy: number; r: number }[]
  bolt: { pts: [number, number][]; t: number } | null
  nextBolt: number
}

const LEAVES = ['#d9752b', '#c2452d', '#e8a33a', '#b5651d', '#9c3b1b', '#e0b13c']
const PETALS = ['#ffc6d9', '#ffd9e6', '#fbb3cb']
const BALLOONS: [string, string][] = [
  ['#e74c3c', '#f6d55c'],
  ['#3caea3', '#f6f2e8'],
  ['#ed553b', '#20639b'],
  ['#8e44ad', '#f39c12'],
  ['#2ecc71', '#f1c40f'],
  ['#ff6f91', '#ffc75f']
]
const BOW = ['255,70,70', '255,150,50', '255,232,70', '90,220,100', '70,160,255', '90,90,230', '170,90,225']
/** how many of the drifting bits each season fills */
const DENSITY: Record<Kind, number> = { leaf: 0.5, snow: 1, petal: 0.45, seed: 0.28 }

/** what the sky is doing, for the sidebar clock */
export const dayStatus = { text: '' }

export class DayLife {
  /** the backdrop's own sky tells the sidebar clock what it is doing; a preview tile's does not */
  constructor(private readonly reports = true) {}

  private W = 0
  private H = 0
  private hy = 0
  private shore = 0
  private cabin = { x: 0, y: 0, w: 0, h: 0 }
  private puff: HTMLCanvasElement | null = null
  private storm: HTMLCanvasElement | null = null
  private soft: HTMLCanvasElement | null = null
  private warm: HTMLCanvasElement | null = null
  private flyGlow: HTMLCanvasElement | null = null
  private strip: HTMLCanvasElement | null = null
  private drift: Drift[] = []
  private balloons: Balloon[] = []
  private planes: Plane[] = []
  private hawks: Hawk[] = []
  private bats: Bat[] = []
  private flies: Fly[] = []
  private sats: { x: number; y: number; vx: number; vy: number; flare: number }[] = []
  private smoke: { x: number; y: number; age: number; s: number }[] = []
  private jumps: { x: number; y: number; age: number }[] = []
  private boat = { x: 0, v: 7 }
  private shower: Shower | null = null
  private bow = 0
  private bowLeft = true
  private aurora = 0
  private boost = 0
  private flash = 0
  private t = 0
  private timers = { balloon: 4, plane: 20, sat: 10, shower: 60, jump: 6, smoke: 0 }
  private forced: string[] = []
  private sunX = 0
  private seeded = ''

  init(o: { w: number; h: number; hy: number; shore: number; cabin: { x: number; y: number; w: number; h: number }; puff: HTMLCanvasElement; soft: HTMLCanvasElement; warm: HTMLCanvasElement }): void {
    this.W = o.w
    this.H = o.h
    this.hy = o.hy
    this.shore = o.shore
    this.cabin = o.cabin
    this.puff = o.puff
    this.soft = o.soft
    this.warm = o.warm
    // a darker puff for rain clouds
    const sc = document.createElement('canvas')
    sc.width = sc.height = o.puff.width
    const sg = sc.getContext('2d')!
    sg.drawImage(o.puff, 0, 0)
    sg.globalCompositeOperation = 'source-atop'
    sg.fillStyle = '#5d6778'
    sg.fillRect(0, 0, sc.width, sc.height)
    this.storm = sc
    const fc = document.createElement('canvas')
    fc.width = fc.height = 32
    const fg = fc.getContext('2d')!
    const fr = fg.createRadialGradient(16, 16, 0, 16, 16, 16)
    fr.addColorStop(0, 'rgba(235,255,150,1)')
    fr.addColorStop(0.25, 'rgba(210,255,110,0.55)')
    fr.addColorStop(1, 'rgba(190,255,90,0)')
    fg.fillStyle = fr
    fg.fillRect(0, 0, 32, 32)
    this.flyGlow = fc
    // the aurora's curtain: violet tops, a bright green hem that fades below
    const st = document.createElement('canvas')
    st.width = 1
    st.height = 128
    const tg = st.getContext('2d')!
    const ag = tg.createLinearGradient(0, 0, 0, 128)
    ag.addColorStop(0, 'rgba(150,80,255,0)')
    ag.addColorStop(0.45, 'rgba(150,90,255,0.32)')
    ag.addColorStop(0.82, 'rgba(90,255,170,0.85)')
    ag.addColorStop(0.9, 'rgba(160,255,200,0.9)')
    ag.addColorStop(1, 'rgba(90,255,170,0)')
    tg.fillStyle = ag
    tg.fillRect(0, 0, 1, 128)
    this.strip = st
    this.drift = Array.from({ length: 70 }, () => this.newDrift(null, true))
    this.flies = Array.from({ length: 30 }, () => this.newFly())
    this.boat = { x: Math.random() * o.w, v: rand(5, 9) }
    this.balloons = []
    this.planes = []
    this.hawks = []
    this.bats = []
    this.sats = []
    this.smoke = []
    this.jumps = []
    this.shower = null
    this.bow = 0
  }

  /** an event now: screenshots and milestones */
  force(name: string): void {
    this.forced.push(name)
  }

  private newDrift(season: SeasonState | null, anywhere = false, night = false): Drift {
    let kind: Kind | null = null
    if (season) {
      const r = Math.random()
      const k = season.k
      const pick: Kind = r < k.spring ? 'petal' : r < k.spring + k.summer ? 'seed' : r < k.spring + k.summer + k.autumn ? 'leaf' : 'snow'
      // summer seeds only fly by day; the night belongs to the fireflies
      if (!(pick === 'seed' && night) && Math.random() < DENSITY[pick]) kind = pick
    }
    const s = kind === 'snow' ? rand(1, 2.8) : kind === 'seed' ? rand(3, 5) : kind === 'leaf' ? rand(5, 9) : rand(4, 7)
    return {
      x: rand(-0.1, 1.1) * this.W,
      y: anywhere ? Math.random() * this.H : -12,
      vx: 0,
      vy: kind === 'snow' ? rand(14, 32) : kind === 'seed' ? rand(-4, 6) : rand(18, 36),
      rot: Math.random() * TAU,
      spin: rand(-1.6, 1.6),
      s,
      ph: Math.random() * TAU,
      kind: anywhere ? null : kind,
      c: kind === 'leaf' ? LEAVES[Math.floor(Math.random() * LEAVES.length)] : kind === 'petal' ? PETALS[Math.floor(Math.random() * PETALS.length)] : '#ffffff',
      wait: anywhere ? rand(0, 3) : 0
    }
  }

  private newFly(): Fly {
    // by the trees at the sides (the sidebar's among them) and along the shore
    const side = Math.random()
    const x = side < 0.4 ? rand(0, SIDEBAR + 40) : side < 0.6 ? rand(this.W * 0.85, this.W) : rand(0, this.W)
    return { x, y: rand(this.hy - this.H * 0.16, this.shore + 6), vx: rand(-8, 8), vy: rand(-5, 5), ph: Math.random() * TAU, sp: rand(1.2, 2.6) }
  }

  /** advance timers and spawn what the hour and season call for */
  update(dt: number, s: SkyState, season: SeasonState, l: Live, wind: number, sunX: number): void {
    this.t += dt
    this.sunX = sunX
    // the first frame (and a new season): the season's drift already spread over the window
    if (this.seeded !== season.season) {
      this.seeded = season.season
      this.drift = this.drift.map(() => this.newDrift(season, true, s.dark > 0.6))
    }
    const W = this.W
    const H = this.H
    const day = s.alt > 2
    const morning = s.rising && s.alt > -3 && s.alt < 32
    const night = s.stars > 0.6
    for (const f of this.forced.splice(0)) {
      if (f === 'balloon') for (let k = 0; k < 3; k++) this.spawnBalloon(true)
      else if (f === 'plane') this.spawnPlane()
      else if (f === 'shower') this.spawnShower(season, true)
      else if (f === 'rainbow') this.startBow()
      else if (f === 'aurora') this.boost = 1
      else if (f === 'sat') this.spawnSat(true)
      else if (f === 'jump') this.jumps.push({ x: rand(0.3, 0.7) * W, y: this.hy + (this.shore - this.hy) * rand(0.2, 0.6), age: 0 })
      else if (f === 'nova') {
        if (day) this.startBow()
        else this.boost = 1
      }
    }
    // hot-air balloons in the morning
    this.timers.balloon -= dt
    if (this.timers.balloon <= 0) {
      if (morning && this.balloons.length < 3) this.spawnBalloon(false)
      this.timers.balloon = rand(25, 60)
    }
    // planes, all day and night
    this.timers.plane -= dt
    if (this.timers.plane <= 0) {
      if (this.planes.length < 2) this.spawnPlane()
      this.timers.plane = rand(45, 120)
    }
    // satellites at night
    this.timers.sat -= dt
    if (this.timers.sat <= 0) {
      if (night) this.spawnSat(false)
      this.timers.sat = rand(25, 70)
    }
    // a passing shower now and then, more often in spring and summer
    this.timers.shower -= dt
    if (this.timers.shower <= 0) {
      if (day && !this.shower && Math.random() < 0.1 + 0.12 * (season.k.spring + season.k.summer)) this.spawnShower(season)
      this.timers.shower = 90
    }
    // fish jump while it is light
    this.timers.jump -= dt
    if (this.timers.jump <= 0) {
      if (s.alt > -4) this.jumps.push({ x: rand(0.25, 0.75) * W, y: this.hy + (this.shore - this.hy) * rand(0.15, 0.7), age: 0 })
      this.timers.jump = rand(8, 22)
    }
    // the chimney smokes more in the cool of morning and evening
    this.timers.smoke -= dt
    if (this.timers.smoke <= 0) {
      const ch = this.chimney()
      this.smoke.push({ x: ch[0], y: ch[1], age: 0, s: rand(0.8, 1.2) })
      this.timers.smoke = s.alt > 30 ? 1.4 : 0.7
    }
    // hawks circle on the thermals around midday
    const hawkOn = s.alt > 18
    if (hawkOn && this.hawks.length < 2) {
      this.hawks.push({ cx: rand(0.3, 0.9) * W, cy: rand(0.07, 0.2) * H, rx: rand(40, 80), a: Math.random() * TAU, va: rand(0.22, 0.38) * (Math.random() < 0.5 ? 1 : -1), s: rand(8, 11), alpha: 0 })
    }
    for (const hk of this.hawks) {
      hk.alpha = clamp(hk.alpha + (hawkOn ? dt : -dt) * 0.3, 0, 1)
      hk.a += hk.va * dt
      hk.cx += Math.sin(this.t * 0.05 + hk.rx) * 3 * dt * wind
    }
    this.hawks = this.hawks.filter((hk) => hk.alpha > 0 || hawkOn)
    // bats from sunset into the first hour of night
    const batOn = !s.rising && s.alt < -0.5 && s.alt > -13
    if (batOn && this.bats.length < 7) this.bats.push({ x: rand(0, 1) * W, y: rand(0.05, 0.45) * H, vx: rand(-60, 60), vy: rand(-40, 40), ph: Math.random() * TAU })
    // after dark they leave one by one
    if (!batOn && this.bats.length && Math.random() < dt * 0.6) this.bats.pop()
    // the aurora: busy usage late at night (the busier the brighter), or a milestone
    this.boost = Math.max(0, this.boost - dt / 90)
    const want = s.stars * Math.max(this.boost, Math.max(0, l.intensity - 1) / 2)
    this.aurora += (want - this.aurora) * Math.min(1, dt * 0.25)
    this.bow = Math.max(0, this.bow - dt / 75)
    this.flash = Math.max(0, this.flash - dt * 6)
    // drifting bits follow the wind
    for (const d of this.drift) {
      if (d.wait > 0) {
        d.wait -= dt
        if (d.wait <= 0) Object.assign(d, this.newDrift(season, false, s.dark > 0.6))
        continue
      }
      if (!d.kind) {
        d.wait = rand(2, 6)
        continue
      }
      const gust = Math.sin(this.t * 0.3 + d.ph) * 0.5 + 0.5
      d.vx = (wind - 0.6) * 22 * (0.6 + gust) + Math.sin(this.t * 1.3 + d.ph) * (d.kind === 'snow' ? 8 : 16)
      d.x += d.vx * dt
      d.y += d.vy * dt * (d.kind === 'snow' && this.shower ? 1.6 : 1)
      d.rot += d.spin * dt
      d.ph += dt
      if (d.y > H + 14 || d.y < -40 || d.x < -40 || d.x > W + 40) {
        d.kind = null
        d.wait = rand(0.2, 3)
      }
    }
    // update status for the clock
    if (this.reports)
      dayStatus.text = this.shower ? (season.k.winter > 0.5 ? '飘雪' : '阵雨') : this.bow > 0.1 ? '彩虹' : this.aurora > 0.15 ? '极光' : this.balloons.length ? '热气球' : batOn ? '蝙蝠出没' : ''
  }

  private chimney(): [number, number] {
    return [this.cabin.x + this.cabin.w * 0.74, this.cabin.y - this.cabin.h * 0.7]
  }

  private spawnBalloon(near: boolean): void {
    const W = this.W
    this.balloons.push({
      x: rand(0.12, 0.92) * W,
      y: near ? rand(0.12, 0.4) * this.H : this.hy - rand(0, 20),
      vx: rand(-3, 5),
      vy: -rand(5, 9),
      s: rand(13, 24),
      colors: BALLOONS[Math.floor(Math.random() * BALLOONS.length)],
      burn: 0,
      next: rand(1, 5)
    })
  }

  private spawnPlane(): void {
    const dir = Math.random() < 0.5 ? 1 : -1
    this.planes.push({ x: dir > 0 ? -40 : this.W + 40, y: rand(0.04, 0.24) * this.H, vx: dir * rand(26, 40), trail: [], drop: 0 })
  }

  private spawnSat(now: boolean): void {
    const ltr = Math.random() < 0.5
    const y = rand(0.03, 0.35) * this.H
    this.sats.push({ x: ltr ? -10 : this.W + 10, y, vx: (ltr ? 1 : -1) * rand(18, 30), vy: rand(-4, 6), flare: now || Math.random() < 0.2 ? rand(4, 14) : -1 })
  }

  private spawnShower(season: SeasonState, overhead = false): void {
    const ltr = Math.random() < 0.5
    this.shower = {
      x: overhead ? this.W * rand(0.4, 0.6) : ltr ? -260 : this.W + 260,
      v: (ltr ? 1 : -1) * rand(14, 22),
      age: 0,
      dur: rand(60, 85),
      puffs: Array.from({ length: 18 }, () => ({ dx: rand(-230, 230), dy: rand(-28, 22), r: rand(60, 120) })),
      bolt: null,
      nextBolt: season.k.winter > 0.5 ? 1e9 : rand(6, 14)
    }
  }

  private startBow(): void {
    this.bow = 1
    // on the side away from the sun, as a rainbow is
    this.bowLeft = this.sunX > this.W / 2
  }

  // ---------------------------------------------------------------- the layers

  /** the aurora, high in the night sky (behind the moon) */
  drawAurora(ctx: CanvasRenderingContext2D, vivid: number): void {
    if (this.aurora < 0.01 || !this.strip) return
    const { W, H, t } = this
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (let x = 0; x < W; x += 5) {
      const base = H * (0.22 + 0.05 * Math.sin(x * 0.004 + t * 0.15) + 0.03 * Math.sin(x * 0.011 - t * 0.27))
      const tall = H * (0.1 + 0.1 * Math.sin(x * 0.006 + t * 0.21) ** 2)
      const ray = 0.5 + 0.5 * Math.sin(x * 0.045 + t * 1.1 + Math.sin(x * 0.01 + t * 0.4) * 2)
      ctx.globalAlpha = Math.min(1, this.aurora * (0.3 + 0.7 * ray) * (0.6 + vivid * 0.6))
      ctx.drawImage(this.strip, x, base - tall, 5.5, tall + H * 0.02)
    }
    ctx.restore()
  }

  /** rain clouds, rain, lightning and the rainbow after (over the far land, under the near) */
  drawWeather(ctx: CanvasRenderingContext2D, dt: number, s: SkyState, vivid: number): void {
    const { W, H, hy } = this
    // the rainbow, opposite the sun
    if (this.bow > 0.01 && s.alt > 0 && s.alt < 45) {
      const k = Math.min(1, this.bow * 3) * smooth(0, 4, s.alt)
      // standing on the horizon and reaching up into the header, where it can be seen
      const cx = this.bowLeft ? W * 0.34 : W * 0.68
      const cy = hy
      const R = W * 0.4
      const ry = hy - H * 0.09
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, W, hy)
      ctx.clip()
      ctx.globalCompositeOperation = 'screen'
      // the sky is brighter inside the bow
      const inner = ctx.createRadialGradient(cx, cy, 0, cx, cy, R)
      inner.addColorStop(0, 'rgba(255,255,255,0)')
      inner.addColorStop(0.85, `rgba(255,255,255,${(0.08 * k).toFixed(3)})`)
      inner.addColorStop(0.9, 'rgba(255,255,255,0)')
      ctx.fillStyle = inner
      ctx.fillRect(0, 0, W, hy)
      ctx.lineWidth = Math.max(4, R * 0.013)
      BOW.forEach((rgb, i) => {
        const r = R - i * ctx.lineWidth
        ctx.strokeStyle = `rgba(${rgb},${(0.42 * k * (0.6 + vivid * 0.5)).toFixed(3)})`
        ctx.beginPath()
        ctx.ellipse(cx, cy, r, (ry * r) / R, 0, Math.PI, TAU)
        ctx.stroke()
      })
      ctx.restore()
    }
    const sh = this.shower
    if (!sh) return
    sh.age += dt
    sh.x += sh.v * dt
    const e = smooth(0, 10, sh.age) * (1 - smooth(sh.dur - 12, sh.dur, sh.age))
    // the light dims under the cloud
    ctx.fillStyle = `rgba(40,48,66,${(0.16 * e).toFixed(3)})`
    ctx.fillRect(0, 0, W, hy)
    const top = H * 0.1
    if (this.storm) {
      for (const p of sh.puffs) {
        ctx.globalAlpha = 0.8 * e
        ctx.drawImage(this.storm, sh.x + p.dx - p.r / 2, top + p.dy - p.r / 2, p.r, p.r * 0.75)
      }
      ctx.globalAlpha = 1
    }
    // rain falling from the cloud's belly (snow in winter falls with the drift instead)
    if (sh.nextBolt < 1e8) {
      ctx.strokeStyle = `rgba(210,220,240,${(0.45 * e).toFixed(3)})`
      ctx.lineWidth = 1.2
      ctx.beginPath()
      const len = hy - top
      for (let i = 0; i < 80; i++) {
        const x = sh.x + (hash(i, 7) - 0.5) * 420
        const y = top + 18 + (((hash(i, 8) * len + this.t * 520) % len) + len) % len
        ctx.moveTo(x, y)
        ctx.lineTo(x - 4, y + 18)
      }
      ctx.stroke()
      // lightning now and then
      sh.nextBolt -= dt
      if (sh.nextBolt <= 0 && e > 0.6) {
        const pts: [number, number][] = [[sh.x + rand(-120, 120), top + 30]]
        while (pts[pts.length - 1][1] < hy - 20) {
          const [px, py] = pts[pts.length - 1]
          pts.push([px + rand(-26, 26), py + rand(18, 40)])
        }
        sh.bolt = { pts, t: 0.35 }
        this.flash = 1
        sh.nextBolt = rand(7, 16)
      }
      if (sh.bolt) {
        sh.bolt.t -= dt
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.strokeStyle = `rgba(230,235,255,${Math.max(0, sh.bolt.t * 2.6).toFixed(3)})`
        ctx.lineWidth = 2
        ctx.beginPath()
        sh.bolt.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
        ctx.stroke()
        ctx.restore()
        if (sh.bolt.t <= 0) sh.bolt = null
      }
    }
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(235,240,255,${(0.22 * this.flash).toFixed(3)})`
      ctx.fillRect(0, 0, W, hy)
    }
    if (sh.age > sh.dur) {
      this.shower = null
      if (s.alt > 2 && s.alt < 42) this.startBow()
    }
  }

  /** balloons, planes, hawks and satellites in the open sky */
  drawAir(ctx: CanvasRenderingContext2D, dt: number, s: SkyState, sunX: number, wind: number): void {
    const { W, t } = this
    const dayK = 1 - s.dark
    // satellites: a steady point crossing slowly, sometimes flaring
    ctx.fillStyle = '#f2f5ff'
    this.sats = this.sats.filter((st) => {
      st.x += st.vx * dt
      st.y += st.vy * dt
      st.flare -= dt
      const fl = st.flare > 0 && st.flare < 2 ? Math.sin((st.flare / 2) * Math.PI) : 0
      ctx.globalAlpha = s.stars * (0.75 + fl * 0.25)
      ctx.fillRect(st.x, st.y, 1.6, 1.6)
      if (fl > 0.05 && this.soft) {
        ctx.globalAlpha = s.stars * fl
        ctx.drawImage(this.soft, st.x - 14, st.y - 14, 30, 30)
      }
      return st.x > -20 && st.x < W + 20
    })
    ctx.globalAlpha = 1
    // planes: contrails by day, blinking lights by night
    for (const p of this.planes) {
      p.x += p.vx * dt
      p.drop -= dt
      if (p.drop <= 0) {
        p.trail.push({ x: p.x - Math.sign(p.vx) * 6, y: p.y, age: 0 })
        p.drop = 0.4
      }
      for (const q of p.trail) q.age += dt
      p.trail = p.trail.filter((q) => q.age < 26)
      if (dayK > 0.15 && p.trail.length > 1) {
        const tint = mix(s.cloudLit, '#ffffff', 0.4)
        ctx.lineCap = 'round'
        for (let i = 1; i < p.trail.length; i++) {
          const a = p.trail[i - 1]
          const b = p.trail[i]
          ctx.strokeStyle = `rgba(${rgbText(tint)},${(0.55 * (1 - b.age / 26) * dayK).toFixed(3)})`
          ctx.lineWidth = 1.4 + b.age * 0.28
          ctx.beginPath()
          ctx.moveTo(a.x, a.y + a.age * 0.4)
          ctx.lineTo(b.x, b.y + b.age * 0.4)
          ctx.stroke()
        }
      }
      if (dayK > 0.4) {
        ctx.strokeStyle = mix(s.land[2], '#000000', 0.2)
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.moveTo(p.x - 5, p.y)
        ctx.lineTo(p.x + 5, p.y)
        ctx.moveTo(p.x + Math.sign(p.vx) * 0.5, p.y - 3.5)
        ctx.lineTo(p.x - Math.sign(p.vx) * 1.5, p.y + 3.5)
        ctx.stroke()
        // a glint from the sun
        if (Math.sin(t * 0.7 + p.y) > 0.92 && this.soft) {
          ctx.globalAlpha = 0.7
          ctx.drawImage(this.soft, p.x - 8, p.y - 8, 16, 16)
          ctx.globalAlpha = 1
        }
      } else {
        const strobe = (t % 1.3) < 0.07
        ctx.fillStyle = Math.floor(t * 1.2) % 2 ? '#ff4b4b' : 'rgba(255,75,75,0.25)'
        ctx.fillRect(p.x - 1, p.y - 2, 2, 2)
        ctx.fillStyle = '#ff5a5a'
        ctx.fillRect(p.x - 6, p.y, 1.5, 1.5)
        ctx.fillStyle = '#5aff7a'
        ctx.fillRect(p.x + 5, p.y, 1.5, 1.5)
        if (strobe && this.soft) {
          ctx.globalAlpha = 0.9
          ctx.drawImage(this.soft, p.x - 7, p.y - 7, 14, 14)
          ctx.globalAlpha = 1
        }
      }
    }
    this.planes = this.planes.filter((p) => (p.x > -60 && p.x < W + 60) || p.trail.length > 0)
    // hawks gliding in circles
    ctx.fillStyle = mix(s.land[3], '#000000', 0.35)
    for (const hk of this.hawks) {
      if (hk.alpha <= 0) continue
      const x = hk.cx + Math.cos(hk.a) * hk.rx
      const y = hk.cy + Math.sin(hk.a) * hk.rx * 0.32
      ctx.globalAlpha = hk.alpha * 0.85
      // mostly gliding, a few wing beats now and then
      const beat = Math.sin(t * 0.4 + hk.cx) > 0.95 ? Math.sin(t * 12) * 0.6 : 0
      drawBird(ctx, x, y, hk.s, 0.25 + 0.12 * Math.sin(t * 1.5 + hk.rx) + beat, -Math.sin(hk.a) * hk.va >= 0 ? 1 : -1)
    }
    ctx.globalAlpha = 1
    // hot-air balloons
    for (const b of this.balloons) {
      b.x += (b.vx + (wind - 1) * 6) * dt
      b.y += b.vy * dt
      // they slow as they climb
      b.vy = Math.min(-2, b.vy * (1 - dt * 0.004))
      b.next -= dt
      if (b.next <= 0) {
        b.burn = 1.2
        b.next = rand(4, 9)
      }
      b.burn = Math.max(0, b.burn - dt)
      this.drawBalloon(ctx, b, s, sunX)
    }
    this.balloons = this.balloons.filter((b) => b.y > -b.s * 4 && b.x > -80 && b.x < W + 80)
  }

  private drawBalloon(ctx: CanvasRenderingContext2D, b: Balloon, s: SkyState, sunX: number): void {
    const { x, y, s: r } = b
    const env = new Path2D()
    env.arc(x, y, r, Math.PI * 0.82, Math.PI * 0.18)
    env.quadraticCurveTo(x + r * 0.8, y + r * 1.05, x + r * 0.22, y + r * 1.45)
    env.lineTo(x - r * 0.22, y + r * 1.45)
    env.quadraticCurveTo(x - r * 0.8, y + r * 1.05, x + Math.cos(Math.PI * 0.82) * r, y + Math.sin(Math.PI * 0.82) * r)
    env.closePath()
    const dim = s.dark * 0.6
    ctx.save()
    ctx.fillStyle = mix(b.colors[0], '#101828', dim)
    ctx.fill(env)
    ctx.clip(env)
    // gores: stripes of the second colour
    ctx.fillStyle = mix(b.colors[1], '#101828', dim)
    for (let k = -2; k <= 2; k += 2) {
      ctx.beginPath()
      ctx.ellipse(x + k * r * 0.32, y + r * 0.1, r * 0.13, r * 1.6, 0, 0, TAU)
      ctx.fill()
    }
    // lit from the sun's side
    const lit = sunX > x ? 1 : -1
    const sh = ctx.createLinearGradient(x - r * lit, y, x + r * lit, y)
    sh.addColorStop(0, 'rgba(0,0,20,0.38)')
    sh.addColorStop(0.6, 'rgba(0,0,0,0)')
    sh.addColorStop(1, `rgba(255,240,210,${(0.3 * (1 - s.dark)).toFixed(3)})`)
    ctx.fillStyle = sh
    ctx.fillRect(x - r * 1.2, y - r * 1.2, r * 2.4, r * 2.8)
    ctx.restore()
    // the burner lights the envelope from inside
    if (b.burn > 0 && this.warm) {
      ctx.globalAlpha = Math.min(1, b.burn) * (0.4 + s.dark * 0.5)
      ctx.drawImage(this.warm, x - r, y + r * 0.6, r * 2, r * 1.4)
      ctx.globalAlpha = 1
    }
    ctx.strokeStyle = 'rgba(40,30,25,0.7)'
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.moveTo(x - r * 0.22, y + r * 1.45)
    ctx.lineTo(x - r * 0.14, y + r * 1.75)
    ctx.moveTo(x + r * 0.22, y + r * 1.45)
    ctx.lineTo(x + r * 0.14, y + r * 1.75)
    ctx.stroke()
    ctx.fillStyle = '#5a3a22'
    ctx.fillRect(x - r * 0.16, y + r * 1.74, r * 0.32, r * 0.24)
  }

  /** the boat and jumping fish on the lake */
  drawLake(ctx: CanvasRenderingContext2D, dt: number, s: SkyState): void {
    const { W, hy, shore, t } = this
    const by = hy + (shore - hy) * 0.32
    this.boat.x += this.boat.v * dt
    if (this.boat.x > W + 40) this.boat.x = -40
    const bx = this.boat.x
    const rock = Math.sin(t * 1.4) * 0.05
    const hull = mix(s.land[3], '#000000', 0.3)
    const sail = mix('#f6f1e4', s.zenith, 0.25 + s.dark * 0.6)
    ctx.save()
    ctx.translate(bx, by)
    ctx.rotate(rock)
    ctx.fillStyle = hull
    ctx.beginPath()
    ctx.moveTo(-14, 0)
    ctx.lineTo(14, 0)
    ctx.lineTo(10, 4)
    ctx.lineTo(-10, 4)
    ctx.closePath()
    ctx.fill()
    ctx.fillRect(-0.6, -22, 1.2, 22)
    ctx.fillStyle = sail
    ctx.beginPath()
    ctx.moveTo(1.2, -21)
    ctx.lineTo(12, -2)
    ctx.lineTo(1.2, -2)
    ctx.closePath()
    ctx.moveTo(-1.2, -16)
    ctx.lineTo(-9, -2)
    ctx.lineTo(-1.2, -2)
    ctx.closePath()
    ctx.fill()
    // its reflection, broken by the ripples
    ctx.globalAlpha = 0.28
    ctx.scale(1, -0.7)
    ctx.translate(Math.sin(t * 2) * 1.5, -10)
    ctx.fill()
    ctx.restore()
    if (s.lights > 0.2 && this.warm) {
      ctx.globalAlpha = Math.min(1, s.lights)
      ctx.drawImage(this.warm, bx - 10, by - 30, 20, 20)
      ctx.globalAlpha = 1
    }
    // a fish leaps, and the rings spread
    this.jumps = this.jumps.filter((j) => {
      j.age += dt
      if (j.age < 0.7) {
        const k = j.age / 0.7
        const fx = j.x + (k - 0.5) * 22
        const fy = j.y - Math.sin(k * Math.PI) * 16
        ctx.strokeStyle = mix('#dfe8f0', s.zenith, s.dark * 0.6)
        ctx.lineWidth = 2.2
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(fx - 4, fy + Math.cos(k * Math.PI) * 2)
        ctx.lineTo(fx + 4, fy - Math.cos(k * Math.PI) * 2)
        ctx.stroke()
      }
      for (const [start, x] of [
        [0, j.x - 11],
        [0.7, j.x + 11]
      ] as const) {
        const q = (j.age - start) / 2.2
        if (q <= 0 || q >= 1) continue
        ctx.strokeStyle = `rgba(${rgbText(mix(s.horizon, '#ffffff', 0.5))},${((1 - q) * 0.5).toFixed(3)})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.ellipse(x, j.y, q * 26, q * 7, 0, 0, TAU)
        ctx.stroke()
      }
      return j.age < 3
    })
  }

  /** chimney smoke, fireflies and bats, in front of the near shore */
  drawShore(ctx: CanvasRenderingContext2D, dt: number, s: SkyState, season: SeasonState, wind: number): void {
    const { W, H, t } = this
    if (this.soft) {
      const col = mix('#d8dce6', s.zenith, 0.35 + s.dark * 0.45)
      ctx.fillStyle = col
      this.smoke = this.smoke.filter((p) => {
        p.age += dt
        p.y -= (9 + p.age * 0.6) * dt
        p.x += (wind - 0.4) * 7 * dt + Math.sin(t + p.age) * 2 * dt
        const r = (5 + p.age * 3.2) * p.s
        ctx.globalAlpha = 0.32 * (1 - p.age / 9)
        ctx.drawImage(this.soft!, p.x - r, p.y - r, r * 2, r * 2)
        return p.age < 9
      })
      ctx.globalAlpha = 1
    }
    // fireflies on summer nights (and the warm ends of spring and autumn)
    const flyK = clamp((s.dark - 0.45) * 2.5, 0, 1) * clamp(season.k.summer + 0.35 * season.k.spring + 0.35 * season.k.autumn, 0, 1)
    if (flyK > 0.02 && this.flyGlow) {
      const n = Math.round(this.flies.length * flyK)
      for (let i = 0; i < n; i++) {
        const f = this.flies[i]
        f.vx += rand(-14, 14) * dt
        f.vy += rand(-10, 10) * dt
        f.vx = clamp(f.vx, -12, 12)
        f.vy = clamp(f.vy, -8, 8)
        f.x += f.vx * dt
        f.y += f.vy * dt
        if (f.y < this.hy - H * 0.2 || f.y > this.shore + 10 || f.x < -10 || f.x > W + 10) Object.assign(f, this.newFly())
        const a = Math.max(0, Math.sin(t * f.sp + f.ph)) ** 3
        if (a < 0.02) continue
        ctx.globalAlpha = a * flyK
        ctx.drawImage(this.flyGlow, f.x - 8, f.y - 8, 16, 16)
      }
      ctx.globalAlpha = 1
    }
    // bats flit about erratically
    ctx.fillStyle = '#0a0c14'
    for (const b of this.bats) {
      b.vx += rand(-260, 260) * dt
      b.vy += rand(-200, 200) * dt
      b.vx = clamp(b.vx, -110, 110)
      b.vy = clamp(b.vy, -70, 70)
      b.x += b.vx * dt
      b.y += b.vy * dt
      if (b.y < 10) b.vy = Math.abs(b.vy)
      if (b.y > H * 0.5) b.vy = -Math.abs(b.vy)
      if (b.x < -30) b.x = W + 20
      if (b.x > W + 30) b.x = -20
      drawBird(ctx, b.x, b.y, 4.2, Math.sin(t * 28 + b.ph), b.vx >= 0 ? 1 : -1)
    }
  }

  /** the season's drift across the whole window */
  drawFront(ctx: CanvasRenderingContext2D, s: SkyState): void {
    const night = s.dark
    for (const d of this.drift) {
      if (!d.kind || d.wait > 0) continue
      if (d.kind === 'snow') {
        ctx.globalAlpha = 0.85 - night * 0.2
        ctx.fillStyle = night > 0.5 ? '#dfe6ff' : '#ffffff'
        ctx.beginPath()
        ctx.arc(d.x, d.y, d.s, 0, TAU)
        ctx.fill()
        continue
      }
      if (d.kind === 'seed') {
        // a dandelion seed: a little parachute that catches the light
        ctx.globalAlpha = 0.75
        ctx.strokeStyle = mix('#ffffff', s.sun, 0.25)
        ctx.lineWidth = 0.7
        ctx.beginPath()
        for (let k = 0; k < 7; k++) {
          const a = -Math.PI / 2 + (k - 3) * 0.32
          ctx.moveTo(d.x, d.y)
          ctx.lineTo(d.x + Math.cos(a) * d.s, d.y + Math.sin(a) * d.s)
        }
        ctx.moveTo(d.x, d.y)
        ctx.lineTo(d.x, d.y + d.s * 1.2)
        ctx.stroke()
        continue
      }
      // leaves and petals tumble: turned edge-on and back as they fall
      const flip = Math.cos(d.ph * 2.4)
      ctx.save()
      ctx.translate(d.x, d.y)
      ctx.rotate(d.rot)
      ctx.scale(Math.max(0.15, Math.abs(flip)), 1)
      ctx.globalAlpha = 0.92
      ctx.fillStyle = mix(d.c, '#0a1020', night * 0.55)
      ctx.beginPath()
      if (d.kind === 'leaf') {
        ctx.moveTo(0, -d.s)
        ctx.quadraticCurveTo(d.s * 0.75, -d.s * 0.2, 0, d.s)
        ctx.quadraticCurveTo(-d.s * 0.75, -d.s * 0.2, 0, -d.s)
      } else ctx.ellipse(0, 0, d.s * 0.55, d.s * 0.4, 0, 0, TAU)
      ctx.fill()
      if (d.kind === 'leaf') {
        ctx.strokeStyle = 'rgba(80,30,10,0.45)'
        ctx.lineWidth = 0.6
        ctx.beginPath()
        ctx.moveTo(0, -d.s * 0.8)
        ctx.lineTo(0, d.s * 1.25)
        ctx.stroke()
      }
      ctx.restore()
    }
    ctx.globalAlpha = 1
  }
}
