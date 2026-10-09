import { useState } from 'react'
import type { WorkBuddyLedger } from '@shared/types'
import { fmtInt } from '@shared/format'
import { useData } from '../../renderer/state'
import { Segmented } from '../../renderer/components/Segmented'
import { IconRefresh } from '../../renderer/components/Icons'
import { WorkBuddyMark } from './WorkBuddyMark'

const credit = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })

export function WorkBuddyLedgerCard() {
  const [range, setRange] = useState<WorkBuddyLedger['range']>('today')
  const [refreshKey, setRefreshKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const ledger = useData(() => window.api.getWorkBuddyLedger(range), [range, refreshKey], 30_000)
  const refresh = async () => {
    setBusy(true)
    try { await window.api.getWorkBuddyLedger(range, true); setRefreshKey((n) => n + 1) }
    finally { setBusy(false) }
  }
  return <div className="card insight workbuddy-ledger">
    <div className="card-head">
      <div className="card-title"><WorkBuddyMark size={18} animated={false} /><span className="serif">官方积分账本</span></div>
      <div className="wb-ledger-controls">
        <Segmented small value={range} onChange={(v) => setRange(v as WorkBuddyLedger['range'])} options={[{ value: 'today', label: '今日' }, { value: '7d', label: '7 天' }, { value: '30d', label: '30 天' }]} />
        <button className="btn ghost small" onClick={refresh} disabled={busy}><IconRefresh className={busy ? 'spin' : ''} />刷新</button>
      </div>
    </div>
    <div className="wb-credit-stats">
      <div><span className="muted">消耗{ledger?.status === 'error' && ledger.checkedAt ? ' · 上次记录' : ''}</span><strong className="tnum">{ledger?.credits == null ? '—' : credit(ledger.credits)}<small>积分</small></strong></div>
      <div><span className="muted">请求</span><strong className="tnum">{ledger?.checkedAt ? fmtInt(ledger.requests) : '—'}<small>条请求</small></strong></div>
    </div>
    {ledger?.error && <div className="wb-account-note muted">{ledger.error}</div>}
    {ledger?.partial && <div className="wb-account-note">只读到 {fmtInt(ledger.requests)} / {fmtInt(ledger.reportedTotal)} 条</div>}
    <div className="grid-2 wb-ledger-details">
      <div><div className="muted">按模型消耗</div>{ledger?.models.map((m) => <div key={m.model} className="wb-credit-model"><span title={m.model}>{m.model}</span><span className="tnum">{credit(m.credits)} 积分</span></div>)}</div>
      <div><div className="muted">最新请求</div>{ledger?.recent.slice(0, 5).map((r) => <div key={r.id} className="wb-credit-model"><span title={new Date(r.ts).toLocaleString('zh-CN') + ' · ' + r.model}>{new Date(r.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} · {r.model}</span><span className="tnum">{credit(r.credits)}</span></div>)}</div>
    </div>
    {ledger?.status === 'ok' && !ledger.requests && <div className="quota-msg">这段时间没有请求</div>}
    {ledger?.checkedAt && <div className="insight-foot muted">{new Date(ledger.checkedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 读取</div>}
  </div>
}
