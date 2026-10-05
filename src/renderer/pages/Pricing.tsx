import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { fmtTokens } from '@shared/format'
import type { ModelResolution, PriceRow, PricingSource, UsageSource } from '@shared/types'
import { SourceMark } from '../components/CodexMark'
import { IconAlert, IconRefresh } from '../components/Icons'
import { Segmented } from '../components/Segmented'
import { useApp, useSource } from '../state'

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
function lineup(rows: PriceRow[], tool: UsageSource): { current: PriceRow[]; older: PriceRow[] } {
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
function UsedModel({ m, row, share, i }: { m: ModelResolution; row: PriceRow | undefined; share: number; i: number }) {
  const { money } = useApp()
  const p = (v: number) => money(v, v < 1 ? 3 : 2)
  const claude = m.model.startsWith('claude') || m.source === 'claude'
  return (
    <motion.div className="used-row" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
      <div className="used-name">
        <b>{row?.name ?? m.model}</b>
        <span className="muted mono">{m.model}</span>
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
        <b className="tnum">{money(m.cost ?? 0)}</b>
        <span className="used-bar">
          <i style={{ width: `${Math.max(1.5, share * 100)}%` }} />
        </span>
        <small className="muted tnum">{fmtTokens(m.tokens ?? 0, 1)} tokens</small>
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
          <th className="num">{tool === 'claude' ? '缓存写入' : '缓存写入'}</th>
          <th className="num">缓存读取</th>
          <th className="num">输出</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>
              <span className="price-name">{r.name}</span>
              <StatusTag row={r} />
              {r.fastInput !== undefined && (
                <span className="price-tag fast" title="快速模式（研究预览）的输入 / 输出价格">
                  快速 {p(r.fastInput)} / {p(r.fastOutput ?? 0)}
                </span>
              )}
            </td>
            <td className="num">{p(r.input)}</td>
            <td className="num" title={tool === 'claude' ? `5 分钟缓存；1 小时缓存 ${p(r.cacheWrite1h)}` : 'OpenAI 不额外收缓存写入费，按输入计'}>
              {tool === 'claude' ? p(r.cacheWrite5m) : <span className="muted">同输入</span>}
            </td>
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
  const tools: UsageSource[] = source === 'all' ? ['claude', 'codex'] : [source]
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
    () => (pricing?.models ?? []).filter((m) => tools.includes(m.source ?? 'claude') && (m.tokens ?? 0) > 0).sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0)),
    [pricing, source] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const priced = used.filter((m) => m.matched)
  const unpriced = used.filter((m) => !m.matched)
  const total = priced.reduce((a, m) => a + (m.cost ?? 0), 0)
  const table = useMemo(() => lineup(pricing?.rows ?? [], tool), [pricing, tool])

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">模型定价</h1>
          <div className="page-sub">
            每百万 Token 的价格
            {pricing && ` · 来自${SOURCE[pricing.source]}，${new Date(pricing.fetchedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 更新`}
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
              近 30 天 · 按费用
            </span>
          </div>
          {total > 0 && <span className="badge accent">合计 {money(total)}</span>}
        </div>
        {!priced.length && !unpriced.length ? (
          <div className="empty">近 30 天没有用量</div>
        ) : (
          <div className="used-list">
            {priced.map((m, i) => (
              <UsedModel key={m.model} m={m} row={m.rowId ? byId.get(m.rowId) : undefined} share={total ? (m.cost ?? 0) / total : 0} i={i} />
            ))}
          </div>
        )}
        {unpriced.length > 0 && (
          <div className="used-unpriced">
            没有公开价格、只计 Token：
            {unpriced.map((m) => (
              <span key={m.model} className="mono">
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
            <span className="serif">{tool === 'claude' ? 'Claude 在售型号' : 'GPT 型号（Codex）'}</span>
            <span className="muted" style={{ fontWeight: 400 }}>
              每个系列只列最新版
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
                { value: 'codex', label: 'GPT' }
              ]}
            />
          )}
        </div>
        <div className="table-wrap">
          <PriceTable rows={table.current} tool={tool} />
        </div>
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
          <span>已退役的型号不再列出（历史用量照旧按原价计费）。</span>
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
                  <li>缓存写入分 5 分钟和 1 小时两档（表里是 5 分钟价，鼠标停在价格上看 1 小时价）</li>
                  <li>
                    Web 搜索 {pricing ? money(pricing.webSearchPer1k) : '—'} / 千次；美国境内推理 × {pricing?.usGeoMultiplier ?? '—'}；快速模式按快速价计输入输出
                  </li>
                </>
              ) : (
                <>
                  <li>GPT 价格来自 LiteLLM 价格表，是 API 等价费用；ChatGPT 套餐里的 Codex 实际不按这个收费</li>
                  <li>OpenAI 不额外收缓存写入费；没有公开价格的新型号按最接近的 GPT 型号估算</li>
                </>
              )}
              <li>每 24 小时自动从官方定价页更新，失败时回退到 LiteLLM 或内置快照</li>
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    </>
  )
}
