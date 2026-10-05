import { motion } from 'motion/react'
import { fmtTokens } from '@shared/format'
import type { RangeKey, RangeOverview } from '@shared/types'
import { useApp } from '../state'

export const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: 'today', label: '今日' },
  { value: '7d', label: '7 天' },
  { value: '30d', label: '30 天' },
  { value: 'month', label: '本月' },
  { value: 'all', label: '全部' }
]

/** Range picker whose tabs show each range's own totals, so equal ranges are visibly equal */
export function RangeTabs({
  value,
  onChange,
  overview
}: {
  value: RangeKey
  onChange: (r: RangeKey) => void
  overview: RangeOverview | null
}) {
  const { money } = useApp()
  return (
    <div className="rtabs" role="tablist">
      {RANGE_OPTIONS.map((o) => {
        const c = overview?.chips.find((x) => x.range === o.value)
        const on = o.value === value
        return (
          <button key={o.value} role="tab" aria-selected={on} className={`rtab${on ? ' on' : ''}`} onClick={() => onChange(o.value)}>
            {on && <motion.span layoutId="rtab-pill" className="rtab-pill" transition={{ type: 'spring', stiffness: 480, damping: 36 }} />}
            <span className="rtab-label">{o.label}</span>
            <span className="rtab-val tnum">{c ? fmtTokens(c.tokens) : '—'}</span>
            <span className="rtab-sub tnum">{c ? money(c.cost) : ' '}</span>
          </button>
        )
      })}
    </div>
  )
}

const md = (t: number) => {
  const d = new Date(t)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** "9/27 – 10/3" for a [start, end) range */
export function spanText(start: number, end: number): string {
  const a = new Date(start)
  const b = new Date(end - 1)
  const f = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`
  return a.toDateString() === b.toDateString() ? f(a) : `${f(a)} – ${f(b)}`
}

/** Explains why several ranges can show the same numbers */
export function coverageNote(overview: RangeOverview | null, range: RangeKey): string | null {
  if (!overview?.firstTs) return null
  const chip = overview.chips.find((c) => c.range === range)
  if (!chip || range === 'today' || range === 'all') return null
  const first = new Date(overview.firstTs)
  first.setHours(0, 0, 0, 0)
  if (chip.start >= first.getTime()) return null
  const same = overview.chips.filter((c) => c.tokens === chip.tokens && c.range !== range).map((c) => RANGE_OPTIONS.find((o) => o.value === c.range)!.label)
  return (
    `本机日志最早只到 ${md(overview.firstTs)}（共 ${overview.activeDays} 个有用量的日子），这个范围里更早的日子没有数据` +
    (same.length ? `，所以与「${same.join('」「')}」数值相同` : '')
  )
}
