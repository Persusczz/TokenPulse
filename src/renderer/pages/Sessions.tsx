import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { fmtInt, fmtTokens } from '@shared/format'
import type { SessionContext, SessionRow } from '@shared/types'
import { ContextChart, contextAdvice } from '../components/UsageInsights'
import { useApp, useData, useSource } from '../state'

type SortKey = 'end' | 'tokens' | 'cost' | 'messages' | 'duration' | 'context'

function duration(ms: number): string {
  const m = Math.round(ms / 60000)
  if (m < 1) return '<1 分钟'
  if (m < 60) return `${m} 分钟`
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`
}
const stamp = (t: number) => new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/** a session another page asked to open (cleared once the page has mounted) */
function takeFocus(): string | null {
  try {
    return sessionStorage.getItem('tp.session.focus')
  } catch {
    return null
  }
}

/** a search another page asked for, such as a project picked on the sky page */
function takeQuery(): string {
  try {
    return sessionStorage.getItem('tp.session.query') ?? ''
  } catch {
    return ''
  }
}

/** One session: its context curve, compactions and every prompt with what it cost */
function SessionDetail({ row, onClose }: { row: SessionRow; onClose: () => void }) {
  const { money } = useApp()
  const c = useData<SessionContext | null>(() => window.api.getSessionContext(row.sessionId), [row.sessionId], 30_000)
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', esc)
    return () => removeEventListener('keydown', esc)
  }, [onClose])
  const top = c ? Math.max(...c.prompts.map((p) => p.cost), 0.0001) : 1
  return (
    <motion.div className="card session-detail" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} transition={{ type: 'spring', stiffness: 380, damping: 34 }}>
      <div className="card-head">
        <div className="card-title">
          <span className={`src-tag ${row.source ?? 'claude'}`}>{row.source === 'codex' ? 'Codex' : 'Claude'}</span>
          <span className="serif">{row.project}</span>
          <span className="muted" style={{ fontWeight: 400 }}>
            {stamp(row.start)} 起 · {duration(row.end - row.start)} · {money(row.cost)}
          </span>
        </div>
        <button className="btn ghost small" onClick={onClose} aria-label="关闭">
          ✕
        </button>
      </div>
      {!c ? (
        <div className="skeleton" style={{ height: 220 }} />
      ) : (
        <>
          <div className="ctx-stats">
            <span>
              当前上下文 <b className={c.latest >= c.warnAt ? 'hot' : ''}>{fmtTokens(c.latest, 1)}</b>{c.window ? <small className="muted"> / {fmtTokens(c.window, 0)} 窗口</small> : null}
            </span>
            <span>
              峰值 <b>{fmtTokens(c.peak, 1)}</b>
            </span>
            <span>
              每次请求增长 <b>{fmtTokens(c.growthPerRequest, 1)}</b>
            </span>
            <span>
              压缩过 <b>{c.compactions.length}</b> 次
            </span>
            <span>
              {c.requests} 次请求 · {c.model}
            </span>
          </div>
          <ContextChart c={c} />
          <div className="insight-foot">
            <span className="legend-dash" /> 每次请求的上下文 <span className="legend-dash hot" /> 提醒线 {fmtTokens(c.warnAt, 0)} <span className="legend-dash compact" /> 压缩 <span className="legend-tick" /> 提问
          </div>
          <div className={`insight-advice${c.latest >= c.warnAt ? ' hot' : ''}`}>{contextAdvice(c.latest, c.warnAt, c.growthPerRequest, c.window)}</div>
          {c.prompts.length > 0 && (
            <>
              <div className="cache-gaps-title" style={{ marginTop: 14 }}>
                这个会话的 {c.prompts.length} 次提问
              </div>
              <div className="session-prompts">
                {c.prompts.map((p) => (
                  <div key={p.key} className="session-prompt" title={p.text}>
                    <span className="tnum muted">{stamp(p.ts)}</span>
                    <span className="ellipsis">{p.text}</span>
                    <span className="cache-bar">
                      <i style={{ width: `${(p.cost / top) * 100}%` }} />
                    </span>
                    <span className="tnum muted">{p.requests} 次</span>
                    <b className="tnum">{money(p.cost)}</b>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </motion.div>
  )
}

export function Sessions() {
  const { money, settings } = useApp()
  const source = useSource()
  const rows = useData(() => window.api.getSessions(), [source])
  const [q, setQ] = useState(takeQuery)
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'end', desc: true })
  const [focus, setFocus] = useState<string | null>(takeFocus)
  useEffect(() => {
    try {
      sessionStorage.removeItem('tp.session.focus')
      sessionStorage.removeItem('tp.session.query')
    } catch {
      /* ignore */
    }
    const fn = (e: Event) => setFocus(String((e as CustomEvent<string>).detail))
    document.addEventListener('tp-session', fn)
    return () => document.removeEventListener('tp-session', fn)
  }, [])
  const fixedLine = (settings?.contextWarnK ?? 120) * 1000

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const val = (r: SessionRow) => (sort.key === 'duration' ? r.end - r.start : r[sort.key])
    return (rows ?? [])
      .filter((r) => !needle || r.project.toLowerCase().includes(needle) || r.models.some((m) => m.toLowerCase().includes(needle)))
      .sort((a, b) => (sort.desc ? val(b) - val(a) : val(a) - val(b)))
  }, [rows, q, sort])
  const mixed = source === 'all' && !!rows?.some((r) => r.source === 'codex')
  const sel = focus ? (rows?.find((r) => r.sessionId === focus) ?? null) : null

  const th = (key: SortKey, label: string, title?: string) => (
    <th className="sortable num" title={title} onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }))}>
      {label}
      {sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
    </th>
  )

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">会话</h1>
          <div className="page-sub">
            点一行看它的上下文曲线和每次提问的费用。费用按日志中每条响应的用量计算
            {source !== 'codex' && '；「自报 · 本次运行」是 Claude Code 自己记录的最近一次运行费用，含子调用，会话恢复后重新计数'}
          </div>
        </div>
        <input className="input" placeholder="搜索项目或模型" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
      </div>
      <AnimatePresence>{sel && <SessionDetail key={sel.sessionId} row={sel} onClose={() => setFocus(null)} />}</AnimatePresence>
      <div className="card" style={{ padding: 8 }}>
        {!rows ? (
          <div className="skeleton" style={{ height: 240 }} />
        ) : !list.length ? (
          <div className="empty">没有会话</div>
        ) : (
          <div className="table-wrap" style={{ maxHeight: sel ? 'calc(100vh - 560px)' : 'calc(100vh - 190px)', minHeight: 220 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>项目</th>
                  <th>模型</th>
                  {th('end', '最近活动')}
                  {th('duration', '时长')}
                  {th('messages', '响应')}
                  {th('context', '上下文', '最近一次请求带上的上下文大小（不含子代理）')}
                  {th('tokens', 'Token')}
                  {th('cost', '费用')}
                  {source !== 'codex' && (
                    <th className="num" title="Claude Code 写入日志的 cost-state：仅统计最近一次进程运行，包含日志中看不到的子调用">
                      自报 · 本次运行
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.sessionId} title={r.sessionId} className={`clickable${focus === r.sessionId ? ' on' : ''}`} onClick={() => setFocus(focus === r.sessionId ? null : r.sessionId)}>
                    <td className="ellipsis">
                      {mixed && <span className={`src-tag ${r.source ?? 'claude'}`}>{r.source === 'codex' ? 'Codex' : 'Claude'}</span>}
                      {r.project}
                    </td>
                    <td className="ellipsis muted">{r.models.join('、')}</td>
                    <td className="num">{stamp(r.end)}</td>
                    <td className="num">{duration(r.end - r.start)}</td>
                    <td className="num">{fmtInt(r.messages)}</td>
                    <td className="num">
                      <span className={`ctx-chip${r.context >= (r.warnAt ?? fixedLine) ? ' over' : r.context >= (r.warnAt ?? fixedLine) * 0.7 ? ' near' : ''}`} title={r.window ? `窗口 ${fmtTokens(r.window, 0)} · 已用 ${Math.round((r.context / r.window) * 100)}%` : undefined}>{r.context ? fmtTokens(r.context, 0) : '—'}</span>
                    </td>
                    <td className="num">{fmtTokens(r.tokens)}</td>
                    <td className="num" style={{ fontWeight: 600 }}>
                      {money(r.cost)}
                    </td>
                    {source !== 'codex' && <td className="num muted">{r.reportedCost === null ? '—' : money(r.reportedCost)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
