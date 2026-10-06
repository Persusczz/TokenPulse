import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import type { ModelResolution, PriceRow, PricingInfo, PricingSource } from '@shared/types'
import {
  BUNDLED_FETCHED_AT,
  BUNDLED_ROWS,
  DEFAULT_US_GEO_MULTIPLIER,
  DEFAULT_WEB_SEARCH_PER_1K,
  GPT_ROWS,
  LEGACY_ROWS
} from './bundled'
import { writeFileAtomic } from '../atomicFile'
import { LITELLM_URL, parseLiteLLM } from './litellm'
import { parsePricingMarkdown } from './markdown'
import { resolvePrice, type Resolved } from './resolve'

export const OFFICIAL_PRICING_URL = 'https://platform.claude.com/docs/en/about-claude/pricing.md'
const STALE_MS = 24 * 3600 * 1000

type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>

interface Snapshot {
  source: PricingSource
  fetchedAt: number
  rows: PriceRow[]
  webSearchPer1k: number
  usGeoMultiplier: number
}

/** Rows from `extra` whose id isn't already present */
function mergeMissing(base: PriceRow[], extra: PriceRow[]): PriceRow[] {
  const ids = new Set(base.map((r) => r.id))
  return [...base, ...extra.filter((r) => !ids.has(r.id))]
}

/** retired / limited flags from the bundled snapshot for rows that lack them (older caches) */
const KNOWN_STATUS = new Map([...BUNDLED_ROWS, ...LEGACY_ROWS].filter((r) => r.status).map((r) => [r.id, r.status!]))
/** older caches also kept LiteLLM's regional, batch and dated duplicates, and non-coding GPT variants */
const JUNK = /[.:]|-(think|thinking|batch)$|-\d{4}-\d{2}-\d{2}$|-\d{4}$|audio|realtime|tts|transcribe|search|image|diarize|instruct|preview|turbo|-chat$|-16k|^gpt-[0-4](?:[_a-z-]|$)/

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** "claude-opus-4-5" → "Claude Opus 4.5", "gpt-5.1-codex-max" → "GPT-5.1 Codex Max" */
export function prettyModelName(id: string): string {
  const c = /^claude-([a-z]+)-(\d+(?:-\d+)*)$/.exec(id)
  if (c) return `Claude ${cap(c[1])} ${c[2].replace(/-/g, '.')}`
  const g = /^gpt-(\d+(?:\.\d+)?)(?:-(.+))?$/.exec(id)
  if (g) return `GPT-${g[1]}${g[2] ? ` ${g[2].split('-').map(cap).join(' ')}` : ''}`
  return id
}

export function tidy(rows: PriceRow[]): PriceRow[] {
  return rows
    .filter((r) => !JUNK.test(r.id.replace(/^gpt-\d+\.\d+/, (v) => v.replace('.', '_'))))
    .map((r) => {
      const out = r.status || !KNOWN_STATUS.has(r.id) ? r : { ...r, status: KNOWN_STATUS.get(r.id) }
      // LiteLLM rows are named by their raw keys
      return /[/]|^gpt-|^anthropic\.|^claude-/.test(out.name) ? { ...out, name: prettyModelName(out.id) } : out
    })
}

export class PricingService extends EventEmitter {
  private snap: Snapshot = {
    source: 'bundled',
    fetchedAt: BUNDLED_FETCHED_AT,
    rows: tidy(mergeMissing(BUNDLED_ROWS, [...LEGACY_ROWS, ...GPT_ROWS])),
    webSearchPer1k: DEFAULT_WEB_SEARCH_PER_1K,
    usGeoMultiplier: DEFAULT_US_GEO_MULTIPLIER
  }
  private byId = new Map<string, PriceRow>()
  private memo = new Map<string, Resolved | null>()
  private lastError: string | undefined
  private refreshing: Promise<void> | null = null

  constructor(
    private cachePath: string,
    private fetchFn: Fetch
  ) {
    super()
    this.index()
  }

  private index(): void {
    this.byId = new Map(this.snap.rows.map((r) => [r.id, r]))
    this.memo.clear()
  }

  get webSearchPer1k(): number {
    return this.snap.webSearchPer1k
  }

  get usGeoMultiplier(): number {
    return this.snap.usGeoMultiplier
  }

  resolve(model: string): Resolved | null {
    if (!this.memo.has(model)) this.memo.set(model, resolvePrice(model, this.byId))
    return this.memo.get(model) ?? null
  }

  info(models: Iterable<string | Omit<ModelResolution, 'matched' | 'estimated' | 'rowId'>>): PricingInfo {
    const list: ModelResolution[] = [...models]
      .map((m) => (typeof m === 'string' ? { model: m } : m))
      .sort((a, b) => a.model.localeCompare(b.model))
      .map((m) => {
        const r = this.resolve(m.model)
        return { ...m, matched: r ? r.row.name : null, rowId: r?.row.id ?? null, estimated: r?.estimated ?? false }
      })
    return {
      ...this.snap,
      models: list,
      lastError: this.lastError,
      refreshing: this.refreshing !== null
    }
  }

  async loadCache(): Promise<void> {
    try {
      const s = JSON.parse(await readFile(this.cachePath, 'utf8')) as Snapshot
      if (Array.isArray(s.rows) && s.rows.length && typeof s.fetchedAt === 'number') {
        this.snap = { ...s, rows: tidy(mergeMissing(s.rows, [...LEGACY_ROWS, ...GPT_ROWS])) }
        this.index()
      }
    } catch {
      /* no cache yet */
    }
  }

  get isStale(): boolean {
    return this.snap.source === 'bundled' || Date.now() - this.snap.fetchedAt > STALE_MS
  }

  refresh(): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null
        this.emit('change')
      })
      this.emit('change')
    }
    return this.refreshing
  }

  private async getText(url: string, ms: number): Promise<string> {
    const res = await this.fetchFn(url, { signal: AbortSignal.timeout(ms) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.text()
  }

  private async doRefresh(): Promise<void> {
    let next: Snapshot | null = null
    const errors: string[] = []
    try {
      const parsed = parsePricingMarkdown(await this.getText(OFFICIAL_PRICING_URL, 20000))
      next = {
        source: 'official',
        fetchedAt: Date.now(),
        rows: parsed.rows,
        webSearchPer1k: parsed.webSearchPer1k ?? DEFAULT_WEB_SEARCH_PER_1K,
        usGeoMultiplier: parsed.usGeoMultiplier ?? DEFAULT_US_GEO_MULTIPLIER
      }
    } catch (e) {
      errors.push(`官方定价页：${(e as Error).message}`)
    }
    try {
      const lite = parseLiteLLM(JSON.parse(await this.getText(LITELLM_URL, 15000)))
      if (lite.length) {
        next = next
          ? { ...next, rows: mergeMissing(next.rows, lite) }
          : {
              source: 'litellm',
              fetchedAt: Date.now(),
              rows: mergeMissing(lite, BUNDLED_ROWS),
              webSearchPer1k: DEFAULT_WEB_SEARCH_PER_1K,
              usGeoMultiplier: DEFAULT_US_GEO_MULTIPLIER
            }
      }
    } catch (e) {
      if (!next) errors.push(`LiteLLM：${(e as Error).message}`)
    }
    if (!next) {
      this.lastError = errors.join('；')
      return
    }
    this.lastError = undefined
    this.snap = { ...next, rows: tidy(mergeMissing(next.rows, [...LEGACY_ROWS, ...GPT_ROWS])) }
    this.index()
    await writeFileAtomic(this.cachePath, JSON.stringify(next)).catch(() => {})
  }
}
