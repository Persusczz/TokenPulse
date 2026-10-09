import { useState } from 'react'
import { useApp, useData } from '../../renderer/state'
import { Segmented } from '../../renderer/components/Segmented'
import { IconRefresh } from '../../renderer/components/Icons'
import { WorkBuddyMark } from './WorkBuddyMark'
import { WORKBUDDY_PLANS_URL } from './links'
export { WorkBuddyLedgerCard } from './LedgerCard'

export const credit = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
/** keeps an empty label's line height */
const NBSP = ' '
const md = (t: number) => `${new Date(t).getMonth() + 1}/${new Date(t).getDate()}`

/** "约 41 天 · 11/18 前后用完": how long the account's credits last at the daily pace */
export function runwayText(o: { daysLeft: number | null; runsOutAt: number | null; dailyAvg: number | null }): string {
  if (o.dailyAvg === 0) return '最近没有消耗'
  if (o.daysLeft === null) return '—'
  const d = o.daysLeft < 1 ? '不到 1 天' : `约 ${Math.round(o.daysLeft)} 天`
  return o.runsOutAt && o.daysLeft >= 1 ? `${d} · ${md(o.runsOutAt)} 前后用完` : d
}

/** The overview's quota slot for WorkBuddy: the account and today from the official ledger, and how long the rest lasts */
export function WorkBuddyCard() {
  const { lastUpdate } = useApp()
  const [refreshKey, setRefreshKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const o = useData(() => window.api.getWorkBuddyOutlook(), [refreshKey, lastUpdate?.at], 30_000)
  const refresh = async () => {
    setBusy(true)
    try { await window.api.getWorkBuddyOutlook(true); setRefreshKey((n) => n + 1) }
    finally { setBusy(false) }
  }
  const percent = o?.total ? Math.min(100, Math.max(0, ((o.used ?? 0) / o.total) * 100)) : 0
  return <div className="card quota-card workbuddy-quota">
    <div className="card-head">
      <div className="card-title"><WorkBuddyMark size={18} animated={false} /><span className="serif">WorkBuddy 积分</span></div>
      <button className="btn ghost small" title="刷新" onClick={refresh} disabled={busy}><IconRefresh className={busy ? 'spin' : ''} />刷新</button>
    </div>
    <div className="wb-credit-stats">
      <div><span className="muted">账户剩余</span><strong className="tnum">{o?.remaining == null ? '—' : credit(o.remaining)}<small>积分</small></strong></div>
      <div><span className="muted">今日消耗{o?.basis === 'local' ? ' · 本地' : ''}</span><strong className="tnum">{o?.today == null ? '—' : credit(o.today)}<small>积分</small></strong></div>
    </div>
    {o?.total != null && <div className="wb-account-balance">
      <div><span>{o.plan || '资源包'} · 已用 <b className="tnum">{credit(o.used ?? 0)}</b> / {credit(o.total)}</span><span className="muted tnum">{o.checkedAt ? new Date(o.checkedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''}</span></div>
      <div className="wb-balance-track"><i style={{ width: `${percent}%` }} /></div>
    </div>}
    {o && o.remaining !== null && <div className="wb-runway">
      <span className="muted">续航</span>
      <b className="tnum">{o.daysLeft === null ? '—' : o.daysLeft < 1 ? '不到 1 天' : `约 ${Math.round(o.daysLeft)} 天`}</b>
      <span className="muted tnum">{[o.runsOutAt && o.daysLeft && o.daysLeft >= 1 ? `${md(o.runsOutAt)} 前后用完` : o.dailyAvg === 0 ? '最近没有消耗' : '', o.dailyAvg ? `日均 ${credit(o.dailyAvg)}` : ''].filter(Boolean).join(' · ')}</span>
    </div>}
    {o?.error && <div className="wb-account-note muted">{o.error}</div>}
    <div className="wb-credit-models">
      {(o?.models ?? []).slice(0, 3).map((m) => <div key={m.model} className="wb-credit-model"><span title={m.model}>{m.model}</span><span className="tnum">{credit(m.credits)} 积分</span></div>)}
    </div>
    <div className="quota-foot">
      <span />
      <button className="btn ghost small" onClick={() => void window.api.openExternal(WORKBUDDY_PLANS_URL)}>套餐与用量 ↗</button>
    </div>
  </div>
}

/** Credits per day from the official ledger; the local logs only when the ledger can't be read */
export function WorkBuddyHistory() {
  const [range, setRange] = useState<'7d' | '30d'>('7d')
  const ledger = useData(() => window.api.getWorkBuddyLedger(range), [range], 60_000)
  const official = ledger?.status === 'ok'
  const local = useData(() => (ledger && !official ? window.api.getWorkBuddyUsage(range) : Promise.resolve(null)), [range, official, !!ledger], 60_000)
  const daily = official ? ledger.daily.map((d) => ({ day: d.day, credits: d.credits, n: d.requests, unknown: 0 })) : (local?.daily ?? []).map((d) => ({ day: d.day, credits: d.credits, n: d.recorded, unknown: d.missing }))
  const total = daily.reduce((a, d) => a + d.credits, 0)
  const max = Math.max(1, ...daily.map((d) => d.credits))
  // 30 bars: thinner, a date every fifth day (today always), values on hover
  const dense = daily.length > 10
  const peak = daily.reduce<(typeof daily)[number] | null>((p, d) => (d.n && (!p || d.credits > p.credits) ? d : p), null)
  return <div className="card insight replay-card workbuddy-history">
    <div className="card-head">
      <div className="card-title"><span className="serif">积分消耗</span><span className="muted">按天{ledger && !official ? ' · 本地记录' : ''}</span></div>
      <Segmented small value={range} onChange={(v) => setRange(v as '7d' | '30d')} options={[{ value: '7d', label: '7 天' }, { value: '30d', label: '30 天' }]} />
    </div>
    {daily.length > 0 && <div className="wb-history-sum">
      共 <b className="tnum">{credit(total)}</b> 积分 · 日均 <b className="tnum">{credit(total / daily.length)}</b>
      {peak && <> · 最多 {peak.day.slice(5)} <b className="tnum">{credit(peak.credits)}</b></>}
      {official && ledger.partial && <> · 只读到部分请求</>}
    </div>}
    <div className={`wb-history-bars${dense ? ' dense' : ''}`}>
      {daily.map((d, i) => <div key={d.day} className="wb-history-day" title={d.n || d.unknown ? `${d.day} · ${credit(d.credits)} 积分 · ${d.n} 条请求${d.unknown ? ` · ${d.unknown} 条未报告` : ''}` : `${d.day} · 没有消耗`}>
        <span className="wb-history-value tnum">{dense ? NBSP : d.n ? credit(d.credits) : d.unknown ? '—' : NBSP}</span>
        <div className="wb-history-track"><i style={{ height: `${d.n ? Math.max(2, (d.credits / max) * 100) : 0}%` }} /></div>
        <span className="muted tnum">{!dense || (daily.length - 1 - i) % 5 === 0 ? d.day.slice(5) : NBSP}</span>
      </div>)}
      {ledger && !daily.length && <div className="quota-msg">这段时间没有积分消耗</div>}
    </div>
  </div>
}
