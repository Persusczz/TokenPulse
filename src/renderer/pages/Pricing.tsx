import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { fmtTokens } from '@shared/format'
import type { ModelResolution, PriceRow, PricingSource, UsageSource } from '@shared/types'
import { SourceMark } from '../components/CodexMark'
import { IconAlert, IconRefresh } from '../components/Icons'
import { Segmented } from '../components/Segmented'
import { useApp, useData, useSource } from '../state'

const SOURCE: Record<PricingSource, string> = {
  official: '官方定价页',
  litellm: 'LiteLLM 价格表',
  bundled: '内置快照'
}

const CLAUDE_FAMILIES = ['fable', 'mythos', 'opus', 'sonnet', 'haiku']

const versionOf = (id: string): number[] => {
  const m = /^claude-[a-z]+-(\d+(?:-\d+)*)/.exec(id) ?? /^gpt-(\d+(?:\.\d+)?)/.exec(id)
  return m ? m[1].split(/[-.]/).map(Number) : []
}
const cmp = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d) return d
  }
  return 0
}
/** the model line a row belongs to: Claude's family, or GPT's variant (base, codex, mini, sol …) */
const lineOf = (id: string) => (id.startsWith('claude-') ? (/^claude-([a-z]+)-/.exec(id)?.[1] ?? id) : id.replace(/^gpt-\d+(?:\.\d+)?-?/, '') || 'base')

/**
 * The current line-up of one tool's models: the newest of each line, and the
 * older (still sold) ones apart. Retired models are left out.
 */
function lineup(rows: PriceRow[], tool: 'claude' | 'codex'): { current: PriceRow[]; older: PriceRow[] } {
  const mine = rows.filter((r) => (tool === 'claude' ? r.id.startsWith('claude-') : r.id.startsWith('gpt-')) && r.status !== 'retired')
  const newest = new Map<string, PriceRow>()
  for (const r of mine) {
    const l = lineOf(r.id)
    const best = newest.get(l)
    if (!best || cmp(versionOf(r.id), versionOf(best.id)) > 0) newest.set(l, r)
  }
  let current = [...newest.values()]
  if (tool === 'codex') {
    // GPT keeps many old lines alive: only lines whose newest model is of the latest three generations
    const gens = [...new Set(mine.map((r) => versionOf(r.id).join('.')))].sort((a, b) => cmp(b.split('.').map(Number), a.split('.').map(Number))).slice(0, 3)
    current = current.filter((r) => gens.includes(versionOf(r.id).join('.')))
  }
  const sortKey = (r: PriceRow) => (tool === 'claude' ? CLAUDE_FAMILIES.indexOf(lineOf(r.id)) : 0)
  current.sort((a, b) => sortKey(a) - sortKey(b) || cmp(versionOf(b.id), versionOf(a.id)) || a.id.localeCompare(b.id))
  const ids = new Set(current.map((r) => r.id))
  const older = mine.filter((r) => !ids.has(r.id)).sort((a, b) => sortKey(a) - sortKey(b) || cmp(versionOf(b.id), versionOf(a.id)) || a.id.localeCompare(b.id))
  return { current, older }
}

function StatusTag({ row }: { row: PriceRow | undefined }) {
  if (row?.status === 'retired') return <span className="price-tag retired">已退役</span>
  if (row?.status === 'limited') return <span className="price-tag limited">限量开放</span>
  return null
}

/** One model from the logs: its price and what it cost over 30 days */
function UsedModel({ m, row, share, i, credits }: { m: ModelResolution; row: PriceRow | undefined; share: number; i: number; credits?: number }) {
  const { money } = useApp()
  const p = (v: number) => money(v, v < 1 ? 3 : 2)
  const claude = m.model.startsWith('claude') || m.source === 'claude'
  const workbuddy = m.source === 'workbuddy'
  return (
    <motion.div className="used-row" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
      <div className="used-name">
        <b>{row?.name ?? m.model}</b>
        <span className="muted mono">{m.model}</span>
        {workbuddy && row && <button className="link-btn price-reference" title={row.priceNote} onClick={() => row.priceUrl && void window.api.openExternal(row.priceUrl)}>{row.priceSource ?? '模型 API 参考价'}</button>}
        <span className="used-tags">
          {m.estimated && (
            <span className="price-tag est" title="没有找到精确价格，按同系列最新的模型估算">
              估算
            </span>
          )}
          <StatusTag row={row} />
        </span>
      </div>
      {row && (
        <div className="used-prices">
          <span>
            输入 <b>{p(row.input)}</b>
          </span>
          <span>
            输出 <b>{p(row.output)}</b>
          </span>
          <span>
            缓存读 <b>{p(row.cacheRead)}</b>
          </span>
          {claude && (
            <span title={`1 小时写入 ${p(row.cacheWrite1h)}`}>
              缓存写 <b>{p(row.cacheWrite5m)}</b>
            </span>
          )}
        </div>
      )}
      <div className="used-cost">
        <b className="tnum">{workbuddy ? (credits == null ? '—' : credits.toLocaleString('zh-CN', { maximumFractionDigits: 2 })) + ' 积分' : money(m.cost ?? 0)}</b>
        <span className="used-bar">
          <i style={{ width: `${Math.max(1.5, share * 100)}%` }} />
        </span>
        <small className="muted tnum">{fmtTokens(m.tokens ?? 0, 1)} tokens</small>
        {workbuddy && <small className="muted tnum">{row ? `API 参考 ${money(m.cost ?? 0)}` : 'API 参考价未知'}</small>}
      </div>
    </motion.div>
  )
}

function PriceTable({ rows, tool }: { rows: PriceRow[]; tool: UsageSource }) {
  const { money } = useApp()
  const p = (v: number) => money(v, v < 1 ? 3 : 2)
  return (
    <table className="tbl price-tbl">
      <thead>
        <tr>
          <th>模型</th>
          <th className="num">输入</th>
          {tool !== 'workbuddy' && <th className="num">缓存写入</th>}
          <th className="num">缓存读取</th>
          <th className="num">输出</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>
              <span className="price-name">{r.name}</span>
              {tool === 'workbuddy' && <><button className="link-btn price-reference" onClick={() => r.priceUrl && void window.api.openExternal(r.priceUrl)}>{r.priceSource ?? '模型 API 参考价'} ↗</button><small className="price-reference">{r.priceNote}</small></>}
              <StatusTag row={r} />
              {r.fastInput !== undefined && (
                <span className="price-tag fast" title="快速模式（研究预览）的输入 / 输出价格">
                  快速 {p(r.fastInput)} / {p(r.fastOutput ?? 0)}
                </span>
              )}
            </td>
            <td className="num">{p(r.input)}</td>
            {tool !== 'workbuddy' && <td className="num" title={tool === 'claude' ? `5 分钟缓存；1 小时缓存 ${p(r.cacheWrite1h)}` : 'OpenAI 不额外收缓存写入费，按输入计'}>
              {tool === 'claude' ? p(r.cacheWrite5m) : <span className="muted">同输入</span>}
            </td>}
            <td className="num">{p(r.cacheRead)}</td>
            <td className="num">{p(r.output)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function Pricing() {
  const { pricing, setPricing, money } = useApp()
  const source = useSource()
  const [busy, setBusy] = useState(false)
  const [pick, setPick] = useState<UsageSource>('claude')
  const [older, setOlder] = useState(false)
  const [rules, setRules] = useState(false)
  const tool: UsageSource = source === 'all' ? pick : source
  const tools: UsageSource[] = source === 'all' ? ['claude', 'codex', 'workbuddy'] : [source]
  const creditUsage = useData(() => source === 'workbuddy' || source === 'all' ? window.api.getWorkBuddyUsage('30d') : Promise.resolve(null), [source], 30_000)
  const creditsByModel = new Map(creditUsage?.models.map((m) => [m.rawModel, m.credits]) ?? [])
  const refresh = async () => {
    setBusy(true)
    try {
      setPricing(await window.api.refreshPricing())
    } finally {
      setBusy(false)
    }
  }
  const spinning = busy || pricing?.refreshing
  const byId = useMemo(() => new Map((pricing?.rows ?? []).map((r) => [r.id, r])), [pricing])
  const used = useMemo(
    () => (pricing?.models ?? []).filter((m) => tools.includes(m.source ?? 'claude') && ((m.tokens ?? 0) > 0 || m.source === 'workbuddy' && creditsByModel.has(m.model))).sort((a, b) => source === 'workbuddy' ? (creditsByModel.get(b.model) ?? 0) - (creditsByModel.get(a.model) ?? 0) : (b.cost ?? 0) - (a.cost ?? 0)),
    [pricing, source, creditUsage] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const priced = used.filter((m) => m.matched)
  const unpriced = used.filter((m) => !m.matched)
  const total = priced.reduce((a, m) => a + (m.cost ?? 0), 0)
  const table = useMemo(() => {
    if (tool !== 'workbuddy') return lineup(pricing?.rows ?? [], tool)
    const ids = new Set((pricing?.models ?? []).filter((m) => m.source === 'workbuddy').map((m) => m.rowId))
    return { current: (pricing?.rows ?? []).filter((r) => ids.size ? ids.has(r.id) : r.priceUrl?.includes('api-docs.deepseek.com')), older: [] }
  }, [pricing, tool])

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">模型定价</h1>
          <div className="page-sub">
            {source === 'workbuddy' ? '每百万 Token 的 API 参考价' : '每百万 Token 的价格'}
            {pricing && source !== 'workbuddy' && ` · 来自${SOURCE[pricing.source]}，${new Date(pricing.fetchedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 更新`}
          </div>
        </div>
        <button className="btn" onClick={refresh} disabled={!!spinning}>
          <IconRefresh className={spinning ? 'spin' : ''} />
          {spinning ? '拉取中…' : '立即拉取'}
        </button>
      </div>

      {pricing?.lastError && (
        <div className="card price-error">
          <IconAlert style={{ color: 'var(--serious)' }} />
          <span>拉取失败，正在使用{SOURCE[pricing.source]}：{pricing.lastError}</span>
        </div>
      )}

      <div className="card used-card">
        <div className="card-head">
          <div className="card-title">
            <span className="serif">你在用的模型</span>
            <span className="muted" style={{ fontWeight: 400 }}>
              {source === 'workbuddy' ? '近 30 天 · 本地记录积分' : '近 30 天 · 按费用'}
            </span>
          </div>
          {source === 'workbuddy' ? creditUsage?.credits != null && <span className="badge accent">合计 {creditUsage.credits.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 积分</span> : total > 0 && <span className="badge accent">{source === 'all' ? 'API 参考合计' : '合计'} {money(total)}</span>}
        </div>
        {!priced.length && !unpriced.length ? (
          <div className="empty">近 30 天没有用量</div>
        ) : (
          <div className="used-list">
            {used.filter((m) => m.matched || m.source === 'workbuddy').map((m, i) => (
              <UsedModel key={`${m.source}:${m.model}`} m={m} row={m.rowId ? byId.get(m.rowId) : undefined} credits={m.source === 'workbuddy' ? creditsByModel.get(m.model) : undefined} share={m.source === 'workbuddy' ? creditUsage?.credits ? (creditsByModel.get(m.model) ?? 0) / creditUsage.credits : 0 : total ? (m.cost ?? 0) / total : 0} i={i} />
            ))}
          </div>
        )}
        {unpriced.length > 0 && (
          <div className="used-unpriced">
            {unpriced.some((m) => m.source === 'workbuddy') ? '没有 API 参考价：' : '没有公开价格、只计 Token：'}
            {unpriced.map((m) => (
              <span key={`${m.source}:${m.model}`} className="mono">
                {m.model}
                <small className="muted"> {fmtTokens(m.tokens ?? 0, 1)}</small>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="card price-card">
        <div className="card-head">
          <div className="card-title">
            <span className="title-mark small">
              <SourceMark size={18} animated={false} source={tool} />
            </span>
            <span className="serif">{tool === 'workbuddy' ? 'WorkBuddy 模型参考价' : tool === 'claude' ? 'Claude 在售型号' : 'GPT 型号（Codex）'}</span>
            <span className="muted" style={{ fontWeight: 400 }}>
              {tool === 'workbuddy' ? '已使用的模型 · 非 WorkBuddy 实际账单' : '每个系列只列最新版'}
            </span>
          </div>
          {source === 'all' && (
            <Segmented
              small
              value={pick}
              onChange={(v) => {
                setPick(v)
                setOlder(false)
              }}
              options={[
                { value: 'claude', label: 'Claude' },
                { value: 'codex', label: 'GPT' },
                { value: 'workbuddy', label: 'WorkBuddy' }
              ]}
            />
          )}
        </div>
        <div className="table-wrap">
          <PriceTable rows={table.current} tool={tool} />
        </div>
        {tool === 'workbuddy' && !table.current.length && <div className="empty">这些模型还没有可靠的 API 参考价</div>}
        {table.older.length > 0 && (
          <>
            <button className="btn ghost small price-more" onClick={() => setOlder(!older)}>
              {older ? '收起更早的版本' : `更早的版本（${table.older.length}）`}
            </button>
            <AnimatePresence initial={false}>
              {older && (
                <motion.div className="table-wrap" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
                  <PriceTable rows={table.older} tool={tool} />
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
        <div className="price-foot">
          <span>{tool === 'workbuddy' ? 'DeepSeek 为峰时价' : '已退役的型号不再列出'}</span>
          <button className="link-btn" onClick={() => setRules(!rules)}>
            {rules ? '收起计价规则' : '计价规则'}
          </button>
        </div>
        <AnimatePresence initial={false}>
          {rules && (
            <motion.ul className="price-rules" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
              <li>费用按每条响应的输入、输出、缓存写入、缓存读取分别计价；思考 Token 算在输出里</li>
              {tool === 'claude' ? (
                <>
                  <li>缓存写入表里是 5 分钟价，悬停看 1 小时价</li>
                  <li>
                    Web 搜索 {pricing ? money(pricing.webSearchPer1k) : '—'} / 千次；美国境内推理 × {pricing?.usGeoMultiplier ?? '—'}；快速模式按快速价计输入输出
                  </li>
                </>
              ) : tool === 'workbuddy' ? (
                <>
                  <li>实际扣费是积分；这里只是 API 参考价，未知型号不估价</li>
                  <li>DeepSeek 峰时：工作日 UTC 01:00–04:00、06:00–10:00</li>
                  <li>GLM、MiniMax、Kimi 等来自 LiteLLM</li>
                </>
              ) : (
                <>
                  <li>GPT 价格来自 LiteLLM，是 API 等价费用，不是 ChatGPT 套餐的实际扣费</li>
                  <li>缓存写入不另收费；没有公开价格的型号按最接近的 GPT 估算</li>
                </>
              )}
              <li>每 24 小时从官方定价页更新</li>
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    </>
  )
}
