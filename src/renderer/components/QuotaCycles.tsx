import { motion } from 'motion/react'
import { useState } from 'react'
import { fmtTokens } from '@shared/format'
import type { QuotaCycle, QuotaCycles, UsageSource } from '@shared/types'
import { useApp, useData, useNow, useSource } from '../state'
import { AnimatedNumber } from './Numbers'
import { Segmented } from './Segmented'

/**
 * The quota window by window: what the open 5-hour and 7-day windows have
 * used so far, in tokens and money, against the ones before them. Days hold
 * several 5-hour windows and weeks don't start on Monday, so day and week
 * totals can't answer "how much did that window take"; this can.
 */

const HOUR = 3_600_000
const DAY = 24 * HOUR
const SHOW = { '5h': 14, '7d': 8 } as const

const hm = (t: number) => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
const md = (t: number) => {
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
const dayOf = (t: number) => new Date(t).toDateString()
function dayName(t: number, now: number): string {
  if (dayOf(t) === dayOf(now)) return '今天'
  if (dayOf(t) === dayOf(now - DAY)) return '昨天'
  return md(t)
}
const range = (c: QuotaCycle, now: number) =>
  c.kind === '5h' ? `${dayName(c.start, now)} ${hm(c.start)}–${dayOf(c.end) === dayOf(c.start) ? '' : '次日 '}${hm(c.end)}` : `${md(c.start)} ${hm(c.start)} – ${md(c.end)} ${hm(c.end)}`
function left(ms: number): string {
  if (ms >= DAY) return `${Math.floor(ms / DAY)} 天 ${Math.floor((ms % DAY) / HOUR)} 小时`
  if (ms >= HOUR) return `${Math.floor(ms / HOUR)} 小时 ${Math.floor((ms % HOUR) / 60_000)} 分`
  return `${Math.max(1, Math.ceil(ms / 60_000))} 分钟`
}
const tok = (v: number) => fmtTokens(v, 2)

type Metric = 'tokens' | 'cost'

/** the token mix of a window, as one thin bar */
function Mix({ c }: { c: QuotaCycle }) {
  const parts = [
    { k: 'output', v: c.output, label: '输出' },
    { k: 'input', v: c.input, label: '输入' },
    { k: 'write', v: c.cacheWrite, label: '缓存写入' },
    { k: 'read', v: c.cacheRead, label: '缓存读取' }
  ]
  const sum = parts.reduce((a, p) => a + p.v, 0) || 1
  return (
    <span className="cy-mix" title={parts.map((p) => `${p.label} ${fmtTokens(p.v, 1)}`).join('\n')}>
      {parts.map((p) => (p.v > 0 ? <i key={p.k} className={`cy-mix-${p.k}`} style={{ flexGrow: p.v / sum }} /> : null))}
    </span>
  )
}

function Panel({ kind, list, metric, now }: { kind: '5h' | '7d'; list: QuotaCycle[]; metric: Metric; now: number }) {
  const { money } = useApp()
  const [hover, setHover] = useState<number | null>(null)
  const shown = list.slice(-SHOW[kind])
  const cur = list.find((c) => c.current) ?? null
  const closed = list.filter((c) => !c.current)
  const prev = closed[closed.length - 1] ?? null
  const head = cur ?? prev
  const avg = closed.length ? { tokens: closed.reduce((a, c) => a + c.tokens, 0) / closed.length, cost: closed.reduce((a, c) => a + c.cost, 0) / closed.length } : null
  const val = (c: { tokens: number; cost: number }) => (metric === 'tokens' ? c.tokens : c.cost)
  const fmt = (v: number) => (metric === 'tokens' ? fmtTokens(v, 1) : money(v, v >= 100 ? 0 : undefined))
  const top = Math.max(...shown.map(val), avg ? val(avg) : 0) || 1
  const pick = shown.find((c) => c.start === hover) ?? cur ?? shown[shown.length - 1] ?? null
  const most = closed.length ? closed.reduce((a, c) => (val(c) > val(a) ? c : a)) : null
  const name = kind === '5h' ? '5 小时窗口' : '7 天窗口'
  const per = pick && pick.pct !== null && pick.pct >= 5 && pick.tokens > 0 ? { tokens: pick.tokens / pick.pct, cost: pick.cost / pick.pct } : null
  return (
    <section className={`cy-panel cy-${kind}`}>
      <header className="cy-head">
        <span className="cy-name">
          <i className="cy-glyph" aria-hidden />
          {name}
        </span>
        <span className="cy-when">
          {cur ? (
            <>
              {range(cur, now)} · 还剩 <b>{left(cur.end - now)}</b>
            </>
          ) : (
            '现在没有打开的窗口'
          )}
        </span>
      </header>

      {head ? (
        <div className="cy-now">
          <div className="cy-num">
            <span className="cy-label">{cur ? '本窗口已用' : '上个窗口'}</span>
            <b className="serif">
              <AnimatedNumber value={head.tokens} format={tok} />
            </b>
            <small>Token</small>
          </div>
          <div className="cy-num cost">
            <span className="cy-label">金额</span>
            <b className="serif">
              <AnimatedNumber value={head.cost} format={(v) => money(v)} />
            </b>
          </div>
          {head.pct !== null && (
            <div className={`cy-quota${head.pct >= 90 ? ' hot' : head.pct >= 75 ? ' warm' : ''}`} title={cur ? '官方额度读数' : '这个窗口的最高读数'}>
              <svg viewBox="0 0 36 36" aria-hidden>
                <circle cx="18" cy="18" r="15" className="cy-q-track" />
                <motion.circle
                  cx="18"
                  cy="18"
                  r="15"
                  className="cy-q-arc"
                  pathLength={100}
                  strokeDasharray="100"
                  initial={{ strokeDashoffset: 100 }}
                  animate={{ strokeDashoffset: 100 - Math.min(100, head.pct) }}
                  transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
                />
              </svg>
              <span>
                <b>{Math.round(head.pct)}%</b>
                <small>{cur ? '额度' : '峰值'}</small>
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="cy-empty">这段时间没有用量</div>
      )}

      <div className="cy-compare">
        {cur && prev && prev.tokens > 0 && (
          <span>
            上个窗口 {fmtTokens(prev.tokens, 1)} · {money(prev.cost)}，本窗口已到它的 <b className={cur.tokens > prev.tokens ? 'up' : ''}>{Math.round((cur.tokens / prev.tokens) * 100)}%</b>
          </span>
        )}
        {avg && (
          <span>
            平均每个 {fmtTokens(avg.tokens, 1)} · {money(avg.cost)}
            {most && ` · 最多 ${fmt(val(most))}（${kind === '5h' ? `${dayName(most.start, now)} ${hm(most.start)}` : `${md(most.start)} 起`}）`}
          </span>
        )}
      </div>

      {shown.length > 0 && (
        <div className="cy-chart" onMouseLeave={() => setHover(null)} style={{ ['--n' as string]: shown.length }}>
          {avg && <i className="cy-avg" style={{ bottom: `calc(var(--xh) + (100% - var(--xh) - var(--vh)) * ${(val(avg) / top).toFixed(4)})` }} />}
          {shown.map((c, i) => {
            const h = val(c) > 0 ? Math.max(0.015, val(c) / top) : 0
            const newDay = kind === '5h' && (i === 0 || dayOf(shown[i - 1].start) !== dayOf(c.start))
            const cls = ['cy-col', c.current && 'current', c === pick && 'on', c.estimated && 'est', ((c.pct ?? 0) >= 100 || c.hitAt) && 'hit', newDay && i > 0 && 'new-day'].filter(Boolean).join(' ')
            return (
              <button key={c.start} className={cls} onMouseEnter={() => setHover(c.start)} onFocus={() => setHover(c.start)} aria-label={`${range(c, now)} ${fmtTokens(c.tokens, 1)} ${money(c.cost)}`}>
                <span className="cy-bar">
                  <span className="cy-val">{val(c) > 0 ? fmt(val(c)) : ''}</span>
                  <i style={{ height: `calc((100% - var(--vh)) * ${h.toFixed(4)})`, animationDelay: `${i * 35}ms` }} />
                </span>
                <span className="cy-x">
                  {kind === '5h' ? hm(c.start) : md(c.start)}
                  <em>{kind === '5h' ? (newDay ? dayName(c.start, now) : '') : c.current ? '本周期' : ''}</em>
                </span>
              </button>
            )
          })}
        </div>
      )}

      {pick && (
        <div className="cy-detail">
          <span className="cy-d-range">
            {range(pick, now)}
            {pick.current && <span className="badge accent">进行中</span>}
            {((pick.pct ?? 0) >= 100 || pick.hitAt) && <span className="badge hot">触顶</span>}
            {pick.estimated && (
              <span className="badge" title="这个窗口的起止是按日志推算的（没有读到官方的重置时间）">
                推算
              </span>
            )}
          </span>
          <span className="cy-d-stats">
            <b>{fmtTokens(pick.tokens, 2)}</b> Token · <b>{money(pick.cost)}</b> · {pick.messages} 次响应 · {pick.sessions} 个会话
            {pick.pct !== null && ` · 额度${pick.current ? '' : '峰值'} ${Math.round(pick.pct)}%`}
            {per && ` · 每 1% ≈ ${fmtTokens(per.tokens, 1)}（${money(per.cost)}）`}
          </span>
          <span className="cy-d-mix">
            <span>
              构成 <Mix c={pick} />
            </span>
            {pick.models
              .filter((m) => pick.cost > 0 && m.cost / pick.cost >= 0.01)
              .map((m) => (
                <span key={m.name} className="cy-model">
                  {m.name} <b>{Math.round((m.cost / pick.cost) * 100)}%</b>
                </span>
              ))}
          </span>
        </div>
      )}
    </section>
  )
}

/** The open 5-hour and 7-day windows, and the ones before them, side by side */
export function CyclesCard() {
  const { quota, codexQuota, lastUpdate } = useApp()
  const source = useSource()
  const now = useNow(30_000)
  const data = useData<QuotaCycles[]>(() => window.api.getQuotaCycles(), [source, quota?.fetchedAt, codexQuota?.updatedAt, lastUpdate?.at], 60_000)
  const [tool, setTool] = useState<UsageSource>('claude')
  const [metric, setMetric] = useState<Metric>('tokens')
  const one = data?.find((d) => d.source === tool) ?? data?.[0] ?? null
  return (
    <div className={`card cycles-card${one ? ` src-${one.source}` : ''}`}>
      <div className="card-head">
        <div className="card-title">
          <span className="serif nowrap">额度窗口账单</span>
          <span className="muted" style={{ fontWeight: 400 }}>
            每个 5 小时、每个 7 天窗口各用了多少
          </span>
        </div>
        <div className="cy-controls">
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
          <Segmented
            small
            value={metric}
            onChange={setMetric}
            options={[
              { value: 'tokens', label: 'Token' },
              { value: 'cost', label: '金额' }
            ]}
          />
        </div>
      </div>
      {!data ? (
        <div className="skeleton" style={{ height: 300 }} />
      ) : !one || (!one.five.length && !one.seven.length) ? (
        <div className="quota-msg" style={{ minHeight: 200 }}>
          最近还没有用量
        </div>
      ) : (
        <div className="cy-grid">
          <Panel kind="5h" list={one.five} metric={metric} now={now} />
          <Panel kind="7d" list={one.seven} metric={metric} now={now} />
        </div>
      )}
    </div>
  )
}
