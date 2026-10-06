import { useMemo, useState } from 'react'
import { fmtTokens } from '@shared/format'
import type { CalendarDay, ModelRow, RangeKey, SessionSpan } from '@shared/types'
import { useApp, useData, useNow, useSource } from '../state'
import { Segmented } from './Segmented'
import { openSession } from './UsageInsights'

/** Three overview cards: the 12-week calendar, today's sessions as a timeline, and the models side by side */

const WEEK = ['一', '二', '三', '四', '五', '六', '日']
const hm = (t: number) => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
const md = (t: number) => `${new Date(t).getMonth() + 1}/${new Date(t).getDate()}`
const dur = (ms: number) => {
  const m = Math.round(ms / 60_000)
  return m < 1 ? '不到 1 分钟' : m < 60 ? `${m} 分钟` : `${Math.floor(m / 60)} 小时 ${m % 60} 分`
}
const RANGE_NAME: Record<RangeKey, string> = { today: '今日', '7d': '7 天', '30d': '30 天', month: '本月', all: '全部' }

// ---------------------------------------------------------------- calendar

/** the last 12 weeks, one cell a day, as deep as the day's use; hover or click a day for its numbers */
export function CalendarCard() {
  const { money, lastUpdate } = useApp()
  const source = useSource()
  const days = useData(() => window.api.getCalendar(), [source, Math.floor((lastUpdate?.at ?? 0) / 300_000)], 5 * 60_000)
  const [metric, setMetric] = useState<'tokens' | 'cost'>('tokens')
  const [pick, setPick] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const list = days ?? []
  const val = (d: CalendarDay) => (metric === 'tokens' ? d.tokens : d.cost)
  // five shades by quantile of the days that had use
  const cuts = useMemo(() => {
    const v = list.map(val).filter((x) => x > 0).sort((a, b) => a - b)
    return [0.2, 0.4, 0.6, 0.8].map((q) => v[Math.floor(q * (v.length - 1))] ?? 0)
  }, [list, metric]) // eslint-disable-line react-hooks/exhaustive-deps
  const level = (d: CalendarDay) => (val(d) <= 0 ? 0 : 1 + cuts.filter((c) => val(d) > c).length)
  const today = list[list.length - 1]
  const shown = list.find((d) => d.t === (hover ?? pick)) ?? today
  const used = list.filter((d) => d.tokens > 0)
  let best = 0
  let run = 0
  for (const d of list) {
    run = d.tokens > 0 ? run + 1 : 0
    best = Math.max(best, run)
  }
  const peak = used.reduce<CalendarDay | null>((a, d) => (!a || val(d) > val(a) ? d : a), null)
  // columns are weeks; month names where a month starts
  const weeks = Math.ceil(list.length / 7)
  const months = Array.from({ length: weeks }, (_, w) => {
    const d = list[w * 7]
    const prev = w ? list[(w - 1) * 7] : null
    return d && (!prev || new Date(d.t).getMonth() !== new Date(prev.t).getMonth()) ? `${new Date(d.t).getMonth() + 1} 月` : ''
  })
  return (
    <div className="card calendar-card">
      <div className="card-head">
        <div className="card-title">
          <span className="serif">日历</span>
          <span className="muted" style={{ fontWeight: 400 }}>
            最近 12 周，每格一天，颜色越深用得越多
          </span>
        </div>
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
      {!days ? (
        <div className="skeleton" style={{ height: 180 }} />
      ) : (
        <div className="cal-body">
          <div className="cal-grid-wrap">
            <div className="cal-months" style={{ gridTemplateColumns: `repeat(${weeks}, var(--cal-cell))` }}>
              {months.map((m, i) => (
                <span key={i}>{m}</span>
              ))}
            </div>
            <div className="cal-rows">
              <div className="cal-week">
                {WEEK.map((w, i) => (
                  <span key={w}>{i % 2 ? '' : w}</span>
                ))}
              </div>
              <div className="cal-grid" style={{ gridTemplateColumns: `repeat(${weeks}, var(--cal-cell))` }} onMouseLeave={() => setHover(null)}>
                {list.map((d, i) => (
                  <button
                    key={d.t}
                    className={`cal-cell l${level(d)}${d === today ? ' today' : ''}${d.t === (pick ?? today?.t) ? ' on' : ''}`}
                    style={{ gridColumn: Math.floor(i / 7) + 1, gridRow: (i % 7) + 1 }}
                    onMouseEnter={() => setHover(d.t)}
                    onClick={() => setPick(d.t === pick ? null : d.t)}
                    aria-label={`${md(d.t)} ${fmtTokens(d.tokens, 1)} ${money(d.cost)}`}
                  />
                ))}
              </div>
            </div>
            <div className="cal-legend">
              少
              {[0, 1, 2, 3, 4, 5].map((l) => (
                <i key={l} className={`cal-cell l${l}`} />
              ))}
              多
            </div>
          </div>
          <div className="cal-day">
            {shown && (
              <>
                <div className="cal-day-head">
                  <b className="serif">
                    {md(shown.t)} 周{WEEK[(new Date(shown.t).getDay() + 6) % 7]}
                  </b>
                  {shown === today && <span className="badge accent">今天</span>}
                </div>
                {shown.tokens > 0 ? (
                  <>
                    <div className="cal-day-nums">
                      <span>
                        <b>{fmtTokens(shown.tokens, 1)}</b> Token
                      </span>
                      <span>
                        <b>{money(shown.cost)}</b>
                      </span>
                      <span>
                        {shown.messages} 次响应 · {shown.sessions} 个会话
                      </span>
                    </div>
                    <div className="cal-day-row">
                      {shown.first && shown.last && `${hm(shown.first)} – ${hm(shown.last)}`}
                      {shown.busiest !== null && ` · 最忙 ${shown.busiest}:00`}
                    </div>
                    <div className="cal-day-row">
                      模型：
                      {shown.models.map((m) => m.name).join('、')}
                    </div>
                    <div className="cal-day-row">
                      项目：
                      {shown.projects.map((p) => `${p.name} ${fmtTokens(p.tokens, 1)}`).join('、')}
                    </div>
                  </>
                ) : (
                  <div className="muted">这天没有用量</div>
                )}
              </>
            )}
            <div className="cal-sum">
              12 周里用了 <b>{used.length}</b> 天 · 最长连续 <b>{best}</b> 天{peak && <> · 最多的一天 {md(peak.t)}</>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- today's sessions

const BIN = 10 * 60_000

/** today's sessions as bars from their first to their last response, lit where they used the most */
export function TimelineCard() {
  const { money, lastUpdate } = useApp()
  const source = useSource()
  const now = useNow(60_000)
  const list = useData(() => window.api.getTimeline(), [source, lastUpdate?.at], 60_000)
  const [tip, setTip] = useState<{ s: SessionSpan; x: number; y: number } | null>(null)
  const spans = list ?? []
  const from = spans.length ? Math.floor(Math.min(...spans.map((s) => s.start)) / 3_600_000) * 3_600_000 : now - 3_600_000
  const to = Math.max(now, ...spans.map((s) => s.end))
  const x = (t: number) => ((t - from) / Math.max(1, to - from)) * 100
  const maxBin = Math.max(1, ...spans.flatMap((s) => s.bins))
  const shown = spans.length > 24 ? [...spans].sort((a, b) => b.tokens - a.tokens).slice(0, 24).sort((a, b) => a.start - b.start) : spans
  // how many were open in each 10 minutes
  const steps = Math.max(1, Math.ceil((to - from) / BIN))
  const open = Array.from({ length: steps }, (_, i) => {
    const t = from + i * BIN
    return spans.filter((s) => s.start < t + BIN && s.end >= t).length
  })
  const most = Math.max(0, ...open)
  const hours: number[] = []
  for (let t = from; t <= to; t += 3_600_000) hours.push(t)
  const every = hours.length > 14 ? 3 : hours.length > 8 ? 2 : 1
  return (
    <div className="card timeline-card" onMouseLeave={() => setTip(null)}>
      <div className="card-head">
        <div className="card-title">
          <span className="serif">今天的会话</span>
          <span className="muted" style={{ fontWeight: 400 }}>
            每条是一个会话，从第一次到最后一次响应；越亮的地方那十分钟用得越多
          </span>
        </div>
        {spans.length > 0 && (
          <span className="muted" style={{ fontSize: 12 }}>
            {spans.length} 个会话 · 最多同时 {most} 个
          </span>
        )}
      </div>
      {!list ? (
        <div className="skeleton" style={{ height: 160 }} />
      ) : !spans.length ? (
        <div className="quota-msg" style={{ minHeight: 110 }}>
          今天还没有会话
        </div>
      ) : (
        <div className="tl-body">
          <div className="tl-row tl-open">
            <span className="tl-label">同时开着</span>
            <span className="tl-track">
              {open.map((n, i) =>
                n ? <i key={i} className="tl-open-bar" style={{ left: `${x(from + i * BIN)}%`, width: `${(BIN / (to - from)) * 100}%`, height: `${(n / Math.max(1, most)) * 100}%` }} /> : null
              )}
            </span>
          </div>
          {shown.map((s) => (
            <div
              key={s.id}
              className={`tl-row src-${s.source}`}
              onMouseMove={(e) => {
                const r = (e.currentTarget.closest('.timeline-card') as HTMLElement).getBoundingClientRect()
                setTip({ s, x: e.clientX - r.left, y: e.clientY - r.top })
              }}
              onClick={() => openSession(s.id)}
            >
              <span className="tl-label" title={s.project}>
                {s.project}
              </span>
              <span className="tl-track">
                <span className="tl-bar" style={{ left: `${x(s.start)}%`, width: `max(4px, ${x(s.end + 60_000) - x(s.start)}%)` }}>
                  {s.bins.map((v, i) => (v > 0 ? <i key={i} style={{ left: `${((i * BIN) / Math.max(BIN, s.end + 60_000 - s.start)) * 100}%`, width: `${(BIN / Math.max(BIN, s.end + 60_000 - s.start)) * 100}%`, opacity: 0.25 + 0.75 * Math.sqrt(v / maxBin) }} /> : null))}
                </span>
              </span>
            </div>
          ))}
          {spans.length > shown.length && <div className="tl-more">另外 {spans.length - shown.length} 个用量很小的会话没有画出来</div>}
          <div className="tl-row tl-axis">
            <span className="tl-label" />
            <span className="tl-track">
              {hours.map((t, i) =>
                // the "now" label has the last few minutes to itself
                i % every === 0 && Math.abs(x(t) - x(now)) > 4 ? (
                  <em key={t} style={{ left: `${x(t)}%` }}>
                    {new Date(t).getHours()}:00
                  </em>
                ) : null
              )}
              <b className="tl-now" style={{ left: `${x(now)}%` }}>
                现在
              </b>
            </span>
          </div>
          <i className="tl-now-line" style={{ left: `calc(var(--tl-label) + (100% - var(--tl-label)) * ${x(now) / 100})` }} />
        </div>
      )}
      {tip && (
        <div className="tip tl-tip" style={{ left: tip.x, top: tip.y }}>
          <div className="tip-title">{tip.s.project}</div>
          <div className="tip-row">
            时间<b>
              {hm(tip.s.start)}–{hm(tip.s.end)}（{dur(tip.s.end - tip.s.start)}）
            </b>
          </div>
          <div className="tip-row">
            模型<b>{tip.s.model}</b>
          </div>
          <div className="tip-row">
            用量<b>
              {fmtTokens(tip.s.tokens, 1)} · {money(tip.s.cost)}
            </b>
          </div>
          <div className="tip-row">
            响应<b>{tip.s.messages} 次</b>
          </div>
          <div className="tip-row muted">点一下打开这个会话</div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- models

type SortKey = 'cost' | 'tokens' | 'perM' | 'perPrompt' | 'hit'

/** the models of the range side by side: what each cost, per million tokens and per question */
export function ModelTableCard({ range }: { range: RangeKey }) {
  const { money, lastUpdate } = useApp()
  const source = useSource()
  const rows = useData(() => window.api.getModelRows(range), [range, source, Math.floor((lastUpdate?.at ?? 0) / 60_000)], 60_000)
  const [sort, setSort] = useState<SortKey>('cost')
  const list = rows ?? []
  const total = list.reduce((a, r) => a + r.cost, 0) || 1
  const totalTokens = list.reduce((a, r) => a + r.tokens, 0) || 1
  const perM = (r: ModelRow) => (r.tokens ? (r.cost / r.tokens) * 1e6 : 0)
  const perPrompt = (r: ModelRow) => (r.prompts ? r.promptCost / r.prompts : 0)
  const hit = (r: ModelRow) => {
    const read = r.input + r.cacheRead + r.cacheWrite
    return read ? r.cacheRead / read : 0
  }
  const key: Record<SortKey, (r: ModelRow) => number> = { cost: (r) => r.cost, tokens: (r) => r.tokens, perM, perPrompt, hit }
  const sorted = [...list].sort((a, b) => key[sort](b) - key[sort](a))
  // the cheapest per million among models with a real share
  const real = list.filter((r) => r.tokens / totalTokens >= 0.05 && r.cost > 0)
  const cheap = real.length > 1 ? real.reduce((a, r) => (perM(r) < perM(a) ? r : a)) : null
  const head = (k: SortKey, label: string) => (
    <th className={`num${sort === k ? ' on' : ''}`} onClick={() => setSort(k)}>
      {label}
      {sort === k ? ' ↓' : ''}
    </th>
  )
  return (
    <div className="card model-table-card">
      <div className="card-head">
        <div className="card-title">
          <span className="serif">模型对比</span>
          <span className="muted" style={{ fontWeight: 400 }}>
            {RANGE_NAME[range]} · 点表头排序
          </span>
        </div>
      </div>
      {!rows ? (
        <div className="skeleton" style={{ height: 160 }} />
      ) : !list.length ? (
        <div className="quota-msg" style={{ minHeight: 100 }}>
          这段时间没有用量
        </div>
      ) : (
        <div className="mt-wrap">
          <table className="mt">
            <thead>
              <tr>
                <th>模型</th>
                {head('cost', '花费')}
                {head('tokens', 'Token')}
                {head('perM', '每百万 Token')}
                {head('perPrompt', '每次提问')}
                {head('hit', '缓存命中')}
                <th className="num">输出占比</th>
                <th className="num">响应</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.name} className={`src-${r.source}`}>
                  <td>
                    <span className="mt-name">
                      <i className="mt-dot" />
                      {r.name}
                      {source === 'all' && <span className="mt-src">{r.source === 'codex' ? 'Codex' : 'Claude'}</span>}
                      {r === cheap && <span className="badge good">最划算</span>}
                    </span>
                  </td>
                  <td className="num">
                    <span className="mt-bar">
                      <i style={{ width: `${(r.cost / total) * 100}%` }} />
                    </span>
                    {money(r.cost)}
                  </td>
                  <td className="num">{fmtTokens(r.tokens, 1)}</td>
                  <td className="num">{r.cost > 0 ? money(perM(r)) : '—'}</td>
                  <td className="num">{r.prompts ? `${money(perPrompt(r))} · ${r.prompts} 次` : '—'}</td>
                  <td className="num">{(hit(r) * 100).toFixed(1)}%</td>
                  <td className="num">{r.tokens ? `${((r.output / r.tokens) * 100).toFixed(1)}%` : '—'}</td>
                  <td className="num">{r.messages}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
