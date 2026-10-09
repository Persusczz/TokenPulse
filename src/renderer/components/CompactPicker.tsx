import { COMPACT_PCT, COMPACT_TOKENS } from '@shared/compact'
import type { TaskCompactAt, UsageSource } from '@shared/types'

/** auto-compaction of a task: on or off, and where it kicks in (null: just before the context is full) */
export interface CompactChoice {
  on: boolean
  at: TaskCompactAt | null
}

type Mode = 'auto' | 'pct' | 'tokens' | 'off'

const modeOf = (c: CompactChoice): Mode => (!c.on ? 'off' : c.at ? c.at.unit : 'auto')
/** Claude Code keeps about this much free under the window it compacts in (summary output + buffer) */
const RESERVE = 33_000
const k = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : `${Math.round(n / 1000)}K`)

/** What the chosen point comes to, in tokens, for the models of the tool */
function hint(tool: UsageSource, c: CompactChoice, codexWindow: number): string {
  const m = modeOf(c)
  if (tool === 'workbuddy') return m === 'tokens' ? `WorkBuddy 的 --autocompact；实际阈值限制在 100K–1M Token` : 'WorkBuddy 按当前模型窗口自动压缩'
  if (m === 'off') return '上下文满了任务就停下，适合想完整保留对话的任务'
  if (m === 'auto') return tool === 'codex' ? 'Codex 自己决定，接近上下文上限时压缩' : 'Claude Code 默认：上下文满了、接口报错时才压缩'
  const v = c.at!.value
  if (m === 'pct') {
    if (tool === 'codex') return `Codex 窗口 ${k(codexWindow)}，约 ${k((codexWindow * v) / 100)} 时压缩`
    // the share is of the window minus the summary's output room (20K)
    return `200K 的模型约 ${k(180_000 * (v / 100))}、1M 的模型约 ${k(980_000 * (v / 100))} 时压缩`
  }
  if (tool === 'codex') return `上下文到 ${k(v)} 时压缩${v > codexWindow ? `（超过了 Codex 的窗口 ${k(codexWindow)}，等于不提前）` : ''}`
  if (v < 100_000 - RESERVE) return `Claude Code 最早约 ${k(100_000 - RESERVE)} 才压缩，会按这个来`
  return `约 ${k(v)} 时压缩${v > 200_000 - RESERVE ? '（200K 的模型到不了这么多，仍在快满时压缩）' : ''}`
}

/**
 * Where a task compacts its conversation: the CLI's own point, a share of
 * the context window, a token count, or not at all (Claude only).
 */
export function CompactPicker({ tool, value, onChange, codexWindow = 258_400 }: { tool: UsageSource; value: CompactChoice; onChange: (c: CompactChoice) => void; codexWindow?: number }) {
  const mode = modeOf(value)
  const pct = value.at?.unit === 'pct' ? value.at.value : 60
  const tokens = value.at?.unit === 'tokens' ? value.at.value : 200_000
  const limits = tool === 'workbuddy' ? { min: 100_000, max: 1_000_000 } : COMPACT_TOKENS
  const pick = (m: Mode) => {
    if (m === 'off') onChange({ on: false, at: value.at })
    else if (m === 'auto') onChange({ on: true, at: null })
    else if (m === 'pct') onChange({ on: true, at: { unit: 'pct', value: pct } })
    else onChange({ on: true, at: { unit: 'tokens', value: tokens } })
  }
  return (
    <span className="compact-pick">
      <select className="input" value={tool !== 'claude' && (mode === 'off' || tool === 'workbuddy' && mode === 'pct') ? 'auto' : mode} onChange={(e) => pick(e.target.value as Mode)}>
        <option value="auto">快满时自动压缩</option>
        {tool !== 'workbuddy' && <option value="pct">上下文到百分比时压缩</option>}
        <option value="tokens">上下文到 Token 数时压缩</option>
        {tool === 'claude' && <option value="off">不自动压缩</option>}
      </select>
      {mode === 'pct' && tool !== 'workbuddy' && (
        <span className="compact-range">
          <input
            type="range"
            min={COMPACT_PCT.min}
            max={COMPACT_PCT.max}
            step={5}
            value={pct}
            style={{ ['--p' as string]: `${((pct - COMPACT_PCT.min) / (COMPACT_PCT.max - COMPACT_PCT.min)) * 100}%` }}
            onChange={(e) => onChange({ on: true, at: { unit: 'pct', value: Number(e.target.value) } })}
          />
          <b className="tnum">{pct}%</b>
        </span>
      )}
      {mode === 'tokens' && (
        <span className="compact-tokens">
          <input
            className="input tnum"
            type="number"
            min={limits.min / 1000}
            max={limits.max / 1000}
            step={10}
            value={Math.round(tokens / 1000)}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (Number.isFinite(n) && n > 0) onChange({ on: true, at: { unit: 'tokens', value: Math.min(limits.max, Math.max(limits.min, Math.round(n) * 1000)) } })
            }}
          />
          K
        </span>
      )}
      <span className="muted compact-hint">{hint(tool, value, codexWindow)}</span>
    </span>
  )
}
