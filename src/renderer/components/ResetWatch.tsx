import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import type { CodexResetPost, CodexResets, CodexUsageState, QuotaCycle, ResetLang } from '@shared/types'
import { useApp, useData, useNow } from '../state'
import { Segmented } from './Segmented'

/**
 * Tibo (@thsottiaux) posts Codex limit resets on X. The card says where things
 * stand (hinted at, announced, just reset, or how long since the last one),
 * the last twelve weeks of resets over the user's weeks, and the post picked
 * there (the latest by default) with what it did to the user's own week.
 * Posts come from codex-resets.com, which asks for a link back, in the
 * language picked (the site's translations; 原文 = as posted).
 */

const HOUR = 3_600_000
const DAY = 24 * HOUR
const SPAN = 84 * DAY
const SITE = 'https://codex-resets.com'
const PROFILE = 'https://x.com/thsottiaux'

export const RESET_LANGS: { value: ResetLang; label: string }[] = [
  { value: 'en', label: '原文' },
  { value: 'zh-CN', label: '简体' },
  { value: 'zh-TW', label: '繁體' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' }
]

export const md = (t: number) => `${new Date(t).getMonth() + 1}/${new Date(t).getDate()}`
export const hm = (t: number) => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
export function ago(t: number, now: number): string {
  const d = Math.max(0, now - t)
  if (d < HOUR) return `${Math.max(1, Math.round(d / 60_000))} 分钟前`
  if (d < DAY) return `${Math.round(d / HOUR)} 小时前`
  return `${Math.round(d / DAY)} 天前`
}
const days = (ms: number) => (ms / DAY).toFixed(ms < 10 * DAY ? 1 : 0)
export const openLink = (url: string) => void window.api.openExternal(url)

const KIND = (p: CodexResetPost) => (p.observed ? '未发帖' : p.kind === 'banked' ? '存入重置' : '常规重置')

/** the tracker's state, kept current */
export function useCodexResets(): [CodexResets | null, (r: CodexResets) => void] {
  const [r, setR] = useState<CodexResets | null>(null)
  useEffect(() => {
    void window.api.getCodexResets().then(setR)
    return window.api.onCodexResets(setR)
  }, [])
  return [r, setR]
}

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

/**
 * Twelve weeks: the user's 7-day windows as bars by their peak, each reset a
 * dot above. Hovering a dot only labels it; a click picks it for the post
 * below (the strip sits above the post, so a longer or shorter post never
 * moves the dots out from under the pointer).
 */
function Strip({ r, weeks, now, pick, onPick }: { r: CodexResets; weeks: QuotaCycle[]; now: number; pick: string | null; onPick: (id: string | null) => void }) {
  const [tip, setTip] = useState<CodexResetPost | null>(null)
  const from = now - SPAN
  const pct = (t: number) => ((Math.max(from, Math.min(now, t)) - from) / SPAN) * 100
  const x = (t: number) => `${pct(t).toFixed(2)}%`
  const posts = r.history.filter((p) => p.at >= from && p.at <= now)
  const ticks = Array.from({ length: 7 }, (_, i) => from + (i * SPAN) / 6)
  return (
    <div className="rs-strip">
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
      <div className="rs-dots" onMouseLeave={() => setTip(null)}>
        {posts.map((p) => (
          <button
            key={p.id}
            className={`rs-dot ${p.kind}${p.observed ? ' observed' : ''}${pick === p.id ? ' on' : ''}${p.id === r.latest?.id ? ' latest' : ''}`}
            style={{ left: x(p.at) }}
            onMouseEnter={() => setTip(p)}
            onFocus={() => setTip(p)}
            onBlur={() => setTip(null)}
            onClick={() => onPick(pick === p.id ? null : p.id)}
            aria-pressed={pick === p.id}
            aria-label={`${md(p.at)} ${hm(p.at)} ${KIND(p)}`}
          />
        ))}
        {r.hint && r.hint.until > now && <i className="rs-dot-hint" style={{ left: x(now) }} />}
        <AnimatePresence>
          {tip && (
            <motion.div
              key={tip.id}
              // near either end it hangs inwards from the dot, so the card's edge never cuts it
              className={`rs-tip ${pct(tip.at) < 22 ? 'l' : pct(tip.at) > 78 ? 'r' : 'c'}`}
              style={{ left: x(tip.at) }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.14 }}
            >
              <b>
                {md(tip.at)} {hm(tip.at)}
              </b>{' '}
              · {KIND(tip)}
              <span>{pick === tip.id ? '再点一下回到最新' : '点一下查看'}</span>
            </motion.div>
          )}
        </AnimatePresence>
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
  const { lastUpdate, settings, saveSettings } = useApp()
  const now = useNow(30_000)
  const [r, setR] = useCodexResets()
  const [usage, setUsage] = useState<CodexUsageState | null>(null)
  const [busy, setBusy] = useState(false)
  const [pick, setPick] = useState<string | null>(null)
  const [orig, setOrig] = useState(false)
  const cycles = useData(() => window.api.getQuotaCycles(), [Math.floor((lastUpdate?.at ?? 0) / 600_000)], 600_000)
  const weeks = cycles?.find((c) => c.source === 'codex')?.seven ?? []
  useEffect(() => {
    void window.api.codexUsageState().then(setUsage)
    return window.api.onCodexUsage(setUsage)
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
  const lang = settings?.codexResetLang ?? r.lang
  // the site's translation, unless the original was asked for; untranslated posts stay as written
  const textOf = (id: string, text: string) => {
    const local = r.lang !== 'en' ? r.local?.[id] : undefined
    return { text: local && !orig ? local : text, other: local ? (orig ? '看译文' : '看原文') : null }
  }
  const shown = hintText ? textOf('hint', hintText.text) : post ? textOf(post.id, post.text) : null

  return (
    <div className={`card resets-card rs-${v.tone}`}>
      <div className="card-head">
        <div className="card-title">
          <span className="serif">Tibo 重置播报</span>
          <button className="rs-handle" onClick={() => openLink(PROFILE)}>
            @thsottiaux
          </button>
        </div>
        <div className="rs-tools">
          <Segmented small value={lang} onChange={(codexResetLang) => void saveSettings({ codexResetLang })} options={RESET_LANGS} />
          <button className="btn small" disabled={busy} onClick={() => void refresh()}>
            {busy ? '读取中…' : '刷新'}
          </button>
        </div>
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

          <Strip r={r} weeks={weeks} now={now} pick={pick} onPick={setPick} />

          {hintText ? (
            <div className="rs-post hint">
              <div className="rs-post-head">
                <span className="badge accent">暗示</span>
                <span className="muted">{ago(hintText.at, now)}</span>
                <span className="rs-acts">
                  {shown?.other && (
                    <button className="rs-link rs-swap" onClick={() => setOrig((o) => !o)}>
                      {shown.other}
                    </button>
                  )}
                  {hintText.url && (
                    <button className="rs-link" onClick={() => openLink(hintText.url!)}>
                      在 X 上看原帖 ↗
                    </button>
                  )}
                </span>
              </div>
              <p className="rs-text">{shown?.text}</p>
            </div>
          ) : (
            post && (
              <motion.div key={post.id} className="rs-post" initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
                <div className="rs-post-head">
                  <span className={`badge${post.kind === 'banked' ? '' : ' accent'}`}>{r.scheduled?.id === post.id ? '已预告' : KIND(post)}</span>
                  <span className="muted">
                    {md(post.at)} {hm(post.at)} · {ago(post.at, now)}
                  </span>
                  <span className="rs-acts">
                    {pick && (
                      <button className="rs-link rs-swap" onClick={() => setPick(null)}>
                        ← 回到最新
                      </button>
                    )}
                    {shown?.other && (
                      <button className="rs-link rs-swap" onClick={() => setOrig((o) => !o)}>
                        {shown.other}
                      </button>
                    )}
                    {post.url && (
                      <button className="rs-link" onClick={() => openLink(post.url!)}>
                        在 X 上看原帖 ↗
                      </button>
                    )}
                  </span>
                </div>
                <p className="rs-text">{shown?.text}</p>
                <Mine r={r} post={post} credits={post.id === r.latest?.id || post.kind === 'banked' ? credits : null} now={now} />
              </motion.div>
            )
          )}
        </>
      )}
      <div className="rs-foot">
        <span>
          数据来自{' '}
          <button className="rs-link" onClick={() => openLink(SITE)}>
            Codex Resets
          </button>
          {r.lang !== 'en' && !orig ? '，译文由该站提供' : ''}
        </span>
        {r.status === 'error' && !empty ? <span className="bad-text">{r.error}</span> : r.at ? <span>{ago(r.at, now)}更新</span> : null}
      </div>
    </div>
  )
}
