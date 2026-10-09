import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { fmtTokens } from '@shared/format'
import { cnCount, crossed, QUOTA_MARKS, TOKEN_MARKS } from '@shared/milestones'
import { clock, useApp, useData, useMotionLevel, useSource, useToolQuotas } from '../state'
import { SourceMark } from './CodexMark'
import { PulseRings } from './PulseRings'

export interface ToastData {
  kind: 'milestone' | 'warn' | 'alarm' | 'achievement'
  title: string
  sub: string
  /** achievement badge glyph */
  icon?: string
}
interface Toast extends ToastData {
  id: number
}

const COLOR: Record<ToastData['kind'], string> = {
  milestone: 'var(--accent)',
  warn: 'var(--serious)',
  alarm: 'var(--critical)',
  achievement: 'var(--accent)'
}

function ToastCard({ t, onDone }: { t: Toast; onDone: () => void }) {
  useEffect(() => {
    const h = setTimeout(onDone, 6500)
    return () => clearTimeout(h)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <motion.div
      layout
      className={`toast ${t.kind}`}
      initial={{ opacity: 0, x: 70, scale: 0.9 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 50, scale: 0.94 }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      onClick={onDone}
      data-ripple
    >
      <span className="toast-icon">
        <PulseRings trigger={t.id} color={COLOR[t.kind]} />
        {t.kind === 'achievement' ? (
          <span className="badge-glyph unlocked pop">{t.icon}</span>
        ) : (
          <SourceMark size={30} intensity={t.kind === 'milestone' ? 2 : 3} pulse={t.id} />
        )}
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="toast-title">{t.title}</div>
        <div className="toast-sub">{t.sub}</div>
      </div>
      <i className="toast-timer" />
    </motion.div>
  )
}

/** In-app notices: daily token milestones and the 5h quota crossing 50 / 75 / 90% */
export function Toasts() {
  const { quota, money, settings } = useApp()
  const level = useMotionLevel()
  const live = useData(() => window.api.getLive(), [], 15_000)
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)
  const prevTokens = useRef<number | null>(null)
  const prevQuota = useRef(new Map<string, number>())

  const push = (t: ToastData) => {
    const id = ++seq.current
    setToasts((list) => [...list.slice(-2), { ...t, id }])
  }

  // the first reading is the baseline, so a restart does not replay old milestones;
  // so is the first one after switching tools (another count, not progress)
  const source = useSource()
  const rebase = useRef(true)
  useEffect(() => void (rebase.current = true), [source])
  useEffect(() => {
    if (!live) return
    const v = live.today.tokens
    const p = rebase.current ? null : prevTokens.current
    rebase.current = false
    prevTokens.current = v
    const m = p === null ? null : crossed(p, v, TOKEN_MARKS)
    if (m) push({ kind: 'milestone', title: `今日突破 ${cnCount(m)} Token`, sub: `已用 ${fmtTokens(v, 2)} tokens · ${money(live.today.cost)}` })
  }, [live?.today.tokens]) // eslint-disable-line react-hooks/exhaustive-deps

  // each tool on view, its own 5h line
  const tools = useToolQuotas()
  const key = tools.map((t) => `${t.source}:${t.five?.utilization ?? '-'}`).join('|')
  useEffect(() => {
    for (const tq of tools) {
      const five = tq.five
      if (!five) continue
      const v = five.utilization
      const p = prevQuota.current.get(tq.source) ?? null
      prevQuota.current.set(tq.source, v)
      const m = p === null ? null : crossed(p, v, QUOTA_MARKS)
      if (!m) continue
      const reset = five.resetsAt ? `${clock(Date.parse(five.resetsAt))} 重置` : ''
      const guard = tq.source === 'claude' && settings?.guardEnabled ? `守卫将在 ${settings.guardPauseAt}% 暂停任务` : ''
      push({ kind: m >= 90 ? 'alarm' : 'warn', title: `${tq.source === 'codex' ? 'Codex ' : tools.length > 1 ? 'Claude ' : ''}5 小时额度已用 ${Math.round(v)}%`, sub: [reset, guard].filter(Boolean).join(' · ') })
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () =>
      window.api.onContextAlert((a) =>
        push({
          kind: a.window ? (a.tokens >= a.window * 0.88 ? 'alarm' : 'warn') : a.tokens >= a.warnAt * 1.5 ? 'alarm' : 'warn',
          title: `${a.source === 'workbuddy' ? 'WorkBuddy ' : a.source === 'codex' ? 'Codex ' : ''}${a.project || '会话'} 上下文 ${fmtTokens(a.tokens, 0)}${a.window ? ` / ${fmtTokens(a.window, 0)}（${Math.round((a.tokens / a.window) * 100)}%）` : ''}`,
          sub: `每次请求都要带上它${a.growthPerRequest > 1000 ? `，还在以每次 ${fmtTokens(a.growthPerRequest, 0)} 增长` : ''} · ${a.window && a.tokens >= a.window * 0.88 ? '快到自动压缩了' : '告一段落时 /compact 一下'}`
        })
      ),
    []
  ) // eslint-disable-line react-hooks/exhaustive-deps

  // with light effects on, unlocks get the full-window celebration instead
  const celebrate = useRef(false)
  celebrate.current = !!settings?.lightFx && level > 0
  useEffect(
    () =>
      window.api.onAchievement((list) => {
        if (celebrate.current) return
        for (const a of list) push({ kind: 'achievement', title: `解锁成就 · ${a.title}`, sub: a.desc, icon: a.icon })
      }),
    []
  ) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () =>
      window.api.onRunaway((list) => {
        for (const a of list.filter((x) => Date.now() - x.at < 10_000)) {
          push({
            kind: 'alarm',
            title: `${a.project || '会话'} ${a.kind === 'loop' ? '疑似陷入循环' : '消耗异常'}`,
            sub: a.kind === 'loop' ? `连续 ${a.repeats} 次相同的响应` : `5 分钟 ${money(a.cost5)}${a.held ? ' · 已暂停该会话' : ''}`
          })
        }
      }),
    []
  ) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () =>
      window.api.onWaste((w) =>
        push({
          kind: 'warn',
          title: `${w.label}额度快要浪费了`,
          sub: w.startedTask ? `还剩约 ${w.unused}%，已提前开始刷新任务「${w.startedTask.slice(0, 24)}」` : `${clock(w.resetsAt)} 刷新，照现在的速度还会剩下约 ${w.unused}%`
        })
      ),
    []
  ) // eslint-disable-line react-hooks/exhaustive-deps

  // lets the screenshot walkthrough show one
  useEffect(() => {
    const fn = (e: Event) => push((e as CustomEvent<ToastData>).detail)
    document.addEventListener('tp-toast', fn)
    return () => document.removeEventListener('tp-toast', fn)
  }, [])

  return (
    <div className="toasts">
      <AnimatePresence>
        {toasts.map((t) => (
          <ToastCard key={t.id} t={t} onDone={() => setToasts((list) => list.filter((x) => x.id !== t.id))} />
        ))}
      </AnimatePresence>
    </div>
  )
}
