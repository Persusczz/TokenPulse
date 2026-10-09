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
/** "7.5", "12"; whole numbers without a decimal (measured shares are differences of whole readings) */
const p1 = (v: number) => (v >= 10 || Math.abs(v - Math.round(v)) < 0.05 ? Math.round(v).toString() : v.toFixed(1))
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : null
}

/** week: each 5-hour window's bite of the 7-day quota, and each week's own reading */
type Metric = 'tokens' | 'cost' | 'week'

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

function Panel({ kind, list, metric, now, weeks = [] }: { kind: '5h' | '7d'; list: QuotaCycle[]; metric: Metric; now: number; weeks?: QuotaCycle[] }) {
  const { money } = useApp()
  const [hover, setHover] = useState<number | null>(null)
  // a clicked bar takes over the numbers at the top until it is clicked again (or the open window is)
  const [sel, setSel] = useState<number | null>(null)
  const shown = list.slice(-SHOW[kind])
  const cur = list.find((c) => c.current) ?? null
  const closed = list.filter((c) => !c.current)
  const prev = closed[closed.length - 1] ?? null
  const chosen = sel !== null ? (list.find((c) => c.start === sel && !c.current) ?? null) : null
  const head = chosen ?? cur ?? prev
  // the closed window just before the chosen one
  const before = chosen ? (closed[closed.indexOf(chosen) - 1] ?? null) : null
  // in percent of the week: a 5-hour window's bite of it, a week's own reading
  const share = metric === 'week'
  const pctOf = (c: QuotaCycle) => (kind === '5h' ? (c.weekPct ?? null) : c.pct)
  const val = (c: QuotaCycle) => (metric === 'tokens' ? c.tokens : metric === 'cost' ? c.cost : (pctOf(c) ?? 0))
  const fmt = (v: number) => (metric === 'tokens' ? fmtTokens(v, 1) : metric === 'cost' ? money(v, v >= 100 ? 0 : undefined) : `${kind === '5h' ? p1(v) : Math.round(v)}%`)
  const counted = share ? closed.filter((c) => pctOf(c) !== null) : closed
  const mean = (f: (c: QuotaCycle) => number) => counted.reduce((a, c) => a + f(c), 0) / counted.length
  const avg = counted.length ? { tokens: mean((c) => c.tokens), cost: mean((c) => c.cost), v: mean(val) } : null
  const top = Math.max(...shown.map(val), avg?.v ?? 0) || 1
  const pick = shown.find((c) => c.start === hover) ?? chosen ?? cur ?? shown[shown.length - 1] ?? null
  const rank = chosen ? [...counted].sort((a, b) => val(b) - val(a)).indexOf(chosen) + 1 : 0
  const most = counted.length ? counted.reduce((a, c) => (val(c) > val(a) ? c : a)) : null
  const name = kind === '5h' ? '5 小时窗口' : '7 天窗口'
  const per = pick && pick.pct !== null && pick.pct >= 5 && pick.tokens > 0 ? { tokens: pick.tokens / pick.pct, cost: pick.cost / pick.pct } : null
  // the rule of thumb: a full 5-hour window is about this much of the week
  const full5 = list.filter((c) => c.pct !== null && c.pct >= 15 && !c.estimated && c.weekPct != null && !c.weekEst)
  const fullOf = full5.some((c) => c.weekMeasured) ? full5.filter((c) => c.weekMeasured) : full5
  const full = kind === '5h' ? median(fullOf.map((c) => (c.weekPct! / c.pct!) * 100)) : null
  const measuredN = kind === '5h' ? shown.filter((c) => c.weekMeasured).length : 0
  const weekOf = (t: number) => weeks.findIndex((w) => w.start <= t && t < w.end)
  const whenOf = (c: QuotaCycle) => (kind === '5h' ? `${dayName(c.start, now)} ${hm(c.start)}` : `${md(c.start)} 起`)
  const weekBite = (c: QuotaCycle) => (c.weekPct != null ? (c.weekMeasured ? `${p1(c.weekPct)}%（实测）` : `≈${p1(c.weekPct)}%（估算）`) : null)
  return (
    <section className={`cy-panel cy-${kind}`}>
      <header className="cy-head">
        <span className="cy-name">
          <i className="cy-glyph" aria-hidden />
          {name}
        </span>
        <span className="cy-when">
          {chosen ? (
            <>
              {range(chosen, now)} · 已结束
              <button className="cy-back" onClick={() => setSel(null)}>
                ↺ 回到{cur ? '当前窗口' : '最近'}
              </button>
            </>
          ) : cur ? (
            <>
              {range(cur, now)} · 还剩 <b>{left(cur.end - now)}</b>
            </>
          ) : (
            '现在没有打开的窗口'
          )}
        </span>
      </header>

      {head ? (
        <div className={`cy-now${chosen ? ' picked' : ''}`} key={head.start}>
          <div className="cy-num">
            <span className="cy-label">{chosen ? `${kind === '5h' ? `${dayName(chosen.start, now)} ${hm(chosen.start)} 起` : `${md(chosen.start)} 起`}的窗口` : cur ? '本窗口已用' : '上个窗口'}</span>
            <b className="serif">
              <AnimatedNumber value={head.tokens} format={tok} />
            </b>
            <small>Token</small>
          </div>
          {share && kind === '5h' ? (
            <div className="cy-num cost" title={head.weekMeasured ? '实测：窗口结束时的 7 天读数减去开始时的' : head.weekEst ? '估算：这周还没有可用的 7 天读数，按相邻一周的比例推算' : '估算：这个窗口开始或结束时没读到 7 天额度，按花费分这周剩下的读数'}>
              <span className="cy-label">占 7 天额度</span>
              <b className="serif">{head.weekPct != null ? <AnimatedNumber value={head.weekPct} format={(v) => `${head.weekMeasured ? '' : '≈'}${p1(v)}%`} /> : '—'}</b>
            </div>
          ) : (
            <div className="cy-num cost">
              <span className="cy-label">金额</span>
              <b className="serif">
                <AnimatedNumber value={head.cost} format={(v) => money(v)} />
              </b>
            </div>
          )}
          {head.pct !== null && (
            <div className={`cy-quota${head.pct >= 90 ? ' hot' : head.pct >= 75 ? ' warm' : ''}`} title={head.current ? '官方额度读数' : '这个窗口的最高读数'}>
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
                <small>{head.current ? '额度' : '峰值'}</small>
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="cy-empty">这段时间没有用量</div>
      )}

      <div className="cy-compare">
        {chosen && before && val(before) > 0 && (
          <span>
            前一个窗口 {share ? fmt(val(before)) : `${fmtTokens(before.tokens, 1)} · ${money(before.cost)}`}，这个是它的{' '}
            <b className={val(chosen) > val(before) ? 'up' : ''}>{Math.round((val(chosen) / val(before)) * 100)}%</b>
          </span>
        )}
        {chosen && avg && avg.v > 0 && rank > 0 && (
          <span>
            是平均的 <b className={val(chosen) > avg.v ? 'up' : ''}>{Math.round((val(chosen) / avg.v) * 100)}%</b> · 在 {counted.length} 个已结束的窗口里排第 {rank}
          </span>
        )}
        {!chosen && cur && prev && val(prev) > 0 && (
          <span>
            {share ? (
              <>
                上个窗口 {fmt(val(prev))}，本窗口已到 <b className={val(cur) > val(prev) ? 'up' : ''}>{fmt(val(cur))}</b>
              </>
            ) : (
              <>
                上个窗口 {fmtTokens(prev.tokens, 1)} · {money(prev.cost)}，本窗口已到它的 <b className={cur.tokens > prev.tokens ? 'up' : ''}>{Math.round((cur.tokens / prev.tokens) * 100)}%</b>
              </>
            )}
          </span>
        )}
        {!chosen && avg && (
          <span>
            {share && full !== null && (
              <>
                满窗口 ≈ <b>{p1(full)}%</b> ·{' '}
              </>
            )}
            {share ? `平均 ${fmt(avg.v)}` : `平均每个 ${fmtTokens(avg.tokens, 1)} · ${money(avg.cost)}`}
            {most && ` · 最多 ${fmt(val(most))}（${whenOf(most)}）`}
          </span>
        )}
        {share && !counted.length && (!cur || pctOf(cur) === null) && <span>还没有 7 天额度的读数，读到之后才能换算</span>}
        {share && kind === '5h' && shown.length > 0 && (
          <span title="实测：窗口结束时的 7 天读数减去开始时的。TokenPulse 没在运行、错过了窗口开始或结束的读数时，按花费估算">
            实测 {measuredN} 个 · 斜纹为估算
          </span>
        )}
      </div>

      {shown.length > 0 && (
        <div className="cy-chart" onMouseLeave={() => setHover(null)} style={{ ['--n' as string]: shown.length }}>
          {avg && <i className="cy-avg" style={{ bottom: `calc(var(--xh) + (100% - var(--xh) - var(--vh)) * ${(avg.v / top).toFixed(4)})` }} />}
          {shown.map((c, i) => {
            const h = val(c) > 0 ? Math.max(0.015, val(c) / top) : 0
            const newDay = kind === '5h' && (i === 0 || dayOf(shown[i - 1].start) !== dayOf(c.start))
            // a new 7-day window starts here
            const newWeek = share && kind === '5h' && i > 0 && weekOf(c.start) !== weekOf(shown[i - 1].start)
            const cls = ['cy-col', c.current && 'current', c === pick && 'on', c === head && 'sel', (share && kind === '5h' ? !c.weekMeasured : c.estimated) && 'est', ((c.pct ?? 0) >= 100 || c.hitAt) && 'hit', newDay && i > 0 && 'new-day', newWeek && 'new-week']
              .filter(Boolean)
              .join(' ')
            return (
              <button
                key={c.start}
                className={cls}
                onMouseEnter={() => setHover(c.start)}
                onFocus={() => setHover(c.start)}
                onClick={() => setSel(c.current || c.start === sel ? null : c.start)}
                aria-pressed={c === head}
                title={c.current ? '当前窗口' : c === chosen ? '再点一次回到当前窗口' : '点一下，在上面查看这个窗口'}
                aria-label={`${range(c, now)} ${fmtTokens(c.tokens, 1)} ${money(c.cost)}`}
              >
                <span className="cy-bar">
                  <span className="cy-val">{val(c) > 0 ? fmt(val(c)) : ''}</span>
                  <i style={{ height: `calc((100% - var(--vh)) * ${h.toFixed(4)})`, animationDelay: `${i * 35}ms` }} />
                </span>
                <span className="cy-x">
                  {kind === '5h' ? hm(c.start) : md(c.start)}
                  <em>{kind === '5h' ? (newWeek ? '新一周' : newDay ? dayName(c.start, now) : '') : c.current ? '本周期' : ''}</em>
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
            {kind === '5h' && weekBite(pick) && ` · 占 7 天 ${weekBite(pick)}`}
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
  const [want, setMetric] = useState<Metric>('tokens')
  const one = data?.find((d) => d.source === tool) ?? data?.[0] ?? null
  // the share of the week needs a weekly reading somewhere
  const weekly = !!one?.five.some((c) => c.weekPct != null)
  const metric: Metric = want === 'week' && !weekly ? 'tokens' : want
  return (
    <div className={`card cycles-card${one ? ` src-${one.source}` : ''}`}>
      <div className="card-head">
        <div className="card-title">
          <span className="serif nowrap">额度窗口账单</span>
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
              { value: 'cost', label: '金额' },
              ...(weekly ? [{ value: 'week' as const, label: '占 7 天' }] : [])
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
          <Panel kind="5h" list={one.five} metric={metric} now={now} weeks={one.seven} />
          <Panel kind="7d" list={one.seven} metric={metric} now={now} />
        </div>
      )}
    </div>
  )
}
