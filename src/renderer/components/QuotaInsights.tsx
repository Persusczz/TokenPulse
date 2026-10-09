import { fmtTokens } from '@shared/format'
import type { CacheReport, RangeKey } from '@shared/types'
import { useApp, useData, useSource } from '../state'

export function CacheCard({ range }: { range: RangeKey }) {
  const { money } = useApp()
  const source = useSource()
  const r = useData<CacheReport>(() => window.api.getCacheReport(range), [range, source], 120_000)
  const share = r && r.totalCost > 0 ? r.extraCost / r.totalCost : 0
  const writeShare = r && r.totalCost > 0 ? r.writeCost / r.totalCost : 0
  const maxGap = r ? Math.max(1, ...r.gaps.map((g) => g.extra)) : 1
  const who = source === 'codex' ? 'Codex ' : source === 'claude' ? 'Claude ' : ''
  return (
    <div className="card insight cache-card">
      <div className="card-head">
        <div className="card-title">
          <span className="serif">缓存诊断</span>
          {r && source !== 'codex' && r.totalCost > 0 && (
            <span className={`muted${writeShare >= 0.3 ? ' hot-text' : ''}`} style={{ fontWeight: 400 }} title="缓存写入费用 / 全部费用">
              写入占 {(writeShare * 100).toFixed(0)}%
            </span>
          )}
        </div>
        {r && <span className="badge">{r.cacheUnreported && !r.hitRate ? '缓存字段不完整' : `命中率 ${(r.hitRate * 100).toFixed(1)}%`}</span>}
      </div>
      {!r ? (
        <div className="skeleton" style={{ height: 190 }} />
      ) : (
        <>
          <div className="pace-head">
            <span className={`serif big-num${share >= 0.12 ? ' hot' : ''}`}>{source === 'workbuddy' ? r.cacheUnreported && !r.hitRate ? '—' : `${(r.hitRate * 100).toFixed(1)}%` : money(r.extraCost)}</span>
            <span className="insight-sub">
              {source === 'workbuddy' ? '实际缓存命中率' : source === 'codex' ? '缓存过期后按全价重新计费多花的钱' : '缓存过期后重写多花的钱'}
              {source !== 'workbuddy' && r.totalCost > 0 ? `，占${who ? ` ${who}` : ''}费用的 ${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%` : ''}
              <br />
              {source === 'workbuddy' ? '缓存读取 / 全部输入' : r.rebuilds ? `${r.rebuilds} 次重写 · 平均每次 ${fmtTokens(r.avgRebuildTokens, 1)} token` : '没有发现过期重写'}
            </span>
          </div>
          {r.rebuilds > 0 && (
            <div className="cache-gaps">
              <div className="cache-gaps-title">离开多久回来，缓存过期重写了几次</div>
            {r.gaps.map((g) => (
              <div key={g.label} className="cache-gap">
                <span>{g.label}</span>
                <span className="cache-bar">
                  <i style={{ width: `${(g.extra / maxGap) * 100}%` }} />
                </span>
                <b className="tnum">{g.count} 次</b>
                <span className="tnum muted">{money(g.extra)}</span>
              </div>
            ))}
            </div>
          )}
          {r.sessions.length > 0 && (
            <div className="cache-gaps">
              <div className="cache-gaps-title">各会话因此多花</div>
              {r.sessions.map((s) => (
                <div key={s.sessionId} className="cache-gap session" title={`${s.sessionId}\n最近一次：${new Date(s.last).toLocaleString('zh-CN')}`}>
                  <span className="ellipsis">{s.project || s.sessionId.slice(0, 8)}</span>
                  <span className="cache-bar">
                    <i style={{ width: `${(s.extra / Math.max(1e-9, r.sessions[0].extra)) * 100}%` }} />
                  </span>
                  <b className="tnum">{s.rebuilds} 次</b>
                  <span className="tnum muted">{money(s.extra)}</span>
                </div>
              ))}
            </div>
          )}
          <ul className="cache-tips">
            {r.tips.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
