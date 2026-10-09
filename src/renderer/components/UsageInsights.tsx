import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { fmtTokens } from '@shared/format'
import type { ContextAlert, PromptReport, RangeKey, SessionContext, UsageSource, WindowHistory, WindowRecord } from '@shared/types'
import { useApp, useData, useNow, useSource } from '../state'
import { Segmented } from './Segmented'

const HOUR = 3600_000
const RANGE_NAME: Record<RangeKey, string> = { today: '今日', '7d': '近 7 天', '30d': '近 30 天', month: '本月', all: '全部时间' }
const dur = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000))
  return m < 1 ? '不到 1 分钟' : m < 60 ? `${m} 分钟` : `${Math.floor(m / 60)} 小时${m % 60 ? ` ${m % 60} 分` : ''}`
}
const stamp = (t: number) => new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const hm = (t: number) => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
const toolName = (s: UsageSource) => (s === 'workbuddy' ? 'WorkBuddy' : s === 'codex' ? 'Codex' : 'Claude')

/** Opens the sessions page on one session */
export function openSession(sessionId: string): void {
  try {
    sessionStorage.setItem('tp.session.focus', sessionId)
  } catch {
    /* ignore */
  }
  document.dispatchEvent(new CustomEvent('tp-nav', { detail: 'sessions' }))
  document.dispatchEvent(new CustomEvent('tp-session', { detail: sessionId }))
}

// ---------------------------------------------------------------- prompts

/** The ten prompts that cost the most in the range, with everything they set off */
export function PromptsCard({ range }: { range: RangeKey }) {
  const { money } = useApp()
  const source = useSource()
  const r = useData<PromptReport>(() => window.api.getPrompts(range), [range, source], 120_000)
  const [open, setOpen] = useState<string | null>(null)
  const max = r?.top[0]?.cost ?? 1
  return (
    <div className="card insight prompts-card">
      <div className="card-head">
        <div className="card-title">
          <span className="serif">最贵的 10 次提问</span>
          <span className="muted" style={{ fontWeight: 400 }}>
            {RANGE_NAME[range]}
          </span>
        </div>
        {r && r.count > 0 && (
          <span className="badge" title="这段时间里每次提问（含它触发的所有工具调用和子代理）的平均 / 中位费用">
            {r.count} 次 · 平均 {money(r.avgCost)} · 中位 {money(r.medianCost)}
          </span>
        )}
      </div>
      {!r ? (
        <div className="skeleton" style={{ height: 260 }} />
      ) : !r.top.length ? (
        <div className="quota-msg" style={{ minHeight: 200 }}>
          这段时间没有找到提问记录
        </div>
      ) : (
        <ol className="prompt-list">
          {r.top.map((p, i) => (
            <motion.li
              key={p.key}
              className={`prompt-item${open === p.key ? ' open' : ''}`}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.035 }}
              onClick={() => setOpen(open === p.key ? null : p.key)}
              title={p.text}
            >
              <span className="prompt-bar" style={{ width: `${(p.cost / max) * 100}%` }} />
              <span className={`prompt-rank r${i + 1}`}>{i + 1}</span>
              <span className="prompt-main">
                <span className="prompt-text">{p.text}</span>
                <span className="prompt-meta">
                  {source === 'all' && <span className={`src-tag ${p.source}`}>{toolName(p.source)}</span>}
                  {p.project} · {stamp(p.ts)} · {p.requests} 次请求 · {dur(p.durationMs)}
                  {open === p.key && <> · {p.models.join('、')}</>}
                </span>
                {open === p.key && (
                  <span className="prompt-actions">
                    <span className="muted">
                      {fmtTokens(p.tokens, 1)} tokens · 输出 {fmtTokens(p.output, 1)}
                    </span>
                    <button
                      className="btn small"
                      onClick={(e) => {
                        e.stopPropagation()
                        openSession(p.sessionId)
                      }}
                    >
                      查看会话
                    </button>
                  </span>
                )}
              </span>
              <span className="prompt-cost">
                <b className="serif">{money(p.cost)}</b>
                <small>{fmtTokens(p.tokens, 1)}</small>
              </span>
            </motion.li>
          ))}
        </ol>
      )}
      {r && r.unattributedCost > 0.005 && <div className="insight-foot muted">另有 {money(r.unattributedCost)} 找不到对应的提问（日志已被清理，只剩归档的用量）</div>}
    </div>
  )
}

// ---------------------------------------------------------------- window replay

/** A window's readings drawn over its five hours; a new key replays the drawing */
function ReplayChart({ w, now, play }: { w: WindowRecord; now: number; play: number }) {
  const W = 520
  const H = 130
  const x = (t: number) => ((t - w.start) / (w.end - w.start)) * W
  const y = (p: number) => H - 6 - (Math.min(100, Math.max(0, p)) / 100) * (H - 14)
  const pts = w.samples.filter((s) => s.t >= w.start - 60_000 && s.t <= w.end + 60_000)
  // a step line: readings hold until the next one
  let d = ''
  pts.forEach((s, i) => {
    const px = x(Math.max(w.start, s.t)).toFixed(1)
    d += i ? `L${px} ${y(pts[i - 1].pct).toFixed(1)}L${px} ${y(s.pct).toFixed(1)}` : `M${px} ${y(s.pct).toFixed(1)}`
  })
  const lastX = x(Math.min(w.end, Math.max(pts[pts.length - 1]?.t ?? w.start, w.end > now ? now : w.end)))
  if (pts.length) d += `L${lastX.toFixed(1)} ${y(pts[pts.length - 1].pct).toFixed(1)}`
  const hot = w.hitAt !== null
  return (
    <div className="replay-box">
    <svg key={play} className={`replay-chart${hot ? ' hot' : ''}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="replay-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={hot ? 'var(--critical)' : 'var(--accent)'} stopOpacity="0.35" />
          <stop offset="1" stopColor={hot ? 'var(--critical)' : 'var(--accent)'} stopOpacity="0" />
        </linearGradient>
        <clipPath id="replay-clip">
          <rect className="replay-wipe" x="0" y="0" width={W} height={H} />
        </clipPath>
      </defs>
      {[25, 50, 75].map((g) => (
        <line key={g} x1="0" x2={W} y1={y(g)} y2={y(g)} className="replay-grid" />
      ))}
      <line x1="0" x2={W} y1={y(100)} y2={y(100)} className="pace-limit" />
      <line x1="0" y1={y(0)} x2={W} y2={y(100)} className="pace-ideal" />
      <g clipPath="url(#replay-clip)">
        {d && <path d={`${d}L${lastX.toFixed(1)} ${H}L${x(pts[0]?.t ?? w.start).toFixed(1)} ${H}Z`} fill="url(#replay-fill)" />}
        {d && <path d={d} className="replay-line" vectorEffect="non-scaling-stroke" />}
      </g>
      {w.hitAt && <circle cx={x(w.hitAt)} cy={y(100)} r="5" className="replay-hit" />}
      {w.end > now && <line x1={x(now)} x2={x(now)} y1="0" y2={H} className="pace-now" />}
    </svg>
    </div>
  )
}

/** One row of windows on a time line: bar height = peak, red when it ran out */
function Lane({ list, from, to, sel, onPick, now }: { list: WindowRecord[]; from: number; to: number; sel: WindowRecord | null; onPick: (w: WindowRecord) => void; now: number }) {
  const span = to - from
  return (
    <div className="lane">
      {list.map((w) => {
        const left = ((Math.max(from, w.start) - from) / span) * 100
        const width = ((Math.min(to, w.end) - Math.max(from, w.start)) / span) * 100
        const cls = ['lane-win', w.hitAt ? 'hit' : w.peak >= 90 ? 'high' : '', w.estimated ? 'est' : '', w.end > now ? 'live' : '', sel === w ? 'on' : ''].filter(Boolean).join(' ')
        return (
          <button
            key={`${w.source}${w.start}`}
            className={cls}
            style={{ left: `${left}%`, width: `${Math.max(0.6, width)}%` }}
            title={`${stamp(w.start)}–${hm(w.end)}\n峰值 ${Math.round(w.peak)}%${w.hitAt ? `，${dur(w.hitAt - w.start)}触顶` : ''}${w.estimated ? '（按本地日志估算）' : ''}`}
            onClick={() => onPick(w)}
          >
            <i style={{ height: `${Math.max(4, Math.min(100, w.peak))}%` }} />
          </button>
        )
      })}
    </div>
  )
}

/** Every 5-hour window of the last days: how high it went, whether and how fast it ran out; click one to replay it */
export function WindowHistoryCard() {
  const { quota, codexQuota } = useApp()
  const source = useSource()
  const now = useNow(60_000)
  const [days, setDays] = useState(7)
  const h = useData<WindowHistory>(() => window.api.getWindowHistory(days), [days, source, quota?.fetchedAt, codexQuota?.updatedAt], 120_000)
  const [sel, setSel] = useState<WindowRecord | null>(null)
  const [play, setPlay] = useState(0)
  const from = now - days * 24 * HOUR
  const sources = h ? h.summary.map((s) => s.source) : []
  // keep the pick across refreshes; default to the latest window that ran out, else the latest one
  const pick = useMemo(() => {
    if (!h?.windows.length) return null
    if (sel) {
      const same = h.windows.find((w) => w.source === sel.source && w.start === sel.start)
      if (same) return same
    }
    const hits = h.windows.filter((w) => w.hitAt)
    return hits[hits.length - 1] ?? h.windows[h.windows.length - 1]
  }, [h, sel])
  useEffect(() => setPlay((p) => p + 1), [pick?.start, pick?.source])
  return (
    <div className="card insight replay-card">
      <div className="card-head">
        <div className="card-title">
          <span className="serif">额度窗口回放</span>
          <span className="muted" style={{ fontWeight: 400 }}>
            每个 5 小时窗口
          </span>
        </div>
        <Segmented
          small
          value={String(days)}
          onChange={(v) => setDays(Number(v))}
          options={[
            { value: '3', label: '3 天' },
            { value: '7', label: '7 天' },
            { value: '14', label: '14 天' }
          ]}
        />
      </div>
      {!h ? (
        <div className="skeleton" style={{ height: 260 }} />
      ) : !h.windows.length ? (
        <div className="quota-msg" style={{ minHeight: 220 }}>
          还没有窗口记录
        </div>
      ) : (
        <>
          <div className="replay-summary">
            {h.summary
              .filter((s) => s.windows > 0)
              .map((s) => (
                <span key={s.source} className="replay-stat">
                  {source === 'all' && <span className={`src-tag ${s.source}`}>{toolName(s.source)}</span>}
                  最近 {days} 天 <b>{s.windows}</b> 个窗口，触顶 <b className={s.hits ? 'hot' : ''}>{s.hits}</b> 次
                  {s.avgToHitMs !== null && (
                    <>
                      ，平均 <b>{dur(s.avgToHitMs)}</b> 用完
                    </>
                  )}
                  ，平均峰值 <b>{Math.round(s.avgPeak)}%</b>
                  {s.estimated > 0 && <span className="muted">（{s.estimated} 个按日志估算）</span>}
                </span>
              ))}
          </div>
          <div className="lanes">
            {sources.map((s) => (
              <div key={s} className={`lane-row ${s}`}>
                {sources.length > 1 && <span className="lane-name">{toolName(s)}</span>}
                <Lane list={h.windows.filter((w) => w.source === s)} from={from} to={now + HOUR} sel={pick} onPick={setSel} now={now} />
              </div>
            ))}
            <div className="lane-axis">
              {Array.from({ length: days + 1 }, (_, i) => {
                const t = from + i * 24 * HOUR
                return (
                  <span key={i} style={{ left: `${((t - from) / (now + HOUR - from)) * 100}%` }}>
                    {new Date(t).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
                  </span>
                )
              })}
            </div>
          </div>
          <AnimatePresence mode="wait">
            {pick && (
              <motion.div key={`${pick.source}${pick.start}`} className="replay" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
                <div className="replay-head">
                  <span>
                    {source === 'all' && <span className={`src-tag ${pick.source}`}>{toolName(pick.source)}</span>}
                    {stamp(pick.start)}–{hm(pick.end)}
                    {pick.end > now && <span className="badge accent">进行中</span>}
                    {pick.estimated && <span className="badge">估算</span>}
                  </span>
                  <span className={pick.hitAt ? 'hot' : ''}>
                    {pick.hitAt ? `${dur(pick.hitAt - pick.start)}触顶，之后等了 ${dur(pick.end - pick.hitAt)}` : `峰值 ${Math.round(pick.peak)}%，没有触顶`}
                  </span>
                  <button className="btn ghost small" onClick={() => setPlay((p) => p + 1)} title="重新播放">
                    ▶ 回放
                  </button>
                </div>
                <ReplayChart w={pick} now={now} play={play} />
                <div className="pace-axis">
                  <span>{hm(pick.start)}</span>
                  <span>
                    <span className="legend-dash solid" /> 实际 <span className="legend-dash ideal" /> 匀速
                  </span>
                  <span>{hm(pick.end)} 刷新</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- context

/** Context size per request through a session, with the warning line, compactions and prompts */
export function ContextChart({ c }: { c: SessionContext }) {
  const W = 760
  const H = 200
  const pts = c.points
  if (pts.length < 2) return <div className="quota-msg">请求太少，还画不出曲线</div>
  const t0 = pts[0].t
  const t1 = Math.max(pts[pts.length - 1].t, t0 + 60_000)
  const top = Math.max(c.peak, c.warnAt) * 1.12
  const x = (t: number) => ((t - t0) / (t1 - t0)) * W
  const y = (v: number) => H - 8 - (v / top) * (H - 18)
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.tokens).toFixed(1)}`).join('')
  const over = c.latest >= c.warnAt
  return (
    <svg className={`ctx-chart${over ? ' over' : ''}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="ctx-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.4" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="ctx-stroke" x1="0" x2="0" y1={y(top)} y2={y(0)} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--critical)" />
          <stop offset={Math.max(0, Math.min(1, 1 - c.warnAt / top)).toFixed(3)} stopColor="var(--critical)" />
          <stop offset={Math.max(0, Math.min(1, 1 - c.warnAt / top + 0.001)).toFixed(3)} stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent)" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width={W} height={y(c.warnAt)} className="ctx-danger" />
      <line x1="0" x2={W} y1={y(c.warnAt)} y2={y(c.warnAt)} className="ctx-warn" />
      {c.compactions.map((t) => (
        <line key={t} x1={x(t)} x2={x(t)} y1="0" y2={H} className="ctx-compact" />
      ))}
      {c.prompts.map((p) => (
        <line key={p.key} x1={x(p.ts)} x2={x(p.ts)} y1={H - 6} y2={H} className="ctx-prompt" />
      ))}
      <path d={`${line}L${x(pts[pts.length - 1].t)} ${H}L0 ${H}Z`} fill="url(#ctx-fill)" />
      <path d={line} className="ctx-line" stroke="url(#ctx-stroke)" vectorEffect="non-scaling-stroke" />
      <circle cx={x(pts[pts.length - 1].t)} cy={y(c.latest)} r="4.5" className={`ctx-dot${over ? ' over' : ''}`} />
    </svg>
  )
}

/** What to say about a session's context, against its model's window when known */
export function contextAdvice(tokens: number, warnAt: number, growth: number, window?: number): string {
  const of = window ? ` / ${fmtTokens(window, 0)}（${Math.round((tokens / window) * 100)}%）` : ''
  if (window ? tokens >= window * 0.88 : tokens >= warnAt * 1.5) return `上下文已经 ${fmtTokens(tokens, 0)}${of}，快到自动压缩了：在合适的节点自己 /compact，比被动压缩更能留住要点`
  if (tokens >= warnAt) return `上下文到了 ${fmtTokens(tokens, 0)}${of}${growth > 1000 ? `，每次请求还在多 ${fmtTokens(growth, 0)}` : ''}：告一段落时 /compact 一下`
  if (growth > 0 && tokens + growth * 10 >= warnAt) return `照现在的增速，大约 ${Math.max(1, Math.ceil((warnAt - tokens) / growth))} 次请求后会到提醒线 ${fmtTokens(warnAt, 0)}`
  return window ? `上下文 ${fmtTokens(tokens, 0)}${of}，还宽裕，不用压缩` : '上下文还不大，不用压缩'
}

/** banners closed by hand, by session and level */
const dismissedContext = new Set<string>()

/** Sessions on view whose context has grown past the warning line */
export function ContextBanner() {
  const { settings } = useApp()
  const source = useSource()
  const list = useData<ContextAlert[]>(() => window.api.getContextAlerts(), [source, settings?.contextWarnK, settings?.contextAuto], 60_000)
  const [hidden, setHiddenState] = useState<Set<string>>(dismissedContext)
  // dismissed until the session reaches the next level (kept across pages)
  const setHidden = (s: Set<string>) => {
    s.forEach((k) => dismissedContext.add(k))
    setHiddenState(new Set(s))
  }
  const [fresh, setFresh] = useState<ContextAlert[]>([])
  useEffect(() => window.api.onContextAlert((a) => setFresh((f) => [a, ...f.filter((x) => x.sessionId !== a.sessionId)].slice(0, 3))), [])
  if (!settings?.contextAlert) return null
  const levelOf = (x: ContextAlert) => (x.window && settings.contextAuto ? (x.tokens >= x.window * 0.88 ? 2 : 1) : x.tokens >= x.warnAt * 1.5 ? 2 : 1)
  const keyOf = (x: ContextAlert) => `${x.sessionId}:${levelOf(x)}`
  const merged = [...fresh.filter((f) => !list?.some((l) => l.sessionId === f.sessionId) && Date.now() - f.at < 20 * 60_000), ...(list ?? [])].filter(
    (a) => !hidden.has(keyOf(a)) && (source === 'all' || a.source === source)
  )
  const a = merged[0]
  return (
    <AnimatePresence>
      {a && (
        <motion.div key={a.sessionId} className="ctx-banner" initial={{ opacity: 0, y: -8, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }} exit={{ opacity: 0, y: -8, height: 0 }}>
          <span className="ctx-banner-gauge" style={{ ['--p' as string]: Math.min(1, a.window ? a.tokens / a.window : a.tokens / (a.warnAt * 2)) }}>
            <b>{fmtTokens(a.tokens, 0)}</b>
          </span>
          <span className="ctx-banner-text">
            <b>
              {levelOf(a) === 2 ? '上下文快满了' : '上下文偏大'} · {a.project || a.sessionId.slice(0, 8)}
            </b>
            {source === 'all' && <span className={`src-tag ${a.source}`}>{toolName(a.source)}</span>}
            <small>
              {contextAdvice(a.tokens, a.warnAt, a.growthPerRequest, a.window)}
              {merged.length > 1 ? `（另有 ${merged.length - 1} 个会话）` : ''}
            </small>
          </span>
          <button className="btn small" onClick={() => openSession(a.sessionId)}>
            看上下文曲线
          </button>
          <button className="btn ghost small" onClick={() => setHidden(new Set([...hidden, keyOf(a)]))} aria-label="忽略">
            ✕
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
