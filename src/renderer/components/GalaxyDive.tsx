import { motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dialogue, DialogueItem, PromptCost, StarMap, UsageSource } from '@shared/types'
import { useApp } from '../state'
import { openSession } from './UsageInsights'

/**
 * Inside a galaxy: the project at a glance, its conversations (each one a
 * chain of stars on the arms), and the one picked, read back from its log.
 */

const DAY = 86_400_000
const CN = (n: number) => (n >= 1e8 ? `${(n / 1e8).toFixed(2)} 亿` : n >= 1e4 ? `${(n / 1e4).toFixed(n >= 1e6 ? 0 : 1)} 万` : String(Math.round(n)))
const stamp = (t: number) => new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })
const clockOf = (t: number) => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
const span = (ms: number) => {
  const m = Math.round(ms / 60_000)
  return m < 1 ? '' : m < 60 ? `${m} 分钟` : m < 1440 ? `${Math.floor(m / 60)} 小时${m % 60 ? ` ${m % 60} 分` : ''}` : `${Math.round(m / 1440)} 天`
}
const folder = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p || '（无项目）'
const dayOf = (t: number) => {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export interface DiveGalaxy {
  key: string
  project: string
  source: UsageSource
  prompts: PromptCost[]
}

interface Props {
  g: DiveGalaxy
  sessions: StarMap['sessions']
  sel: string | null
  onSel: (id: string | null) => void
  onHoverSession: (id: string | null) => void
  onPulse: (key: string | null) => void
  /** a star picked in the galaxy: scroll its prompt into view */
  jump: { key: string; n: number } | null
  onBack: () => void
}

function Clamp({ text, lines, className }: { text: string; lines: number; className?: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > lines * 46 || text.split('\n').length > lines
  return (
    <div className={className}>
      <div className="dv-text" style={open || !long ? undefined : { WebkitLineClamp: lines }} data-clamp={!open && long ? '' : undefined}>
        {text}
      </div>
      {long && (
        <button className="dv-more" onClick={() => setOpen(!open)}>
          {open ? '收起' : '展开全文'}
        </button>
      )}
    </div>
  )
}

function Step({ it, who, cost, pk, onPulse }: { it: DialogueItem; who: string; cost: PromptCost | null; pk: string | null; onPulse: (k: string | null) => void }) {
  const { money } = useApp()
  if (it.kind === 'compact') return <div className="dv-compact">上下文在这里压缩过</div>
  if (it.kind === 'tools')
    return (
      <div className="dv-tools">
        {it.tools!.slice(0, 6).map((t) => (
          <span key={t.name}>
            {t.name}
            {t.n > 1 && <b> ×{t.n}</b>}
          </span>
        ))}
        {it.tools!.length > 6 && <span className="muted">等 {it.tools!.length} 种工具</span>}
      </div>
    )
  if (it.kind === 'prompt')
    return (
      <div className="dv-prompt" data-pk={pk ?? undefined} onMouseEnter={() => pk && onPulse(pk)} onMouseLeave={() => pk && onPulse(null)}>
        <div className="dv-who">
          <span>你</span>
          <span className="muted">{clockOf(it.ts)}</span>
          {cost && (
            <span className="dv-cost tnum" title={`${cost.requests} 次请求 · 输出 ${CN(cost.output)} Token`}>
              {money(cost.cost)} · {CN(cost.tokens)} Token{cost.durationMs > 60_000 ? ` · ${span(cost.durationMs)}` : ''}
            </span>
          )}
        </div>
        <Clamp text={it.text ?? ''} lines={6} />
      </div>
    )
  return (
    <div className="dv-reply">
      <div className="dv-who">
        <span>{who}</span>
        <span className="muted">{clockOf(it.ts)}</span>
      </div>
      <Clamp text={it.text ?? ''} lines={8} />
    </div>
  )
}

export function GalaxyDive({ g, sessions, sel, onSel, onHoverSession, onPulse, jump, onBack }: Props) {
  const { money } = useApp()
  const [dlg, setDlg] = useState<{ id: string; d: Dialogue | null } | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const who = g.source === 'workbuddy' ? 'WorkBuddy' : g.source === 'codex' ? 'Codex' : 'Claude'

  const stats = useMemo(() => {
    const ps = [...g.prompts].sort((a, b) => a.ts - b.ts)
    const cost = ps.reduce((a, p) => a + p.cost, 0)
    const tokens = ps.reduce((a, p) => a + p.tokens, 0)
    const models = new Map<string, number>()
    for (const p of ps) for (const m of p.models) models.set(m, (models.get(m) ?? 0) + 1)
    const first = ps[0]?.ts ?? 0
    const last = ps[ps.length - 1]?.ts ?? 0
    // spend day by day, first day to last
    const d0 = dayOf(first)
    const n = Math.max(1, Math.round((dayOf(last) - d0) / DAY) + 1)
    const days = Array.from({ length: Math.min(n, 90) }, () => ({ cost: 0, prompts: 0 }))
    for (const p of ps) {
      const i = Math.min(days.length - 1, Math.round((dayOf(p.ts) - d0) / DAY))
      days[i].cost += p.cost
      days[i].prompts++
    }
    return { ps, cost, tokens, first, last, days, d0, active: days.filter((d) => d.prompts).length, models: [...models.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3) }
  }, [g])
  const list = useMemo(() => {
    const titles = new Map<string, string>()
    for (const p of stats.ps) if (!titles.has(p.sessionId)) titles.set(p.sessionId, p.text)
    return sessions.map((s) => ({ ...s, title: titles.get(s.id) || '（没有文字的提问）' })).sort((a, b) => b.last - a.last)
  }, [sessions, stats])
  const maxCost = Math.max(1e-9, ...list.map((s) => s.cost))
  const maxDay = Math.max(1e-9, ...stats.days.map((d) => d.cost))
  const cur = sel ? list.find((s) => s.id === sel) : null
  const sessionPrompts = useMemo(() => stats.ps.filter((p) => p.sessionId === sel), [stats, sel])

  useEffect(() => {
    if (!sel) return
    let live = true
    setDlg(null)
    window.api.getDialogue(sel).then((d) => live && setDlg({ id: sel, d }))
    return () => {
      live = false
    }
  }, [sel])

  // a star picked in the galaxy: its prompt scrolls into view and flashes
  useEffect(() => {
    if (!jump || !dlg || dlg.id !== sel) return
    const el = body.current?.querySelector(`[data-pk="${CSS.escape(jump.key)}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.remove('flash')
    void (el as HTMLElement).offsetWidth
    el.classList.add('flash')
  }, [jump, dlg, sel])

  const costOf = (it: DialogueItem): PromptCost | null => {
    if (it.kind !== 'prompt') return null
    let best: PromptCost | null = null
    for (const p of sessionPrompts) if (Math.abs(p.ts - it.ts) < 2000 && (!best || Math.abs(p.ts - it.ts) < Math.abs(best.ts - it.ts))) best = p
    return best
  }

  return (
    <motion.div className="dive-panel" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}>
      <div className="dv-head">
        <button className="dv-back" onClick={cur ? () => onSel(null) : onBack}>
          ← {cur ? '这个星系的全部对话' : '回到星系群'}
        </button>
        <div className="dv-title">
          <span className={`src-tag ${g.source}`}>{who}</span>
          <b>{folder(g.project)}</b>
        </div>
        <div className="dv-facts tnum">
          <b>{money(stats.cost)}</b> · {stats.ps.length} 次提问 · {list.length} 段对话 · {CN(stats.tokens)} Token
        </div>
        <div className="dv-facts muted">
          {stamp(stats.first)} 起 · 活跃 {stats.active} 天{stats.models.length ? ` · 常用 ${stats.models.map(([m]) => m).join('、')}` : ''}
        </div>
        {stats.days.length > 1 && (
          <div className="dv-days" title="每天在这个项目上的花费">
            {stats.days.map((d, i) => (
              <i key={i} style={{ height: `${Math.max(d.prompts ? 8 : 2, (d.cost / maxDay) * 100)}%` }} className={d.prompts ? '' : 'none'} title={`${new Date(stats.d0 + i * DAY).getMonth() + 1}/${new Date(stats.d0 + i * DAY).getDate()} · ${d.prompts} 次提问 · ${money(d.cost)}`} />
            ))}
          </div>
        )}
      </div>

      {!cur ? (
        <div className="dv-body">
          {list.map((s) => (
            <button key={s.id} className="dv-session" onClick={() => onSel(s.id)} onMouseEnter={() => onHoverSession(s.id)} onMouseLeave={() => onHoverSession(null)}>
              <span className="dv-session-title">{s.title}</span>
              <span className="dv-session-meta muted tnum">
                {stamp(s.first)} · {s.prompts} 次提问{s.last - s.first > 60_000 ? ` · 跨 ${span(s.last - s.first)}` : ''}
              </span>
              <span className="dv-session-cost tnum">{money(s.cost)}</span>
              <i className="dv-session-bar" style={{ width: `${(s.cost / maxCost) * 100}%` }} />
            </button>
          ))}
        </div>
      ) : (
        <div className="dv-body" ref={body}>
          <div className="dv-conv-head">
            <Clamp text={cur.title} lines={2} className="dv-conv-title" />
            <div className="muted tnum">
              {stamp(cur.first)} – {clockOf(cur.last)} · {cur.prompts} 次提问 · {money(cur.cost)} · {CN(cur.tokens)} Token
            </div>
            <button className="btn small" onClick={() => openSession(cur.id)}>
              在会话页打开
            </button>
          </div>
          {!dlg || dlg.id !== sel ? (
            <div className="dv-loading">
              <i />
              <i />
              <i />
            </div>
          ) : !dlg.d ? (
            <div className="dv-empty">找不到这段对话的日志（可能已被删除或移动）</div>
          ) : (
            <div className="dv-steps">
              {dlg.d.skipped > 0 && <div className="dv-compact">更早的 {dlg.d.skipped} 步没有显示</div>}
              {dlg.d.items.map((it, i) => {
                const c = costOf(it)
                return <Step key={i} it={it} who={who} cost={c} pk={c?.key ?? null} onPulse={onPulse} />
              })}
              {!dlg.d.items.length && <div className="dv-empty">这段对话的日志里没有可读的内容</div>}
            </div>
          )}
        </div>
      )}
    </motion.div>
  )
}
