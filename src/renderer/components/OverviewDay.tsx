import { useMemo, useState } from 'react'
import type { RaceSeries } from '@shared/types'
import { useApp, useData, useSource } from '../state'
import { Segmented } from './Segmented'

/** This week against last week as two runners on the same track, and the hero's "vs your usual day" chip */

const CN = (n: number) => (n >= 1e8 ? `${(n / 1e8).toFixed(n >= 1e9 ? 1 : 2)} 亿` : n >= 1e4 ? `${(n / 1e4).toFixed(n >= 1e6 ? 0 : 1)} 万` : String(Math.round(n)))
const pctText = (r: number) => `${r >= 0 ? '+' : '−'}${Math.abs(r * 100) >= 10 ? Math.round(Math.abs(r * 100)) : Math.abs(r * 100).toFixed(1)}%`

// ---------------------------------------------------------------- this week against last week

const W = 640
const PADL = 6
const PADR = 86
const PADT = 18
const PADB = 26
const PH = 200 - PADT - PADB
const WEEKDAY = ['一', '二', '三', '四', '五', '六', '日']

/** a round number a little above v, for the top of the chart */
function niceTop(v: number): number {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  return [1, 1.5, 2, 3, 4, 5, 6, 8, 10].map((k) => k * p).find((x) => x >= v * 1.08) ?? 10 * p
}

export function RaceCard() {
  const { money } = useApp()
  const source = useSource()
  const [kind, setKind] = useState<RaceSeries['kind']>('week')
  const [metric, setMetric] = useState<'tokens' | 'cost'>('tokens')
  const r = useData(() => window.api.getRace(kind), [kind, source], 60_000)
  const fmt = (v: number) => (metric === 'tokens' ? CN(v) : money(v))
  const prevName = kind === 'week' ? '上周' : '上月'
  const curName = kind === 'week' ? '本周' : '本月'
  const m = useMemo(() => {
    if (!r) return null
    const val = (p: { tokens: number; cost: number }) => (metric === 'tokens' ? p.tokens : p.cost)
    const cur = r.cur.map(val)
    const prev = r.prev.map(val)
    const k = cur.length - 1
    const now = cur[k] ?? 0
    const then = prev[Math.min(k, prev.length - 1)] ?? 0
    const prevEnd = prev[prev.length - 1] ?? 0
    // the rest of the way, run the way last time's rest went, scaled to where this one stands
    const ratio = then > 0 ? now / then : null
    const proj: number[] = []
    if (k >= 0 && k < r.steps - 1) {
      for (let i = k; i < r.steps; i++) {
        const pi = Math.min(i, prev.length - 1)
        proj.push(ratio !== null && then > 0 ? now + (prev[pi] - then) * ratio : now + (k > 0 ? (now / (k + 1)) * (i - k) : 0))
      }
    }
    const projEnd = proj.length ? proj[proj.length - 1] : now
    const top = niceTop(Math.max(prevEnd, projEnd, now))
    const steps = Math.max(r.steps, r.prevSteps)
    const x = (i: number) => PADL + ((i + 1) / steps) * (W - PADL - PADR)
    const y = (v: number) => PADT + PH * (1 - v / top)
    const line = (vs: number[], from = 0) => vs.map((v, i) => `${i ? 'L' : 'M'}${x(i + from).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
    const area = (vs: number[]) => (vs.length ? `${line(vs)} L${x(vs.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z` : '')
    return { cur, prev, k, now, then, prevEnd, proj, projEnd, top, x, y, line, area, gap: then > 0 ? now / then - 1 : null, steps }
  }, [r, metric])
  const ticks = useMemo(() => {
    if (!r || !m) return []
    if (r.kind === 'week') return WEEKDAY.map((d, i) => ({ x: m.x(i * 24 - 1), label: `周${d}` }))
    return Array.from({ length: r.steps }, (_, i) => i)
      .filter((i) => i === 0 || (i + 1) % 5 === 0)
      .map((i) => ({ x: m.x(i - 1), label: `${i + 1} 日` }))
  }, [r, m])
  // where the 上周/预计 labels sit at the right edge
  const ends = m ? [m.prev.length > 0 ? m.y(m.prevEnd) : NaN, m.proj.length > 1 ? m.y(m.projEnd) + 10 : NaN] : []
  return (
    <div className="card race-card">
      <div className="card-head">
        <div className="card-title">
          <span className="serif nowrap">{curName}追{prevName}</span>
          <span className="muted" style={{ fontWeight: 400 }}>
            从{kind === 'week' ? '周一' : '1 号'}起累计，同一时刻比一比
          </span>
        </div>
        <span className="race-tabs">
          <Segmented
            small
            value={metric}
            onChange={setMetric}
            options={[
              { value: 'tokens', label: 'Token' },
              { value: 'cost', label: '费用' }
            ]}
          />
          <Segmented
            small
            value={kind}
            onChange={setKind}
            options={[
              { value: 'week', label: '周' },
              { value: 'month', label: '月' }
            ]}
          />
        </span>
      </div>
      {!r || !m ? (
        <div className="skeleton" style={{ height: 230 }} />
      ) : (
        <>
          <div className="race-head">
            <b className="serif tnum">{fmt(m.now)}</b>
            {m.gap === null ? (
              <span className="muted">{m.then > 0 || m.prevEnd > 0 ? '' : `${prevName}这时还没有用量`}</span>
            ) : (
              <span className={`race-gap ${m.gap >= 0 ? 'up' : 'down'}`}>
                比{prevName}同一时刻{m.gap >= 0 ? '多' : '少'} <b className="tnum">{pctText(m.gap).replace(/^[+−]/, '')}</b>
              </span>
            )}
            <span className="muted race-sub">
              {prevName}此时 {fmt(m.then)} · {prevName}全程 {fmt(m.prevEnd)}
              {m.proj.length > 1 ? ` · 照这样${curName}约 ${fmt(m.projEnd)}` : ''}
            </span>
          </div>
          <div className="race-plot">
          <svg className="race-svg" viewBox={`0 0 ${W} 200`} role="img" aria-label={`${curName}和${prevName}的累计用量`}>
            <defs>
              <linearGradient id="race-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="var(--accent)" stopOpacity="0.38" />
                <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75, 1].map((f) => (
              <g key={f}>
                <line x1={PADL} x2={W - PADR} y1={m.y(m.top * f)} y2={m.y(m.top * f)} className="race-grid" />
                {/* the scale steps aside where a line's end label sits */}
                {!ends.some((y) => Math.abs(y - m.y(m.top * f)) < 13) && (
                  <text x={W - PADR + 6} y={m.y(m.top * f) + 4} className="race-axis">
                    {fmt(m.top * f)}
                  </text>
                )}
              </g>
            ))}
            {ticks.map((t) => (
              <text key={t.label} x={t.x} y={200 - 8} className="race-axis" textAnchor="middle">
                {t.label}
              </text>
            ))}
            <path d={m.area(m.prev)} className="race-prev-area" />
            <path d={m.line(m.prev)} className="race-prev" />
            {m.proj.length > 1 && <path d={m.line(m.proj, m.k)} className="race-proj" />}
            <path key={`${kind}-${metric}-a`} d={m.area(m.cur)} className="race-cur-area" />
            <path key={`${kind}-${metric}-l`} d={m.line(m.cur)} className="race-cur" pathLength={1} />
            {m.k >= 0 && (
              <g className="race-now">
                {m.then > 0 && (
                  <>
                    <line x1={m.x(m.k)} x2={m.x(m.k)} y1={m.y(m.then)} y2={m.y(m.now)} className={`race-link ${m.now >= m.then ? 'up' : 'down'}`} />
                    <circle cx={m.x(m.k)} cy={m.y(m.then)} r="4.5" className="race-ghost" />
                  </>
                )}
                <circle cx={m.x(m.k)} cy={m.y(m.now)} r="5.5" className="race-head-dot" />
              </g>
            )}
            {m.prev.length > 0 && (
              <text x={m.x(m.prev.length - 1) + 6} y={m.y(m.prevEnd) + 4} className="race-end">
                {prevName}
              </text>
            )}
            {m.proj.length > 1 && (
              <text x={m.x(m.steps - 1) + 6} y={m.y(m.projEnd) + 14} className="race-end proj">
                预计
              </text>
            )}
          </svg>
          {m.k >= 0 && <i className="race-pulse" style={{ left: `${(m.x(m.k) / W) * 100}%`, top: `${(m.y(m.now) / 200) * 100}%` }} aria-hidden />}
          </div>
        </>
      )}
    </div>
  )
}

/** Today so far against the average day: a plain "1.4× 日均" beside the cost */
export function VsUsualChip({ today, avg }: { today: number; avg: number }) {
  if (!(today > 0 && avg > 0)) return null
  const r = today / avg
  return (
    <span className={`vs-chip ${r >= 1 ? 'up' : 'down'}`} title="今天到现在的费用，和近 30 天有用量的日子的日均费用比">
      <i>{r >= 1 ? '▲' : '▼'}</i>
      日均的 {r >= 10 ? Math.round(r) : r.toFixed(1)} 倍
    </span>
  )
}
