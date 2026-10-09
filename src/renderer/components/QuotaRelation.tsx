import { useMemo, useState } from 'react'
import { fmtTokens } from '@shared/format'
import type { QuotaCycle, QuotaCycles, UsageSource } from '@shared/types'
import { useApp, useData, useNow, useSource } from '../state'
import { Segmented } from './Segmented'

/**
 * How the 5-hour quota relates to the 7-day one. The week's reading is
 * shared out over the 5-hour windows inside it by what each spent (both
 * limits count the same usage), which gives each window's bite of the week
 * and the rule of thumb: a full 5-hour window is about this much of the week.
 */

const DAY = 86_400_000
const hm = (t: number) => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
const dayOf = (t: number) => new Date(t).toDateString()
function dayName(t: number, now: number): string {
  if (dayOf(t) === dayOf(now)) return '今天'
  if (dayOf(t) === dayOf(now - DAY)) return '昨天'
  return `${new Date(t).getMonth() + 1}/${new Date(t).getDate()}`
}
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}
const p1 = (v: number) => (v >= 10 ? Math.round(v).toString() : v.toFixed(1))

interface Bite {
  c: QuotaCycle
  /** percent of the week it took */
  share: number
}

interface Relation {
  week: QuotaCycle
  bites: Bite[]
  /** percent of the week a full 5-hour window takes, when the 5-hour readings allow it */
  full: number | null
  /** 5-hour percent per dollar, for windows without a reading of their own */
  per5: number
}

function relate(t: QuotaCycles): Relation | null {
  const week = t.seven.find((c) => c.current) ?? t.seven[t.seven.length - 1]
  if (!week || week.pct === null || week.pct <= 0 || week.cost <= 0) return null
  // the week's percent per dollar: this week, or last week while this one has barely started
  const last = t.seven.filter((c) => !c.current && c.pct !== null && c.pct > 0 && c.cost > 0).pop()
  const basis = week.pct < 3 && last ? last : week
  const per7 = basis.pct! / basis.cost
  // the 5-hour percent per dollar, from windows with a real reading
  const per5 = median(t.five.filter((c) => c.pct !== null && c.pct >= 15 && c.cost > 0 && !c.estimated).map((c) => c.pct! / c.cost))
  const inWeek = t.five.filter((c) => c.end > week.start && c.start < week.end && c.cost > 0)
  const raw = inWeek.map((c) => c.cost * per7)
  // shared out so the pieces add up to the week's reading
  const sum = raw.reduce((a, b) => a + b, 0)
  const k = sum > 0 && basis === week ? week.pct / sum : 1
  return {
    week,
    bites: inWeek.map((c, i) => ({ c, share: raw[i] * k })),
    full: per5 > 0 ? (100 / per5) * per7 : null,
    per5
  }
}

function ToolRelation({ t }: { t: QuotaCycles }) {
  const { money } = useApp()
  const now = useNow(60_000)
  const [hover, setHover] = useState<number | null>(null)
  const r = useMemo(() => relate(t), [t])
  if (!r) return <div className="quota-msg" style={{ minHeight: 140 }}>还没有 7 天额度的读数，读到之后才能换算</div>
  const { week, bites, full, per5 } = r
  const used = week.pct ?? 0
  const left = Math.max(0, 100 - used)
  const ticks = full ? Array.from({ length: Math.floor(100 / full) }, (_, i) => (i + 1) * full).filter((x) => x < 99.5) : []
  const list = [...bites].reverse().slice(0, 8)
  const top = Math.max(...bites.map((b) => b.share), 0.1)
  return (
    <div className="qr-body">
      <div className="qr-verdict">
        {full ? (
          <>
            <div>
              <span className="qr-label">一个满的 5 小时窗口</span>
              <b className="serif">
                ≈ {p1(full)}%
              </b>
              <small>的 7 天额度</small>
            </div>
            <div>
              <span className="qr-label">7 天额度能装下</span>
              <b className="serif">{(100 / full).toFixed(1)}</b>
              <small>个满窗口</small>
            </div>
            <div>
              <span className="qr-label">这周还剩 {Math.round(left)}%</span>
              <b className="serif">≈ {(left / full).toFixed(1)}</b>
              <small>个满窗口</small>
            </div>
          </>
        ) : (
          <div>
            <span className="qr-label">这周已用</span>
            <b className="serif">{Math.round(used)}%</b>
            <small>（5 小时窗口的读数还不够，暂时算不出满窗口的换算）</small>
          </div>
        )}
      </div>

      {/* the week as one bar, cut into the 5-hour windows that used it */}
      <div className="qr-bar" onMouseLeave={() => setHover(null)}>
        {bites.map((b) => (
          <i
            key={b.c.start}
            className={`qr-seg${b.c.current ? ' current' : ''}${hover === b.c.start ? ' on' : ''}`}
            style={{ flexBasis: `${b.share}%` }}
            onMouseEnter={() => setHover(b.c.start)}
            title={`${dayName(b.c.start, now)} ${hm(b.c.start)} 起：7 天额度 +${p1(b.share)}%`}
          />
        ))}
        <i className="qr-rest" style={{ flexBasis: `${left}%` }} title={`还剩 ${Math.round(left)}%`} />
        {ticks.map((x, i) => (
          <span key={x} className="qr-tick" style={{ left: `${x}%` }}>
            <em>{i + 1}</em>
          </span>
        ))}
      </div>
      <div className="qr-axis">
        <span>
          7 天窗口 {new Date(week.start).getMonth() + 1}/{new Date(week.start).getDate()} 起 · 已用 <b>{Math.round(used)}%</b>
        </span>
        {full ? <span>刻度 = 用满 1、2、3… 个 5 小时窗口时的位置</span> : <span />}
      </div>

      <div className="qr-list">
        {list.map((b) => (
          <div key={b.c.start} className={`qr-row${b.c.current ? ' current' : ''}${hover === b.c.start ? ' on' : ''}`} onMouseEnter={() => setHover(b.c.start)} onMouseLeave={() => setHover(null)}>
            <span className="qr-when">
              {dayName(b.c.start, now)} {hm(b.c.start)} 起{b.c.current && <span className="badge accent">进行中</span>}
            </span>
            <span className="qr-five">
              5h{' '}
              {b.c.pct !== null ? (
                <b>{Math.round(b.c.pct)}%</b>
              ) : per5 > 0 ? (
                <b className="est" title="这个窗口没有官方读数，按它的花费推算（起止也是按日志推算的，超过 100% 说明它至少用满了）">
                  ≈{b.c.cost * per5 >= 100 ? '100%+' : `${Math.round(b.c.cost * per5)}%`}
                </b>
              ) : (
                <em title="这个窗口没有官方读数">—</em>
              )}
            </span>
            <span className="qr-arrow">→</span>
            <span className="qr-seven">
              <i style={{ width: `${(b.share / top) * 100}%` }} />
              7 天 <b>+{p1(b.share)}%</b>
            </span>
            <span className="qr-cost muted">
              {fmtTokens(b.c.tokens, 1)} · {money(b.c.cost)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The 5-hour and 7-day quota side by side: how much of the week each 5-hour window took */
export function QuotaRelationCard() {
  const { quota, codexQuota, lastUpdate } = useApp()
  const source = useSource()
  const data = useData<QuotaCycles[]>(() => window.api.getQuotaCycles(), [source, quota?.fetchedAt, codexQuota?.updatedAt, lastUpdate?.at], 60_000)
  const [tool, setTool] = useState<UsageSource>('claude')
  const one = data?.find((d) => d.source === tool) ?? data?.[0] ?? null
  return (
    <div className={`card relation-card${one ? ` src-${one.source}` : ''}`}>
      <div className="card-head">
        <div className="card-title">
          <span className="serif nowrap">5 小时 × 7 天</span>
          <span className="muted" style={{ fontWeight: 400 }}>
            每个 5 小时窗口吃掉了多少 7 天额度
          </span>
        </div>
        {data && data.length > 1 && (
          <Segmented
            small
            value={one?.source ?? 'claude'}
            onChange={setTool}
            options={[
              { value: 'claude', label: 'Claude' },
              { value: 'codex', label: 'Codex' }
            ]}
          />
        )}
      </div>
      {!data ? <div className="skeleton" style={{ height: 220 }} /> : one ? <ToolRelation t={one} /> : <div className="quota-msg">最近还没有用量</div>}
    </div>
  )
}
