import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtTokens } from '@shared/format'
import type { QuotaInfo, QuotaWindow, RateStats } from '@shared/types'
import { clock, cssVar, useApp, useData, usePrefersReducedMotion, useSource } from '../state'
import { AnimatedNumber } from './Numbers'

/** Gauge geometry: a 270° ring opening downwards */
const C = 110
const R = 84
const START = 135
const SWEEP = 270
const RAD = Math.PI / 180

const polar = (deg: number, r = R) => [C + r * Math.cos(deg * RAD), C + r * Math.sin(deg * RAD)] as const

function arc(from: number, to: number, r = R): string {
  const [x0, y0] = polar(from, r)
  const [x1, y1] = polar(to, r)
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

/** Zones of the dial with their state names; the colour always ships with the label */
const ZONES = [
  { upto: 0.25, color: 'var(--s3)', label: '平稳' },
  { upto: 0.6, color: 'var(--accent)', label: '活跃' },
  { upto: 0.85, color: 'var(--serious)', label: '高速' },
  { upto: Infinity, color: 'var(--critical)', label: '极速' }
]
const zoneOf = (r: number) => ZONES.find((z) => r < z.upto)!

/**
 * Tokens per minute as a glowing ring: the arc fills toward the day's scale,
 * a bright head rides its end, and an inner ring of light spins faster the
 * faster tokens flow.
 */
function RingGauge({ value, scale }: { value: number; scale: number }) {
  const ratio = Math.max(0, Math.min(1, value / scale))
  const zone = zoneOf(value / scale)
  const ticks = Array.from({ length: 28 }, (_, i) => i / 27)
  // a full turn every 14 s when idle, every 1.6 s flat out
  const spin = value > 0 ? 14 - 12.4 * Math.sqrt(ratio) : 0
  return (
    <svg className="ring-gauge" viewBox="0 0 220 220" role="img" aria-label={`当前速率 ${fmtTokens(value)} tokens/分钟，满刻度 ${fmtTokens(scale)}`} style={{ ['--spin' as string]: `${spin.toFixed(2)}s` }}>
      <defs>
        {/* mapped to the dial, not to the arc, so a short arc stays green */}
        <linearGradient id="rg-fill" gradientUnits="userSpaceOnUse" x1={C - R} y1={C + R * 0.7} x2={C + R} y2={C + R * 0.7}>
          <stop offset="0" stopColor="var(--s3)" />
          <stop offset="0.45" stopColor="var(--accent)" />
          <stop offset="0.8" stopColor="var(--serious)" />
          <stop offset="1" stopColor="var(--critical)" />
        </linearGradient>
        <radialGradient id="rg-core">
          <stop offset="0" stopColor={zone.color} stopOpacity="0.28" />
          <stop offset="0.7" stopColor={zone.color} stopOpacity="0.05" />
          <stop offset="1" stopColor={zone.color} stopOpacity="0" />
        </radialGradient>
        <filter id="rg-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      <circle cx={C} cy={C} r={R - 12} fill="url(#rg-core)" />
      {/* the scale outside the ring; the last fifth is the red zone */}
      {ticks.map((t) => {
        const major = Math.round(t * 27) % 9 === 0
        const [x0, y0] = polar(START + SWEEP * t, R + 13)
        const [x1, y1] = polar(START + SWEEP * t, R + (major ? 21 : 17))
        return <line key={t} x1={x0} y1={y0} x2={x1} y2={y1} className={`rg-tick${major ? ' major' : ''}${t > 0.85 ? ' red' : ''}${t <= ratio + 1e-6 && ratio > 0 ? ' lit' : ''}`} />
      })}
      <path d={arc(START, START + SWEEP)} className="rg-track" />
      {/* the fill is one dash as long as the reading; an empty dash would still leave a round cap, so it fades out at zero */}
      <path d={arc(START, START + SWEEP)} className="rg-value glow" stroke="url(#rg-fill)" pathLength={1} strokeDasharray={`${Math.max(0.0001, ratio)} 2`} filter="url(#rg-glow)" style={{ opacity: ratio > 0.002 ? 0.55 : 0 }} />
      <path d={arc(START, START + SWEEP)} className="rg-value" stroke="url(#rg-fill)" pathLength={1} strokeDasharray={`${Math.max(0.0001, ratio)} 2`} style={{ opacity: ratio > 0.002 ? 1 : 0 }} />
      {/* the inner ring of light: dashes that spin with the flow */}
      <circle cx={C} cy={C} r={R - 22} className={`rg-spin${value > 0 ? ' on' : ''}`} style={{ stroke: zone.color }} />
      <g className="rg-head" style={{ transform: `rotate(${(START + SWEEP * ratio).toFixed(2)}deg)` }}>
        <circle cx={C + R} cy={C} r="11" className="rg-halo" style={{ fill: zone.color }} />
        <circle cx={C + R} cy={C} r="5.5" className="rg-dot" />
      </g>
      {[0, 0.5, 1].map((t) => {
        const [x, y] = polar(START + SWEEP * t, R + 33)
        return (
          <text key={t} x={x} y={y + 4} textAnchor="middle" className="rg-label">
            {t === 0 ? '0' : fmtTokens(scale * t, 1).replace('.0', '')}
          </text>
        )
      })}
    </svg>
  )
}

/** A small trace of one quantity over the last hour */
function Spark({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(...values, 1e-9)
  const n = values.length
  const pts = values.map((v, i) => `${((i / Math.max(1, n - 1)) * 100).toFixed(2)},${(26 - (v / max) * 22).toFixed(2)}`)
  const id = useMemo(() => `sp${Math.random().toString(36).slice(2, 8)}`, [])
  return (
    <svg className="rt-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.45" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`M0,28L${pts.join('L')}L100,28Z`} fill={`url(#${id})`} />
      <path d={`M${pts.join('L')}`} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

function Tile({ label, children, sub, values, color = 'var(--accent)' }: { label: string; children: React.ReactNode; sub?: React.ReactNode; values?: number[]; color?: string }) {
  return (
    <div className="rt-tile">
      <span className="rt-label">{label}</span>
      <b className="rt-value">{children}</b>
      {sub && <span className="rt-sub">{sub}</span>}
      {values && <Spark values={values} color={color} />}
    </div>
  )
}

/**
 * Per-minute token rate for the last hour as a glowing trace that drifts
 * left as the minute advances, with the hour's peak marked. Hover shows that
 * minute's numbers.
 */
function PulseLine({ rate, pulse, theme }: { rate: RateStats; pulse: number; theme: string }) {
  const { money } = useApp()
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const reduced = usePrefersReducedMotion()
  const [hover, setHover] = useState<{ i: number; x: number } | null>(null)
  const st = useRef({ rate, hoverI: -1, bump: 0, w: 0, h: 0, draw: () => {} })
  st.current.rate = rate
  st.current.hoverI = hover?.i ?? -1

  useEffect(() => {
    if (pulse) st.current.bump = 1
  }, [pulse])

  useEffect(() => {
    const cv = canvas.current!
    const box = wrap.current!
    const ctx = cv.getContext('2d')!
    const s = st.current
    const read = () => ({ line: cssVar('--accent'), hi: cssVar('--accent-hi') || cssVar('--accent'), cool: cssVar('--s3'), grid: cssVar('--grid'), text: cssVar('--text-3'), surface: cssVar('--surface-solid') || cssVar('--surface') })
    let colors = read()

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      s.w = box.clientWidth
      s.h = box.clientHeight
      cv.width = Math.round(s.w * dpr)
      cv.height = Math.round(s.h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      colors = read()
    }

    s.draw = () => {
      const { w, rate: r } = s
      const h = s.h - 18
      if (!w || h <= 0) return
      const pts = r.perMinute
      const top = 18
      const bottom = h - 2
      const max = Math.max(...pts.map((p) => p.tokens), 1)
      // the newest minute sits at the right edge; the trace slides as it fills
      const frac = reduced ? 1 : Math.min(1, (Date.now() - pts[pts.length - 1].t) / 60_000)
      const step = (w - 12) / (pts.length - 1)
      const xAt = (i: number) => 4 + (i + 1 - frac) * step
      const yAt = (v: number) => bottom - (v / max) * (bottom - top)

      ctx.clearRect(0, 0, w, s.h)
      // every 15 minutes a faint line, and the scale at the top
      ctx.strokeStyle = colors.grid
      ctx.lineWidth = 1
      ctx.setLineDash([2, 4])
      for (let i = pts.length - 1; i >= 0; i -= 15) {
        const x = Math.round(xAt(i)) + 0.5
        ctx.beginPath()
        ctx.moveTo(x, top - 6)
        ctx.lineTo(x, bottom)
        ctx.stroke()
      }
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(0, Math.round(top) + 0.5)
      ctx.lineTo(w, Math.round(top) + 0.5)
      ctx.moveTo(0, Math.round(bottom) + 0.5)
      ctx.lineTo(w, Math.round(bottom) + 0.5)
      ctx.stroke()
      ctx.font = '500 10.5px "Segoe UI", sans-serif'
      ctx.fillStyle = colors.text
      ctx.textAlign = 'left'
      if (max > 1) ctx.fillText(`${fmtTokens(max)}/分钟`, 4, top - 5)

      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, w - 4, h)
      ctx.clip()
      const path = new Path2D()
      pts.forEach((p, i) => {
        const x = xAt(i)
        const y = yAt(p.tokens)
        if (i === 0) path.moveTo(x, y)
        else {
          const px = xAt(i - 1)
          const py = yAt(pts[i - 1].tokens)
          path.bezierCurveTo((px + x) / 2, py, (px + x) / 2, y, x, y)
        }
      })
      const area = new Path2D(path)
      area.lineTo(xAt(pts.length - 1), bottom)
      area.lineTo(xAt(0), bottom)
      area.closePath()
      const grad = ctx.createLinearGradient(0, top, 0, bottom)
      grad.addColorStop(0, `${colors.line}66`)
      grad.addColorStop(0.6, `${colors.line}1a`)
      grad.addColorStop(1, `${colors.line}00`)
      ctx.fillStyle = grad
      ctx.fill(area)
      // older minutes fade, the present burns bright
      const stroke = ctx.createLinearGradient(0, 0, w, 0)
      stroke.addColorStop(0, `${colors.line}55`)
      stroke.addColorStop(0.7, colors.line)
      stroke.addColorStop(1, colors.hi)
      ctx.strokeStyle = stroke
      ctx.lineWidth = 2.2
      ctx.lineJoin = 'round'
      ctx.shadowColor = colors.line
      ctx.shadowBlur = 10
      ctx.stroke(path)
      ctx.shadowBlur = 0
      ctx.restore()

      // the hour's peak
      let pk = 0
      pts.forEach((p, i) => (p.tokens > pts[pk].tokens ? (pk = i) : 0))
      if (pts[pk].tokens > 0 && pk !== pts.length - 1) {
        const x = xAt(pk)
        const y = yAt(pts[pk].tokens)
        ctx.fillStyle = colors.hi
        ctx.beginPath()
        ctx.moveTo(x, y - 5)
        ctx.lineTo(x + 4, y - 1)
        ctx.lineTo(x, y + 3)
        ctx.lineTo(x - 4, y - 1)
        ctx.closePath()
        ctx.fill()
        const label = `最高 ${fmtTokens(pts[pk].tokens)} · ${clock(pts[pk].t)}`
        ctx.font = '600 10.5px "Segoe UI", sans-serif'
        const tw = ctx.measureText(label).width
        ctx.textAlign = 'left'
        ctx.fillStyle = colors.text
        ctx.fillText(label, Math.max(4, Math.min(w - tw - 8, x - tw / 2)), Math.max(top - 5, y - 10))
      }

      // glowing head that throbs when new tokens land
      s.bump = Math.max(0, s.bump - 0.03)
      const hx = Math.min(w - 6, xAt(pts.length - 1))
      const hy = yAt(pts[pts.length - 1].tokens)
      const phase = ((performance.now() / 1000) * 0.9) % 1
      const alpha = Math.min(255, Math.round((1 - phase) * 70 + s.bump * 70))
      ctx.beginPath()
      ctx.arc(hx, hy, 6 + 7 * phase + s.bump * 10, 0, Math.PI * 2)
      ctx.fillStyle = `${colors.line}${alpha.toString(16).padStart(2, '0')}`
      ctx.fill()
      ctx.beginPath()
      ctx.arc(hx, hy, 4, 0, Math.PI * 2)
      ctx.fillStyle = colors.hi
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = colors.line
      ctx.stroke()

      if (s.hoverI >= 0) {
        const x = xAt(s.hoverI)
        ctx.strokeStyle = colors.text
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.moveTo(x, top)
        ctx.lineTo(x, bottom)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.arc(x, yAt(pts[s.hoverI].tokens), 4.5, 0, Math.PI * 2)
        ctx.fillStyle = colors.line
        ctx.fill()
        ctx.strokeStyle = colors.surface
        ctx.lineWidth = 2
        ctx.stroke()
      }
    }

    const ro = new ResizeObserver(() => {
      resize()
      s.draw()
    })
    ro.observe(box)
    resize()
    if (reduced) {
      s.draw()
      return () => ro.disconnect()
    }
    let raf = 0
    let last = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (now - last < 30) return
      last = now
      s.draw()
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [reduced, theme])

  useEffect(() => {
    if (reduced) st.current.draw()
  }, [rate, hover, reduced])

  const onMove = (e: React.MouseEvent) => {
    const r = wrap.current!.getBoundingClientRect()
    const pts = rate.perMinute
    const step = (r.width - 12) / (pts.length - 1)
    const frac = Math.min(1, (Date.now() - pts[pts.length - 1].t) / 60_000)
    const i = Math.max(0, Math.min(pts.length - 1, Math.round((e.clientX - r.left - 4) / step - 1 + frac)))
    setHover({ i, x: Math.min(r.width - 90, Math.max(90, e.clientX - r.left)) })
  }

  const p = hover ? rate.perMinute[hover.i] : null
  return (
    <div className="pulse" ref={wrap} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <canvas ref={canvas} />
      {p && (
        <div className="tip pulse-tip" style={{ left: hover!.x }}>
          <div className="tip-title">
            {clock(p.t)}
            {hover!.i === rate.perMinute.length - 1 ? '（进行中）' : ''}
          </div>
          <div className="tip-row">
            Token<b>{fmtTokens(p.tokens)}</b>
          </div>
          <div className="tip-row">
            输出<b>{fmtTokens(p.output)}</b>
          </div>
          <div className="tip-row">
            请求<b>{p.requests}</b>
          </div>
          <div className="tip-row">
            费用<b>{money(p.cost)}</b>
          </div>
        </div>
      )}
      <div className="pulse-axis">
        <span>60 分钟前</span>
        <span>45</span>
        <span>30</span>
        <span>15</span>
        <span>现在</span>
      </div>
    </div>
  )
}

/** the 5h quota of the tool on view, and how fast it drains */
function QuotaTile({ quota, codex, pauseAt, guardOn }: { quota: QuotaInfo | null; codex: QuotaWindow | undefined; pauseAt: number; guardOn: boolean }) {
  const source = useSource()
  if (source === 'codex') {
    return (
      <Tile label="Codex 5 小时额度" sub={codex ? 'Codex 运行时更新' : '等 Codex 下次运行时更新'}>
        {codex ? `${Math.round(codex.utilization)}%` : '—'}
      </Tile>
    )
  }
  const burn = quota?.burn
  const five = quota?.windows.find((w) => w.key === 'session' || w.key === 'five_hour')
  if (!five) return <Tile label="5 小时额度消耗" sub="额度数据暂不可用">—</Tile>
  if (!burn) return <Tile label="5 小时额度消耗" sub={`已用 ${Math.round(five.utilization)}% · 正在积累速度样本`}>…</Tile>
  return (
    <Tile
      label="5 小时额度消耗"
      sub={
        five.utilization >= pauseAt ? (
          <span className="rate-warn">已超过 {pauseAt}%{guardOn ? '，守卫会暂停' : ''}</span>
        ) : burn.etaPause ? (
          <span className="rate-warn">
            {clock(burn.etaPause)} 到 {pauseAt}%
          </span>
        ) : (
          `已用 ${Math.round(five.utilization)}% · 重置前到不了 ${pauseAt}%`
        )
      }
    >
      {burn.pctPerHour < 0.05 ? '≈ 0' : `+${burn.pctPerHour.toFixed(1)}`}
      <small>%/小时</small>
    </Tile>
  )
}

export function RateCard({ theme }: { theme: string }) {
  const { money, lastUpdate, quota, codexQuota, settings } = useApp()
  const rate = useData(() => window.api.getRate(), [], 3_000)
  const tokFmt = useMemo(() => (v: number) => fmtTokens(v, 1), [])
  const r = rate
  const ratio = r ? r.tokensPerMin / r.scale : 0
  const zone = zoneOf(ratio)
  const series = useMemo(() => {
    const pm = r?.perMinute ?? []
    return {
      output: pm.map((p) => p.output / 60),
      tokens: pm.map((p) => p.tokens),
      requests: pm.map((p) => p.requests),
      cost: pm.map((p) => p.cost * 60)
    }
  }, [r])
  const peakShare = r && r.peakPerMin > 0 ? Math.min(1, r.tokensPerMin / r.peakPerMin) : 0

  return (
    <div className="card rate-card" style={{ ['--zone' as string]: zone.color }}>
      <div className="card-head">
        <div className="card-title">
          <span className="serif">实时速率</span>
          <span className="badge" title="速率区间按今日峰值自动定标">
            <i className="zone-dot" style={{ background: zone.color }} />
            {r && r.tokensPerMin > 0 ? zone.label : '空闲'}
          </span>
        </div>
        <span className="muted" style={{ fontSize: 12 }}>
          最近 60 秒 · 每 3 秒刷新
        </span>
      </div>
      <div className="rate-body">
        <div className="gauge-box">
          <RingGauge value={r?.tokensPerMin ?? 0} scale={r?.scale ?? 50_000} />
          <div className="gauge-readout">
            <div className="gauge-num">
              <AnimatedNumber value={r?.tokensPerMin ?? 0} format={tokFmt} />
            </div>
            <div className="gauge-unit">tokens / 分钟</div>
          </div>
        </div>
        <div className="rate-tiles">
          <Tile label="输出速度" values={series.output} sub="模型每秒写出的 token">
            <AnimatedNumber value={r?.outputPerSec ?? 0} format={(v) => v.toFixed(1)} />
            <small>tok/s</small>
          </Tile>
          <Tile label="5 分钟均速" values={series.tokens} color="var(--s2)" sub="含读取缓存的全部 token">
            <AnimatedNumber value={r?.tokensPerMin5 ?? 0} format={tokFmt} />
            <small>/分钟</small>
          </Tile>
          <Tile label="请求频率" values={series.requests} color="var(--s3)" sub="每分钟的 API 响应">
            <AnimatedNumber value={r?.requestsPerMin ?? 0} format={(v) => v.toFixed(1)} />
            <small>次/分钟</small>
          </Tile>
          <Tile label="费用速率" values={series.cost} color="var(--s4)" sub="按 API 价格折算">
            {money(r?.costPerHour ?? 0)}
            <small>/小时</small>
          </Tile>
          <Tile
            label="今日峰值"
            sub={
              <span className="rt-meter">
                <i style={{ width: `${peakShare * 100}%` }} />
                <em>现在是峰值的 {Math.round(peakShare * 100)}%</em>
              </span>
            }
          >
            {fmtTokens(r?.peakPerMin ?? 0)}
            <small>/分钟{r?.peakAt ? ` · ${clock(r.peakAt)}` : ''}</small>
          </Tile>
          <QuotaTile quota={quota} codex={codexQuota?.windows.find((w) => w.key === 'codex_5h')} pauseAt={settings?.guardPauseAt ?? 90} guardOn={!!settings?.guardEnabled} />
        </div>
      </div>
      {r ? <PulseLine rate={r} pulse={lastUpdate?.addedTokens ? lastUpdate.at : 0} theme={theme} /> : <div className="pulse skeleton" />}
    </div>
  )
}
