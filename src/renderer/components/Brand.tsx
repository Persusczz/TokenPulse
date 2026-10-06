import { motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import type { Intensity, SourceView } from '@shared/types'
import { revealFromPointer } from '../effects'
import { onFrame } from '../frames'
import { useApp, useData, useHasCodex, useMotionLevel, useSource } from '../state'
import { CodexMark, SourceMark } from './CodexMark'
import { Starburst } from './Starburst'

const TOOL_LINE: Record<SourceView, string> = { claude: 'for Claude Code', codex: 'for Codex', all: 'Claude + Codex' }

/**
 * The wordmark's sweep of light: still for 3.3 s, then 2.7 s across. Run on
 * the frame clock, so it draws on frames the page draws anyway instead of
 * asking for one on every display refresh.
 */
function useShine() {
  const level = useMotionLevel()
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const em = ref.current
    if (!em || level < 2) return
    let t = 0
    let shown = ''
    return onFrame(
      30,
      (dt) => {
        t = (t + dt) % 6
        const k = t < 3.3 ? 0 : (t - 3.3) / 2.7
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2
        const v = `${(100 - 220 * e).toFixed(1)}% 0`
        if (v === shown) return
        shown = v
        em.style.backgroundPosition = v
      },
      'shine'
    )
  }, [level])
  return ref
}

/** Sidebar logo: the live mark of the tool on view, a two-tone wordmark and an ECG line redrawn on each batch of new usage */
export function Brand() {
  const { lastUpdate } = useApp()
  const shine = useShine()
  const source = useSource()
  const hasCodex = useHasCodex()
  const live = useData(() => window.api.getLive(), [], 30_000)
  const beat = lastUpdate?.addedTokens ? lastUpdate.at : 0
  return (
    <div className="brand">
      {/* a new key replays the swap when the tool changes */}
      <motion.span key={source} className="brand-mark" initial={{ scale: 0.4, rotate: -90, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }}>
        <SourceMark size={28} intensity={(live?.intensity ?? 0) as Intensity} pulse={beat} />
      </motion.span>
      <span className="brand-text">
        <span className="brand-name">
          Token<em ref={shine}>Pulse</em>
        </span>
        <svg key={beat} className="brand-ecg" viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden>
          <path d="M0 6h40l4-4 5 9 5-11 5 11 4-5h57" />
        </svg>
        {hasCodex && <span className="brand-tool">{TOOL_LINE[source]}</span>}
      </span>
    </div>
  )
}

const SOURCES: { value: SourceView; label: string; title: string }[] = [
  { value: 'claude', label: 'Claude', title: '只看 Claude Code：用量、额度、守卫和任务' },
  { value: 'codex', label: 'Codex', title: '只看 Codex：GPT 用量和 ChatGPT 套餐额度' },
  { value: 'all', label: '全部', title: '两个一起看：合计用量，额度并排显示' }
]

/** Claude / Codex / 全部: which tool the whole app is about */
export function SourceSwitch() {
  const { saveSettings } = useApp()
  const source = useSource()
  if (!useHasCodex()) return null
  const pick = (v: SourceView) => {
    if (v === source) return
    // the new tool's colours grow from the click, like a theme change
    revealFromPointer(() => {
      document.documentElement.dataset.source = v
      void saveSettings({ sourceFilter: v })
    })
  }
  return (
    <div className="src-switch" role="radiogroup" aria-label="查看">
      {SOURCES.map((o) => (
        <button key={o.value} role="radio" aria-checked={source === o.value} className={`src-opt ${o.value}${source === o.value ? ' on' : ''}`} title={o.title} onClick={() => pick(o.value)}>
          {source === o.value && <motion.span layoutId="src-pill" className="src-pill" transition={{ type: 'spring', stiffness: 520, damping: 38 }} />}
          <span className="src-icon">
            {o.value === 'claude' ? <Starburst size={14} animated={false} /> : o.value === 'codex' ? <CodexMark size={14} animated={false} /> : <span className="src-both" />}
          </span>
          {o.label}
        </button>
      ))}
    </div>
  )
}
