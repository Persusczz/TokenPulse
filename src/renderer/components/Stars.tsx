import { motion } from 'motion/react'
import { fmtTokens } from '@shared/format'
import type { Achievement, AchievementGroup, CodingSign, StarFigure } from '@shared/types'
import { useData, useSource } from '../state'

/** figures the achievement constellations are drawn on, one per group */
const TEMPLATES: StarFigure[] = [
  // a dipper
  { points: [[0.08, 0.3], [0.26, 0.24], [0.42, 0.32], [0.54, 0.46], [0.6, 0.7], [0.88, 0.74], [0.92, 0.48]], lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]] },
  // a W
  { points: [[0.06, 0.3], [0.28, 0.68], [0.5, 0.36], [0.72, 0.7], [0.94, 0.32]], lines: [[0, 1], [1, 2], [2, 3], [3, 4]] },
  // a cross (swan)
  { points: [[0.5, 0.06], [0.5, 0.32], [0.5, 0.58], [0.5, 0.92], [0.12, 0.42], [0.88, 0.28]], lines: [[0, 1], [1, 2], [2, 3], [4, 1], [1, 5]] },
  // a hunter
  { points: [[0.28, 0.08], [0.72, 0.14], [0.42, 0.46], [0.5, 0.5], [0.58, 0.54], [0.24, 0.9], [0.76, 0.88]], lines: [[0, 2], [1, 4], [2, 3], [3, 4], [2, 5], [4, 6]] },
  // a crown
  { points: [[0.06, 0.4], [0.22, 0.62], [0.42, 0.72], [0.62, 0.7], [0.8, 0.58], [0.94, 0.36]], lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]] },
  // a lyre
  { points: [[0.5, 0.08], [0.36, 0.36], [0.62, 0.38], [0.3, 0.8], [0.58, 0.86]], lines: [[0, 1], [0, 2], [1, 2], [1, 3], [2, 4], [3, 4]] },
  // a scorpion
  { points: [[0.08, 0.2], [0.2, 0.32], [0.34, 0.4], [0.44, 0.54], [0.5, 0.72], [0.62, 0.86], [0.78, 0.86], [0.9, 0.72]], lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7]] },
  // a spiral arm
  { points: [[0.5, 0.5], [0.62, 0.42], [0.66, 0.6], [0.48, 0.7], [0.3, 0.56], [0.32, 0.28], [0.6, 0.14], [0.86, 0.3], [0.9, 0.66]], lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8]] },
  // a crystal
  { points: [[0.5, 0.06], [0.84, 0.3], [0.84, 0.7], [0.5, 0.94], [0.16, 0.7], [0.16, 0.3], [0.5, 0.5]], lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [0, 6], [2, 6], [4, 6]] }
]

/** a figure with exactly `n` stars: cut down, or longest links split until it has enough */
export function fitFigure(fig: StarFigure, n: number): StarFigure {
  let points = fig.points.map((p) => [...p] as [number, number])
  let lines = fig.lines.map((l) => [...l] as [number, number])
  if (n <= points.length) {
    points = points.slice(0, n)
    lines = lines.filter(([a, b]) => a < n && b < n)
    // keep every star on the drawing
    for (let i = 1; i < n; i++) if (!lines.some(([a, b]) => a === i || b === i)) lines.push([i - 1, i])
    return { points, lines }
  }
  while (points.length < n && lines.length) {
    let best = 0
    let len = -1
    lines.forEach(([a, b], i) => {
      const d = Math.hypot(points[a][0] - points[b][0], points[a][1] - points[b][1])
      if (d > len) {
        len = d
        best = i
      }
    })
    const [a, b] = lines[best]
    const k = points.length
    const off = (k % 2 ? 1 : -1) * 0.04
    points.push([(points[a][0] + points[b][0]) / 2 + off, (points[a][1] + points[b][1]) / 2 - off])
    lines.splice(best, 1, [a, k], [k, b])
  }
  return { points, lines }
}

const TIER_COLOR = ['', '#e7a77a', '#dfe7f0', '#ffd86b', '#ff8be0']

/** One figure: lit stars glow, the rest are faint; a link shines when both its stars are lit */
export function Constellation({
  fig,
  lit,
  size,
  colors,
  titles,
  delay = 0
}: {
  fig: StarFigure
  lit: (i: number) => boolean
  size: number
  colors?: (i: number) => string
  titles?: (i: number) => string
  delay?: number
}) {
  const p = (i: number) => [fig.points[i][0] * size, fig.points[i][1] * size] as const
  return (
    <g>
      {fig.lines.map(([a, b], i) => {
        const on = lit(a) && lit(b)
        const [x1, y1] = p(a)
        const [x2, y2] = p(b)
        return (
          <motion.line
            key={`l${i}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            className={`sky-link${on ? ' on' : ''}`}
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.6, delay: delay + i * 0.05 }}
          />
        )
      })}
      {fig.points.map((_, i) => {
        const [x, y] = p(i)
        const on = lit(i)
        return (
          <motion.circle
            key={`s${i}`}
            cx={x}
            cy={y}
            r={on ? 4.2 : 2.4}
            className={`sky-star${on ? ' on' : ''}`}
            style={on && colors ? { fill: colors(i), ['--glow' as string]: colors(i) } : undefined}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 14, delay: delay + 0.2 + i * 0.04 }}
          >
            {titles && <title>{titles(i)}</title>}
          </motion.circle>
        )
      })}
    </g>
  )
}

const GROUP_NAME: Record<AchievementGroup, string> = { volume: '用量', streak: '坚持', time: '时段', efficiency: '效率与花费', sessions: '会话', explore: '探索', guardian: '守护', cosmos: '天体', collect: '收藏' }

/** The achievements as a sky: every group a constellation, every unlocked badge a lit star */
export function AchievementSky({ list }: { list: Achievement[] }) {
  const groups = Object.keys(GROUP_NAME) as AchievementGroup[]
  // two rows: five constellations, then four centred under them
  const CELL = 200
  const ROW = 236
  const S = 150
  const COLS = Math.ceil(groups.length / 2)
  const at = (gi: number) => (gi < COLS ? { x: gi * CELL, y: 0 } : { x: (gi - COLS) * CELL + ((COLS * 2 - groups.length) * CELL) / 2, y: ROW })
  return (
    <div className="card sky-card">
      <div className="card-head">
        <div className="card-title">
          <span className="serif">成就星图</span>
        </div>
      </div>
      <svg className="sky" viewBox={`0 0 ${CELL * COLS} ${ROW * 2}`} preserveAspectRatio="xMidYMid meet">
        {groups.map((g, gi) => {
          const items = list.filter((a) => a.group === g)
          const fig = fitFigure(TEMPLATES[gi % TEMPLATES.length], Math.max(2, items.length))
          const done = items.filter((a) => a.unlocked).length
          const { x, y } = at(gi)
          return (
            <g key={g} transform={`translate(${x + (CELL - S) / 2}, ${y + 14})`}>
              <Constellation
                fig={fig}
                size={S}
                lit={(i) => !!items[i]?.unlocked}
                colors={(i) => TIER_COLOR[items[i]?.tier ?? 1]}
                titles={(i) => (items[i] ? (items[i].kind === 'secret' && !items[i].unlocked ? '隐藏成就' : `${items[i].title}（${items[i].unlocked ? '已解锁' : items[i].hint}）\n${items[i].desc}`) : '')}
                delay={gi * 0.12}
              />
              <text x={S / 2} y={S + 40} className="sky-name">
                {GROUP_NAME[g]}
              </text>
              <text x={S / 2} y={S + 58} className="sky-count">
                {done} / {items.length}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function useSign(): CodingSign | null {
  const source = useSource()
  return useData(() => window.api.getSign(), [source], 300_000)
}

/** The constellation of your coding habits, and today's sign lighting up */
export function SignCard() {
  const s = useSign()
  if (!s) return <div className="card sign-card skeleton" style={{ height: 240 }} />
  const z = s.zodiac
  return (
    <div className="card sign-card">
      <div className="sign-main">
        <svg className="sign-figure" viewBox="-10 -10 200 200">
          <Constellation fig={s} size={180} lit={() => true} />
        </svg>
        <div className="sign-text">
          <div className="muted sign-kicker">你的编码星座 · 近 30 天的习惯</div>
          <div className="sign-name serif">
            {s.name} <span>{s.symbol}</span>
          </div>
          <div className="sign-desc">{s.desc}</div>
          <ul className="sign-traits">
            {s.traits.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="sign-zodiac">
        <svg viewBox="-6 -6 92 92">
          <Constellation fig={z} size={80} lit={(i) => i < z.lit} />
        </svg>
        <div>
          <b>
            {z.symbol} 今天是{z.name}
          </b>
          <div className="muted">
            今日 {fmtTokens(z.today, 1)} tokens 点亮了 {z.lit}/{z.stars} 颗星{z.average ? `（平常一天 ${fmtTokens(z.average, 1)}）` : ''}
            {z.lit >= z.stars ? '，整座星座都亮了' : ''}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Overview: today's sign, star by star */
export function ZodiacCard() {
  const s = useSign()
  const z = s?.zodiac
  return (
    <div className="card insight zodiac-card">
      <div className="card-head">
        <div className="card-title">
          <span className="serif">今日星座</span>
          {z && (
            <span className="muted" style={{ fontWeight: 400 }}>
              {z.symbol} {z.name}
            </span>
          )}
        </div>
        <button className="btn small" onClick={() => document.dispatchEvent(new CustomEvent('tp-nav', { detail: 'achievements' }))}>
          星图
        </button>
      </div>
      {z ? (
        <>
          <svg className="zodiac-figure" viewBox="-8 -8 176 136" preserveAspectRatio="xMidYMid meet">
            <Constellation fig={{ points: z.points.map(([x, y]) => [x, y * 0.72] as [number, number]), lines: z.lines }} size={160} lit={(i) => i < z.lit} />
          </svg>
          <div className="insight-advice">
            今日用量点亮了 <b>{z.lit}</b> / {z.stars} 颗星{z.lit >= z.stars ? '，今天已经超过平常的一天' : z.average ? `，再用约 ${fmtTokens(Math.max(0, (z.average * (z.lit + 1)) / z.stars - z.today), 1)} 点亮下一颗` : ''}
          </div>
          {s && (
            <div className="muted zodiac-sign">
              编码星座：{s.symbol} {s.name}
            </div>
          )}
        </>
      ) : (
        <div className="skeleton" style={{ height: 150 }} />
      )}
    </div>
  )
}
