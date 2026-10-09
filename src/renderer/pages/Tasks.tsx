import { AnimatePresence, motion } from 'motion/react'
import { memo, useEffect, useMemo, useState, type DragEvent, type Ref } from 'react'
import type { ScheduledTask, TaskAction, TaskAttempt, TaskEffort, TaskFailure, TaskLogLine, TaskMove, TaskPatch, TaskPermission, TaskQueueState, UsageSource } from '@shared/types'
import { compactText } from '@shared/compact'
import { SourceMark } from '../components/CodexMark'
import { SOURCE_NAMES } from '@shared/sources'
import { CompactPicker, type CompactChoice } from '../components/CompactPicker'
import { Segmented } from '../components/Segmented'
import { Starburst } from '../components/Starburst'
import { WorkBuddyMark } from '../../features/workbuddy/WorkBuddyMark'
import { countdown, TOOL_CLI, useApp, useNow, useSource } from '../state'
import { CODEX_PERMISSIONS, useCodexModels } from './SettingsPage'
import { FlowRing } from '../components/Fx'

const PERMISSIONS: { value: TaskPermission; label: string; desc: string }[] = [
  { value: 'inherit', label: '跟随设置', desc: '使用 Claude Code 自己的权限设置' },
  { value: 'auto', label: '自动', desc: 'Claude Code 的 auto 模式：由分类器判断操作是否安全' },
  { value: 'acceptEdits', label: '允许改文件', desc: '可以读写文件，其他需要确认的操作会被拒绝' },
  { value: 'bypassPermissions', label: '完全放行', desc: '跳过所有权限确认，适合信任的仓库' },
  { value: 'plan', label: '只做规划', desc: '只读分析、写出计划，不改任何东西' }
]
const MODELS = [
  { value: '', label: '默认模型' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' }
]
const RETRIES = [0, 1, 2, 3, 5]
const TIMEOUTS = [0, 15, 30, 60, 120, 240]
const EFFORTS: { value: TaskEffort | ''; label: string }[] = [
  { value: '', label: '默认思考' },
  { value: 'low', label: '少想（low）' },
  { value: 'medium', label: '适中（medium）' },
  { value: 'high', label: '多想（high）' },
  { value: 'xhigh', label: '深想（xhigh）' },
  { value: 'max', label: '想到底（max）' }
]
const FAILURE: Record<TaskFailure, string> = {
  stopped: '被停止',
  quota: '额度用完',
  transient: '网络/服务出错',
  timeout: '超时',
  check: '检查没通过',
  budget: '到花费上限',
  setup: '换了模型',
  other: '没有完成'
}
const TRY_KIND: Record<TaskAttempt['kind'], string> = { run: '首次', retry: '重试', fix: '修正', resume: '接着做' }

const WINDOW = 5 * 3600_000
const DAY = 86_400_000

const when = (t: number) => new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const folder = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p
const duration = (ms: number) => {
  const m = Math.round(ms / 60_000)
  return m < 1 ? '不到 1 分钟' : m < 60 ? `${m} 分钟` : `${Math.floor(m / 60)} 小时 ${m % 60} 分`
}
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const LOG_ICON: Record<TaskLogLine['kind'], string> = { system: '·', thinking: '✻', text: '💬', tool: '🔧', result: '✅', error: '⚠' }
const toolOf = (t: ScheduledTask): UsageSource => t.tool ?? 'claude'
/** same as the main process: one folder of one tool runs one task at a time */
const laneOf = (t: ScheduledTask) => `${toolOf(t)}:${t.cwd.replace(/[\\/]+$/, '').toLowerCase()}`
const permLabel = (t: ScheduledTask) => (toolOf(t) === 'codex' ? CODEX_PERMISSIONS : PERMISSIONS).find((p) => p.value === t.permission)?.label ?? t.permission
const finished = (t: ScheduledTask) => t.status === 'done' || t.status === 'failed' || t.status === 'cancelled'
/** a try that failed at the task itself (a model swap TokenPulse made does not count) */
const realFail = (a: TaskAttempt) => !a.ok && a.failure !== 'setup'

/** One tool's next 5h refresh: a ring counting down, and what the queue does then */
function ToolRefresh({ tool, state, now, compact }: { tool: UsageSource; state: TaskQueueState; now: number; compact: boolean }) {
  const info = state.tools?.[tool] ?? { cli: state.claude, nextReset: state.nextReset, waiting: state.waiting }
  const reset = info.nextReset
  const queued = state.tasks.filter((t) => toolOf(t) === tool && t.status === 'queued')
  const atReset = reset ? queued.filter((t) => !t.parentId && t.trigger === 'reset' && t.notBefore <= reset + 120_000).length : 0
  const retrying = queued.filter((t) => t.pending).length
  const elapsed = reset ? Math.min(1, Math.max(0, 1 - (reset - now) / WINDOW)) : 1
  const R = 54
  const C = 2 * Math.PI * R
  return (
    <div className={`task-refresh${compact ? ' compact' : ''} tool-${tool}`}>
      <div className="task-ring">
        <svg viewBox="0 0 128 128" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="64" cy="64" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="10" />
          <circle cx="64" cy="64" r={R} fill="none" stroke={tool === 'workbuddy' ? 'var(--workbuddy)' : tool === 'codex' ? 'var(--codex)' : 'var(--claude)'} strokeWidth="10" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - elapsed)} />
        </svg>
        <div className="task-ring-in">
          {reset ? (
            <>
              <b className="serif tnum">{countdown(reset, now)}</b>
              <small>后刷新</small>
            </>
          ) : (
            <>
              <b className="serif">就绪</b>
              <small>{tool === 'workbuddy' ? '按积分计费' : '额度空闲'}</small>
            </>
          )}
        </div>
      </div>
      <div className="task-hero-text">
        <div className="card-title">
          <span className="title-mark small">
            <SourceMark size={18} animated={false} source={tool} />
          </span>
          <span className="serif">{tool === 'workbuddy' ? 'WorkBuddy 任务' : compact ? `${TOOL_CLI[tool]} 下次刷新` : `${TOOL_CLI[tool]} · 下一次 5h 刷新`}</span>
        </div>
        <div className="task-hero-when">{tool === 'workbuddy' ? '随时开始' : reset ? when(reset) : '当前没有进行中的 5h 窗口，排队的任务会马上开始'}</div>
        <div className="task-hero-sub">
          {queued.length ? `排队 ${queued.length} 个${reset && atReset ? `，其中 ${atReset} 个在这次刷新时开始` : ''}${retrying ? ` · ${retrying} 个等着再试` : ''}` : `还没有 ${TOOL_CLI[tool]} 任务`}
        </div>
        {info.waiting && <div className="task-wait">⏳ {info.waiting}</div>}
        {!info.cli && <div className="task-wait bad">没有找到 {TOOL_CLI[tool]} 命令，请确认已安装</div>}
      </div>
    </div>
  )
}

function NextRefresh({ state, now, tools }: { state: TaskQueueState; now: number; tools: UsageSource[] }) {
  const { settings, saveSettings } = useApp()
  const running = state.tasks.filter((t) => t.status === 'running' && tools.includes(toolOf(t)))
  const lanes = new Set(running.map(laneOf)).size
  return (
    <div className="card task-hero">
      {tools.map((tool) => (
        <ToolRefresh key={tool} tool={tool} state={state} now={now} compact={tools.length > 1} />
      ))}
      <div className="task-hero-foot">
        <span className="muted">
          {state.terminal ? '🖥 任务在终端窗口里运行，能看到思考过程' : state.node ? '任务在后台运行（设置里可以改成终端窗口）' : '没有找到 Node.js，任务在后台运行'}
          {lanes > 1 && ` · ${lanes} 个文件夹并行中`}
        </span>
        <label className="check" title="排好的任务先不执行；正在执行的不受影响">
          <input type="checkbox" checked={!!settings?.taskQueuePaused} onChange={(e) => void saveSettings({ taskQueuePaused: e.target.checked })} />
          暂停队列
        </label>
      </div>
    </div>
  )
}

/** The last 30 days of tasks in numbers: how often they finish, and how often trial and error saved one */
function TaskStats({ tasks, now }: { tasks: ScheduledTask[]; now: number }) {
  const { money } = useApp()
  const s = useMemo(() => {
    const fin = tasks.filter((t) => (t.status === 'done' || t.status === 'failed') && (t.finishedAt ?? 0) >= now - 30 * DAY)
    const done = fin.filter((t) => t.status === 'done')
    const rescued = done.filter((t) => (t.attempts ?? []).slice(0, -1).some(realFail)).length
    const tries = fin.reduce((n, t) => n + Math.max(1, t.attempts?.length ?? 1), 0)
    const cost = fin.reduce((n, t) => n + (t.costUsd ?? 0), 0)
    const times = done.filter((t) => t.startedAt && t.finishedAt).map((t) => t.finishedAt! - t.startedAt!)
    const checked = done.filter((t) => t.verify).length
    return { total: fin.length, done: done.length, failed: fin.length - done.length, rescued, tries, cost, avg: times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0, checked }
  }, [tasks, Math.floor(now / 60_000)])
  if (!s.total) return null
  const rate = s.done / s.total
  const R = 15
  const C = 2 * Math.PI * R
  return (
    <div className="card task-stats">
      <div className="task-stats-head">
        <div className="task-stats-ring" title={`近 30 天成功率 ${Math.round(rate * 100)}%`}>
          <svg viewBox="0 0 40 40">
            <circle cx="20" cy="20" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="5" />
            <circle cx="20" cy="20" r={R} fill="none" stroke="var(--good, #5e9b4a)" strokeWidth="5" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - rate)} transform="rotate(-90 20 20)" />
          </svg>
          <b className="tnum">{Math.round(rate * 100)}%</b>
        </div>
        <div>
          <div className="card-title">
            <span className="serif">近 30 天的任务</span>
          </div>
          <span className="muted task-stats-note">
            成功率 {Math.round(rate * 100)}%{s.checked ? ` · ${s.checked} 个完成时通过了检查` : ''}
          </span>
        </div>
      </div>
      <div className="task-stats-grid">
      <div className="task-stat">
        <b className="tnum">{s.done}</b>
        <small>完成</small>
      </div>
      <div className="task-stat">
        <b className={`tnum${s.failed ? ' bad-text' : ''}`}>{s.failed}</b>
        <small>失败</small>
      </div>
      <div className="task-stat" title="先失败、后来靠自动重试或修正检查才完成的任务">
        <b className="tnum accent-text">{s.rescued}</b>
        <small>试错救回</small>
      </div>
      <div className="task-stat">
        <b className="tnum">{(s.tries / s.total).toFixed(1)}</b>
        <small>平均尝试次数</small>
      </div>
      <div className="task-stat">
        <b className="tnum">{money(s.cost)}</b>
        <small>花费（API 等价）</small>
      </div>
      <div className="task-stat">
        <b className="tnum">{s.avg ? duration(s.avg) : '—'}</b>
        <small>平均用时</small>
      </div>
      </div>
    </div>
  )
}

/** What is typed into the form but not yet queued; null fields follow the defaults in settings */
interface Draft {
  prompt: string
  cwd: string
  tool: UsageSource | null
  trigger: ScheduledTask['trigger']
  at: string
  repeat: boolean
  permission: TaskPermission | null
  model: string | null
  continue: boolean | null
  /** null: the default in settings */
  compact: CompactChoice | null
  parentId: string
  /** null: the default in settings */
  retries: number | null
  verify: string
  /** null: the default in settings; 0: no limit */
  timeoutMin: number | null
  effort: TaskEffort | ''
  fallbackModel: string
  budgetUsd: string
  more: boolean
}
const DRAFT_KEY = 'tp.task.draft'
const EMPTY: Draft = {
  prompt: '',
  cwd: '',
  tool: null,
  trigger: 'reset',
  at: '',
  repeat: false,
  permission: null,
  model: null,
  continue: null,
  compact: null,
  parentId: '',
  retries: null,
  verify: '',
  timeoutMin: null,
  effort: '',
  fallbackModel: '',
  budgetUsd: '',
  more: false
}
/** kept outside the component: leaving the page unmounts the form, the draft must survive it */
let draftMem: Draft | null = null
/** "copy as a new task" fills the form through this */
const DRAFT_EVENT = 'tp-task-draft'

function loadDraft(): Draft {
  if (draftMem) return draftMem
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null')
    draftMem = d && typeof d === 'object' ? { ...EMPTY, ...d } : { ...EMPTY }
  } catch {
    draftMem = { ...EMPTY }
  }
  return draftMem!
}

function saveDraft(d: Draft): void {
  draftMem = d
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d))
  } catch {
    /* ignore */
  }
}

/** a task's settings as a draft for the form */
function draftOf(t: ScheduledTask): Partial<Draft> {
  return {
    prompt: t.prompt,
    cwd: t.cwd,
    tool: toolOf(t),
    permission: t.permission,
    model: t.model ?? '',
    continue: t.continue,
    compact: { on: t.autoCompact, at: t.compactAt ?? null },
    retries: t.retries ?? 0,
    verify: t.verify ?? '',
    timeoutMin: t.timeoutMin ?? 0,
    effort: t.effort ?? '',
    fallbackModel: t.fallbackModel ?? '',
    budgetUsd: t.budgetUsd ? String(t.budgetUsd) : '',
    trigger: 'reset',
    parentId: '',
    more: !!(t.effort || t.fallbackModel || t.budgetUsd)
  }
}

function RetrySelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(Number(e.target.value))} title="失败后自动再试几次：网络出错会等一会儿再试，检查没通过会把输出交给它去修">
      {RETRIES.map((n) => (
        <option key={n} value={n}>
          {n ? `失败后重试 ${n} 次` : '失败不重试'}
        </option>
      ))}
    </select>
  )
}

function TimeoutSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const list = TIMEOUTS.includes(value) ? TIMEOUTS : [...TIMEOUTS, value].sort((a, b) => a - b)
  return (
    <select className="input" value={value} onChange={(e) => onChange(Number(e.target.value))} title="每次尝试最长多久，超时就停下（还有重试次数的话接着做）">
      {list.map((n) => (
        <option key={n} value={n}>
          {n ? `每次最长 ${n >= 60 ? `${n / 60} 小时` : `${n} 分钟`}` : '不限时'}
        </option>
      ))}
    </select>
  )
}

function ModelSelect({ tool, value, onChange, empty = '默认模型' }: { tool: UsageSource; value: string; onChange: (v: string) => void; empty?: string }) {
  const codexModels = useCodexModels()
  const { pricing } = useApp()
  const buddyModels = [...new Set((pricing?.models ?? []).filter((m) => m.source === 'workbuddy').map((m) => m.model))]
  const list = tool === 'workbuddy' ? buddyModels : tool === 'codex' ? codexModels : MODELS.slice(1).map((m) => m.value)
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{empty}</option>
      {[...list, ...(value && !list.includes(value) ? [value] : [])].map((m) => (
        <option key={m} value={m}>
          {MODELS.find((x) => x.value === m)?.label ?? m}
        </option>
      ))}
    </select>
  )
}

function EffortSelect({ tool, value, onChange }: { tool: UsageSource; value: TaskEffort | ''; onChange: (v: TaskEffort | '') => void }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value as TaskEffort | '')} title={tool === 'codex' ? 'Codex 的 model_reasoning_effort' : `${TOOL_CLI[tool]} 的 --effort`}>
      {EFFORTS.filter((x) => tool !== 'codex' || x.value !== 'max').map((x) => (
        <option key={x.value} value={x.value}>
          {x.label}
        </option>
      ))}
    </select>
  )
}

function NewTask({ state, view }: { state: TaskQueueState; view: UsageSource | 'all' }) {
  const { settings } = useApp()
  const [d, setD] = useState<Draft>(loadDraft)
  const [msg, setMsg] = useState('')
  const set = (patch: Partial<Draft>) =>
    setD((prev) => {
      const next = { ...prev, ...patch }
      saveDraft(next)
      return next
    })
  useEffect(() => {
    if (view !== 'all' && (d.tool ?? 'claude') !== view) set({ tool: view, permission: null, model: null, fallbackModel: '' })
  }, [view])
  // "copy as a new task" from a card
  useEffect(() => {
    const on = (e: Event) => {
      set((e as CustomEvent<Partial<Draft>>).detail)
      document.querySelector('.task-new')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setMsg('已把任务的设置填进表单，改好再加入队列')
      setTimeout(() => setMsg(''), 5000)
    }
    document.addEventListener(DRAFT_EVENT, on)
    return () => document.removeEventListener(DRAFT_EVENT, on)
  }, [])
  const tool: UsageSource = view === 'all' ? (d.tool ?? 'claude') : view
  const { prompt, trigger: savedTrigger, at, repeat: savedRepeat } = d
  const trigger = tool === 'workbuddy' && savedTrigger === 'reset' ? 'manual' : savedTrigger
  const repeat = tool !== 'workbuddy' && savedRepeat
  const cwd = d.cwd || settings?.taskCwd || ''
  const permission = d.permission ?? (tool === 'workbuddy' ? 'inherit' : tool === 'codex' ? settings?.codexTaskPermission : settings?.taskPermission) ?? 'inherit'
  const perms = tool === 'codex' ? CODEX_PERMISSIONS : PERMISSIONS
  const shownPerm = perms.some((p) => p.value === permission) ? permission : 'inherit'
  const model = d.model ?? (tool === 'workbuddy' ? '' : tool === 'codex' ? settings?.codexTaskModel : settings?.taskModel) ?? ''
  const cont = d.continue ?? settings?.taskContinue ?? true
  const compact: CompactChoice = d.compact ?? { on: settings?.taskAutoCompact ?? true, at: settings?.taskCompactAt ?? null }
  const retries = d.retries ?? settings?.taskRetries ?? 1
  const timeout = d.timeoutMin ?? settings?.taskTimeoutMin ?? 0
  const budget = Number(d.budgetUsd)
  const parents = state.tasks.filter((t) => t.status === 'queued' || t.status === 'running').sort((a, b) => a.order - b.order)
  const parentId = parents.some((t) => t.id === d.parentId) ? d.parentId : ''
  const submit = async () => {
    if (!prompt.trim() || !cwd.trim()) return
    const t = await window.api.addTask({
      prompt,
      cwd,
      tool,
      trigger,
      at: trigger === 'time' && at ? new Date(at).getTime() : null,
      repeat,
      permission: shownPerm,
      model: model || null,
      continue: cont,
      autoCompact: tool === 'codex' || compact.on,
      compactAt: compact.at,
      parentId: parentId || null,
      retries,
      verify: d.verify.trim() || null,
      timeoutMin: timeout || null,
      effort: d.effort || null,
      fallbackModel: d.fallbackModel || null,
      budgetUsd: tool === 'claude' && budget > 0 ? budget : null
    })
    set({ prompt: '', at: '', parentId: '' })
    const parent = parents.find((p) => p.id === parentId)
    setMsg(
      parent
        ? `已加入，「${short(parent.prompt, 16)}」完成后开始`
        : trigger === 'manual'
          ? '已加入，等你手动开始或拖到别的任务下面'
          : t.notBefore <= Date.now() + 5000
            ? '已加入，马上开始'
            : `已加入，将在 ${when(t.notBefore)} 开始`
    )
    setTimeout(() => setMsg(''), 5000)
  }
  return (
    <div className="card task-new">
      <div className="card-head">
        <div className="card-title">
          <span className="serif">发布任务</span>
          {view === 'all' && (
            <Segmented
              small
              value={tool}
              onChange={(v) => set({ tool: v, permission: null, model: null, fallbackModel: '' })}
              options={[
                { value: 'claude', label: 'Claude Code' },
                { value: 'codex', label: 'Codex' },
                { value: 'workbuddy', label: 'WorkBuddy' }
              ]}
            />
          )}
        </div>
        {msg && <span className="ok-text">{msg}</span>}
      </div>
      <textarea
        className="input task-prompt"
        rows={4}
        placeholder={`交给 ${TOOL_CLI[tool]} 的任务，例如：把 tests 里失败的用例修好，跑一遍 npm test，确认全部通过后总结改了什么`}
        value={prompt}
        onChange={(e) => set({ prompt: e.target.value })}
        onKeyDown={(e) => e.ctrlKey && e.key === 'Enter' && void submit()}
      />
      <div className="task-form-row">
        <span className="tg-label">工作目录</span>
        <input className="input mono" placeholder="G:\code\my-project" value={cwd} onChange={(e) => set({ cwd: e.target.value })} />
        <button className="btn small" onClick={() => void window.api.pickFolder().then((p) => p && set({ cwd: p }))}>
          选择…
        </button>
      </div>
      <div className="task-form-row">
        <span className="tg-label">开始</span>
        {parentId ? (
          <span className="task-after-note">接在所选任务之后，它完成就开始</span>
        ) : (
          <>
            <Segmented
              small
              value={trigger}
              onChange={(v) => set({ trigger: v })}
              options={[
                ...(tool === 'workbuddy' ? [] : [{ value: 'reset' as const, label: '下次刷新' }]),
                { value: 'now', label: '立即' },
                { value: 'time', label: '指定时间' },
                { value: 'manual', label: '先放着' }
              ]}
            />
            {trigger === 'time' && <input type="datetime-local" className="input tnum" value={at} onChange={(e) => set({ at: e.target.value })} />}
          </>
        )}
      </div>
      <div className="task-form-row">
        <span className="tg-label">排在</span>
        <select className="input" value={parentId} onChange={(e) => set({ parentId: e.target.value })}>
          <option value="">不跟在别的任务后面</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>
              {view === 'all' ? `[${SOURCE_NAMES[toolOf(p)]}] ` : ''}
              {short(p.prompt.replace(/\s+/g, ' '), 40)} 之后
            </option>
          ))}
        </select>
        {tool !== 'workbuddy' && <label className="check">
          <input type="checkbox" checked={repeat} onChange={(e) => set({ repeat: e.target.checked })} />
          每次刷新都执行
        </label>}
      </div>
      <div className="task-form-row">
        <span className="tg-label" title="失败后自动再试；做完后可以跑一个检查命令，没通过就把输出交给它接着修">
          试错
        </span>
        <RetrySelect value={retries} onChange={(v) => set({ retries: v })} />
        <input
          className="input mono task-check"
          placeholder="检查命令（可选），如 npm test"
          value={d.verify}
          onChange={(e) => set({ verify: e.target.value })}
          title="在工作目录里运行，退出代码 0 算通过；没通过时把输出交给下一次尝试去修"
        />
        <TimeoutSelect value={timeout} onChange={(v) => set({ timeoutMin: v })} />
      </div>
      <div className="task-form-row">
        <span className="tg-label">对话</span>
        <label className="check" title={tool === 'codex' ? 'codex exec resume：接着这个文件夹最近的 Codex 会话' : `${TOOL_CLI[tool]} --continue --fork-session：接着最近的对话，分叉成新会话`}>
          <input type="checkbox" checked={cont} onChange={(e) => set({ continue: e.target.checked })} />
          接着上次的对话（{tool === 'codex' ? 'resume' : '--continue'}）
        </label>
      </div>
      <div className="task-form-row">
        <span className="tg-label" title="长任务的对话越来越长时，在哪里把它压缩成摘要">
          压缩
        </span>
        <CompactPicker tool={tool} value={compact} onChange={(c) => set({ compact: c })} />
      </div>
      <div className="task-form-row">
        <span className="tg-label">{tool === 'codex' ? '沙箱' : '权限'}</span>
        <select className="input" value={shownPerm} onChange={(e) => set({ permission: e.target.value as TaskPermission })} title={perms.find((p) => p.value === shownPerm)?.desc}>
          {perms.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <ModelSelect tool={tool} value={model} onChange={(v) => set({ model: v })} />
        <span className="muted task-perm-desc">{perms.find((p) => p.value === shownPerm)?.desc.replace('Claude Code', TOOL_CLI[tool])}</span>
        <button className="btn ghost small task-more" onClick={() => set({ more: !d.more })}>
          {d.more ? '收起选项 ▴' : '更多选项 ▾'}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {d.more && (
          <motion.div className="task-form-row" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
            <span className="tg-label">进阶</span>
            <EffortSelect tool={tool} value={d.effort} onChange={(v) => set({ effort: v })} />
            <span title={tool === 'codex' ? '重试时改用这个模型' : '主模型过载或不可用时自动切换（--fallback-model），重试时也用它'}>
              <ModelSelect tool={tool} value={d.fallbackModel} onChange={(v) => set({ fallbackModel: v })} empty="不用备用模型" />
            </span>
            {tool === 'claude' && (
              <label className="task-budget" title="每次尝试最多花多少（--max-budget-usd，按 API 价格算），到了就停下，不再重试">
                上限 $
                <input className="input tnum" type="number" min="0" step="0.5" placeholder="不限" value={d.budgetUsd} onChange={(e) => set({ budgetUsd: e.target.value })} />
              </label>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="task-form-row end">
        <span className="muted" style={{ fontSize: 12 }}>
          Ctrl+Enter 提交
        </span>
        <button className="btn primary" disabled={!prompt.trim() || !cwd.trim()} onClick={() => void submit()}>
          加入队列
        </button>
      </div>
    </div>
  )
}

/** Changes a task that is not running; a finished one is then tried again */
function TaskEditor({ t, onClose }: { t: ScheduledTask; onClose: () => void }) {
  const tool = toolOf(t)
  const [p, setP] = useState({
    prompt: t.prompt,
    verify: t.verify ?? '',
    retries: t.retries ?? 0,
    timeoutMin: t.timeoutMin ?? 0,
    model: t.model ?? '',
    permission: t.permission,
    effort: (t.effort ?? '') as TaskEffort | '',
    compact: { on: t.autoCompact, at: t.compactAt ?? null } as CompactChoice
  })
  const set = (patch: Partial<typeof p>) => setP((x) => ({ ...x, ...patch }))
  const perms = tool === 'codex' ? CODEX_PERMISSIONS : PERMISSIONS
  const save = (then: 'keep' | 'now' | 'reset') => {
    if (!p.prompt.trim()) return
    const patch: TaskPatch = {
      prompt: p.prompt,
      verify: p.verify.trim() || null,
      retries: p.retries,
      timeoutMin: p.timeoutMin || null,
      model: p.model || null,
      permission: p.permission,
      effort: p.effort || null,
      autoCompact: tool === 'codex' || p.compact.on,
      compactAt: p.compact.at
    }
    void window.api.updateTask(t.id, patch, then)
    onClose()
  }
  const queued = t.status === 'queued'
  const last = t.attempts?.[t.attempts.length - 1]
  return (
    <div className="task-edit">
      {!queued && t.error && <div className="task-edit-why">上次{last?.failure ? FAILURE[last.failure] : '没有完成'}：{short(t.error, 140)}。可以把任务说得更具体、换个模型、放宽权限或加一个检查，再试一次</div>}
      <textarea className="input task-prompt" rows={3} value={p.prompt} onChange={(e) => set({ prompt: e.target.value })} />
      <div className="task-form-row">
        <span className="tg-label">试错</span>
        <RetrySelect value={p.retries} onChange={(v) => set({ retries: v })} />
        <input className="input mono task-check" placeholder="完成后的检查命令（可选）" value={p.verify} onChange={(e) => set({ verify: e.target.value })} />
        <TimeoutSelect value={p.timeoutMin} onChange={(v) => set({ timeoutMin: v })} />
      </div>
      <div className="task-form-row">
        <span className="tg-label">{tool === 'codex' ? '沙箱' : '权限'}</span>
        <select className="input" value={perms.some((x) => x.value === p.permission) ? p.permission : 'inherit'} onChange={(e) => set({ permission: e.target.value as TaskPermission })}>
          {perms.map((x) => (
            <option key={x.value} value={x.value}>
              {x.label}
            </option>
          ))}
        </select>
        <ModelSelect tool={tool} value={p.model} onChange={(v) => set({ model: v })} />
        <EffortSelect tool={tool} value={p.effort} onChange={(v) => set({ effort: v })} />
      </div>
      <div className="task-form-row">
        <span className="tg-label">压缩</span>
        <CompactPicker tool={tool} value={p.compact} onChange={(c) => set({ compact: c })} />
      </div>
      <div className="task-form-row end">
        <span className="muted" style={{ fontSize: 12 }}>
          {queued ? '保存后仍按原来的时间开始' : tool === 'workbuddy' ? '改好后马上再试' : '改好后马上再试，或者排到下次额度刷新'}
        </span>
        <span className="task-edit-btns">
          <button className="btn ghost small" onClick={onClose}>
            取消
          </button>
          {queued ? (
            <button className="btn primary small" disabled={!p.prompt.trim()} onClick={() => save('keep')}>
              保存
            </button>
          ) : (
            <>
              {tool !== 'workbuddy' && <button className="btn small" disabled={!p.prompt.trim()} onClick={() => save('reset')}>
                保存，下次刷新时做
              </button>}
              <button className="btn primary small" disabled={!p.prompt.trim()} onClick={() => save('now')}>
                保存并立即重试
              </button>
            </>
          )}
        </span>
      </div>
    </div>
  )
}

/** Says more in the task's own conversation: a new task that carries it on (in a fork for Claude) */
function FollowUp({ t, onClose }: { t: ScheduledTask; onClose: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const tool = toolOf(t)
  const send = async () => {
    if (!text.trim() || !t.sessionId) return
    setBusy(true)
    await window.api.addTask({
      prompt: text,
      cwd: t.cwd,
      tool,
      trigger: 'now',
      resumeId: t.sessionId,
      followOf: t.id,
      permission: t.permission,
      model: t.model,
      autoCompact: t.autoCompact,
      compactAt: t.compactAt ?? null,
      continue: false,
      retries: t.retries ?? 0,
      verify: t.verify ?? null,
      timeoutMin: t.timeoutMin ?? null,
      effort: t.effort ?? null
    })
    onClose()
  }
  return (
    <div className="task-follow">
      <div className="muted">
        接着这个任务的对话继续说，马上开始（{tool === 'codex' ? 'codex exec resume' : `${TOOL_CLI[tool]} --resume，分叉成新会话，原对话不变`}）
      </div>
      <textarea
        className="input task-prompt"
        rows={2}
        autoFocus
        placeholder={t.status === 'failed' ? '例如：刚才卡在哪里？换个办法接着做完' : '例如：再把这部分的测试补上 / 解释一下为什么这么改'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.ctrlKey && e.key === 'Enter' && void send()}
      />
      <div className="task-form-row end">
        <span className="muted" style={{ fontSize: 12 }}>
          Ctrl+Enter 发送 · 沿用这个任务的权限、模型、检查和重试
        </span>
        <span className="task-edit-btns">
          <button className="btn ghost small" onClick={onClose}>
            取消
          </button>
          <button className="btn primary small" disabled={!text.trim() || busy} onClick={() => void send()}>
            追问
          </button>
        </span>
      </div>
    </div>
  )
}

/** The tries of the latest run, as a trail: what each one was and how it ended */
function TryTrail({ t, now }: { t: ScheduledTask; now: number }) {
  const tries = t.attempts ?? []
  const [open, setOpen] = useState(false)
  if (!(tries.length > 1 || t.pending || tries.some((a) => a.check))) return null
  const lastCheck = [...tries].reverse().find((a) => a.check && a.check.code !== 0)?.check
  return (
    <div className="try-trail">
      {tries.map((a, i) => {
        const state = a.ok === null ? 'run' : a.ok ? 'ok' : a.failure === 'setup' ? 'swap' : 'bad'
        const label = a.ok === null ? '进行中' : a.ok ? (a.check ? '检查通过' : '完成') : a.failure ? FAILURE[a.failure] : '没有完成'
        return (
          <span key={i} className="try-step">
            {i > 0 && <i className="try-link" />}
            <span
              className={`try ${state}`}
              title={[
                `第 ${a.n} 次 · ${TRY_KIND[a.kind]}`,
                a.model ? `模型 ${a.model}` : '',
                a.finishedAt ? `用时 ${duration(a.finishedAt - a.startedAt)}` : '',
                a.reason ?? '',
                a.check ? `检查退出 ${a.check.code}` : ''
              ]
                .filter(Boolean)
                .join('\n')}
            >
              <b>{a.n}</b>
              {TRY_KIND[a.kind]} · {label}
            </span>
          </span>
        )
      })}
      {t.pending && (
        <span className="try-step">
          <i className="try-link dashed" />
          <span className="try next">
            <b>{tries.length + 1}</b>
            {TRY_KIND[t.pending.kind]} · {t.notBefore > now ? `${countdown(t.notBefore, now)} 后` : '马上'}
          </span>
        </span>
      )}
      {lastCheck && (
        <button className="btn ghost small try-out" onClick={() => setOpen(!open)}>
          {open ? '收起检查输出' : `检查输出（退出 ${lastCheck.code}）`}
        </button>
      )}
      {open && lastCheck && <pre className="try-tail">{lastCheck.tail || '（没有输出）'}</pre>}
    </div>
  )
}

function TaskLog({ id, live }: { id: string; live: boolean }) {
  const [lines, setLines] = useState<TaskLogLine[]>([])
  useEffect(() => {
    const load = () => void window.api.taskLog(id).then(setLines)
    load()
    if (!live) return
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [id, live])
  return (
    <div className="task-log">
      {lines.length ? (
        lines.map((l, i) => (
          <div key={i} className={`task-log-line ${l.kind}`}>
            <span className="tnum">{new Date(l.t).toLocaleTimeString('zh-CN', { hour12: false })}</span>
            <i>{LOG_ICON[l.kind]}</i>
            <span>{l.text}</span>
          </div>
        ))
      ) : (
        <div className="muted">还没有输出</div>
      )}
    </div>
  )
}

type Drop = { id: string; how: TaskMove } | null

interface ItemProps {
  t: ScheduledTask
  all: ScheduledTask[]
  now: number
  waiting: string | null
  depth: number
  busyLanes: Set<string>
  showTool: boolean
  drop: Drop
  dragging: string | null
  onDrag: (id: string | null) => void
  onDrop: (d: Drop) => void
  /** AnimatePresence's popLayout lifts a leaving item out of the flow through this */
  ref?: Ref<HTMLDivElement>
}

/** where in the queue a task stands, in words */
function standing(t: ScheduledTask, all: ScheduledTask[], now: number, busy: boolean): string {
  const parent = t.parentId ? all.find((x) => x.id === t.parentId) : undefined
  if (t.force) return busy ? '马上开始（等这个文件夹的当前任务结束）' : '马上开始'
  if (t.pending) {
    const n = (t.attempts?.length ?? 0) + 1
    return t.notBefore > now ? `第 ${n} 次尝试 · ${when(t.notBefore)} · 还有 ${countdown(t.notBefore, now)}` : `第 ${n} 次尝试 · ${busy ? '等这个文件夹的当前任务结束' : '马上开始'}`
  }
  if (parent && parent.status !== 'done' && !(parent.doneAt && parent.doneAt >= t.queuedAt)) {
    if (parent.status === 'failed' || parent.status === 'cancelled') return `前置任务${parent.status === 'failed' ? '没有完成' : '已取消'}，等你决定`
    return `等「${short(parent.prompt.replace(/\s+/g, ' '), 18)}」完成`
  }
  if (!parent && t.trigger === 'manual') return '先放着，等你手动开始'
  if (t.notBefore > now) return `${when(t.notBefore)} 开始 · 还有 ${countdown(t.notBefore, now)}`
  return busy ? '等这个文件夹的当前任务结束' : '等待开始'
}

const EFFORT_SHORT: Record<TaskEffort, string> = { low: '少想', medium: '适中', high: '多想', xhigh: '深想', max: '想到底' }

const TaskItem = memo(function TaskItem({ t, all, now, waiting, depth, busyLanes, showTool, drop, dragging, onDrag, onDrop, ref }: ItemProps) {
  const { money } = useApp()
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState<'edit' | 'follow' | 'more' | null>(null)
  const tool = toolOf(t)
  const act = (a: TaskAction) => {
    // past the guard line the hook would hold the task at its first step anyway
    if ((a === 'start' || a === 'retry') && tool === 'claude' && waiting?.includes('守卫线') && !confirm(`${waiting}。\n现在开始的话，额度守卫会在任务的第一步就把它暂停，直到额度刷新。\n\n仍要现在开始吗？`)) return
    if (a === 'remove' && t.attempts && t.attempts.length > 1 && !confirm('删除这个任务和它所有尝试的日志？')) return
    void window.api.taskAction(t.id, a)
  }
  const parent = t.parentId ? all.find((x) => x.id === t.parentId) : undefined
  const follows = t.followOf ? all.find((x) => x.id === t.followOf) : undefined
  const queued = t.status === 'queued'
  const ended = finished(t)
  const chips = [
    folder(t.cwd),
    ...(t.followOf ? [follows ? `追问「${short(follows.prompt.replace(/\s+/g, ' '), 12)}」` : '追问'] : []),
    ...(parent ? [laneOf(parent) === laneOf(t) ? '同一窗口接着做' : '完成后另开窗口'] : []),
    ...(t.followOf ? [] : t.continue ? ['接着上次对话'] : ['新对话']),
    ...(tool === 'claude' && t.autoCompact === false ? ['不自动压缩'] : t.compactAt ? [`上下文 ${compactText(t.compactAt)} 时压缩`] : []),
    ...(t.repeat ? ['每次刷新'] : []),
    ...(t.permission !== 'inherit' ? [permLabel(t)] : []),
    ...(t.model ? [t.model] : []),
    ...(t.effort ? [`思考：${EFFORT_SHORT[t.effort]}`] : []),
    ...(t.fallbackModel ? [`备用 ${t.fallbackModel}`] : []),
    ...(t.retries ? [`失败重试 ${t.retries} 次`] : []),
    ...(t.timeoutMin ? [`每次限 ${t.timeoutMin} 分钟`] : []),
    ...(t.budgetUsd ? [`上限 ${money(t.budgetUsd)}`] : []),
    ...(t.runs > 1 ? [`第 ${t.runs} 次运行`] : []),
    ...(t.status === 'running' && t.mode === 'terminal' ? ['🖥 终端窗口'] : [])
  ]
  const zone = drop?.id === t.id ? drop.how : null
  const over = (e: DragEvent<HTMLDivElement>) => {
    if (!dragging || dragging === t.id) return
    e.preventDefault()
    e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    const y = (e.clientY - r.top) / r.height
    // only queued or running tasks can take subtasks
    const how: TaskMove = y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'child'
    if (zone !== how) onDrop({ id: t.id, how })
  }
  const tries = t.attempts?.length ?? 0
  const toggle = (p: 'edit' | 'follow' | 'more') => setPanel(panel === p ? null : p)
  return (
    <motion.div
      ref={ref}
      layout
      className={`task-node depth-${Math.min(depth, 4)}`}
      style={{ ['--depth' as string]: depth }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
    >
      {depth > 0 && <span className="task-link" aria-hidden />}
      <div
        className={`card task-item ${t.status}${t.pending ? ' retrying' : ''}${t.status === 'running' ? ' flow-border' : ''}${dragging === t.id ? ' dragging' : ''}${zone ? ` drop-${zone}` : ''}`}
        draggable={queued && !panel}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', t.id)
          onDrag(t.id)
        }}
        onDragEnd={() => {
          onDrag(null)
          onDrop(null)
        }}
        onDragOver={over}
        onDragLeave={(e) => {
          if (zone && !e.currentTarget.contains(e.relatedTarget as Node | null)) onDrop(null)
        }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const id = e.dataTransfer.getData('text/plain') || dragging
          if (id && zone && id !== t.id) void window.api.moveTask(id, t.id, zone)
          onDrag(null)
          onDrop(null)
        }}
      >
        {t.status === 'running' && <FlowRing />}
        {zone === 'child' && <div className="task-drop-label">放开：成为它的子任务，它完成后再开始</div>}
        <div className="task-item-head">
          {queued && (
            <span className="task-grip" title="拖动排序；拖到另一个任务上变成它的子任务">
              ⋮⋮
            </span>
          )}
          <span className={`task-state ${t.status}`}>
            {t.status === 'running' ? (
              tool === 'codex' ? (
                <SourceMark size={22} source="codex" intensity={3} />
              ) : (
                t.tool === 'workbuddy' ? <WorkBuddyMark size={22} /> : <Starburst size={22} intensity={3} />
              )
            ) : t.pending ? (
              '↻'
            ) : (
              { queued: '⏳', done: '✓', failed: '✕', cancelled: '–' }[t.status]
            )}
          </span>
          <div className="task-item-main">
            <div className="task-item-prompt">
              {showTool && <span className={`src-tag ${tool}`}>{SOURCE_NAMES[tool]}</span>}
              {t.prompt}
            </div>
            <div className="task-chips">
              {chips.map((c, i) => (
                <span key={i} className="badge">
                  {c}
                </span>
              ))}
              {t.verify && (
                <span className="badge check-badge" title={`完成后在工作目录里运行：${t.verify}`}>
                  🧪 {short(t.verify, 28)}
                </span>
              )}
              {queued && <span className="task-eta">{standing(t, all, now, busyLanes.has(laneOf(t)))}</span>}
              {t.status === 'running' && t.startedAt && (
                <span className="task-eta">
                  已运行 {countdown(now + (now - t.startedAt), now)}
                  {tries > 1 ? ` · 第 ${tries} 次尝试` : ''}
                </span>
              )}
              {(t.status === 'done' || t.status === 'failed') && t.finishedAt && (
                <span className="task-eta">
                  {when(t.finishedAt)} · {t.startedAt ? duration(t.finishedAt - t.startedAt) : ''}
                  {t.costUsd !== null ? ` · ${money(t.costUsd)}` : ''}
                  {t.tokens ? ` · ${(t.tokens / 1000).toFixed(1)}k tokens` : ''}
                  {t.turns ? ` · ${t.turns} 轮` : ''}
                  {t.steps ? ` · ${t.steps} 步` : ''}
                  {tries > 1 ? ` · 试了 ${tries} 次` : ''}
                </span>
              )}
            </div>
          </div>
          <div className="task-actions">
            {queued && (
              <>
                <button className="btn small" onClick={() => act('start')}>
                  {t.pending ? '现在就试' : '立即开始'}
                </button>
                <button className="btn ghost small" onClick={() => toggle('edit')}>
                  {panel === 'edit' ? '收起' : '编辑'}
                </button>
                {t.parentId && (
                  <button className="btn ghost small" onClick={() => void window.api.moveTask(t.id, null, 'root')} title="不再等前一个任务">
                    解除从属
                  </button>
                )}
                <button className="btn ghost small" onClick={() => act('cancel')} title={t.pending ? '不再重试，按现在的结果结束' : undefined}>
                  {t.pending ? '不再重试' : '取消'}
                </button>
              </>
            )}
            {t.status === 'running' && (
              <button className="btn small" onClick={() => act('stop')}>
                停止
              </button>
            )}
            {ended && (
              <>
                <button className="btn small" onClick={() => act('retry')} title="用同样的设置马上再做一次">
                  重试
                </button>
                <button className={`btn ${panel === 'edit' ? '' : 'ghost '}small`} onClick={() => toggle('edit')} title="改一下任务内容或设置再试">
                  调整
                </button>
                {t.sessionId && t.status !== 'cancelled' && (
                  <button className={`btn ${panel === 'follow' ? '' : 'ghost '}small`} onClick={() => toggle('follow')} title="接着这个任务的对话继续说">
                    追问
                  </button>
                )}
              </>
            )}
            {!queued && t.status !== 'cancelled' && (
              <button className="btn ghost small" onClick={() => setOpen(!open)}>
                {open ? '收起日志' : '日志'}
              </button>
            )}
            {ended && (
              <button className={`btn ghost small${panel === 'more' ? ' on' : ''}`} onClick={() => toggle('more')} title="更多操作">
                ⋯
              </button>
            )}
          </div>
        </div>
        {panel === 'more' && (
          <div className="task-more-row">
            {tool !== 'workbuddy' && <button className="btn ghost small" onClick={() => act('requeue')}>
              下次刷新时再做
            </button>}
            <button
              className="btn ghost small"
              onClick={() => {
                document.dispatchEvent(new CustomEvent(DRAFT_EVENT, { detail: draftOf(t) }))
                setPanel(null)
              }}
            >
              复制为新任务
            </button>
            <button className="btn ghost small danger" onClick={() => act('remove')}>
              删除
            </button>
          </div>
        )}
        {t.status === 'running' && t.activity && <div className={`task-activity${t.activity.startsWith('思考：') ? ' thinking' : ''}`}>{t.activity}</div>}
        <TryTrail t={t} now={now} />
        {t.note && <div className="task-note">ℹ {t.note}</div>}
        {t.status === 'failed' && t.error && (
          <div className="task-error">
            ⚠ {t.error}
            {/not supported when using Codex with a ChatGPT account/i.test(t.error) && (
              <div className="task-hint">这个模型不能直接用 ChatGPT 账号调用。点「调整」换成 gpt-5.5 这类账号支持的型号再试</div>
            )}
          </div>
        )}
        {(t.status === 'done' || (queued && t.pending)) && t.summary && !open && !panel && <div className="task-summary">{t.summary}</div>}
        <AnimatePresence initial={false}>
          {(panel === 'edit' || panel === 'follow') && (
            <motion.div key={panel} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
              {panel === 'edit' ? <TaskEditor t={t} onClose={() => setPanel(null)} /> : <FollowUp t={t} onClose={() => setPanel(null)} />}
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
              <TaskLog id={t.id} live={t.status === 'running'} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
})

const HISTORY_PAGE = 30
const noop = () => {}

export function TasksPage() {
  const source = useSource()
  const [state, setState] = useState<TaskQueueState | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [drop, setDrop] = useState<Drop>(null)
  const [rootOver, setRootOver] = useState(false)
  const [filter, setFilter] = useState<'all' | 'done' | 'failed'>('all')
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(HISTORY_PAGE)
  const now = useNow(1000)
  useEffect(() => {
    void window.api.getTasks().then(setState)
    return window.api.onTasks(setState)
  }, [])
  const tools: UsageSource[] = source === 'all' ? ['claude', 'codex', 'workbuddy'] : [source]
  const all = state?.tasks ?? []
  const mine = useMemo(() => all.filter((t) => tools.includes(toolOf(t))), [all, source])
  const active = mine.filter((t) => t.status === 'running' || t.status === 'queued').sort((a, b) => a.order - b.order)
  const history = useMemo(() => {
    const q = query.trim().toLowerCase()
    return mine
      .filter((t) => finished(t) && (filter === 'all' || t.status === filter || (filter === 'failed' && t.status === 'cancelled')))
      .filter((t) => !q || t.prompt.toLowerCase().includes(q) || t.cwd.toLowerCase().includes(q) || (t.summary ?? '').toLowerCase().includes(q))
      .sort((a, b) => (b.finishedAt ?? b.createdAt) - (a.finishedAt ?? a.createdAt))
  }, [mine, filter, query])
  const historyCount = mine.filter(finished).length
  const ids = new Set(active.map((t) => t.id))
  const kids = new Map<string, ScheduledTask[]>()
  const roots: ScheduledTask[] = []
  for (const t of active) {
    if (t.parentId && ids.has(t.parentId)) kids.set(t.parentId, [...(kids.get(t.parentId) ?? []), t])
    else roots.push(t)
  }
  // the tree in reading order, flat: every task is its own animated item (a subtree leaving never lingers)
  const rows: { t: ScheduledTask; depth: number }[] = []
  const walk = (t: ScheduledTask, depth: number) => {
    rows.push({ t, depth })
    for (const c of kids.get(t.id) ?? []) walk(c, depth + 1)
  }
  roots.forEach((t) => walk(t, 0))
  const busyLanes = useMemo(() => new Set(all.filter((t) => t.status === 'running').map(laneOf)), [all])
  const waitingOf = (t: ScheduledTask) => state?.tools?.[toolOf(t)]?.waiting ?? (toolOf(t) === 'claude' ? (state?.waiting ?? null) : null)
  const title = source === 'workbuddy' ? 'WorkBuddy 任务' : source === 'codex' ? 'Codex 刷新任务' : source === 'claude' ? 'Claude 刷新任务' : '刷新任务'
  const clear = () => {
    if (!confirm(`删除 ${source === 'all' ? '' : `${TOOL_CLI[source]} 的`}全部 ${historyCount} 个历史任务和它们的日志？排队和进行中的任务不受影响。`)) return
    void window.api.clearTaskHistory(source)
  }
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{title}</h1>
          <div className="page-sub">{source === 'workbuddy' ? '立即、定时或手动开始，按积分计费' : '5h 额度刷新时自动开始'}</div>
        </div>
      </div>
      {state && (
        <div className="task-top">
          <div className="task-side">
            <NextRefresh state={state} now={now} tools={tools} />
            <TaskStats tasks={mine} now={now} />
          </div>
          <NewTask state={state} view={source} />
        </div>
      )}
      <div className="task-section-title">
        进行中与排队 {active.length > 0 && <span className="muted">{active.length}</span>}
        {active.some((t) => t.status === 'queued') && <span className="task-dnd-hint">拖动 ⋮⋮ 排序 · 拖到另一个任务中间变成它的子任务</span>}
      </div>
      <div className="task-tree">
        <AnimatePresence initial={false} mode="popLayout">
          {rows.map(({ t, depth }) => (
            <TaskItem
              key={t.id}
              t={t}
              all={all}
              now={now}
              waiting={waitingOf(t)}
              depth={depth}
              busyLanes={busyLanes}
              showTool={source === 'all'}
              drop={drop}
              dragging={dragging}
              onDrag={setDragging}
              onDrop={setDrop}
            />
          ))}
        </AnimatePresence>
        {dragging && (
          <div
            className={`task-root-drop${rootOver ? ' on' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setRootOver(true)
              setDrop(null)
            }}
            onDragLeave={() => setRootOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              const id = e.dataTransfer.getData('text/plain') || dragging
              if (id) void window.api.moveTask(id, null, 'root')
              setRootOver(false)
              setDragging(null)
            }}
          >
            放到这里：回到顶层，排到最后
          </div>
        )}
      </div>
      {!active.length && <div className="empty">还没有排队的任务</div>}
      {historyCount > 0 && (
        <>
          <div className="task-section-title task-history-head">
            <span>
              历史 <span className="muted">{historyCount}</span>
            </span>
            <span className="task-history-tools">
              <Segmented
                small
                value={filter}
                onChange={(v) => {
                  setFilter(v)
                  setShown(HISTORY_PAGE)
                }}
                options={[
                  { value: 'all', label: '全部' },
                  { value: 'done', label: '完成' },
                  { value: 'failed', label: '没完成' }
                ]}
              />
              <input className="input task-search" placeholder="搜索任务、文件夹或结果" value={query} onChange={(e) => setQuery(e.target.value)} />
              <button className="btn ghost small" onClick={clear}>
                清空历史
              </button>
            </span>
          </div>
          <AnimatePresence initial={false} mode="popLayout">
            {history.slice(0, shown).map((t) => (
              <TaskItem
                key={t.id}
                t={t}
                all={all}
                now={0}
                waiting={waitingOf(t)}
                depth={0}
                busyLanes={busyLanes}
                showTool={source === 'all'}
                drop={null}
                dragging={null}
                onDrag={noop}
                onDrop={noop}
              />
            ))}
          </AnimatePresence>
          {!history.length && <div className="empty">没有符合条件的历史任务</div>}
          {history.length > shown && (
            <button className="btn ghost task-show-more" onClick={() => setShown(shown + HISTORY_PAGE)}>
              再显示 {Math.min(HISTORY_PAGE, history.length - shown)} 个（还有 {history.length - shown} 个）
            </button>
          )}
        </>
      )}
    </>
  )
}
