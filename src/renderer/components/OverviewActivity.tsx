import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { fmtInt, fmtTokens } from '@shared/format'
import type { ActionKind, ActionStats, PersonalRecords, RangeKey } from '@shared/types'
import { useApp, useData, useSource } from '../state'
import { SourceMark } from './CodexMark'
import { openSession } from './UsageInsights'

/** Two overview cards: what the AI did with its tools over the range, and your personal records */

const RANGE_NAME: Record<RangeKey, string> = { today: '今天', '7d': '这 7 天', '30d': '这 30 天', month: '本月', all: '全部记录里' }
const md = (t: number) => `${new Date(t).getMonth() + 1}/${new Date(t).getDate()}`
const hh = (t: number) => `${md(t)} ${String(new Date(t).getHours()).padStart(2, '0')}:00`

export const KIND: Record<ActionKind, { label: string; color: string }> = {
  run: { label: '跑命令', color: 'var(--s1)' },
  read: { label: '读与搜索', color: 'var(--s2)' },
  edit: { label: '改文件', color: 'var(--s3)' },
  web: { label: '联网', color: 'var(--s4)' },
  agent: { label: '子代理', color: 'var(--s5)' },
  mcp: { label: 'MCP 工具', color: 'var(--s6)' },
  other: { label: '其他', color: 'var(--other)' }
}

function Lines({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="act-lines">
      <b className="add">+{fmtInt(added)}</b>
      <b className="del">−{fmtInt(removed)}</b>
    </span>
  )
}

// ---------------------------------------------------------------- AI 做了什么

/** the tool calls over the overview's range: what kind, which tools, which files */
export function ActionsCard({ range }: { range: RangeKey }) {
  const { lastUpdate } = useApp()
  const source = useSource()
  const s = useData<ActionStats>(() => window.api.getActions(range), [range, source, Math.floor((lastUpdate?.at ?? 0) / 60_000)], 60_000)
  const count = (k: ActionKind) => s?.kinds.find((x) => x.kind === k)?.count ?? 0
  const kinds = s?.kinds.filter((k) => k.count > 0) ?? []
  const topTool = s?.tools[0]?.count ?? 1
  const perAsk = s && s.prompts ? s.total / s.prompts : 0
  return (
    <div className="card actions-card">
      <div className="card-head">
        <div className="card-title">
          <span className="serif">AI 做了什么</span>
          <span className="muted" style={{ fontWeight: 400 }}>
            {RANGE_NAME[range]}的工具调用
          </span>
        </div>
      </div>
      {!s ? (
        <div className="skeleton" style={{ height: 260 }} />
      ) : !s.total ? (
        <div className="act-empty">{RANGE_NAME[range]}还没有工具调用</div>
      ) : (
        <>
          <p className="act-verdict">
            {RANGE_NAME[range]}调用工具 <b>{fmtInt(s.total)}</b> 次
            {perAsk > 0 && (
              <>
                ，平均每个问题 <b>{perAsk.toFixed(perAsk >= 10 ? 0 : 1)}</b> 次
              </>
            )}
            {s.files > 0 && (
              <>
                ；改了 <b>{fmtInt(s.files)}</b> 个文件
              </>
            )}
            。
          </p>
          <div className="act-tiles">
            <Tile label="跑命令" value={fmtInt(count('run'))} unit="次" color={KIND.run.color} />
            <Tile label="读与搜索" value={fmtInt(count('read'))} unit="次" color={KIND.read.color} />
            <Tile label="改文件" value={fmtInt(s.files)} unit="个" sub={`${fmtInt(count('edit'))} 次修改`} color={KIND.edit.color} />
            <Tile label="代码行" value={<Lines added={s.added} removed={s.removed} />} sub="写入 / 删除" color="var(--good)" title="按工具的输入统计：Edit 比较改前改后，Write 整个文件算作写入" />
          </div>
          <div className="act-bar" aria-label="按类型">
            {kinds.map((k) => (
              <motion.i
                key={k.kind}
                style={{ background: KIND[k.kind].color }}
                initial={{ flexGrow: 0 }}
                animate={{ flexGrow: k.count }}
                transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
                title={`${KIND[k.kind].label} ${fmtInt(k.count)} 次`}
              />
            ))}
          </div>
          <div className="act-legend">
            {kinds.map((k) => (
              <span key={k.kind}>
                <i style={{ background: KIND[k.kind].color }} />
                {KIND[k.kind].label} <b>{k.count / s.total < 0.005 ? '<1' : Math.round((k.count / s.total) * 100)}%</b>
              </span>
            ))}
          </div>
          <div className="act-body">
            <div>
              <div className="act-sub">常用工具</div>
              <div className="act-tools">
                {s.tools.map((t) => (
                  <div className="act-tool" key={`${t.source}:${t.name}`}>
                    <span className="act-tool-name" title={t.name}>
                      {source === 'all' && <SourceMark size={12} animated={false} source={t.source} />}
                      {t.name}
                    </span>
                    <span className="act-tool-bar">
                      <motion.i style={{ background: KIND[t.kind].color }} initial={{ scaleX: 0 }} animate={{ scaleX: t.count / topTool }} transition={{ duration: 0.6 }} />
                    </span>
                    <b>{fmtInt(t.count)}</b>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="act-sub">改得最多的文件</div>
              {s.topFiles.length ? (
                <div className="act-files">
                  {s.topFiles.map((f) => (
                    <div className="act-file" key={f.path} title={f.path}>
                      <span className="act-file-name">
                        {f.name}
                        <em>{f.project}</em>
                      </span>
                      <span className="muted">{f.edits} 次</span>
                      <Lines added={f.added} removed={f.removed} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="act-empty small">没有改文件</div>
              )}
            </div>
          </div>
          {s.since !== null && (range === 'all' || range === '30d' || range === 'month') && Date.now() - s.since < 29 * 86_400_000 && (
            <div className="act-note">日志里最早的工具调用在 {md(s.since)}：Claude Code 默认只保留 30 天日志，更早的已不在了</div>
          )}
        </>
      )}
    </div>
  )
}

function Tile({ label, value, unit, sub, color, title }: { label: string; value: ReactNode; unit?: string; sub?: string; color: string; title?: string }) {
  return (
    <div className="act-tile" style={{ ['--c' as string]: color }} title={title}>
      <span className="act-tile-label">{label}</span>
      <span className="act-tile-value">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      {sub && <span className="act-tile-sub">{sub}</span>}
    </div>
  )
}

// ---------------------------------------------------------------- 个人纪录

/** one record: the best, when it was, and how close today is */
function Rec({ label, value, sub, today, todayText, beat, onClick, title }: { label: string; value: string; sub: string; today?: number; todayText?: string; beat?: boolean; onClick?: () => void; title?: string }) {
  const pct = today === undefined ? null : Math.min(1, today)
  return (
    <button className={`rec${beat ? ' beat' : ''}${onClick ? ' link' : ''}`} onClick={onClick} disabled={!onClick} title={title}>
      <span className="rec-label">
        {label}
        {beat && <em>今天破纪录</em>}
      </span>
      <span className="rec-value">{value}</span>
      <span className="rec-sub">{sub}</span>
      {pct !== null && (
        <span className="rec-today">
          <span className="rec-track">
            <motion.i initial={{ scaleX: 0 }} animate={{ scaleX: pct }} transition={{ duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }} />
          </span>
          <span>{todayText ?? `今天 ${Math.round(pct * 100)}%`}</span>
        </span>
      )}
    </button>
  )
}

/** bests over everything in the logs, with today set against them */
export function RecordsCard() {
  const { money, lastUpdate } = useApp()
  const source = useSource()
  const r = useData<PersonalRecords>(() => window.api.getRecords(), [source, Math.floor((lastUpdate?.at ?? 0) / 300_000)], 5 * 60_000)
  const isToday = (t: number) => md(t) === md(Date.now()) && Date.now() - t < 86_400_000
  return (
    <div className="card records-card">
      <div className="card-head">
        <div className="card-title">
          <span className="serif">个人纪录</span>
          {r?.since && (
            <span className="muted" style={{ fontWeight: 400 }}>
              从 {md(r.since)} 起 · {r.days} 天有用量
            </span>
          )}
        </div>
      </div>
      {!r ? (
        <div className="skeleton" style={{ height: 300 }} />
      ) : !r.days ? (
        <div className="act-empty">还没有用量</div>
      ) : (
        <>
          <div className="rec-grid">
            {r.bestDay && (
              <Rec label="用得最多的一天" value={`${fmtTokens(r.bestDay.tokens)} token`} sub={md(r.bestDay.t)} today={r.today.tokens / r.bestDay.tokens} beat={isToday(r.bestDay.t)} />
            )}
            {r.costDay && <Rec label="花得最多的一天" value={money(r.costDay.cost)} sub={md(r.costDay.t)} today={r.today.cost / r.costDay.cost} beat={isToday(r.costDay.t)} />}
            {r.streak && (
              <Rec
                label="最长连续使用"
                value={`${r.streak.days} 天`}
                sub={`${md(r.streak.from)} – ${md(r.streak.to)}`}
                today={r.current / r.streak.days}
                todayText={r.current ? (r.current >= r.streak.days ? `正在刷新：连续 ${r.current} 天` : `现在连续 ${r.current} 天`) : '现在没有在连续'}
              />
            )}
            {r.bestHour && (
              <Rec label="最忙的一个小时" value={`${fmtTokens(r.bestHour.tokens)} token`} sub={hh(r.bestHour.t)} today={r.today.hour / r.bestHour.tokens} todayText={`这个小时 ${Math.round((r.today.hour / r.bestHour.tokens) * 100)}%`} beat={Date.now() - r.bestHour.t < 3_600_000} />
            )}
            {r.promptDay && (
              <Rec label="提问最多的一天" value={`${fmtInt(r.promptDay.prompts)} 个问题`} sub={md(r.promptDay.t)} today={r.today.prompts / r.promptDay.prompts} beat={isToday(r.promptDay.t)} />
            )}
            {r.codeDay && (
              <Rec
                label="写代码最多的一天"
                value={`+${fmtInt(r.codeDay.added)} 行`}
                sub={`${md(r.codeDay.t)} · 删除 ${fmtInt(r.codeDay.removed)} 行`}
                today={r.today.added / r.codeDay.added}
                beat={isToday(r.codeDay.t)}
              />
            )}
            {r.bigSession && (
              <Rec
                label="最大的一段对话"
                value={`${fmtTokens(r.bigSession.tokens)} token`}
                sub={`${r.bigSession.project} · ${md(r.bigSession.start)} · ${money(r.bigSession.cost)}`}
                onClick={() => openSession(r.bigSession!.id)}
                title="打开这段对话"
              />
            )}
            {r.costPrompt && (
              <Rec label="最贵的一个问题" value={money(r.costPrompt.cost)} sub={`${md(r.costPrompt.ts)} · ${r.costPrompt.text}`} onClick={() => openSession(r.costPrompt!.sessionId)} title={r.costPrompt.text} />
            )}
          </div>
          <div className="rec-avg">
            <span>
              平均每个使用日 <b>{fmtTokens(r.avg.dayTokens)}</b> token · <b>{money(r.avg.dayCost)}</b>
            </span>
            {r.avg.promptCost > 0 && (
              <span>
                每个问题 <b>{money(r.avg.promptCost)}</b> · <b>{fmtTokens(r.avg.promptTokens)}</b> token
              </span>
            )}
            {r.avg.promptsPerDay > 0 && (
              <span>
                每天 <b>{r.avg.promptsPerDay.toFixed(r.avg.promptsPerDay >= 10 ? 0 : 1)}</b> 个问题
              </span>
            )}
            {r.avg.sessionMinutes > 0 && (
              <span>
                一段对话通常 <b>{r.avg.sessionMinutes >= 60 ? `${(r.avg.sessionMinutes / 60).toFixed(1)} 小时` : `${Math.round(r.avg.sessionMinutes)} 分钟`}</b>
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
