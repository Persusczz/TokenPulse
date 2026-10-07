import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import type { ChallengeDay, ChallengeEntry, TiboChallenge } from '@shared/types'
import { useNow } from '../state'
import { hm, openLink, useCodexResets } from './ResetWatch'

/**
 * Tibo's 28-day challenge: "each day we'll either ship one thing that is a
 * clear improvement … or ship a full reset". A month on a calendar, each day
 * an improvement, a reset, or still ahead, with what was shipped on the day
 * picked and how the site's visitors voted on it. Days follow Tibo's clock
 * (Pacific time), as the site counts them.
 */

const DAY = 86_400_000
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const pacific = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' })
const pacificTime = new Intl.DateTimeFormat('zh-CN', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hour12: false })

/** the challenge day it is for Tibo: 0 before the first, past the last once over */
export function challengeDay(c: TiboChallenge, now: number): number {
  return Math.round((Date.parse(pacific.format(now)) - Date.parse(c.start)) / DAY) + 1
}

const dateOf = (d: ChallengeDay) => {
  const t = new Date(`${d.date}T00:00:00Z`)
  return `${t.getUTCMonth() + 1}/${t.getUTCDate()} 周${WEEKDAYS[t.getUTCDay()]}`
}
/** YYYY-MM-DD as 10/5 */
const mdOf = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`
const KIND = { reset: '重置', improvement: '产品改进' } as const
const n = (v: number) => v.toLocaleString('en-US')

function Votes({ e }: { e: ChallengeEntry }) {
  if (e.up === null || e.down === null) return null
  const total = e.up + e.down
  const share = total ? (e.up / total) * 100 : 50
  return (
    <div className="ch-votes" title={`codex-resets.com 上的投票：👏 ${n(e.up)} · 🤷 ${n(e.down)}`}>
      <span>👏 {n(e.up)}</span>
      <span className="ch-vote-bar">
        <motion.i initial={{ width: '50%' }} animate={{ width: `${share}%` }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }} />
      </span>
      <span>🤷 {n(e.down)}</span>
    </div>
  )
}

function Detail({ c, d, today, now }: { c: TiboChallenge; d: ChallengeDay; today: number; now: number }) {
  const empty =
    d.day > today
      ? `第 ${d.day} 天还没到`
      : d.day === today
        ? `今天还没有动静（Tibo 那边现在 ${pacificTime.format(now)}）`
        : d.state === 'missed'
          ? '这一天没有改进，也没有重置'
          : '这一天没有记录'
  return (
    <motion.div key={`${c.start}-${d.day}`} className="ch-detail" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
      <div className="ch-detail-head">
        <b className="serif">第 {String(d.day).padStart(2, '0')} 天</b>
        <span className="muted">{dateOf(d)}</span>
        {(d.state === 'reset' || d.state === 'improvement') && <span className={`badge ${d.state === 'reset' ? 'accent' : 'good'}`}>{KIND[d.state]}</span>}
      </div>
      {d.entries.length ? (
        <ul className="ch-entries">
          {d.entries.map((e) => (
            <li key={e.id} className={`ch-entry ${e.kind}`}>
              <div className="ch-entry-head">
                <i className="ch-kind" aria-hidden>
                  {e.kind === 'reset' ? '↺' : '✦'}
                </i>
                {e.url ? (
                  <button className="ch-title" onClick={() => openLink(e.url!)} title="在 X 上看原帖">
                    {e.title}
                  </button>
                ) : (
                  <span className="ch-title">{e.title}</span>
                )}
                {e.at !== null && <span className="muted ch-at">{hm(e.at)}</span>}
              </div>
              {e.text && <p className="ch-text">{e.text}</p>}
              <Votes e={e} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="ch-none">{empty}</div>
      )}
    </motion.div>
  )
}

export function TiboChallengeCard() {
  const now = useNow(60_000)
  const [r] = useCodexResets()
  const [pick, setPick] = useState<number | null>(null)
  const c = r && r.status !== 'off' ? r.challenge : null
  if (!c || !c.list.length) return null
  const today = challengeDay(c, now)
  // shown until a few days after the last
  if (today > c.days + 3) return null
  const at = Math.max(1, Math.min(c.days, today))
  const latest = [...c.list].reverse().find((d) => d.day <= at && d.entries.length)
  const sel = c.list.find((d) => d.day === pick) ?? (c.list[at - 1].entries.length || !latest ? c.list[at - 1] : latest)
  const kept = { improvement: c.list.filter((d) => d.state === 'improvement').length, reset: c.list.filter((d) => d.state === 'reset').length }
  const shown = kept.improvement + kept.reset
  const lead = new Date(`${c.start}T00:00:00Z`).getUTCDay()
  const progress = today < 1 ? `${mdOf(c.start)} 开始` : today > c.days ? '挑战已结束' : `第 ${today} 天 / 共 ${c.days} 天`

  return (
    <div className="card ch-card">
      <div className="card-head">
        <div className="card-title">
          <span className="serif">Tibo 的 {c.days} 天挑战</span>
          <span className="ch-progress">{progress}</span>
        </div>
        <button className="rs-link" onClick={() => openLink(c.url)}>
          在站点上看 ↗
        </button>
      </div>
      {c.promise && (
        <blockquote className="ch-promise">
          “{c.promise.text}”
          {c.promise.url && (
            <button className="rs-link" onClick={() => openLink(c.promise!.url!)}>
              — Tibo ↗
            </button>
          )}
        </blockquote>
      )}
      <div className="ch-body">
        <div className="ch-cal">
          <div className="ch-week">
            {Array.from({ length: 7 }, (_, i) => (
              <span key={i}>{WEEKDAYS[(lead + i) % 7]}</span>
            ))}
          </div>
          <div className="ch-grid">
            {c.list.map((d, i) => {
              const state = d.day === today && d.state !== 'reset' && d.state !== 'improvement' ? 'today' : d.day > today ? 'ahead' : d.state
              return (
                <motion.button
                  key={d.day}
                  className={`ch-cell ${state}${d.day === today ? ' now' : ''}${sel.day === d.day ? ' sel' : ''}`}
                  onClick={() => setPick(d.day)}
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: Math.min(i, 27) * 0.012, type: 'spring', stiffness: 420, damping: 28 }}
                  aria-pressed={sel.day === d.day}
                  aria-label={`第 ${d.day} 天 ${dateOf(d)} ${d.state === 'reset' || d.state === 'improvement' ? KIND[d.state] : ''}`}
                >
                  {sel.day === d.day && <motion.span layoutId="ch-ring" className="ch-ring" transition={{ type: 'spring', stiffness: 520, damping: 36 }} />}
                  <b>{d.day}</b>
                  <small>{mdOf(d.date)}</small>
                  {(d.state === 'reset' || d.state === 'improvement') && <i aria-hidden>{d.state === 'reset' ? '↺' : '✦'}</i>}
                </motion.button>
              )
            })}
          </div>
          <div className="ch-tally">
            <span className="ch-key improvement">
              <i />
              改进 <b>{kept.improvement}</b> 天
            </span>
            <span className="ch-key reset">
              <i />
              重置 <b>{kept.reset}</b> 天
            </span>
            <span className="ch-duel" aria-hidden>
              <motion.i className="improvement" animate={{ flexGrow: shown ? kept.improvement : 1 }} transition={{ duration: 0.6 }} />
              <motion.i className="reset" animate={{ flexGrow: shown ? kept.reset : 1 }} transition={{ duration: 0.6 }} />
            </span>
          </div>
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <Detail key={sel.day} c={c} d={sel} today={today} now={now} />
        </AnimatePresence>
      </div>
    </div>
  )
}
