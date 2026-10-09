import { motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { fmtTokens } from '@shared/format'
import type { Pace, QuotaRate } from '@shared/types'
import { clock, useApp, useData, useNow, useSource } from '../state'
import { Segmented } from './Segmented'

/** Quota views for the overview: will each window last, and the week day by day */

const HOUR = 3_600_000
const DAY = 24 * HOUR
const dur = (ms: number) => (ms >= DAY ? `${Math.floor(ms / DAY)} 天 ${Math.round((ms % DAY) / HOUR)} 小时` : ms >= HOUR ? `${Math.floor(ms / HOUR)} 小时 ${Math.round((ms % HOUR) / 60_000)} 分` : `${Math.max(1, Math.round(ms / 60_000))} 分钟`)
const when = (t: number, weekly: boolean) =>
  weekly ? new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }) : clock(t)
const tool = (s: string) => (s === 'codex' ? 'Codex' : 'Claude')

function usePaces(): Pace[] | null {
  const { quota, codexQuota } = useApp()
  const source = useSource()
  return useData(() => window.api.getPace(), [quota?.fetchedAt, quota?.windows.map((w) => w.utilization).join(), codexQuota?.updatedAt, source], 60_000)
}

function Empty({ text }: { text: string }) {
  return (
    <div className="quota-msg" style={{ minHeight: 170 }}>
      {text}
    </div>
  )
}

// ---------------------------------------------------------------- 额度够用吗

/** tokens and dollars one percent of a tool's 5-hour window bought, over its closed windows */
function perPercent(rates: QuotaRate[] | null, src: string): { tokens: number; cost: number } | null {
  const list = (rates ?? []).filter((r) => r.source === src && r.pct >= 5 && r.tokens > 0)
  const closed = list.filter((r) => !r.current)
  const use = closed.length ? closed : list
  const pct = use.reduce((a, r) => a + r.pct, 0)
  if (!pct) return null
  return { tokens: use.reduce((a, r) => a + r.tokens, 0) / pct, cost: use.reduce((a, r) => a + r.cost, 0) / pct }
}

function OutlookRow({ p, now, named, per }: { p: Pace; now: number; named: boolean; per: { tokens: number; cost: number } | null }) {
  const { money } = useApp()
  const weekly = p.end - p.start > 6 * HOUR
  const used = Math.max(0, Math.min(100, p.pct))
  const time = Math.max(0, Math.min(100, ((now - p.start) / Math.max(1, p.end - p.start)) * 100))
  const land = Math.max(used, Math.min(100, p.projected))
  const idle = p.pctPerHour < 0.05
  const tone = p.etaFull ? 'hot' : p.unused >= 20 ? 'cool' : 'ok'
  const name = weekly ? '7 天额度' : '5 小时额度'
  const speed = weekly ? `${(p.pctPerHour * 24).toFixed(1)}%/天` : `${p.pctPerHour.toFixed(1)}%/小时`
  const even = weekly ? `${(100 / ((p.end - p.start) / DAY)).toFixed(1)}%/天` : `${(100 / ((p.end - p.start) / HOUR)).toFixed(1)}%/小时`
  return (
    <div className={`ol-row ${tone}`}>
      <div className="ol-head">
        <span className="ol-name">
          {named && <span className={`src-tag ${p.source}`}>{tool(p.source)}</span>}
          {name}
        </span>
        <span className="muted">
          {when(p.end, weekly)} 刷新 · 还有 {dur(Math.max(0, p.end - now))}
        </span>
      </div>
      <div className="ol-bars">
        <span className="ol-label">已用</span>
        <span className="ol-track">
          <motion.i className="ol-land" initial={{ width: 0 }} animate={{ width: `${land}%` }} transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }} />
          <motion.i className="ol-used" initial={{ width: 0 }} animate={{ width: `${used}%` }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }} />
          <b className="ol-time-tick" style={{ left: `${time}%` }} />
        </span>
        <b className="ol-pct tnum">{Math.round(used)}%</b>
        <span className="ol-label">时间</span>
        <span className="ol-track thin">
          <motion.i className="ol-time" initial={{ width: 0 }} animate={{ width: `${time}%` }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }} />
        </span>
        <b className="ol-pct tnum muted">{Math.round(time)}%</b>
      </div>
      <div className="ol-verdict">
        <i className="ol-dot" />
        {idle ? (
          <span>现在几乎没在用，刷新时还剩 {Math.round(100 - used)}%</span>
        ) : p.etaFull ? (
          <span>
            照现在的速度 <b>{when(p.etaFull, weekly)} 用完</b>，比刷新早 {dur(p.end - p.etaFull)}
          </span>
        ) : p.unused >= 20 ? (
          <span>
            照现在的速度，刷新时还剩 <b>{Math.round(p.unused)}%</b> 用不完
          </span>
        ) : (
          <span>
            够用：刷新时大约用到 <b>{Math.round(p.projected)}%</b>
          </span>
        )}
      </div>
      <div className="ol-facts muted">
        最近 {speed} · 匀速 {even}
        {!weekly && per && (
          <>
            {' '}
            · 每 1% ≈ {fmtTokens(per.tokens, 1)} Token（{money(per.cost)}）
          </>
        )}
      </div>
    </div>
  )
}

/** Each quota window: used against time gone, and whether it lasts to the reset at the recent pace */
export function QuotaOutlookCard() {
  const { quota, codexQuota, settings } = useApp()
  const paces = usePaces()
  const source = useSource()
  const now = useNow(30_000)
  const rates = useData<QuotaRate[]>(() => window.api.getQuotaRates(7), [source, quota?.fetchedAt, codexQuota?.updatedAt], 120_000)
  const spare = paces?.find((p) => p.source === 'claude' && p.end - p.start <= 6 * HOUR && p.unused >= 20 && p.pctPerHour >= 0.05)
  return (
    <div className="card insight outlook-card">
      <div className="card-head">
        <div className="card-title">
          <span className="serif nowrap">额度够用吗</span>
          <span className="muted" style={{ fontWeight: 400 }}>
            按最近的速度算到下次刷新
          </span>
        </div>
      </div>
      {!paces ? (
        <div className="skeleton" style={{ height: 230 }} />
      ) : !paces.length ? (
        <Empty text={source === 'codex' ? '需要 Codex 会话日志里的额度数据（Codex 运行一次后出现）' : '需要订阅额度数据（用量接口或状态栏桥接）'} />
      ) : (
        <>
          <div className="ol-list">
            {paces.map((p) => (
              <OutlookRow key={p.key} p={p} now={now} named={source === 'all'} per={perPercent(rates, p.source)} />
            ))}
          </div>
          <div className="ol-legend muted">
            <span>
              <i className="used" /> 已用
            </span>
            <span>
              <i className="land" /> 照现在的速度，到刷新时会用到
            </span>
            <span>
              <i className="time" /> 窗口时间过了多少
            </span>
          </div>
          <div className="insight-advice">
            {settings?.wasteAlert ? `刷新前 ${settings.wasteLeadMin} 分钟还剩 35% 以上会提醒你` : '额度浪费提醒已关闭（设置 → 订阅额度）'}
            {spare && (
              <button className="btn small" style={{ marginLeft: 10 }} onClick={() => document.dispatchEvent(new CustomEvent('tp-nav', { detail: 'tasks' }))}>
                排个刷新任务用掉它
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- 7 天额度：每天用了多少

/** cumulative percent at time t from the estimated curve */
function pctAt(p: Pace, t: number): number {
  const c = p.curve
  if (!c.length || t <= c[0].t) return c.length && t >= c[0].t ? c[0].pct : 0
  for (let i = 1; i < c.length; i++) {
    if (t <= c[i].t) {
      const a = c[i - 1]
      const b = c[i]
      return a.pct + ((b.pct - a.pct) * (t - a.t)) / Math.max(1, b.t - a.t)
    }
  }
  return p.pct
}

/** The 7-day window day by day: what each day took against an even share */
export function DailyQuotaCard() {
  const paces = usePaces()
  const now = useNow(60_000)
  const weekly = (paces ?? []).filter((p) => p.end - p.start > 6 * HOUR)
  const [sel, setSel] = useState<string | null>(null)
  const p = weekly.find((x) => x.key === sel) ?? weekly[0]
  const days = useMemo(() => {
    if (!p) return []
    const n = Math.max(1, Math.round((p.end - p.start) / DAY))
    return Array.from({ length: n }, (_, i) => {
      const from = p.start + i * DAY
      const to = Math.min(p.start + (i + 1) * DAY, now)
      const past = from < now
      // scale the curve so it ends at the real reading
      const k = pctAt(p, now) > 0 ? p.pct / pctAt(p, now) : 1
      const v = past ? Math.max(0, (pctAt(p, to) - pctAt(p, from)) * k) : 0
      return { i, from, v, past, today: from <= now && now < from + DAY }
    })
  }, [p, now])
  const even = p ? 100 / days.length : 0
  const leftDays = days.filter((d) => !d.past || d.today).length
  const budget = p && leftDays ? Math.max(0, 100 - p.pct) / leftDays : 0
  const top = Math.max(even * 1.6, budget * 1.2, ...days.map((d) => d.v), 1)
  const today = days.find((d) => d.today)
  // a slice runs from one reset hour to the next: named by the day it mostly falls on
  const wd = (t: number) => `周${'日一二三四五六'[new Date(t + DAY / 2).getDay()]}`
  const md = (t: number) => `${new Date(t + DAY / 2).getMonth() + 1}/${new Date(t + DAY / 2).getDate()}`
  const at = (v: number) => `calc(34px + (100% - 52px) * ${(v / top).toFixed(4)})`
  return (
    <div className="card insight daily-quota-card">
      <div className="card-head">
        <div className="card-title">
          <span className="serif nowrap">这 7 天每天用了多少</span>
          <span className="muted" style={{ fontWeight: 400 }}>
            {p ? `每天从 ${clock(p.start)} 算起` : ''}
          </span>
        </div>
        {weekly.length > 1 && <Segmented small value={p?.key ?? ''} onChange={setSel} options={weekly.map((x) => ({ value: x.key, label: tool(x.source) }))} />}
      </div>
      {!paces ? (
        <div className="skeleton" style={{ height: 230 }} />
      ) : !p ? (
        <Empty text="需要 7 天额度的数据" />
      ) : (
        <>
          <div className="dq-bars">
            <i className="dq-even" style={{ bottom: at(even) }}>
              <em>匀速 {even.toFixed(1)}%/天</em>
            </i>
            {budget > 0 && Math.abs(budget - even) / even > 0.08 && (
              <i className="dq-budget" style={{ bottom: at(budget) }}>
                <em>剩下每天可用 {budget.toFixed(1)}%</em>
              </i>
            )}
            {days.map((d) => (
              <div key={d.i} className={`dq-day${d.today ? ' today' : ''}${d.past ? '' : ' future'}`} title={`${new Date(d.from).getMonth() + 1}/${new Date(d.from).getDate()} ${clock(d.from)} 起的 24 小时 · ${d.past ? `用了 ${d.v.toFixed(1)}%` : `还没到，可用 ${budget.toFixed(1)}%`}`}>
                <span className="dq-col">
                  {d.past && <b className="dq-val tnum">{d.v.toFixed(d.v < 10 ? 1 : 0)}%</b>}
                  <motion.i
                    className={d.v > even * 1.15 ? 'hot' : ''}
                    initial={{ height: 0 }}
                    animate={{ height: `${((d.past ? d.v : budget) / top) * 100}%` }}
                    transition={{ duration: 0.8, delay: d.i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                  />
                </span>
                <span>
                  {d.today ? '今天' : wd(d.from)}
                  <small>{md(d.from)}</small>
                </span>
              </div>
            ))}
          </div>
          <div className="insight-advice">
            {today ? (
              <>
                今天用了 <b className={today.v > even * 1.15 ? 'hot' : ''}>{today.v.toFixed(1)}%</b>
                {today.v > even * 1.15 ? '，比匀速多' : today.v < even * 0.6 ? '，比匀速少' : '，和匀速差不多'}；
              </>
            ) : null}
            剩下 {leftDays} 天每天还能用 <b>{budget.toFixed(1)}%</b>
            <span className="muted">（斜纹柱：还没到的日子）</span>
          </div>
        </>
      )}
    </div>
  )
}
