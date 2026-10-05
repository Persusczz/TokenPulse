import { useEffect, useRef, useState } from 'react'
import { fmtInt, fmtTokens } from '@shared/format'
import type { Intensity, Pace, QuotaWindow } from '@shared/types'
import { Backdrop } from '../components/Backdrop'
import { Odometer } from '../components/Numbers'
import { PulseMonitor } from '../components/PulseMonitor'
import { PulseRings } from '../components/PulseRings'
import { RewindTag, useQuotaMotion } from '../components/QuotaMotion'
import { ArcMotion } from '../components/QuotaRings'
import { SourceMark } from '../components/CodexMark'
import { clock, countdown, useApp, useData, useNow, useSource, useToolQuotas } from '../state'

const INTENSITY: Record<Intensity, string> = { 0: '平静', 1: '活跃', 2: '火热', 3: '燃烧中' }

/** "领先节奏 12% · 照此 14:20 用完" under a ring */
function StagePace({ p }: { p: Pace }) {
  const lead = Math.round(p.lead)
  const weekly = p.end - p.start > 6 * 3600_000
  const at = (t: number) => (weekly ? new Date(t).toLocaleString('zh-CN', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : clock(t))
  return (
    <div className={`stage-pace ${lead >= 8 ? 'ahead' : lead <= -15 ? 'behind' : 'even'}`}>
      {Math.abs(lead) < 3 ? '节奏正好' : lead > 0 ? `领先节奏 ${lead}%` : `落后节奏 ${-lead}%`}
      {p.etaFull ? ` · 照此 ${at(p.etaFull)} 用完` : p.unused >= 20 ? ` · 刷新时约剩 ${Math.round(p.unused)}%` : ''}
    </div>
  )
}

function StageRing({ w, label, guardAt, now, pace, tint }: { w: QuotaWindow | null | undefined; label: string; guardAt: number | null; now: number; pace?: Pace; tint?: string }) {
  const R = 92
  const C = 2 * Math.PI * R
  const pct = w ? Math.max(0, Math.min(100, w.utilization)) : 0
  const color = pct >= (guardAt ?? 90) ? 'var(--critical)' : pct >= 75 ? 'var(--serious)' : (tint ?? 'var(--accent)')
  const reset = w?.resetsAt ? Date.parse(w.resetsAt) : NaN
  const left = reset > now ? (reset - now > 86_400_000 ? `${Math.floor((reset - now) / 86_400_000)} 天后重置` : `${countdown(reset, now)} 后重置`) : '—'
  const prev = useRef(pct)
  const [wave, setWave] = useState(0)
  useEffect(() => {
    if (pct > prev.current + 0.4) setWave(Date.now())
    prev.current = pct
  }, [pct])
  const m = useQuotaMotion(pct, w?.resetsAt)
  const [flash, setFlash] = useState(0)
  useEffect(() => {
    if (m.phase === 'zero') setFlash(Date.now())
  }, [m.phase])
  const shown = m.phase === 'rewind' ? 'var(--rewind)' : color
  return (
    <div className={`stage-ring stage-panel q-${m.phase}`}>
      <div className="stage-ring-svg">
        <PulseRings trigger={wave} color={color} rings={2} />
        <PulseRings trigger={flash} color="var(--rewind)" rings={3} />
        {m.delta >= 0.5 && m.phase === 'grow' && (
          <span key={m.run} className="q-delta big">
            +{m.delta >= 10 ? Math.round(m.delta) : m.delta.toFixed(1)}%
          </span>
        )}
        <svg viewBox="0 0 220 220" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="110" cy="110" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="16" />
          <circle
            cx="110"
            cy="110"
            r={R}
            fill="none"
            className="q-arc"
            stroke={shown}
            strokeWidth="16"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - m.v / 100)}
            style={{ filter: `drop-shadow(0 0 10px ${shown})` }}
          />
          <ArcMotion m={m} r={R} c={110} width={16} />
        </svg>
        <div className="stage-ring-center">
          <b className="serif">{w ? Math.round(m.v) : '—'}</b>
          <small>%</small>
          <RewindTag phase={m.phase} />
        </div>
      </div>
      <div className="stage-ring-label">{label}</div>
      <div className="stage-ring-sub">{left}</div>
      {pace && <StagePace p={pace} />}
    </div>
  )
}

/** Full-screen dashboard for a second display */
export function Stage({ theme, paint }: { theme: string; paint: string }) {
  const { money, quota, codexQuota, lastUpdate } = useApp()
  const source = useSource()
  const tools = useToolQuotas()
  const main = tools[0]
  const other = tools[1]
  const live = useData(() => window.api.getLive(), [source], 5_000)
  const rate = useData(() => window.api.getRate(), [source], 3_000)
  const forecast = useData(() => window.api.getForecast(main?.source ?? 'claude'), [main?.source, quota?.fetchedAt, codexQuota?.updatedAt], 60_000)
  const paces = useData(() => window.api.getPace(), [source, quota?.fetchedAt, codexQuota?.updatedAt], 60_000)
  const paceOf = (s: string, k: '5h' | '7d') => paces?.find((p) => p.key === `${s}_${k}`)
  const now = useNow(1000)
  const intensity = (live?.intensity ?? 0) as Intensity
  const beat = lastUpdate?.addedTokens ? lastUpdate.at : 0
  const name = (s: string) => (s === 'codex' ? 'Codex' : 'Claude')

  useEffect(() => {
    const key = (e: KeyboardEvent) => (e.key === 'Escape' || e.key === 'F11') && window.api.closeStage()
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [])

  // the number glows when it grows
  const numRef = useRef<HTMLDivElement>(null)
  const prev = useRef(0)
  useEffect(() => {
    const v = live?.today.tokens ?? 0
    if (numRef.current && prev.current > 0 && v > prev.current) {
      numRef.current.classList.remove('pop')
      void numRef.current.offsetWidth
      numRef.current.classList.add('pop')
    }
    prev.current = v
  }, [live?.today.tokens])

  const d = new Date(now)
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    <div className="stage">
      <Backdrop theme={theme} paint={paint} animated />
      <header className="stage-top">
        <span className="stage-brand">
          <SourceMark size={34} intensity={intensity} pulse={beat} />
          <span className="serif">TokenPulse</span>
        </span>
        <span className="stage-clock">
          <b className="serif">
            {p(d.getHours())}:{p(d.getMinutes())}
            <small>:{p(d.getSeconds())}</small>
          </b>
          <span>{d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</span>
        </span>
      </header>

      <section className="stage-hero">
        <span className="hero-mark">
          <PulseRings trigger={beat} />
          <SourceMark size={200} intensity={intensity} pulse={beat} />
        </span>
        <div>
          <div className="stage-label">今日 Token</div>
          <div className="stage-number hero-number" ref={numRef}>
            <Odometer text={fmtInt(live?.today.tokens ?? 0)} />
          </div>
          <div className="stage-cost">
            <span className="serif">{money(live?.today.cost ?? 0)}</span>
            <span className={`intensity l${intensity}`}>
              <i />
              {INTENSITY[intensity]}
            </span>
          </div>
        </div>
      </section>

      <section className="stage-monitor stage-panel">
        <PulseMonitor
          beat={beat}
          size={lastUpdate?.addedTokens ?? 0}
          perMinute={rate?.requestsPerMin ?? 0}
          active={!!live?.lastEntryAt && Date.now() - live.lastEntryAt < 3 * 60_000}
          intensity={intensity}
          theme={paint}
        />
        <span className="monitor-bpm">
          <i>♥</i>
          <b>{(rate?.requestsPerMin ?? 0).toFixed(1)}</b> 次/分
        </span>
      </section>

      <section className="stage-row">
        <StageRing w={main?.five} label={other ? 'Claude 5 小时' : `${source === 'codex' ? 'Codex ' : ''}5 小时额度`} guardAt={main?.pauseAt ?? null} now={now} pace={main && paceOf(main.source, '5h')} />
        {other ? (
          <StageRing w={other.five} label="Codex 5 小时" guardAt={null} now={now} pace={paceOf('codex', '5h')} tint="var(--codex)" />
        ) : (
          <StageRing w={main?.seven} label={`${source === 'codex' ? 'Codex ' : ''}7 天额度`} guardAt={null} now={now} pace={main && paceOf(main.source, '7d')} />
        )}
        <div className="stage-stats stage-panel">
          <div>
            <span>速率</span>
            <b className="serif">{fmtTokens(rate?.tokensPerMin ?? 0, 1)}</b>
            <small>tokens/分</small>
          </div>
          <div>
            <span>输出</span>
            <b className="serif">{(rate?.outputPerSec ?? 0).toFixed(1)}</b>
            <small>tok/s</small>
          </div>
          <div>
            <span>近 1 小时</span>
            <b className="serif">{money(rate?.costPerHour ?? 0)}</b>
          </div>
          <div>
            <span>{other ? `${name(main!.source)} 7 天预测` : '7 天预测'}</span>
            <b className={`serif${forecast && forecast.projectedPct >= 100 ? ' hot' : ''}`}>
              {forecast?.available ? `${Math.round(forecast.projectedPct)}%` : '—'}
            </b>
            <small>{forecast?.etaFull ? `照此 ${new Date(forecast.etaFull).toLocaleString('zh-CN', { weekday: 'short', hour: '2-digit', minute: '2-digit' })} 用完` : '到重置时'}</small>
          </div>
        </div>
      </section>
      <footer className="stage-hint">Esc 退出大屏</footer>
    </div>
  )
}
