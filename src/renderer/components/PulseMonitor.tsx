import { useEffect, useRef } from 'react'
import type { Intensity } from '@shared/types'
import { cssVar, useMotionLevel } from '../state'
import { onFrame } from '../frames'

/** one heartbeat (P, QRS, T), as offsets from the baseline in units of the R height, one value per pixel */
function beatShape(): number[] {
  const out: number[] = []
  const bump = (n: number, h: number) => {
    for (let i = 0; i < n; i++) out.push(h * Math.sin((Math.PI * i) / (n - 1)))
  }
  bump(8, 0.12) // P
  for (let i = 0; i < 4; i++) out.push(0)
  out.push(-0.12, -0.2) // Q
  out.push(0.35, 0.8, 1, 0.7, 0.2) // R
  out.push(-0.3, -0.38, -0.18) // S
  for (let i = 0; i < 6; i++) out.push(0)
  bump(12, 0.22) // T
  return out
}
const BEAT = beatShape()
const SPEED = 70 // px per second
const GAP = 14 // the sweep's blank band

/**
 * A monitor strip that sweeps left to right like a hospital ECG. Each `beat`
 * change (a batch of new usage) draws one heartbeat, taller for bigger
 * batches; while Claude is working it also keeps the pace of `perMinute`
 * requests. Flat when idle.
 */
export function PulseMonitor({
  beat,
  size,
  perMinute,
  active,
  intensity,
  theme
}: {
  beat: number
  /** tokens in the batch behind `beat` */
  size: number
  perMinute: number
  active: boolean
  intensity: Intensity
  theme: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const level = useMotionLevel()
  const st = useRef({
    perMinute,
    active,
    intensity,
    queue: [] as number[],
    pending: [] as number[],
    sinceBeat: 0,
    color: '#d97757',
    alarm: '#d03b3b',
    grid: '#eeece5'
  })
  st.current.perMinute = perMinute
  st.current.active = active
  st.current.intensity = intensity

  useEffect(() => {
    const s = st.current
    s.color = cssVar('--accent')
    s.alarm = cssVar('--critical')
    s.grid = cssVar('--grid')
  }, [theme])

  useEffect(() => {
    if (!beat) return
    st.current.pending.push(Math.max(0.35, Math.min(1, (Math.log10(size + 1) - 2.5) / 3.5)))
  }, [beat]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    const s = st.current
    let w = 0
    let h = 0
    let values: number[] = []
    let head = 0
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      w = Math.max(1, Math.round(canvas.clientWidth))
      h = canvas.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      values = new Array(w).fill(0)
      head = 0
    }
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()

    const draw = () => {
      ctx.clearRect(0, 0, w, h)
      // faint monitor grid: short ticks and a dotted baseline
      ctx.strokeStyle = s.grid
      ctx.globalAlpha = 0.6
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = 0; x < w; x += 18) {
        ctx.moveTo(x + 0.5, h / 2 - 4)
        ctx.lineTo(x + 0.5, h / 2 + 4)
      }
      ctx.stroke()
      ctx.setLineDash([2, 4])
      ctx.beginPath()
      ctx.moveTo(0, h / 2 + 0.5)
      ctx.lineTo(w, h / 2 + 0.5)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1
      const color = s.intensity >= 3 ? s.alarm : s.color
      const amp = h * 0.42
      ctx.lineWidth = 1.6
      ctx.lineJoin = 'round'
      ctx.strokeStyle = color
      ctx.shadowColor = color
      ctx.shadowBlur = level >= 2 ? 6 : 0
      // older samples fade; the band just ahead of the sweep stays blank
      for (let seg = 0; seg < 6; seg++) {
        ctx.globalAlpha = 0.25 + (0.75 * (seg + 1)) / 6
        ctx.beginPath()
        let started = false
        for (let k = Math.floor((seg * w) / 6); k < Math.floor(((seg + 1) * w) / 6) + 1 && k < w - GAP; k++) {
          const x = (head + GAP + k) % w
          const y = h / 2 - values[x] * amp
          if (!started || x === 0) {
            ctx.moveTo(x, y)
            started = true
          } else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      ctx.shadowBlur = 0
      // glowing head
      const hx = (head - 1 + w) % w
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(hx, h / 2 - values[hx] * amp, 2.6, 0, Math.PI * 2)
      ctx.fill()
    }

    if (!level) {
      draw()
      return () => ro.disconnect()
    }
    let last = performance.now()
    let acc = 0
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      acc += dt * SPEED
      s.sinceBeat += dt
      // keep the rhythm of the request rate while active (between 0.5 and 6 s per beat)
      const interval = s.perMinute > 0 ? Math.min(6, Math.max(0.5, 60 / s.perMinute)) : Infinity
      if (s.active && !s.queue.length && !s.pending.length && s.sinceBeat > interval) s.pending.push(0.32 + Math.random() * 0.12)
      while (acc >= 1) {
        acc -= 1
        if (!s.queue.length && s.pending.length) {
          const a = s.pending.shift()!
          s.queue = BEAT.map((v) => v * a)
          s.sinceBeat = 0
        }
        const noise = (Math.random() - 0.5) * 0.025
        values[head] = (s.queue.length ? s.queue.shift()! : 0) + noise
        head = (head + 1) % w
      }
      draw()
    }
    const stop = onFrame(60, (_dt, now) => tick(now), 'monitor')
    return () => {
      stop()
      ro.disconnect()
    }
  }, [level])

  return <canvas ref={ref} className="pulse-monitor" />
}
