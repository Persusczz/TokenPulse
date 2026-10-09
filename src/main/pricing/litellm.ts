import type { PriceRow } from '@shared/types'
import { normalizeModelId } from './resolve'

export const LITELLM_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'

const M = 1e6

/** Vendor reference rows from LiteLLM's price list, per-token costs converted to $/MTok */
export function parseLiteLLM(json: Record<string, any>): PriceRow[] {
  const out = new Map<string, PriceRow>()
  // first-party keys ("claude-…") before provider-prefixed ones, which can carry regional prices
  const entries = Object.entries(json).sort(([a], [b]) => Number(/[./]/.test(a)) - Number(/[./]/.test(b)))
  for (const [key, v] of entries) {
    if (!v || typeof v.input_cost_per_token !== 'number' || typeof v.output_cost_per_token !== 'number') continue
    // batch prices, thinking aliases and dated snapshots repeat the main rows
    if (/:|-think(ing)?$|-\d{4}-\d{2}-\d{2}$/.test(key)) continue
    // OpenAI's own entries only (Codex models); its cache has no write charge
    if (/^gpt-\d/i.test(key)) {
      const id = normalizeModelId(key)
      if (out.has(id)) continue
      const input = v.input_cost_per_token * M
      out.set(id, { id, name: key, input, output: v.output_cost_per_token * M, cacheWrite5m: input, cacheWrite1h: input, cacheRead: (v.cache_read_input_token_cost ?? v.input_cost_per_token * 0.1) * M })
      continue
    }
    if (/^(?:deepseek(?:\/|\b)|(?:z_ai|zai)\/glm-|qwen\/|hunyuan\/|minimax\/|moonshot\/)/i.test(key)) {
      const id = normalizeModelId(key)
      if (out.has(id)) continue
      const input = v.input_cost_per_token * M
      out.set(id, { id, name: id, input, output: v.output_cost_per_token * M, cacheWrite5m: input, cacheWrite1h: input, cacheRead: (v.cache_read_input_token_cost ?? v.input_cost_per_token) * M, priceSource: 'LiteLLM · ' + key.split('/')[0], priceUrl: LITELLM_URL, priceNote: '模型提供商的 API 参考价；WorkBuddy 实际扣费以响应积分为准' })
      continue
    }
    if (!/claude/i.test(key)) continue
    // "claude-opus-4.5" from some providers is "claude-opus-4-5"
    const id = normalizeModelId(key).replace(/(\d)\.(\d)/g, '$1-$2')
    if (!/^claude-[a-z]+-\d/.test(id) || out.has(id)) continue
    const input = v.input_cost_per_token * M
    out.set(id, {
      id,
      name: key,
      input,
      output: v.output_cost_per_token * M,
      cacheWrite5m: (v.cache_creation_input_token_cost ?? v.input_cost_per_token * 1.25) * M,
      cacheWrite1h: (v.cache_creation_input_token_cost_above_1hr ?? v.input_cost_per_token * 2) * M,
      cacheRead: (v.cache_read_input_token_cost ?? v.input_cost_per_token * 0.1) * M
    })
  }
  return [...out.values()]
}
