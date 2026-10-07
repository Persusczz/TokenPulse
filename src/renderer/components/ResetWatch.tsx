import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import type { CodexResetPost, CodexResets, CodexUsageState, QuotaCycle } from '@shared/types'
import { useApp, useData, useNow } from '../state'

/**
 * Tibo (@thsottiaux) posts Codex limit resets on X. The card says where things
 * stand (hinted at, announced, just reset, or how long since the last one),
 * the post itself, what it did to the user's own week, and the last twelve
 * weeks of resets over the user's weeks. Posts come from codex-resets.com,
 * which asks for a link back.
 */

const HOUR = 3_600_000
const DAY = 24 * HOUR
const SPAN = 84 * DAY
const SITE = 'https://codex-resets.com'
const PROFILE = 'https://x.com/thsottiaux'

const md = (t: number) => `${new Date(t).getMonth() + 1}/${new Date(t).getDate()}`
const hm = (t: number) => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
function ago(t: number, now: number): string {
  const d = Math.max(0, now - t)
  if (d < HOUR) return `${Math.max(1, Math.round(d / 60_000))} 分钟前`
  if (d < DAY) return `${Math.round(d / HOUR)} 小时前`
  return `${Math.round(d / DAY)} 天前`
}
const days = (ms: number) => (ms / DAY).toFixed(ms < 10 * DAY ? 1 : 0)
const open = (url: string) => void window.api.openExternal(url)

const KIND = (p: CodexResetPost) => (p.observed ? '未发帖' : p.kind === 'banked' ? '存入重置' : '常规重置')

type Tone = 'hint' | 'due' | 'fresh' | 'calm'

/** the headline: the strongest sign first */
function verdict(r: CodexResets, now: number): { tone: Tone; title: string; sub: string } {
  if (r.scheduled) return { tone: 'due', title: '已宣布重置，等待生效', sub: r.scheduled.due ? `预计 ${md(r.scheduled.due)} ${hm(r.scheduled.due)}` : `${ago(r.scheduled.at, now)}宣布` }
  if (r.hint && r.hint.until > now)
    return {
      tone: 'hint',
      title: r.hint.level === 'strong' ? 'Tibo 在强烈暗示重置' : 'Tibo 在暗示重置',
      sub: [r.hint.chance !== null ? `可能性 ${r.hint.chance}%` : '', r.hint.window].filter(Boolean).join(' · ')
    }
  const last = r.latest
  const month = r.history.filter((p) => now - p.at < 30 * DAY).length
  const count = [r.stats ? `共 ${r.stats.total} 次` : '', `近 30 天 ${month} 次`].filter(Boolean).join(' · ')
  if (last && now - last.at < DAY) return { tone: 'fresh', title: last.kind === 'banked' ? '刚往账户存入一次重置' : '刚刚重置', sub: count }
  return { tone: 'calm', title: last ? `已 ${days(now - last.at)} 天没有重置` : '还没有重置记录', sub: count }
}

function Mine({ r, post, credits, now }: { r: CodexResets; post: CodexResetPost; credits: number | null; now: number }) {
  const e = post.kind === 'regular' ? r.effects?.[post.id] : undefined
  const before = e?.before != null ? `重置前用到 ${Math.round(e.before)}%` : ''
  let line: { text: string; cls: string } | null = null
  if (e?.restarted) line = { text: [before, '7 天额度已从头开始'].filter(Boolean).join('，'), cls: 'ok' }
  else if (e && e.checked) line = { text: [before, now - post.at < 6 * HOUR ? '还没到你的账户' : '你的 7 天窗口没有重新开始'].filter(Boolean).join('，'), cls: 'warn' }
  else if (e) line = { text: [before, '等新的额度读数'].filter(Boolean).join(' · '), cls: '' }
  if (!line && !(credits && credits > 0)) return null
  return (
    <div className="rs-mine">
      <span className="rs-mine-label">你的账户</span>
      {line && (
        <span className={`rs-mine-line ${line.cls}`}>
          {line.cls === 'ok' && <i className="rs-check">✓</i>}
          {line.text}
        </span>
      )}
      {!!credits && credits > 0 && <span className="badge accent">存着 {credits} 次重置</span>}
    </div>
  )
}

/** twelve weeks: the user's 7-day windows as bars by their peak, each reset a dot above */
function Strip({ r, weeks, now, pick, onPick }: { r: CodexResets; weeks: QuotaCycle[]; now: number; pick: string | null; onPick: (id: string | null) => void }) {
  const from = now - SPAN
  const x = (t: number) => `${(((Math.max(from, Math.min(now, t)) - from) / SPAN) * 100).toFixed(2)}%`
  const posts = r.history.filter((p) => p.at >= from && p.at <= now)
  const ticks = Array.from({ length: 7 }, (_, i) => from + (i * SPAN) / 6)
  return (
    <div className="rs-strip" onMouseLeave={() => onPick(null)}>
      <div className="rs-weeks">
        {weeks
          .filter((w) => w.end > from)
          .map((w) => (
            <i
              key={w.start}
              className={`rs-week${w.pct === null ? ' none' : ''}${w.current ? ' now' : ''}`}
              style={{ left: x(w.start), width: `calc(${x(w.end)} - ${x(w.start)} - 2px)`, height: w.pct === null ? undefined : `${Math.max(6, Math.min(100, w.pct))}%` }}
              title={`${md(w.start)} – ${md(w.end)}${w.pct !== null ? ` · 7 天额度最高 ${Math.round(w.pct)}%` : ''}`}
            />
          ))}
      </div>
      <div className="rs-dots">
        {posts.map((p) => (
          <button
            key={p.id}
            className={`rs-dot ${p.kind}${p.observed ? ' observed' : ''}${pick === p.id ? ' on' : ''}${p.id === r.latest?.id ? ' latest' : ''}`}
            style={{ left: x(p.at) }}
            onMouseEnter={() => onPick(p.id)}
            onClick={() => p.url && open(p.url)}
            aria-label={`${md(p.at)} ${KIND(p)}`}
          />
        ))}
        {r.hint && r.hint.until > now && <i className="rs-dot-hint" style={{ left: x(now) }} />}
      </div>
      <div className="rs-axis">
        {ticks.map((t, i) => (
          <span key={i} style={{ left: x(t) }}>
            {i === 6 ? '今天' : md(t)}
          </span>
        ))}
      </div>
    </div>
  )
}

export function ResetWatchCard() {
  const { lastUpdate } = useApp()
  const now = useNow(30_000)
  const [r, setR] = useState<CodexResets | null>(null)
  const [usage, setUsage] = useState<CodexUsageState | null>(null)
  const [busy, setBusy] = useState(false)
  const [pick, setPick] = useState<string | null>(null)
  const cycles = useData(() => window.api.getQuotaCycles(), [Math.floor((lastUpdate?.at ?? 0) / 600_000)], 600_000)
  const weeks = cycles?.find((c) => c.source === 'codex')?.seven ?? []
  useEffect(() => {
    void window.api.getCodexResets().then(setR)
    void window.api.codexUsageState().then(setUsage)
    const offs = [window.api.onCodexResets(setR), window.api.onCodexUsage(setUsage)]
    return () => offs.forEach((off) => off())
  }, [])
  const refresh = async () => {
    setBusy(true)
    setR(await window.api.refreshCodexResets())
    setBusy(false)
  }
  if (!r || r.status === 'off') return null
  const empty = !r.latest && !r.history.length
  const v = verdict(r, now)
  const post = (pick && r.history.find((p) => p.id === pick)) || (r.scheduled ?? r.latest)
  const hintText = !pick && v.tone === 'hint' ? r.hint : null
  const since = r.latest ? now - r.latest.at : 0
  const avg = (r.stats?.avgDays ?? 0) * DAY
  const credits = usage?.status === 'ok' ? (usage.resetCredits ?? null) : null

  return (
    <div className={`card resets-card rs-${v.tone}`}>
      <div className="card-head">
        <div className="card-title">
          <span className="serif">Tibo 重置播报</span>
          <button className="rs-handle" onClick={() => open(PROFILE)}>
            @thsottiaux
          </button>
        </div>
        <button className="btn small" disabled={busy} onClick={() => void refresh()}>
          {busy ? '读取中…' : '刷新'}
        </button>
      </div>
      {empty ? (
        r.status === 'error' ? (
          <div className="rs-empty">{r.error}</div>
        ) : (
          <div className="skeleton" style={{ height: 180 }} />
        )
      ) : (
        <>
          <div className="rs-top">
            <div className="rs-state">
              <span className="rs-radar" aria-hidden>
                <i />
                <i />
                <b />
              </span>
              <div style={{ minWidth: 0 }}>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={v.title} className="rs-verdict serif" initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }}>
                    {v.title}
                  </motion.div>
                </AnimatePresence>
                {v.sub && <div className="rs-sub">{v.sub}</div>}
              </div>
            </div>
            {r.latest && avg > 0 && (
              <div className="rs-gauge">
                <div className="rs-gauge-nums">
                  <span>
                    距上次 <b>{days(since)}</b> 天
                  </span>
                  <span>
                    平均 <b>{(avg / DAY).toFixed(1)}</b> 天
                  </span>
                </div>
                <div className={`rs-track${since > avg ? ' over' : ''}`}>
                  <motion.i initial={{ width: 0 }} animate={{ width: `${Math.min(100, (since / (avg * 2)) * 100)}%` }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }} />
                  <span className="rs-avg" />
                </div>
              </div>
            )}
          </div>

          {hintText ? (
            <div className="rs-post hint">
              <div className="rs-post-head">
                <span className="badge accent">暗示</span>
                <span className="muted">{ago(hintText.at, now)}</span>
                {hintText.url && (
                  <button className="rs-link" onClick={() => open(hintText.url!)}>
                    在 X 上看原帖 ↗
                  </button>
                )}
              </div>
              <p className="rs-text">{hintText.text}</p>
            </div>
          ) : (
            post && (
              <div className="rs-post">
                <div className="rs-post-head">
                  <span className={`badge${post.kind === 'banked' ? '' : ' accent'}`}>{r.scheduled?.id === post.id ? '已预告' : KIND(post)}</span>
                  <span className="muted">
                    {md(post.at)} {hm(post.at)} · {ago(post.at, now)}
                  </span>
                  {post.url && (
                    <button className="rs-link" onClick={() => open(post.url!)}>
                      在 X 上看原帖 ↗
                    </button>
                  )}
                </div>
                <p className="rs-text">{post.text}</p>
                <Mine r={r} post={post} credits={post.id === r.latest?.id || post.kind === 'banked' ? credits : null} now={now} />
              </div>
            )
          )}

          <Strip r={r} weeks={weeks} now={now} pick={pick} onPick={setPick} />
        </>
      )}
      <div className="rs-foot">
        <span>
          数据来自{' '}
          <button className="rs-link" onClick={() => open(SITE)}>
            Codex Resets
          </button>
        </span>
        {r.status === 'error' && !empty ? <span className="bad-text">{r.error}</span> : r.at ? <span>{ago(r.at, now)}更新</span> : null}
      </div>
    </div>
  )
}
