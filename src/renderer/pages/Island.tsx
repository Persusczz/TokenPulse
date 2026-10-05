import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { fmtTokens } from '@shared/format'
import { cnCount, crossed, TOKEN_MARKS } from '@shared/milestones'
import type { Intensity, QuotaWindow } from '@shared/types'
import { CodexMark, SourceMark } from '../components/CodexMark'
import { BlackHole } from '../components/Cosmos'
import { useQuotaMotion } from '../components/QuotaMotion'
import { Starburst } from '../components/Starburst'
import { clock, countdown, useApp, useData, useMotionLevel, useNow, useSource, useToolQuotas } from '../state'

type Tone = 'accent' | 'warn' | 'alarm' | 'good'
interface IslandEvent {
  id: number
  tone: Tone
  icon: ReactNode
  title: string
  sub?: string
  /** a progress bar (quota) */
  pct?: number
}

const toneColor = (pct: number) => (pct >= 90 ? 'var(--critical)' : pct >= 75 ? 'var(--serious)' : 'var(--accent)')
const SPRING = { type: 'spring' as const, stiffness: 420, damping: 34 }
const FADE = { initial: { opacity: 0, scale: 0.94 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.94 }, transition: { duration: 0.18 } }

function Ring({ pct, size = 18, tint, resetsAt }: { pct: number; size?: number; tint?: string; resetsAt?: string | null }) {
  const r = size / 2 - 2.5
  const c = 2 * Math.PI * r
  const m = useQuotaMotion(pct, resetsAt)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={`q-${m.phase}`} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="3" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        className="q-arc"
        stroke={m.phase === 'rewind' ? 'var(--rewind)' : tint && m.v < 75 ? tint : toneColor(m.v)}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - m.v / 100)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  )
}

function Bar({ label, w, guardAt, now, tint }: { label: ReactNode; w: QuotaWindow | undefined; guardAt: number | null; now: number; tint?: string }) {
  if (!w) return null
  const pct = Math.max(0, Math.min(100, w.utilization))
  const reset = w.resetsAt ? Date.parse(w.resetsAt) : NaN
  const left = reset > now ? (reset - now > 86_400_000 ? `${Math.floor((reset - now) / 86_400_000)} 天` : countdown(reset, now)) : ''
  const m = useQuotaMotion(pct, w.resetsAt)
  return (
    <div className="isl-bar">
      <span>{label}</span>
      <div className={`isl-track q-bar q-${m.phase}`}>
        <i style={{ width: `${m.v}%`, background: m.phase === 'rewind' ? 'var(--rewind)' : tint && m.v < 75 ? tint : toneColor(m.v) }} />
        {guardAt !== null && <b style={{ left: `${guardAt}%` }} />}
      </div>
      <em className={`q-${m.phase}`}>
        {m.phase === 'rewind' && <i className="q-rw">⏪</i>}
        {Math.round(m.v)}%
      </em>
      <small>{left}</small>
    </div>
  )
}

/** Dynamic-island capsule: compact readout, springing open for events and on hover */
export function Island() {
  const { guard, lastUpdate, money, settings } = useApp()
  const source = useSource()
  const live = useData(() => window.api.getLive(), [source], 15_000)
  const rate = useData(() => window.api.getRate(), [source], 5_000)
  const tools = useToolQuotas()
  const level = useMotionLevel()
  const cosmic = settings?.backdrop === 'galaxy'
  const now = useNow(1000)
  const [hover, setHover] = useState(false)
  const [ev, setEv] = useState<IslandEvent | null>(null)
  const [bubble, setBubble] = useState<{ id: number; text: string } | null>(null)
  const seq = useRef(0)
  const taskStatus = useRef<Map<string, string> | null>(null)
  const five = tools[0]?.five ?? undefined
  const seven = tools[0]?.seven ?? undefined
  const other = tools[1] ?? null
  const intensity = (live?.intensity ?? 0) as Intensity
  const working = !!live?.lastEntryAt && now - live.lastEntryAt < 120_000
  const guardAt = tools[0]?.pauseAt ?? null

  useEffect(() => {
    document.documentElement.classList.add('island-root')
    void window.api.getTasks().then((s) => (taskStatus.current ??= new Map(s.tasks.map((t) => [t.id, t.status]))))
  }, [])

  const show = (e: Omit<IslandEvent, 'id'>, ms = 4500) => {
    const id = ++seq.current
    setEv({ ...e, id })
    setTimeout(() => setEv((cur) => (cur?.id === id ? null : cur)), ms)
  }

  // new usage: a bubble in the capsule; a big batch opens it
  useEffect(() => {
    const n = lastUpdate?.addedTokens ?? 0
    if (n < 1000) return
    setBubble({ id: lastUpdate!.at, text: `+${fmtTokens(n, 1)}` })
    if (n >= 3_000_000) show({ tone: 'accent', icon: <Starburst size={30} intensity={3} pulse={lastUpdate!.at} />, title: `大批新用量 +${fmtTokens(n, 1)}`, sub: `约 ${money(lastUpdate!.addedCost)} · 今日 ${fmtTokens(live?.today.tokens ?? 0, 1)}` })
  }, [lastUpdate]) // eslint-disable-line react-hooks/exhaustive-deps

  // daily milestones (switching tools starts a new baseline)
  const prevTokens = useRef<number | null>(null)
  useEffect(() => void (prevTokens.current = null), [source])
  useEffect(() => {
    const v = live?.today.tokens
    if (v === undefined) return
    const m = prevTokens.current === null ? null : crossed(prevTokens.current, v, TOKEN_MARKS)
    prevTokens.current = v
    if (m) show({ tone: 'accent', icon: <span className="isl-glyph">✦</span>, title: `今日突破 ${cnCount(m)} Token`, sub: money(live!.today.cost) })
  }, [live?.today.tokens]) // eslint-disable-line react-hooks/exhaustive-deps

  // quota crossing 75 / 90
  const prevFive = useRef<number | null>(null)
  useEffect(() => {
    if (!five) return
    const p = prevFive.current
    prevFive.current = five.utilization
    const m = p === null ? null : crossed(p, five.utilization, [75, 90])
    if (m) {
      show({
        tone: m >= 90 ? 'alarm' : 'warn',
        icon: <Ring pct={five.utilization} size={40} />,
        title: `5 小时额度 ${Math.round(five.utilization)}%`,
        sub: five.resetsAt ? `${clock(Date.parse(five.resetsAt))} 重置` : undefined,
        pct: five.utilization
      })
    }
  }, [five?.utilization]) // eslint-disable-line react-hooks/exhaustive-deps

  // guard pausing / resuming, manual holds
  const paused = guard?.paused.length ?? 0
  const prevPaused = useRef(paused)
  useEffect(() => {
    const p = prevPaused.current
    prevPaused.current = paused
    const until = guard?.paused.find((x) => x.until)?.until
    if (!p && paused) show({ tone: 'alarm', icon: <span className="isl-glyph">⏸</span>, title: `已暂停 ${paused} 个任务`, sub: until ? `${clock(until)} 自动继续` : '恢复后继续' }, 6000)
    if (p && !paused) show({ tone: 'good', icon: <span className="isl-glyph">▶</span>, title: '任务已恢复', sub: 'Claude Code 继续执行' })
  }, [paused]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const offs = [
      window.api.onAchievement((list) => {
        const a = list[0]
        if (a) show({ tone: 'accent', icon: <span className="isl-glyph badge">{a.icon}</span>, title: `解锁成就 · ${a.title}`, sub: a.desc }, 5500)
      }),
      window.api.onRunaway((list) => {
        const a = list[list.length - 1]
        if (!a || Date.now() - a.at > 10_000) return
        show(
          {
            tone: 'alarm',
            icon: <span className="isl-glyph">{a.kind === 'loop' ? '↻' : '⚠'}</span>,
            title: `${a.project || '会话'} ${a.kind === 'loop' ? '疑似死循环' : '消耗异常'}`,
            sub: a.kind === 'loop' ? `连续 ${a.repeats} 次相同的响应` : `5 分钟 ${money(a.cost5)}${a.ratio ? ` · 平时的 ${a.ratio.toFixed(1)} 倍` : ''}${a.held ? ' · 已暂停' : ''}`
          },
          7000
        )
      }),
      window.api.onRemote((r) => show({ tone: 'accent', icon: <span className="isl-glyph">✈</span>, title: `远程指令 /${r.command}`, sub: r.reply })),
      // a session's context grew past the line
      window.api.onContextAlert((a) =>
        show(
          {
            tone: a.window ? (a.tokens >= a.window * 0.88 ? 'alarm' : 'warn') : a.tokens >= a.warnAt * 1.5 ? 'alarm' : 'warn',
            icon: <span className="isl-glyph">⇲</span>,
            title: `${a.project || '会话'} 上下文 ${fmtTokens(a.tokens, 0)}${a.window ? ` / ${fmtTokens(a.window, 0)}` : ''}`,
            sub: a.window && a.tokens >= a.window * 0.88 ? '快到自动压缩了，找个节点 /compact' : '告一段落时 /compact 一下',
            pct: Math.min(100, a.window ? (a.tokens / a.window) * 100 : (a.tokens / (a.warnAt * 2)) * 100)
          },
          6500
        )
      ),
      // a quota window about to reset half unused
      window.api.onWaste((w) =>
        show(
          { tone: 'warn', icon: <span className="isl-glyph">⏳</span>, title: `${w.label}额度还剩约 ${w.unused}%`, sub: w.startedTask ? `已提前开始：${w.startedTask.slice(0, 22)}` : '快刷新了，别浪费' },
          7000
        )
      ),
      // refresh tasks starting and finishing
      window.api.onTasks((s) => {
        const before = taskStatus.current
        const next = new Map(s.tasks.map((t) => [t.id, t.status]))
        taskStatus.current = next
        if (!before) return
        for (const t of s.tasks) {
          const was = before.get(t.id)
          const title = t.prompt.length > 26 ? `${t.prompt.slice(0, 25)}…` : t.prompt
          if (t.status === 'running' && was !== 'running') show({ tone: 'accent', icon: <span className="isl-glyph">⏱</span>, title: '额度刷新，开始执行任务', sub: title }, 6000)
          if (was === 'running' && t.status !== 'running') {
            const failed = !!t.error
            show({ tone: failed ? 'alarm' : 'good', icon: <span className="isl-glyph">{failed ? '✕' : '✓'}</span>, title: failed ? '刷新任务未完成' : '刷新任务完成', sub: failed ? (t.error ?? title) : title }, 6000)
          }
        }
      })
    ]
    return () => offs.forEach((off) => off())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const mode = ev ? 'event' : hover ? 'detail' : 'compact'
  return (
    <div className="island-stage">
      <motion.div
        layout
        transition={SPRING}
        style={{ borderRadius: mode === 'compact' ? 20 : 28 }}
        className={`island ${mode}${cosmic ? ' cosmic' : ''} tone-${ev?.tone ?? (guard?.manualHold || paused ? 'alarm' : 'none')}`}
        onMouseEnter={() => {
          setHover(true)
          window.api.islandInteractive(true)
        }}
        onMouseLeave={() => {
          setHover(false)
          window.api.islandInteractive(false)
        }}
        onClick={() => window.api.showMain()}
        onContextMenu={(e) => {
          e.preventDefault()
          window.api.islandMenu()
        }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {mode === 'compact' && (
            <motion.div key="compact" className="isl-compact" {...FADE}>
              {cosmic ? (
                <BlackHole className="isl-hole" pct={five ? five.utilization : null} intensity={intensity} level={level} pulse={lastUpdate?.addedTokens ? lastUpdate.at : 0} gauge={false} />
              ) : (
                <SourceMark size={20} intensity={intensity} pulse={lastUpdate?.addedTokens ? lastUpdate.at : 0} />
              )}
              <span className="isl-tokens">{fmtTokens(live?.today.tokens ?? 0, 1)}</span>
              {five && (
                <>
                  <i className="isl-sep" />
                  {other && <Starburst size={11} animated={false} />}
                  <Ring pct={five.utilization} resetsAt={five.resetsAt} />
                  <span className="isl-pct">{Math.round(five.utilization)}%</span>
                </>
              )}
              {other?.five && (
                <>
                  <CodexMark size={11} animated={false} />
                  <Ring pct={other.five.utilization} tint="var(--codex)" resetsAt={other.five.resetsAt} />
                  <span className="isl-pct">{Math.round(other.five.utilization)}%</span>
                </>
              )}
              {(guard?.manualHold || paused > 0) && <span className="isl-paused">⏸</span>}
              <i className={`isl-dot${working ? ' on' : ''}`} />
              <AnimatePresence>
                {bubble && (
                  <motion.span
                    key={bubble.id}
                    className="isl-bubble"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: [0, 1, 1, 0], y: [6, 0, -4, -12] }}
                    transition={{ duration: 1.6, times: [0, 0.15, 0.7, 1] }}
                    onAnimationComplete={() => setBubble((b) => (b?.id === bubble.id ? null : b))}
                  >
                    {bubble.text}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.div>
          )}
          {mode === 'event' && ev && (
            <motion.div key={`ev${ev.id}`} className="isl-event" {...FADE}>
              <span className={`isl-icon ${ev.tone}`}>{ev.icon}</span>
              <span className="isl-text">
                <b>{ev.title}</b>
                {ev.sub && <small>{ev.sub}</small>}
                {ev.pct !== undefined && (
                  <span className="isl-track">
                    <i style={{ width: `${Math.min(100, ev.pct)}%`, background: toneColor(ev.pct) }} />
                  </span>
                )}
              </span>
            </motion.div>
          )}
          {mode === 'detail' && (
            <motion.div key="detail" className="isl-detail" {...FADE}>
              <div className="isl-head">
                {cosmic ? (
                  <BlackHole className="isl-hole big" pct={five ? five.utilization : null} intensity={intensity} level={level} pulse={0} gauge={false} />
                ) : (
                  <SourceMark size={26} intensity={intensity} />
                )}
                <span>
                  <b>{fmtTokens(live?.today.tokens ?? 0, 2)}</b> 今日
                </span>
                <span className="isl-cost">{money(live?.today.cost ?? 0)}</span>
                <span className="isl-rate">⚡ {fmtTokens(rate?.tokensPerMin ?? 0, 1)}/分</span>
              </div>
              <Bar label={other ? <><Starburst size={10} animated={false} />5h</> : '5h'} w={five} guardAt={guardAt} now={now} />
              {other && <Bar label={<><CodexMark size={10} animated={false} />5h</>} w={other.five ?? undefined} guardAt={null} now={now} tint="var(--codex)" />}
              <Bar label={other ? <><Starburst size={10} animated={false} />7d</> : '7d'} w={seven} guardAt={null} now={now} />
              {other && <Bar label={<><CodexMark size={10} animated={false} />7d</>} w={other.seven ?? undefined} guardAt={null} now={now} tint="var(--codex)" />}
              <div className="isl-foot">
                <span>{guard?.manualHold && source !== 'codex' ? '已暂停所有任务' : paused && source !== 'codex' ? `暂停中 ${paused} 个任务` : working ? `${source === 'codex' ? 'Codex' : source === 'all' ? 'AI' : 'Claude'} 正在工作` : '空闲'}</span>
                <button
                  className="isl-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    void window.api.setManualHold(!guard?.manualHold)
                  }}
                >
                  {guard?.manualHold ? '恢复任务' : '暂停任务'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
