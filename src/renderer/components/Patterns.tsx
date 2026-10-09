import { motion } from 'motion/react'
import { JOURNEY } from '@shared/astro'
import { fmtTokens } from '@shared/format'
import type { RangeKey, UsagePatterns } from '@shared/types'
import { useData, useSource } from '../state'

const WEEK = ['一', '二', '三', '四', '五', '六', '日']

function usePatterns(range: RangeKey): UsagePatterns | null {
  const source = useSource()
  return useData(() => window.api.getPatterns(range), [range, source], 120_000)
}

// ---------------------------------------------------------------- 打卡图

/** The last 30 days as a weekday × hour grid of dots, sized by tokens */
export function PunchCard() {
  const p = usePatterns('30d')
  const week = p?.week ?? Array.from({ length: 7 }, () => new Array(24).fill(0))
  const max = Math.max(1, ...week.flat())
  let best = { d: 0, h: 0, v: 0 }
  week.forEach((row, d) => row.forEach((v, h) => v > best.v && (best = { d, h, v })))
  const byDay = week.map((r) => r.reduce((a, b) => a + b, 0))
  const topDay = byDay.indexOf(Math.max(...byDay))
  const part = (h: number) => (h < 6 ? '凌晨' : h < 9 ? '早上' : h < 12 ? '上午' : h < 14 ? '中午' : h < 18 ? '下午' : h < 22 ? '晚上' : '深夜')
  const CW = 15
  const CH = 19
  return (
    <div className="card punch-card">
      <div className="card-head">
        <div className="card-title">
          <span className="serif">一周节律</span>
          <span className="muted" style={{ fontWeight: 400 }}>
            近 30 天
          </span>
        </div>
      </div>
      <svg className="punch" viewBox={`-22 -4 ${24 * CW + 26} ${7 * CH + 22}`} preserveAspectRatio="xMidYMid meet">
        {WEEK.map((w, d) => (
          <text key={w} x={-8} y={d * CH + CH / 2 + 4} textAnchor="end" className="punch-label">
            {w}
          </text>
        ))}
        {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
          <text key={h} x={h * CW + CW / 2} y={7 * CH + 14} textAnchor="middle" className="punch-label">
            {h}
          </text>
        ))}
        {week.map((row, d) =>
          row.map((v, h) => {
            const k = Math.sqrt(v / max)
            return (
              <circle
                key={`${d}-${h}`}
                cx={h * CW + CW / 2}
                cy={d * CH + CH / 2}
                r={v > 0 ? 1.6 + k * 6.4 : 1.1}
                className={`punch-dot${v > 0 ? '' : ' empty'}${d === best.d && h === best.h && v > 0 ? ' best' : ''}`}
                style={{ opacity: v > 0 ? 0.35 + k * 0.65 : undefined, animationDelay: `${(d * 24 + h) * 4}ms` }}
              >
                <title>{`周${WEEK[d]} ${h}:00 · ${fmtTokens(v)}`}</title>
              </circle>
            )
          })
        )}
      </svg>
      <div className="insight-advice">
        {best.v > 0 ? (
          <>
            最常在 <b>周{WEEK[best.d]}{part(best.h)} {best.h}:00</b> 写代码；一周里 <b>周{WEEK[topDay]}</b> 用得最多
          </>
        ) : (
          '近 30 天还没有记录'
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- 星际旅程

const fmtKm = (km: number) => (km >= 1e12 ? `${(km / 1e12).toFixed(2)} 万亿` : km >= 1e8 ? `${(km / 1e8).toFixed(km >= 1e10 ? 0 : 2)} 亿` : km >= 1e4 ? `${(km / 1e4).toFixed(km >= 1e6 ? 0 : 1)} 万` : `${Math.round(km)}`)

/** the stops drawn on the track: the Moon to Voyager 1 (the space station is too close, Proxima too far) */
const TRACK = JOURNEY.filter((j) => j.km >= 1e5 && j.km <= 1e11)

/** labels that fit: the next stop and the last one passed first, then the rest, each in the upper or lower row if there is room */
function placeLabels(xs: number[], first: number[]): Map<number, 'up' | 'low'> {
  const out = new Map<number, 'up' | 'low'>()
  const rows: Record<'up' | 'low', number[]> = { up: [], low: [] }
  const order = [...first.filter((i) => i >= 0), ...xs.map((_, i) => i)]
  for (const i of order) {
    if (out.has(i)) continue
    for (const row of ['up', 'low'] as const) {
      if (rows[row].every((x) => Math.abs(x - xs[i]) > 0.13)) {
        rows[row].push(xs[i])
        out.set(i, row)
        break
      }
    }
  }
  return out
}

/** Every token as one kilometre: how far from the Earth all of them reach */
export function JourneyCard() {
  const p = usePatterns('today')
  const km = p?.allTokens ?? 0
  const lo = 5
  const hi = Math.log10(6e10)
  const x = (v: number) => (Math.min(hi, Math.max(lo, Math.log10(Math.max(1, v)))) - lo) / (hi - lo)
  const passed = JOURNEY.filter((j) => j.km <= km)
  const next = JOURNEY.find((j) => j.km > km)
  const days = next && p?.dailyAvg ? (next.km - km) / p.dailyAvg : null
  const labels = placeLabels(
    TRACK.map((j) => x(j.km)),
    [TRACK.indexOf(next as (typeof TRACK)[number]), TRACK.indexOf(passed[passed.length - 1] as (typeof TRACK)[number]), 0, TRACK.length - 1]
  )
  const light = km / 299_792.458
  const lightText = light < 60 ? `${light.toFixed(1)} 秒` : light < 3600 ? `${(light / 60).toFixed(1)} 分钟` : `${(light / 3600).toFixed(1)} 小时`
  return (
    <div className="card journey-card">
      <div className="card-head">
        <div className="card-title">
          <span className="serif">星际旅程</span>
          <span className="muted" style={{ fontWeight: 400 }}>
            1 Token = 1 公里
          </span>
        </div>
      </div>
      <div className="journey-num">
        <span className="serif">{fmtKm(km)}</span> 公里<span className="muted"> · 光要飞 {lightText}</span>
      </div>
      <div className="journey-track">
        <div className="journey-line" />
        <motion.div className="journey-done" initial={{ width: 0 }} animate={{ width: `${x(km) * 100}%` }} transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1] }} />
        {TRACK.map((j, i) => {
          const row = labels.get(i)
          return (
            <div key={j.name} className={`journey-stop${j.km <= km ? ' passed' : ''}${j === next ? ' next' : ''}${row === 'low' ? ' low' : ''}`} style={{ left: `${x(j.km) * 100}%` }} title={`${j.name} · ${j.note}`}>
              <i />
              {row && <span>{j.name}</span>}
            </div>
          )
        })}
        <motion.div className="journey-ship" initial={{ left: 0 }} animate={{ left: `${x(km) * 100}%` }} transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1] }}>
          <svg viewBox="-12 -8 24 16" width="26" height="18" aria-hidden>
            <path d="M 10 0 L -4 -6 L -2 0 L -4 6 Z" className="ship-body" />
            <path d="M -4 -2.5 L -11 0 L -4 2.5 Z" className="ship-flame" />
          </svg>
        </motion.div>
      </div>
      <div className="insight-advice">
        {passed.length ? (
          <>
            已经飞过 <b>{passed[passed.length - 1].name}</b>
            {next ? (
              <>
                ，正飞向 <b>{next.name}</b>（{next.note}），还差 {fmtKm(next.km - km)} 公里{days !== null ? (days < 1 ? '，今天就能到' : `，按近 30 天的速度大约 ${days < 365 ? `${Math.ceil(days)} 天` : `${(days / 365).toFixed(1)} 年`}后到达`) : ''}
              </>
            ) : (
              '，已经飞出了太阳系的邻居'
            )}
          </>
        ) : (
          '刚刚离开地面'
        )}
      </div>
    </div>
  )
}
