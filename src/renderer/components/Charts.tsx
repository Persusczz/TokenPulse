import { motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmtInt, fmtTokens } from '@shared/format'
import type { Bucket, GroupStat, HeatCell, RangeSummary } from '@shared/types'
import { useApp } from '../state'

export const TOKEN_SERIES = [
  { key: 'input', costKey: 'costInput', label: '输入', color: 'var(--s2)' },
  { key: 'output', costKey: 'costOutput', label: '输出', color: 'var(--s1)' },
  { key: 'cacheWrite', costKey: 'costCacheWrite', label: '缓存写入', color: 'var(--s4)' },
  { key: 'cacheRead', costKey: 'costCacheRead', label: '缓存读取', color: 'var(--s3)' }
] as const

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function bucketLabel(t: number, unit: RangeSummary['bucketUnit'], long = false): string {
  const d = new Date(t)
  if (unit === 'hour') return long ? `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:00–${d.getHours() + 1}:00` : `${d.getHours()}时`
  const md = `${d.getMonth() + 1}/${d.getDate()}`
  if (!long) return md
  return unit === 'week' ? `${d.getMonth() + 1}月${d.getDate()}日 起一周` : `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}>
          <span className="swatch" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  )
}

/**
 * True for a moment after the chart appears or `key` changes, false
 * afterwards: the bars grow in when a range or metric is picked, not again
 * for every batch of live usage (each replay re-renders the chart frame by
 * frame, which while a tool works went on almost without pause).
 */
function useEntrance(key: string): boolean {
  const [on, setOn] = useState(true)
  useEffect(() => {
    setOn(true)
    const t = setTimeout(() => setOn(false), 1100)
    return () => clearTimeout(t)
  }, [key])
  return on
}

export function TrendChart({ summary, metric }: { summary: RangeSummary; metric: 'cost' | 'tokens' }) {
  const { money } = useApp()
  const animate = useEntrance(`${summary.range}|${metric}`)
  const fmt = metric === 'cost' ? (v: number) => money(v) : (v: number) => fmtTokens(v)
  const keys = TOKEN_SERIES.map((s) => (metric === 'cost' ? s.costKey : s.key))
  const unit = summary.bucketUnit
  const empty = summary.buckets.every((b) => b.tokens === 0)

  return (
    <div className="chart-box">
      {empty ? (
        <div className="empty" style={{ height: '100%' }}>
          这个时间范围内还没有用量
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={summary.buckets} margin={{ top: 8, right: 8, left: 4, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis
              dataKey="t"
              tickFormatter={(t) => bucketLabel(t, unit)}
              tick={{ fill: 'var(--text-3)', fontSize: 11.5 }}
              axisLine={{ stroke: 'var(--axis)' }}
              tickLine={false}
              minTickGap={14}
            />
            <YAxis
              tickFormatter={(v) => (metric === 'cost' ? money(v, v >= 10 || v === 0 ? 0 : 2) : fmtTokens(v))}
              tick={{ fill: 'var(--text-3)', fontSize: 11.5 }}
              axisLine={false}
              tickLine={false}
              width={58}
            />
            <Tooltip
              cursor={{ fill: 'var(--accent-wash)' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const b = payload[0].payload as Bucket
                const total = metric === 'cost' ? b.cost : b.tokens
                return (
                  <div className="tip">
                    <div className="tip-title">{bucketLabel(b.t, unit, true)}</div>
                    {[...TOKEN_SERIES].reverse().map((s) => (
                      <div className="tip-row" key={s.key}>
                        <span className="swatch" style={{ background: s.color }} />
                        {s.label}
                        <b>{fmt(b[metric === 'cost' ? s.costKey : s.key])}</b>
                      </div>
                    ))}
                    <div className="tip-row tip-total">
                      合计
                      <b>{fmt(total)}</b>
                    </div>
                    {metric === 'cost' ? (
                      <div className="tip-row">
                        Token<b>{fmtTokens(b.tokens)}</b>
                      </div>
                    ) : (
                      <div className="tip-row">
                        费用<b>{money(b.cost)}</b>
                      </div>
                    )}
                  </div>
                )
              }}
            />
            {keys.map((k, i) => (
              <Bar
                key={k}
                dataKey={k}
                stackId="s"
                fill={TOKEN_SERIES[i].color}
                stroke="var(--surface)"
                strokeWidth={1}
                maxBarSize={24}
                radius={i === keys.length - 1 ? [4, 4, 0, 0] : 0}
                isAnimationActive={animate}
                animationDuration={700}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

/** the theme's six series colours, then four hues far from all of them */
const MODEL_PALETTE = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', '#2ba7b5', '#8c5a3c', '#9aa83a', '#6b7280']
const nameHash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0
  return h
}

/**
 * A distinct colour for every model shown. Each name has a preferred slot
 * (so a model tends to keep its colour between ranges); clashes move on to the
 * next free one, so no two slices ever share a colour.
 */
export function modelColors(names: string[]): (name: string) => string {
  const used = new Set<number>()
  const map = new Map<string, string>()
  for (const n of names) {
    if (n === '其他' || map.has(n)) continue
    let i = nameHash(n) % MODEL_PALETTE.length
    for (let k = 0; used.has(i) && k < MODEL_PALETTE.length; k++) i = (i + 1) % MODEL_PALETTE.length
    used.add(i)
    map.set(n, MODEL_PALETTE[i])
  }
  return (n) => map.get(n) ?? 'var(--other)'
}

export function ModelDonut({ models, total }: { models: GroupStat[]; total: number }) {
  const { money } = useApp()
  const animate = useEntrance('')
  const data = useMemo(() => {
    if (models.length <= 6) return models
    const rest = models.slice(5)
    return [
      ...models.slice(0, 5),
      {
        name: '其他',
        cost: rest.reduce((s, m) => s + m.cost, 0),
        tokens: rest.reduce((s, m) => s + m.tokens, 0),
        messages: rest.reduce((s, m) => s + m.messages, 0)
      }
    ]
  }, [models])

  if (!data.length) return <div className="empty">暂无数据</div>
  const color = modelColors(data.map((d) => d.name))
  const pieData = data.filter((d) => d.cost > 0)

  return (
    <div className="donut-wrap">
      <div className="donut">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={pieData.length ? pieData : [{ name: '—', cost: 1 }]}
              dataKey="cost"
              nameKey="name"
              innerRadius={64}
              outerRadius={88}
              paddingAngle={pieData.length > 1 ? 2 : 0}
              cornerRadius={4}
              stroke="none"
              isAnimationActive={animate}
              animationDuration={800}
            >
              {(pieData.length ? pieData : [{ name: '—' }]).map((d) => (
                <Cell key={d.name} fill={pieData.length ? color(d.name) : 'var(--surface-2)'} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length || !pieData.length) return null
                const m = payload[0].payload as GroupStat
                return (
                  <div className="tip">
                    <div className="tip-title">{m.name}</div>
                    <div className="tip-row">
                      费用<b>{money(m.cost)}</b>
                    </div>
                    <div className="tip-row">
                      Token<b>{fmtTokens(m.tokens)}</b>
                    </div>
                    <div className="tip-row">
                      消息<b>{fmtInt(m.messages)}</b>
                    </div>
                  </div>
                )
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center">
          <span className="serif">{money(total)}</span>
          <span className="muted" style={{ fontSize: 12 }}>
            {data.length} 个模型
          </span>
        </div>
      </div>
      <div className="rank">
        {data.map((m) => (
          <div className="rank-row" key={m.name}>
            <span className="swatch" style={{ background: color(m.name) }} />
            <span className="rank-name" title={m.name}>
              {m.name}
            </span>
            <span className="rank-val">{money(m.cost)}</span>
            <span className="rank-pct">{total > 0 ? `${((m.cost / total) * 100).toFixed(1)}%` : '—'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ProjectBars({ projects }: { projects: GroupStat[] }) {
  const { money } = useApp()
  if (!projects.length) return <div className="empty">暂无数据</div>
  const max = Math.max(...projects.map((p) => p.cost), 1e-9)
  return (
    <div className="bars">
      {projects.map((p, i) => (
        <div className="bar-row" key={p.name}>
          <span className="rank-name" title={p.name}>
            {p.name}
          </span>
          <div className="bar-track">
            <motion.div
              className="bar-fill"
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(1.5, (p.cost / max) * 100)}%` }}
              transition={{ duration: 0.8, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
              style={{ background: p.name === '其他' ? 'var(--other)' : undefined }}
            />
          </div>
          <span className="bar-val">
            {money(p.cost)}
            <small>{fmtTokens(p.tokens)}</small>
          </span>
        </div>
      ))}
    </div>
  )
}

const CELL = 12
const GAP = 3

export function Heatmap({ cells }: { cells: HeatCell[] }) {
  const { money } = useApp()
  const [hover, setHover] = useState<{ c: HeatCell; x: number; y: number } | null>(null)
  const thresholds = useMemo(() => {
    const vals = cells
      .map((c) => c.tokens)
      .filter((v) => v > 0)
      .sort((a, b) => a - b)
    if (!vals.length) return [Infinity]
    const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))]
    return [q(0.2), q(0.45), q(0.7), q(0.9)]
  }, [cells])
  const level = (v: number) => (v <= 0 ? 0 : 1 + thresholds.filter((t) => v > t).length)

  const cols = Math.ceil(cells.length / 7)
  const left = 26
  const top = 18
  const width = left + cols * (CELL + GAP)
  const height = top + 7 * (CELL + GAP)
  const months: { x: number; label: string }[] = []
  cells.forEach((c, i) => {
    const d = new Date(c.t)
    if (d.getDate() === 1 || i === 0) {
      const x = left + Math.floor(i / 7) * (CELL + GAP)
      if (!months.length || x - months[months.length - 1].x > 28) months.push({ x, label: `${d.getMonth() + 1}月` })
    }
  })

  return (
    <div className="heat">
      <svg width={width} height={height} role="img" aria-label="近一年每日用量热力图">
        {months.map((m) => (
          <text key={m.x} x={m.x} y={11} fontSize="11" fill="var(--text-3)">
            {m.label}
          </text>
        ))}
        {['一', '三', '五'].map((d, i) => (
          <text key={d} x={0} y={top + (i * 2 + 1) * (CELL + GAP) + CELL - 2} fontSize="11" fill="var(--text-3)">
            {d}
          </text>
        ))}
        {cells.map((c, i) => (
          <motion.rect
            key={c.date}
            x={left + Math.floor(i / 7) * (CELL + GAP)}
            y={top + (i % 7) * (CELL + GAP)}
            width={CELL}
            height={CELL}
            rx={3}
            fill={`var(--q${level(c.tokens)})`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: Math.floor(i / 7) * 0.012 }}
            onMouseEnter={(e) => {
              const r = (e.target as SVGRectElement).getBoundingClientRect()
              setHover({ c, x: r.left + r.width / 2, y: r.top })
            }}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
      <div className="heat-legend">
        少
        {[0, 1, 2, 3, 4, 5].map((l) => (
          <i key={l} style={{ background: `var(--q${l})` }} />
        ))}
        多
      </div>
      {hover && (
        <div className="tip floating-tip" style={{ left: hover.x, top: hover.y, minWidth: 150 }}>
          <div className="tip-title">
            {new Date(hover.c.t).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}
          </div>
          <div className="tip-row">
            Token<b>{fmtTokens(hover.c.tokens)}</b>
          </div>
          <div className="tip-row">
            费用<b>{money(hover.c.cost)}</b>
          </div>
        </div>
      )}
    </div>
  )
}
