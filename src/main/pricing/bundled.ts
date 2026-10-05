import type { PriceRow } from '@shared/types'

const row = (
  id: string,
  name: string,
  input: number,
  cacheWrite5m: number,
  cacheWrite1h: number,
  cacheRead: number,
  output: number,
  fast?: [number, number] | null,
  status?: PriceRow['status']
): PriceRow => ({
  id,
  name,
  input,
  cacheWrite5m,
  cacheWrite1h,
  cacheRead,
  output,
  ...(fast ? { fastInput: fast[0], fastOutput: fast[1] } : {}),
  ...(status ? { status } : {})
})

/** Snapshot of platform.claude.com pricing, 2026-10-03. Used when offline. */
export const BUNDLED_FETCHED_AT = Date.UTC(2026, 9, 3)

export const BUNDLED_ROWS: PriceRow[] = [
  row('claude-fable-5-1', 'Claude Fable 5.1', 10, 12.5, 20, 0.25, 50),
  row('claude-mythos-5-1', 'Claude Mythos 5.1', 10, 12.5, 20, 0.25, 50, null, 'limited'),
  row('claude-fable-5', 'Claude Fable 5', 10, 12.5, 20, 1, 50),
  row('claude-mythos-5', 'Claude Mythos 5', 10, 12.5, 20, 1, 50, null, 'limited'),
  row('claude-opus-5-5', 'Claude Opus 5.5', 4, 5, 8, 0.2, 20, [8, 40]),
  row('claude-opus-5', 'Claude Opus 5', 5, 6.25, 10, 0.5, 25, [10, 50]),
  row('claude-opus-4-8', 'Claude Opus 4.8', 5, 6.25, 10, 0.5, 25, [10, 50]),
  row('claude-opus-4-7', 'Claude Opus 4.7', 5, 6.25, 10, 0.5, 25),
  row('claude-opus-4-6', 'Claude Opus 4.6', 5, 6.25, 10, 0.5, 25),
  row('claude-opus-4-5', 'Claude Opus 4.5', 5, 6.25, 10, 0.5, 25),
  row('claude-opus-4-1', 'Claude Opus 4.1', 15, 18.75, 30, 1.5, 75, null, 'retired'),
  row('claude-opus-4', 'Claude Opus 4', 15, 18.75, 30, 1.5, 75, null, 'retired'),
  row('claude-sonnet-5-5', 'Claude Sonnet 5.5', 2, 2.5, 4, 0.2, 10),
  row('claude-sonnet-5', 'Claude Sonnet 5', 2, 2.5, 4, 0.2, 10),
  row('claude-sonnet-4-6', 'Claude Sonnet 4.6', 3, 3.75, 6, 0.3, 15),
  row('claude-sonnet-4-5', 'Claude Sonnet 4.5', 3, 3.75, 6, 0.3, 15),
  row('claude-sonnet-4', 'Claude Sonnet 4', 3, 3.75, 6, 0.3, 15, null, 'retired'),
  row('claude-haiku-4-5', 'Claude Haiku 4.5', 1, 1.25, 2, 0.1, 5),
  row('claude-haiku-3-5', 'Claude Haiku 3.5', 0.8, 1, 1.6, 0.08, 4, null, 'retired')
]

/** Retired models no longer on the pricing page; kept so old history still prices */
export const LEGACY_ROWS: PriceRow[] = [
  row('claude-sonnet-3-7', 'Claude Sonnet 3.7', 3, 3.75, 6, 0.3, 15, null, 'retired'),
  row('claude-sonnet-3-5', 'Claude Sonnet 3.5', 3, 3.75, 6, 0.3, 15, null, 'retired'),
  row('claude-sonnet-3', 'Claude Sonnet 3', 3, 3.75, 6, 0.3, 15, null, 'retired'),
  row('claude-opus-3', 'Claude Opus 3', 15, 18.75, 30, 1.5, 75, null, 'retired'),
  row('claude-haiku-3', 'Claude Haiku 3', 0.25, 0.3, 0.5, 0.03, 1.25, null, 'retired')
]

/**
 * OpenAI models Codex runs, for API-equivalent cost when LiteLLM's list is not
 * at hand. OpenAI charges nothing extra to write its cache, so writes cost as input.
 */
const gpt = (id: string, name: string, input: number, cached: number, output: number) => row(id, name, input, input, input, cached, output)
export const GPT_ROWS: PriceRow[] = [
  gpt('gpt-5', 'GPT-5', 1.25, 0.125, 10),
  gpt('gpt-5-codex', 'GPT-5 Codex', 1.25, 0.125, 10),
  gpt('gpt-5-mini', 'GPT-5 mini', 0.25, 0.025, 2),
  gpt('gpt-5-nano', 'GPT-5 nano', 0.05, 0.005, 0.4)
]

export const DEFAULT_WEB_SEARCH_PER_1K = 10
export const DEFAULT_US_GEO_MULTIPLIER = 1.1
