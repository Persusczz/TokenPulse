import type { ValueReport } from '@shared/types'
import { useApp, useData, useSource } from '../state'
import { AnimatedNumber } from './Numbers'

const VERDICT: Record<ValueReport['verdict'], { label: string; cls: string }> = {
  upgrade: { label: '建议升级', cls: 'up' },
  downgrade: { label: '可以降级', cls: 'down' },
  keep: { label: '刚刚好', cls: 'keep' },
  unknown: { label: '无法判断', cls: 'keep' }
}

/** Cumulative month cost against the plan price, with the projection to month end */
function PaybackChart({ v }: { v: ValueReport }) {
  const W = 300
  const H = 74
  const max = Math.max(v.projectedMonthCost, v.planPrice, v.monthCost, 1) * 1.1
  const x = (day: number) => (day / Math.max(1, v.daysInMonth - 1)) * W
  const y = (usd: number) => H - 4 - (usd / max) * (H - 10)
  const pts = v.daily.map((d, i) => [x(i), y(d.cost)] as const)
  const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join('')
  const last = pts[pts.length - 1] ?? [0, H]
  const paidAt = v.daily.findIndex((d) => d.cost >= v.planPrice)
  return (
    <svg className="mini-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="pay-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" x2={W} y1={y(v.planPrice)} y2={y(v.planPrice)} className="pay-line" />
      {pts.length > 1 && <path d={`${line}L${last[0]} ${H}L0 ${H}Z`} fill="url(#pay-fill)" />}
      <path d={line} className="pay-actual" vectorEffect="non-scaling-stroke" />
      <line x1={last[0]} y1={last[1]} x2={W} y2={y(v.projectedMonthCost)} className="pay-proj" vectorEffect="non-scaling-stroke" />
      {paidAt >= 0 && <circle cx={x(paidAt)} cy={y(v.daily[paidAt].cost)} r="3.5" className="pay-dot" />}
    </svg>
  )
}

export function ValueCard() {
  const { money, codexQuota } = useApp()
  const source = useSource()
  const v = useData(() => window.api.getValue(source), [source, codexQuota?.plan], 60_000)
  const verdict = v ? VERDICT[v.verdict] : null
  return (
    <div className="card insight">
      <div className="card-head">
        <div className="card-title">
          <span className="serif">订阅回本</span>
          {v?.plan && (
            <span className="badge accent" title={v.plan}>
              {v.source === 'all' ? v.plan.replace(/ChatGPT /g, 'GPT ') : v.plan} · ${v.planPrice}/月{v.priceDetected ? '' : '（自定义）'}
            </span>
          )}
        </div>
        {verdict && <span className={`verdict ${verdict.cls}`}>{verdict.label}</span>}
      </div>
      {v ? (
        <>
          <div className="insight-big">
            <span className="serif big-num">
              <AnimatedNumber value={v.multiple} format={(n) => n.toFixed(1)} />
              <small>×</small>
            </span>
            <span className="insight-sub">
              本月已用 <b>{money(v.monthCost)}</b> 的 API 等价额度
              <br />
              按当前速度月底约 <b>{money(v.projectedMonthCost)}</b>（{v.projectedMultiple.toFixed(1)}×）
            </span>
          </div>
          <PaybackChart v={v} />
          <div className="insight-foot">
            <span className="legend-dash" /> 回本线 {money(v.planPrice)}
            {v.quotaHits > 0 && <span className="muted"> · 本月 {v.quotaHits} 次触到 5h 上限</span>}
            {v.source === 'all' && <span className="muted"> · 两份订阅合计</span>}
          </div>
          <div className="insight-advice">{v.advice}</div>
        </>
      ) : (
        <div className="skeleton" style={{ height: 150 }} />
      )}
    </div>
  )
}

