import { useEffect, useRef, useState } from 'react'
import { fmtTokens } from '@shared/format'
import { useApp, useData, useNow } from '../state'

/**
 * The signature of the Claude and Codex backdrops, in the sidebar's empty
 * space: Claude Code's morphing spinner star with a whimsical verb, or the
 * Codex prompt tile with its shimmering "Working" line. Both follow real
 * activity: while new usage keeps arriving they work and count the time and
 * the tokens; afterwards they say how long the last stretch took.
 */

const VERBS = [
  'Clauding',
  'Pondering',
  'Brewing',
  'Noodling',
  'Percolating',
  'Cogitating',
  'Simmering',
  'Musing',
  'Conjuring',
  'Crafting',
  'Ruminating',
  'Synthesizing',
  'Marinating',
  'Moseying',
  'Spelunking',
  'Tinkering',
  'Wrangling',
  'Forging'
]
const DONE = ['Brewed', 'Baked', 'Churned', 'Cogitated', 'Cooked', 'Crunched', 'Pondered', 'Simmered', 'Worked', 'Mulled', 'Noodled', 'Sautéed']
/** Claude Code's spinner, there and back */
const FRAMES = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢', '·'].map((g) => g + '︎')
const ACTIVE_MS = 90_000

const pick = <T,>(list: T[], seed: number) => list[Math.abs(Math.floor(seed)) % list.length]

function span(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/** a stretch of work: new usage arriving with gaps under 90 s */
function useStreak() {
  const { lastUpdate } = useApp()
  const live = useData(() => window.api.getLive(), [], 30_000)
  const st = useRef<{ start: number; last: number; tokens: number } | null>(null)
  const [, bump] = useState(0)
  useEffect(() => {
    if (!lastUpdate || lastUpdate.addedTokens <= 0) return
    const now = Date.now()
    const s = st.current
    if (!s || now - s.last > ACTIVE_MS) st.current = { start: now, last: now, tokens: lastUpdate.addedTokens }
    else {
      s.last = now
      s.tokens += lastUpdate.addedTokens
    }
    bump((n) => n + 1)
  }, [lastUpdate])
  const now = useNow(1000)
  const s = st.current
  const active = !!s && now - s.last < ACTIVE_MS
  return { active, s, now, today: live?.today.tokens ?? 0, lastEntryAt: live?.lastEntryAt ?? null }
}

function ClaudeEmblem() {
  const { active, s, now, today, lastEntryAt } = useStreak()
  // the verb changes every few seconds while working
  const verb = pick(VERBS, active && s ? s.start / 1000 + (now - s.start) / 4200 : 0)
  const line = active && s ? `(${span(now - s.start)} · ↓ ${fmtTokens(s.tokens)} tokens)` : s ? `↓ ${fmtTokens(s.tokens)} tokens · 今日 ${fmtTokens(today)}` : `今日 ↓ ${fmtTokens(today)} tokens`
  const done = s ? `${pick(DONE, s.start / 1000)} for ${span(s.last - s.start + 1000)}` : lastEntryAt ? `Idle · ${span(now - lastEntryAt)}` : 'Ready'
  return (
    <div className={`emblem emblem-claude${active ? ' on' : ''}`}>
      <div className="emb-star" aria-hidden>
        <span className="emb-halo" />
        <span className="emb-window">
          <span className="emb-strip">
            {FRAMES.map((g, i) => (
              <b key={i}>{g}</b>
            ))}
          </span>
        </span>
      </div>
      <div className="emb-verb">{active ? `${verb}…` : done}</div>
      <div className="emb-line tnum">{line}</div>
    </div>
  )
}

function CodexEmblem() {
  const { active, s, now, today } = useStreak()
  return (
    <div className={`emblem emblem-codex${active ? ' on' : ''}`}>
      <div className="emb-tile" aria-hidden>
        <span className="emb-prompt">
          &gt;_<i className="emb-cursor" />
        </span>
      </div>
      <div className="emb-verb">
        {active && s ? (
          <>
            <i className="emb-dot">•</i> <span className="emb-shimmer">Working</span> <span className="emb-dim">({span(now - s.start)})</span>
          </>
        ) : (
          <>
            <span className="emb-dim">›</span> {s ? `Worked for ${span(s.last - s.start + 1000)}` : 'Ready'}
          </>
        )}
      </div>
      <div className="emb-line tnum">{active && s ? `↓ ${fmtTokens(s.tokens)} tokens · esc to interrupt` : `今日 ↓ ${fmtTokens(today)} tokens`}</div>
    </div>
  )
}

/** the slot between the navigation and the footer; it fades away when the nav needs the room */
export function SideEmblem() {
  const { settings } = useApp()
  const b = settings?.backdrop
  if (b !== 'claude' && b !== 'codex') return null
  return <div className="emblem-slot">{b === 'claude' ? <ClaudeEmblem /> : <CodexEmblem />}</div>
}
