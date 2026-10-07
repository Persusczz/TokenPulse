import { motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtInt, fmtPct, fmtTokens } from '@shared/format'
import type { Intensity, RangeKey, SourceView, TokenTotals } from '@shared/types'
import { Heatmap, Legend, ModelDonut, ProjectBars, TOKEN_SERIES, TrendChart } from '../components/Charts'
import { SourceMark } from '../components/CodexMark'
import { ContextBanner, PromptsCard, WindowHistoryCard } from '../components/UsageInsights'
import { EnergyTank } from '../components/EnergyTank'
import { ComboBadge, FlowRing, NextMilestone, useCombo } from '../components/Fx'
import { GuardBanner } from '../components/GuardBanner'
import { IconBolt } from '../components/Icons'
import { ValueCard } from '../components/Insights'
import { Odometer } from '../components/Numbers'
import { PosterDialog } from '../components/Poster'
import { PulseMonitor } from '../components/PulseMonitor'
import { PulseRings } from '../components/PulseRings'
import { PunchCard } from '../components/Patterns'
import { RaceCard, VsUsualChip } from '../components/OverviewDay'
import { DailyQuotaCard, QuotaOutlookCard } from '../components/QuotaViz'
import { CacheCard } from '../components/QuotaInsights'
import { QuotaCard } from '../components/QuotaRings'
import { CyclesCard } from '../components/QuotaCycles'
import { QuotaRelationCard } from '../components/QuotaRelation'
import { CalendarCard, ModelTableCard, TimelineCard } from '../components/OverviewMore'
import { ActionsCard, RecordsCard } from '../components/OverviewActivity'
import { coverageNote, RANGE_OPTIONS, RangeTabs, spanText } from '../components/RangeTabs'
import { RateCard } from '../components/RateCard'
import { ResetWatchCard } from '../components/ResetWatch'
import { RunawayBanner } from '../components/RunawayBanner'
import { Segmented } from '../components/Segmented'
import { StatTile } from '../components/StatTile'
import { useApp, useData, useHasCodex, useIntroDone, useSource } from '../state'

const RANGE_NAME: Record<RangeKey, string> = { today: '今日', '7d': '近 7 天', '30d': '近 30 天', month: '本月', all: '全部时间' }
const PREV_NAME: Record<RangeKey, string> = { today: '较昨日同期', '7d': '较前 7 天', '30d': '较前 30 天', month: '较上月同期', all: '' }
const INTENSITY: Record<Intensity, string> = { 0: '平静', 1: '活跃', 2: '火热', 3: '燃烧中' }

function Delta({ cur, prev, label }: { cur: number; prev: number; label: string }) {
  if (!label) return null
  if (prev <= 0) return <span className="delta">{cur > 0 ? `${label} 新增` : ''}</span>
  const d = (cur - prev) / prev
  return (
    <span className="delta">
      {label} <b>{d >= 0 ? '↑' : '↓'} {Math.abs(d * 100).toFixed(d !== 0 && Math.abs(d) < 0.1 ? 1 : 0)}%</b>
    </span>
  )
}

/** Share of cost by token type, as one segmented bar */
function CostMix({ totals }: { totals: TokenTotals }) {
  const parts = TOKEN_SERIES.map((s) => ({ ...s, v: totals.costParts[s.key] }))
  const sum = parts.reduce((a, p) => a + p.v, 0)
  return (
    <div className="mix">
      <div className="mix-title">费用构成</div>
      <div className="mix-bar">
        {sum > 0 ? (
          parts
            .filter((p) => p.v > 0)
            .map((p) => <div key={p.key} style={{ width: `${(p.v / sum) * 100}%`, background: p.color }} title={`${p.label} ${fmtPct(p.v / sum, 1)}`} />)
        ) : (
          <div style={{ width: '100%', background: 'var(--surface-2)' }} />
        )}
      </div>
      <div className="legend">
        {parts.map((p) => (
          <span key={p.key}>
            <span className="swatch" style={{ background: p.color }} />
            {p.label} <b>{sum > 0 ? fmtPct(p.v / sum) : '—'}</b>
          </span>
        ))}
      </div>
    </div>
  )
}

function useStoredRange(): [RangeKey, (r: RangeKey) => void] {
  const [range, setRange] = useState<RangeKey>(() => {
    try {
      const v = localStorage.getItem('tp.range') as RangeKey | null
      return v && RANGE_OPTIONS.some((o) => o.value === v) ? v : 'today'
    } catch {
      return 'today'
    }
  })
  const set = (r: RangeKey) => {
    setRange(r)
    try {
      localStorage.setItem('tp.range', r)
    } catch {
      /* ignore */
    }
  }
  return [range, set]
}

const TITLE: Record<SourceView, string> = { claude: 'Claude 用量', codex: 'Codex 用量', all: '用量概览' }
const SCANNING: Record<SourceView, string> = { claude: '正在扫描 Claude Code 日志…', codex: '正在扫描 Codex 会话日志…', all: '正在扫描 Claude Code 与 Codex 日志…' }

export function Overview({ theme }: { theme: string }) {
  const { money, lastUpdate, load, settings } = useApp()
  const source = useSource()
  const hasCodex = useHasCodex()
  // the launch animation ends before the numbers roll up from zero
  const intro = useIntroDone()
  const [range, setRange] = useStoredRange()
  const [metric, setMetric] = useState<'cost' | 'tokens'>('cost')
  const summary = useData(() => window.api.getSummary(range), [range, source], 60_000)
  const overview = useData(() => window.api.getRanges(), [source], 60_000)
  const liveData = useData(() => window.api.getLive(), [source], 15_000)
  const live = intro ? liveData : null
  const note = coverageNote(overview, range)

  // eye-dropper drops + spark pulse for each batch of new usage: 1k tokens ≈ 1 drop, 1M ≈ 4
  const [pour, setPour] = useState({ id: 0, count: 0 })
  useEffect(() => {
    if (!lastUpdate || lastUpdate.addedTokens <= 0) return
    const count = Math.max(1, Math.min(6, Math.round(Math.log10(lastUpdate.addedTokens + 1) - 2)))
    setPour((p) => ({ id: p.id + 1, count }))
  }, [lastUpdate])
  const beat = lastUpdate?.addedTokens ? lastUpdate.at : 0

  const sparks = useMemo(() => {
    const b = summary?.buckets ?? []
    return Object.fromEntries(TOKEN_SERIES.map((s) => [s.key, b.map((x) => x[s.key])])) as Record<string, number[]>
  }, [summary])

  const t = intro ? summary?.totals : undefined
  const level = live ? live.today.cost / live.capacity : 0
  const intensity = (live?.intensity ?? 0) as Intensity
  const rate = useData(() => window.api.getRate(), [source], 5_000)
  const hot = intensity >= 2 ? ' flow-border' : ''
  const [poster, setPoster] = useState(false)
  const combo = useCombo()

  // the total glows and bounces when it grows
  const numRef = useRef<HTMLDivElement>(null)
  const prevTokens = useRef(0)
  useEffect(() => {
    const v = t?.tokens ?? 0
    const el = numRef.current
    if (el && prevTokens.current > 0 && v > prevTokens.current) {
      el.classList.remove('pop')
      void el.offsetWidth
      el.classList.add('pop')
    }
    prevTokens.current = v
  }, [t?.tokens])
  const moneyFmt = (v: number) => money(v)
  const tokFmt = (v: number) => fmtTokens(v, 2)

  return (
    <>
      {source !== 'codex' && <GuardBanner />}
      <RunawayBanner />
      <ContextBanner />
      <div className="page-head">
        <div>
          <h1 className="page-title">
            <motion.span key={source} className="title-mark" initial={{ scale: 0, rotate: -120 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 240, damping: 16 }}>
              <SourceMark size={26} animated={false} />
            </motion.span>
            {TITLE[source]}
          </h1>
          <div className="page-sub">
            {load?.loading
              ? SCANNING[source]
              : `${fmtInt(liveData?.totalEntries ?? 0)} 条响应 · ${source === 'codex' ? `${load?.codexFiles ?? 0} 个 Codex 会话文件` : source === 'claude' ? `${load?.files ?? 0} 个会话文件` : `${(load?.files ?? 0) + (load?.codexFiles ?? 0)} 个会话文件（Claude ${load?.files ?? 0} · Codex ${load?.codexFiles ?? 0}）`}` +
                (overview?.archived && source !== 'codex' ? ` · 已归档 ${fmtInt(overview.archived)} 条` : '')}
          </div>
          <div className="page-actions">
            <button className="btn small" onClick={() => setPoster(true)}>
              周报海报
            </button>
            <button className="btn small" onClick={() => window.api.openStage()} title="F11">
              大屏模式
            </button>
          </div>
        </div>
        <RangeTabs value={range} onChange={setRange} overview={overview} />
      </div>
      {note && (
        <motion.div className="coverage" key={range} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
          <span className="coverage-i">i</span>
          {note}
        </motion.div>
      )}

      <div className="grid-hero">
        <div className={`card tank-card${hot}`}>
          {hot && <FlowRing />}
          <div className="card-head" style={{ marginBottom: 0 }}>
            <div className="card-title">
              <span className="serif">今日能量罐</span>
            </div>
            <span className="badge" title={live?.capacityFromBudget ? '来自设置中的每日预算' : '近 30 天活跃日均费用 × 1.5'}>
              {live?.capacityFromBudget ? '预算' : '自适应'}
            </span>
          </div>
          <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <EnergyTank level={level} intensity={intensity} pour={pour} theme={theme} />
            <div className={`tank-overlay${level > 0.72 ? ' on-liquid' : ''}`}>
              <div className="tank-value">{live ? money(live.today.cost) : '—'}</div>
              <div className="tank-pct">{live ? `${level > 9.99 ? '>999' : Math.round(level * 100)}% / ${money(live.capacity)}` : ''}</div>
            </div>
          </div>
          <div className="tank-foot">
            <span>本月 {live ? money(live.monthCost) : '—'}</span>
            <span title="近 30 天有用量的日子（不含今天）平均每天的费用">日均 {live && live.dailyAvgCost > 0 ? money(live.dailyAvgCost) : '—'}</span>
          </div>
        </div>

        <div className={`card hero${hot}`}>
          {hot && <FlowRing />}
          {/* a light sweep marks each range switch */}
          <motion.div
            key={range}
            className="range-sweep"
            initial={{ x: '-100%', opacity: 1 }}
            animate={{ x: '100%', opacity: 0 }}
            transition={{ duration: 0.9, ease: [0.4, 0, 0.2, 1] }}
          />
          <div className="hero-top">
            <span className="hero-mark">
              <PulseRings trigger={beat} />
              <SourceMark size={92} intensity={intensity} pulse={beat} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="hero-label">
                {RANGE_NAME[range]} · 总 Token
                {summary && summary.range === range && <span className="hero-span">{spanText(summary.start, Math.min(summary.end, Date.now() + 1))}</span>}
                <ComboBadge combo={combo} />
              </div>
              <div className="hero-number" ref={numRef}>
                <Odometer text={t ? fmtInt(t.tokens) : '0'} />
              </div>
              <div className="hero-cost">
                <Odometer text={t ? money(t.cost) : money(0)} />
                {summary?.previous && t && <Delta cur={t.cost} prev={summary.previous.cost} label={PREV_NAME[range]} />}
                {range === 'today' && live && <VsUsualChip today={live.today.cost} avg={live.dailyAvgCost} />}
              </div>
              {live && <NextMilestone tokens={live.today.tokens} />}
            </div>
          </div>
          {t && <CostMix totals={t} />}
          <div className="monitor">
            <PulseMonitor
              beat={beat}
              size={lastUpdate?.addedTokens ?? 0}
              perMinute={rate?.requestsPerMin ?? 0}
              active={!!live?.lastEntryAt && Date.now() - live.lastEntryAt < 3 * 60_000}
              intensity={intensity}
              theme={theme}
            />
            <span className="monitor-bpm" title="近 5 分钟每分钟的 API 响应数">
              <i>♥</i>
              <b>{(rate?.requestsPerMin ?? 0).toFixed(1)}</b> 次/分
            </span>
          </div>
          <div className="burn">
            <span className={`intensity l${intensity}`}>
              <i />
              {INTENSITY[intensity]}
            </span>
            <span>
              <IconBolt style={{ verticalAlign: -2, marginRight: 4, color: 'var(--accent)' }} />
              <b>{fmtTokens(live?.tokensPerMin ?? 0)}</b> tokens/分钟
            </span>
            <span>
              近 1 小时 <b>{money(live?.costPerHour ?? 0)}</b>
            </span>
            <span>
              按当前速度今日预计 <b>{money(live?.projectedTodayCost ?? 0)}</b>
            </span>
            {t && (
              <span className="muted">
                {fmtInt(t.messages)} 条响应 · {t.sessions} 个会话
              </span>
            )}
          </div>
        </div>

        <QuotaCard />
      </div>

      <CyclesCard />

      {source !== 'claude' && hasCodex && settings?.codexResetWatch && <ResetWatchCard />}

      <QuotaRelationCard />

      <RateCard theme={theme} />

      <TimelineCard />

      {/* the quota: will it last, and the week day by day */}
      <div className="grid-2 quota-row">
        <QuotaOutlookCard />
        <DailyQuotaCard />
      </div>

      <div className="grid-2 prompt-row">
        <PromptsCard range={range} />
        <WindowHistoryCard />
      </div>

      <div className="grid-2 race-row">
        <RaceCard />
        <ValueCard />
      </div>
      <PosterDialog open={poster} onClose={() => setPoster(false)} />

      <div className="grid-stats">
        {TOKEN_SERIES.map((s) => (
          <StatTile
            key={s.key}
            label={s.label}
            color={s.color}
            value={t?.[s.key] ?? 0}
            format={tokFmt}
            sub={t ? money(t.costParts[s.key]) : '—'}
            spark={sparks[s.key]}
          />
        ))}
        <StatTile
          label="缓存命中率"
          value={intro ? (summary?.cacheHitRate ?? 0) : 0}
          format={(v) => fmtPct(v, 1)}
          sub="缓存读取 / 全部输入"
        />
        <StatTile
          label="缓存为你省下"
          value={t?.costParts.cacheSavings ?? 0}
          format={moneyFmt}
          sub="相对按原价计费的输入"
        />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <div className="card-title">
            <span className="serif">用量趋势</span>
            <span className="muted" style={{ fontWeight: 400 }}>
              {summary?.bucketUnit === 'hour' ? '按小时' : summary?.bucketUnit === 'week' ? '按周' : '按天'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <Legend items={[...TOKEN_SERIES]} />
            <Segmented
              small
              value={metric}
              onChange={setMetric}
              options={[
                { value: 'cost', label: '费用' },
                { value: 'tokens', label: 'Token' }
              ]}
            />
          </div>
        </div>
        {summary ? <TrendChart summary={summary} metric={metric} /> : <div className="chart-box skeleton" />}
      </div>

      <ActionsCard range={range} />

      <CalendarCard />

      <RecordsCard />

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <div className="card-title">
              <span className="serif">模型分布</span>
              <span className="muted" style={{ fontWeight: 400 }}>
                按费用
              </span>
            </div>
          </div>
          {summary && <ModelDonut models={summary.byModel} total={summary.totals.cost} />}
        </div>
        <div className="card">
          <div className="card-head">
            <div className="card-title">
              <span className="serif">项目排行</span>
              <span className="muted" style={{ fontWeight: 400 }}>
                按费用
              </span>
            </div>
          </div>
          {summary && <ProjectBars projects={summary.byProject} />}
        </div>
      </div>

      <ModelTableCard range={range} />

      <div className="grid-2 rhythm-row">
        <PunchCard />
        <CacheCard range={range} />
      </div>

      {range === 'all' && summary?.heatmap && (
        <div className="card">
          <div className="card-head">
            <div className="card-title">
              <span className="serif">活动热力图</span>
              <span className="muted" style={{ fontWeight: 400 }}>
                近一年 · 按 Token
              </span>
            </div>
          </div>
          <Heatmap cells={summary.heatmap} />
        </div>
      )}
    </>
  )
}
