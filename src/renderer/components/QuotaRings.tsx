import { useEffect, useRef, useState } from 'react'
import type { CodexQuota, Pace, QuotaInfo, QuotaOrigin, QuotaWindow } from '@shared/types'
import { clock, countdown, useApp, useData, useNow, useSource } from '../state'
import { CodexMark } from './CodexMark'
import { IconAlert, IconCheck, IconRefresh } from './Icons'
import { PulseRings } from './PulseRings'
import { RewindTag, useQuotaMotion, type QuotaMotion } from './QuotaMotion'
import { Starburst } from './Starburst'
import { FlowRing } from './Fx'

const R = 42
const C = 2 * Math.PI * R

const ORIGIN: Record<QuotaOrigin, { label: string; tip: string }> = {
  oauth: { label: '用量接口', tip: 'Claude Code /usage 使用的 Anthropic 用量接口（未公开文档，读取本机登录凭据，只读）' },
  statusline: { label: '官方状态栏', tip: 'Claude Code 官方文档中传给状态栏脚本的 rate_limits 数据，每次响应后更新' },
  local: { label: '本地估算', tip: '根据本机日志估算：本 5 小时窗口的等价 API 费用 ÷ 校准出的窗口上限' }
}

const isFive = (w: QuotaWindow) => w.key === 'session' || w.key === 'five_hour'
/** the pace entry for a ring: Claude's 5h / weekly windows, or Codex's own keys */
const paceKey = (w: QuotaWindow) => (isFive(w) ? 'claude_5h' : w.key === 'weekly_all' || w.key === 'seven_day' ? 'claude_7d' : w.key)

/** "领先节奏 12%" / "落后节奏 30%" under a ring */
function PaceLine({ p }: { p: Pace }) {
  const lead = Math.round(p.lead)
  const cls = lead >= 8 ? 'ahead' : lead <= -15 ? 'behind' : 'even'
  const tip = `理想节奏：现在应在 ${Math.round(p.ideal)}%\n按最近速度，刷新时约 ${Math.round(Math.min(p.projected, 999))}%${p.etaFull ? `，${clock(p.etaFull)} 用完` : ''}`
  return (
    <div className={`ring-pace ${cls}`} title={tip}>
      {Math.abs(lead) < 3 ? '节奏正好' : lead > 0 ? `领先节奏 ${lead}%` : `落后节奏 ${-lead}%`}
    </div>
  )
}

/**
 * The moving parts of a quota arc on a circle of radius r around (c, c), in
 * the svg's own frame (0° at three o'clock, drawn rotated to twelve): while
 * it grows a bright head with a fading tail leads it; while it rewinds,
 * speed lines spin backwards around it.
 */
export function ArcMotion({ m, r, c, width }: { m: QuotaMotion; r: number; c: number; width: number }) {
  const C = 2 * Math.PI * r
  const len = (C * m.v) / 100
  const a = (m.v / 100) * 2 * Math.PI
  const growing = (m.phase === 'grow' || m.phase === 'refill') && m.v > 0.4
  const tail = Math.min(len, C * 0.16)
  return (
    <>
      {m.phase === 'rewind' && (
        <circle className="q-speed" cx={c} cy={c} r={r + width * 0.95} fill="none" strokeWidth={Math.max(1.2, width * 0.22)} strokeDasharray={`${C * 0.012} ${C * 0.05}`} />
      )}
      {growing && (
        <>
          <circle className="q-tail" cx={c} cy={c} r={r} fill="none" strokeWidth={width} strokeLinecap="round" strokeDasharray={`${tail} ${C}`} strokeDashoffset={-(len - tail)} />
          <circle className="q-head" cx={c + r * Math.cos(a)} cy={c + r * Math.sin(a)} r={width * 0.62} />
        </>
      )}
    </>
  )
}

function level(w: QuotaWindow, pauseAt: number): { color: string; label: string; icon: 'ok' | 'alert' } {
  const u = w.utilization
  if (u >= pauseAt || w.severity === 'critical') return { color: 'var(--critical)', label: '告急', icon: 'alert' }
  if (u >= 75 || w.severity === 'warning') return { color: 'var(--serious)', label: '偏高', icon: 'alert' }
  return { color: 'var(--accent)', label: '正常', icon: 'ok' }
}

function untilText(iso: string | null, now: number): string {
  if (!iso) return '已重置'
  const ms = Date.parse(iso) - now
  if (Number.isNaN(ms)) return ''
  if (ms <= 0) return '即将重置'
  const m = Math.round(ms / 60000)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  const mm = m % 60
  if (d) return `${d} 天 ${h} 小时后重置`
  if (h) return `${h} 小时 ${mm} 分后重置`
  return `${mm} 分钟后重置`
}

function Ring({ w, now, guardAt, pace, compact, tint }: { w: QuotaWindow; now: number; guardAt: number | null; pace?: Pace; compact?: boolean; tint?: string }) {
  const base = level(w, guardAt ?? 90)
  // a tool's own colour while the window is in the normal range
  const lv = tint && base.icon === 'ok' ? { ...base, color: tint } : base
  // where an even pace would be now
  const ia = pace ? (pace.ideal / 100) * 2 * Math.PI : 0
  const pct = Math.max(0, Math.min(100, w.utilization))
  const reset = w.resetsAt ? Date.parse(w.resetsAt) : NaN
  const over = guardAt !== null && pct >= guardAt
  // guard threshold marker, in the ring's rotated frame
  const a = ((guardAt ?? 0) / 100) * 2 * Math.PI
  // a ripple each time usage rises, a burst when a rewind hits zero
  const prev = useRef(pct)
  const [wave, setWave] = useState(0)
  useEffect(() => {
    if (pct > prev.current + 0.4) setWave(Date.now())
    prev.current = pct
  }, [pct])
  const m = useQuotaMotion(pct, w.resetsAt)
  const [flash, setFlash] = useState(0)
  useEffect(() => {
    if (m.phase === 'zero') setFlash(Date.now())
  }, [m.phase])
  const px = compact ? 80 : 104
  const rewinding = m.phase === 'rewind'
  return (
    <div className={`ring q-${m.phase}${over ? ' over' : ''}${compact ? ' compact' : ''}`} title={w.resetsAt ? `重置时间 ${new Date(w.resetsAt).toLocaleString()}` : undefined}>
      <div className="ring-dial" style={{ position: 'relative', width: px, height: px }}>
        <PulseRings trigger={wave} color={lv.color} rings={2} />
        <PulseRings trigger={flash} color="var(--rewind)" rings={3} />
        {m.delta >= 0.5 && m.phase === 'grow' && (
          <span key={m.run} className="q-delta">
            +{m.delta >= 10 ? Math.round(m.delta) : m.delta.toFixed(1)}%
          </span>
        )}
        <svg width={px} height={px} viewBox="0 0 104 104" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="52" cy="52" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="9" />
          <circle
            className="q-arc"
            cx="52"
            cy="52"
            r={R}
            fill="none"
            stroke={rewinding ? 'var(--rewind)' : lv.color}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - m.v / 100)}
          />
          <ArcMotion m={m} r={R} c={52} width={9} />
          {guardAt !== null && (
            <line
              className="ring-guard"
              x1={52 + (R - 8) * Math.cos(a)}
              y1={52 + (R - 8) * Math.sin(a)}
              x2={52 + (R + 8) * Math.cos(a)}
              y2={52 + (R + 8) * Math.sin(a)}
            >
              <title>守卫线 {guardAt}%</title>
            </line>
          )}
          {pace && (
            <circle className="ring-pace-dot" cx={52 + (R + 0.5) * Math.cos(ia)} cy={52 + (R + 0.5) * Math.sin(ia)} r="3.4">
              <title>理想节奏 {Math.round(pace.ideal)}%</title>
            </circle>
          )}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
          <span className="ring-center">
            {Math.round(m.v)}
            <small style={{ fontSize: 13, color: 'var(--text-3)' }}>%</small>
          </span>
          <RewindTag phase={m.phase} />
        </div>
      </div>
      <div className="ring-label">{compact ? w.label.replace('额度', '').replace(' · 全部模型', '') : w.label}</div>
      {!compact && (
        <span className="status-chip">
          {lv.icon === 'ok' ? <IconCheck style={{ color: 'var(--good-text)' }} /> : <IconAlert style={{ color: lv.color }} />}
          {lv.label}
        </span>
      )}
      <div className="ring-reset">{guardAt !== null && reset > now && reset - now < 5 * 3600_000 ? `${countdown(reset, now)} 后重置` : untilText(w.resetsAt, now)}</div>
      {pace && <PaceLine p={pace} />}
    </div>
  )
}

const ago = (q: CodexQuota, now: number) => {
  const m = Math.round((now - q.updatedAt) / 60_000)
  const sameDay = new Date(q.updatedAt).toDateString() === new Date(now).toDateString()
  const at = sameDay ? clock(q.updatedAt) : new Date(q.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return m < 1 ? '刚刚' : m < 60 ? `${m} 分钟前` : at
}
const chatgpt = (plan: string | null) => (plan ? `ChatGPT ${plan.charAt(0).toUpperCase()}${plan.slice(1)}` : null)

/** Codex's limits, as Codex last reported them */
function CodexRings({ q, now, paceOf, compact }: { q: CodexQuota; now: number; paceOf: (k: string) => Pace | undefined; compact?: boolean }) {
  return (
    <>
      {q.windows.length ? (
        <div className="quota-rings">
          {q.windows.map((w) => (
            <Ring key={w.key} w={w} now={now} guardAt={null} pace={paceOf(w.key)} compact={compact} tint={compact ? 'var(--codex)' : undefined} />
          ))}
        </div>
      ) : (
        <div className="quota-msg">Codex 日志里还没有额度数据</div>
      )}
      {!compact && (
        <div className="quota-break">{q.origin === 'api' ? `来自 ChatGPT 账号的用量接口 · ${ago(q, now)}更新（每分钟刷新）` : `来自 Codex 会话日志 · ${ago(q, now)}更新（Codex 运行时才会更新；在设置里登录 ChatGPT 可以每分钟读取）`}</div>
      )}
    </>
  )
}

/** Codex alone: its own card, in its own colours */
function CodexQuotaCard() {
  const { codexQuota } = useApp()
  const now = useNow(1000)
  const paces = usePaces()
  const five = codexQuota?.windows.find((w) => w.key === 'codex_5h')
  const alarm = five && five.utilization >= 75 ? ' flow-border alarm' : ''
  return (
    <div className={`card quota-card${alarm}`}>
      {alarm && <FlowRing />}
      <div className="card-head">
        <div className="card-title">
          <span className="serif">Codex 额度</span>
          {chatgpt(codexQuota?.plan ?? null) && <span className="badge accent">{chatgpt(codexQuota!.plan)}</span>}
        </div>
        {codexQuota?.origin === 'api' ? (
          <span className="badge" title="ChatGPT 账号的用量接口（Codex 的 /status 用的同一个），每分钟刷新">
            官方接口
          </span>
        ) : (
          <span className="badge" title="Codex 每次响应都会把 rate_limits 写进会话日志">
            会话日志
          </span>
        )}
      </div>
      {codexQuota ? <CodexRings q={codexQuota} now={now} paceOf={(k) => paces?.find((p) => p.key === k)} /> : <div className="quota-msg">还没有读到 Codex 的额度数据：在设置 → Codex 额度里登录 ChatGPT，或运行一次 Codex</div>}
      <div className="guard-strip">
        <span className="guard-dot off" />
        额度守卫只作用于 Claude Code；Codex 到线时提醒（桌面通知、灵动岛、Telegram）
      </div>
    </div>
  )
}

/** 全部: Claude's and Codex's windows side by side, each under its own mark */
function BothQuotaCard() {
  const { quota, codexQuota, settings } = useApp()
  const now = useNow(1000)
  const paces = usePaces()
  const paceOf = (k: string) => paces?.find((p) => p.key === k)
  const guardAt = settings?.guardEnabled ? settings.guardPauseAt : null
  const msg = message(quota)
  const high = [quota?.windows.find(isFive), codexQuota?.windows.find((w) => w.key === 'codex_5h')].some((w) => w && w.utilization >= 75)
  const ws = (quota?.windows ?? []).filter((w) => isFive(w) || w.key === 'weekly_all' || w.key === 'seven_day')
  return (
    <div className={`card quota-card both${high ? ' flow-border alarm' : ''}`}>
      {high && <FlowRing />}
      <div className="card-head">
        <div className="card-title">
          <span className="serif">订阅额度</span>
        </div>
      </div>
      <div className="quota-side claude">
        <div className="quota-side-head">
          <Starburst size={16} animated={false} />
          <b>Claude</b>
          {quota?.plan && <span className="badge">{quota.plan}</span>}
        </div>
        {msg || !ws.length ? (
          <div className="quota-msg small">{msg ?? '暂无额度窗口'}</div>
        ) : (
          <div className="quota-rings">
            {ws.map((w) => (
              <Ring key={w.key} w={w} now={now} guardAt={isFive(w) ? guardAt : null} pace={paceOf(paceKey(w))} compact tint="var(--claude)" />
            ))}
          </div>
        )}
      </div>
      <div className="quota-side codex">
        <div className="quota-side-head">
          <CodexMark size={16} animated={false} />
          <b>Codex</b>
          {chatgpt(codexQuota?.plan ?? null) && <span className="badge">{chatgpt(codexQuota!.plan)}</span>}
          {codexQuota && <span className="muted quota-side-ago">{ago(codexQuota, now)}</span>}
        </div>
        {codexQuota && <CodexRings q={codexQuota} now={now} paceOf={paceOf} compact />}
      </div>
      {quota?.status !== 'disabled' && <GuardStrip />}
    </div>
  )
}

function usePaces() {
  const { quota, codexQuota, settings } = useApp()
  return useData(() => window.api.getPace(), [quota?.fetchedAt, quota?.windows.map((w) => w.utilization).join(), codexQuota?.updatedAt, settings?.sourceFilter], 60_000)
}

function message(q: QuotaInfo | null): string | null {
  if (!q) return '正在读取订阅额度…'
  switch (q.status) {
    case 'loading':
      return '正在读取订阅额度…'
    case 'disabled':
      return '订阅额度监控已关闭'
    case 'no-credentials':
      return '未找到 Claude Code 登录凭据（~/.claude/.credentials.json）'
    case 'expired':
      return q.windows.length ? null : '登录令牌已过期——打开一次 Claude Code 即可自动刷新'
    case 'no-data':
      return '还没有状态栏数据：在设置中开启「状态栏桥接」，Claude Code 下次响应后即可显示'
    case 'error':
      return q.windows.length ? null : `读取失败：${q.error ?? '未知错误'}`
    default:
      if (q.windows.length) return null
      if (q.origin === 'local') return null
      return '接口没有返回额度窗口'
  }
}

/** Local estimate before a 5h limit is known: show the window's spend instead of a percentage */
function LocalPending({ q, onRetry }: { q: QuotaInfo; onRetry: () => void }) {
  const { money, guard } = useApp()
  const l = q.local!
  return (
    <div className="quota-msg" style={{ gap: 6 }}>
      {q.error && (
        <span className="quota-err">
          <IconAlert style={{ color: 'var(--serious)' }} /> 官方数据不可用：{q.error}
        </span>
      )}
      <span className="serif" style={{ fontSize: 26, color: 'var(--text)' }}>
        {money(l.usedUsd)}
      </span>
      <span>
        本 5 小时窗口的等价 API 费用
        {l.windowEnd > l.windowStart ? `（${clock(l.windowStart)}–${clock(l.windowEnd)}）` : '（当前没有进行中的窗口）'}
      </span>
      <span className="muted" style={{ fontSize: 12 }}>
        {guard?.bridgeInstalled
          ? '等待 Claude Code 下一次响应带来官方状态栏数据'
          : '尚无窗口上限。建议在设置中开启「状态栏桥接」获取官方数据，或手动填写 5h 上限'}
      </span>
      {q.error && (
        <button className="btn small" onClick={onRetry}>
          重试
        </button>
      )}
    </div>
  )
}

function GuardStrip() {
  const { settings, guard, saveSettings } = useApp()
  const now = useNow(1000)
  if (!settings || !guard) return null
  if (!settings.guardEnabled) {
    return (
      <div className="guard-strip">
        <span className="guard-dot off" />
        额度守卫未开启
        <button className="btn ghost small" onClick={() => void saveSettings({ guardEnabled: true })}>
          开启（{settings.guardPauseAt}% 暂停）
        </button>
      </div>
    )
  }
  if (guard.error) {
    return (
      <div className="guard-strip bad">
        <IconAlert style={{ color: 'var(--critical)' }} />
        守卫未生效：{guard.error}
      </div>
    )
  }
  const until = guard.paused.find((p) => p.until)?.until
  if (guard.paused.length) {
    return (
      <div className="guard-strip paused">
        <span className="guard-dot hot" />
        已暂停 {guard.paused.length} 个任务{until ? ` · ${countdown(until, now)} 后恢复` : ''}
      </div>
    )
  }
  return (
    <div className="guard-strip">
      <span className="guard-dot on" />
      守卫就绪 · 5h 达到 {settings.guardPauseAt}% 时暂停任务，重置后自动继续
    </div>
  )
}

/** The quota of the tool on view; both side by side under 全部 */
export function QuotaCard() {
  const { codexQuota } = useApp()
  const source = useSource()
  if (source === 'codex') return <CodexQuotaCard />
  if (source === 'all' && codexQuota) return <BothQuotaCard />
  return <ClaudeQuotaCard />
}

function ClaudeQuotaCard() {
  const { quota, setQuota, saveSettings, settings, money } = useApp()
  const now = useNow(1000)
  const paces = usePaces()
  const paceOf = (k: string) => paces?.find((p) => p.key === k)
  const msg = message(quota)
  const refresh = async () => setQuota(await window.api.refreshQuota())
  const origin = quota?.origin ? ORIGIN[quota.origin] : null
  const guardAt = settings?.guardEnabled ? settings.guardPauseAt : null
  // a red light runs around the card while the 5h window is high
  const five = quota?.windows.find(isFive)
  const alarm = five && five.utilization >= 75 ? ' flow-border alarm' : ''

  return (
    <div className={`card quota-card${alarm}`}>
      {alarm && <FlowRing />}
      <div className="card-head">
        <div className="card-title">
          <span className="serif">Claude 额度</span>
          {quota?.plan && <span className="badge accent">{quota.plan}</span>}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {origin && quota?.status !== 'disabled' && (
            <span className={`badge${quota?.origin === 'statusline' ? ' good' : ''}`} title={origin.tip}>
              {origin.label}
            </span>
          )}
          {quota?.status !== 'disabled' && (
            <button className="btn ghost" style={{ padding: 4 }} onClick={refresh} title="刷新额度">
              <IconRefresh />
            </button>
          )}
        </div>
      </div>
      {msg ? (
        <div className="quota-msg">
          <span>{msg}</span>
          {quota?.status === 'disabled' && (
            <button className="btn" onClick={() => void saveSettings({ quotaEnabled: true })}>
              开启额度监控
            </button>
          )}
          {(quota?.status === 'error' || quota?.status === 'expired') && (
            <button className="btn" onClick={refresh}>
              重试
            </button>
          )}
        </div>
      ) : quota!.origin === 'local' && !quota!.windows.length ? (
        <LocalPending q={quota!} onRetry={refresh} />
      ) : (
        <>
          <div className="quota-rings">
            {quota!.windows.slice(0, 3).map((w) => (
              <Ring key={w.key} w={w} now={now} guardAt={isFive(w) ? guardAt : null} pace={paceOf(paceKey(w))} />
            ))}
          </div>
          {quota!.breakdown.length > 0 && (
            <div className="quota-break">
              近 7 天构成：
              {quota!.breakdown
                .filter((b) => b.percent > 0)
                .map((b) => `${b.name} ${b.percent}%`)
                .join(' · ') || '暂无'}
            </div>
          )}
          {quota!.origin === 'local' && quota!.local && (
            <div className="quota-break">
              估算：窗口内等价费用 {money(quota!.local.usedUsd)} / 上限 {money(quota!.local.limitUsd ?? 0)}
              {quota!.local.calibrated ? '（官方数据校准）' : '（手动设置）'}
            </div>
          )}
          {quota?.error && <div className="quota-break">{quota.origin === 'local' ? `官方数据不可用（${quota.error}），显示本地估算` : `刷新失败：${quota.error}（显示上次结果）`}</div>}
          {quota?.status === 'expired' && <div className="quota-break">登录令牌已过期，显示上次结果——打开一次 Claude Code 即可刷新</div>}
        </>
      )}
      {quota?.status !== 'disabled' && <GuardStrip />}
    </div>
  )
}
