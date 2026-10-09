import { describe, expect, it } from 'vitest'
import { CODEX_KNOT } from '../src/shared/codexKnot'
import { draftButtons, draftCaption, draftStep, planText, taskPanelSvg, type DraftEnv, type TaskDraft, type ToolGlance } from '../src/main/tgTask'

const NOW = Date.UTC(2026, 9, 9, 6, 0)
const H = 3_600_000

const glance = (p: Partial<ToolGlance> = {}): ToolGlance => ({
  tool: 'claude',
  name: 'Claude Code',
  accent: '#d97757',
  windows: [
    { label: '5 小时额度', pct: 42, reset: '14:00 重置' },
    { label: '7 天额度', pct: 18, reset: '10/12 09:00 重置' }
  ],
  nextReset: NOW + 2 * H + 13 * 60_000,
  queued: 2,
  atReset: 1,
  running: 0,
  waiting: null,
  cli: true,
  guard: '守卫：5h 到 90% 时暂停',
  ...p
})

const env = (p: Partial<DraftEnv> = {}): DraftEnv => ({
  now: NOW,
  tools: ['claude', 'codex', 'workbuddy'],
  // the 5-hour window resets in 2 h 13 min (plus the grace minute)
  startAt: (tool, trigger) => (trigger === 'reset' && tool !== 'workbuddy' ? NOW + 2 * H + 14 * 60_000 : NOW),
  models: (tool) => (tool === 'claude' ? ['opus', 'sonnet', 'haiku'] : tool === 'codex' ? ['gpt-5.5', 'gpt-5.4'] : []),
  defaultModel: (tool) => (tool === 'claude' ? 'sonnet' : null),
  permission: (tool) => (tool === 'codex' ? '可写工作区' : '自动'),
  glance: glance(),
  ...p
})

const draft = (p: Partial<TaskDraft> = {}): TaskDraft => ({
  id: 'a1',
  prompt: '把 tests 里失败的用例修好',
  tool: 'claude',
  trigger: 'reset',
  cwd: 'G:\\code\\app',
  folders: ['G:\\code\\app', 'G:\\code\\site'],
  model: null,
  retries: 1,
  cont: true,
  photo: true,
  ...p
})

describe('task panel in Telegram', () => {
  it('says when the task would start', () => {
    expect(planText(draft(), env())).toMatch(/刷新后开始 · 还有 2 小时 14 分$/)
    expect(planText(draft({ trigger: 'now' }), env())).toBe('加入后马上开始')
    expect(planText(draft({ trigger: 'manual', tool: 'workbuddy' }), env())).toBe('先放着，点「现在开始」才执行 · 按积分计费')
    // nothing used in the window: no refresh to wait for
    expect(planText(draft(), env({ startAt: () => NOW }))).toBe('额度空闲，加入后马上开始')
  })

  it('shows the options as rows of buttons, the chosen ones ticked', () => {
    const rows = draftButtons(draft(), env())
    expect(rows[0].map((b) => b.text)).toEqual(['✓ Claude', 'Codex', 'WorkBuddy'])
    expect(rows[1].map((b) => b.text)).toEqual(['✓ ⏭ 下次刷新', '⚡ 立即', '📌 先放着'])
    expect(rows[2].map((b) => b.text)).toEqual(['✓ 📁 app', '📁 site'])
    expect(rows[3].map((b) => b.text)).toEqual(['🧠 Sonnet', '🔁 重试 1', '💬 续上次 ✓'])
    expect(rows[4].map((b) => b.data)).toEqual(['e:draft a1 go', 'e:draft a1 no', 'e:draft a1 redraw'])
    // callback data is limited to 64 bytes
    for (const row of rows) for (const b of row) expect(Buffer.byteLength(b.data)).toBeLessThanOrEqual(64)
    // WorkBuddy has no refresh to wait for and no model to pick
    const wb = draftButtons(draft({ tool: 'workbuddy', trigger: 'manual' }), env())
    expect(wb[1].map((b) => b.text)).toEqual(['⚡ 立即', '✓ 📌 先放着'])
    expect(wb[3].map((b) => b.text)).toEqual(['🔁 重试 1', '💬 续上次 ✓'])
  })

  it('applies a tapped option; only another tool needs a new picture', () => {
    const d = draft()
    const e = env()
    expect(draftStep(d, 'model', undefined, e)).toEqual({ picture: false })
    // default (sonnet) → opus → haiku → default: the default is not offered twice
    expect(d.model).toBe('opus')
    draftStep(d, 'model', undefined, e)
    expect(d.model).toBe('haiku')
    draftStep(d, 'model', undefined, e)
    expect(d.model).toBeNull()
    draftStep(d, 'cwd', '1', e)
    expect(d.cwd).toBe('G:\\code\\site')
    draftStep(d, 'retry', undefined, e)
    draftStep(d, 'cont', undefined, e)
    expect(d).toMatchObject({ retries: 2, cont: false })
    expect(draftStep(d, 'tool', 'workbuddy', e)).toEqual({ picture: true })
    // a refresh means nothing to WorkBuddy
    expect(d).toMatchObject({ tool: 'workbuddy', trigger: 'manual', model: null })
    draftStep(d, 'when', 'reset', e)
    expect(d.trigger).toBe('manual')
    expect(draftStep(d, 'tool', 'nope', e)).toEqual({ picture: false })
    expect(draftStep(d, 'redraw', undefined, e)).toEqual({ picture: true })
  })

  it('puts the task and its settings in the caption, the quota too when there is no picture', () => {
    const d = draft({ prompt: '修 <b> 的 bug' })
    const cap = draftCaption(d, env())
    expect(cap).toContain('修 &lt;b&gt; 的 bug')
    expect(cap).toContain('Sonnet · 自动 · 失败重试 1 次 · 接着上次对话')
    expect(cap).not.toContain('📊')
    const text = draftCaption({ ...d, photo: false }, env())
    expect(text).toContain('📊 5 小时额度 <b>42%</b> · 7 天额度 <b>18%</b> · 2 小时 13 分后刷新')
    // Telegram's caption limit
    expect(draftCaption(draft({ prompt: 'x'.repeat(5000) }), env()).length).toBeLessThan(1024)
  })

  it('draws the quota, the countdown and the queue', () => {
    const svg = taskPanelSvg(glance(), '14:01 刷新后开始 · 还有 2 小时 14 分', NOW)
    expect(svg).toContain('2:13')
    expect(svg).toContain('后刷新')
    expect(svg).toContain('5 小时额度')
    expect(svg).toContain('排队 2')
    const wb = taskPanelSvg(glance({ tool: 'workbuddy', name: 'WorkBuddy', windows: [], nextReset: null, credits: { remaining: 2997.52, total: 3000, today: 13.6, dailyAvg: 91.9, daysLeft: 32.6, plan: 'Pro' } }), '先放着', NOW)
    expect(wb).toContain('2,998')
    expect(wb).toContain('剩余积分')
    expect(wb).toContain('约 33 天')
    // each tool under its own mark: Codex's knot, not a terminal tile
    expect(taskPanelSvg(glance({ tool: 'codex', name: 'Codex' }), '马上开始', NOW)).toContain(CODEX_KNOT)
    expect(svg).not.toContain(CODEX_KNOT)
  })
})
