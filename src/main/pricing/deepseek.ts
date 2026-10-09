import type { PriceRow } from '@shared/types'

export const DEEPSEEK_PRICING_URL = 'https://api-docs.deepseek.com/quick_start/pricing/'
const row = (id: string, name: string, input: number, output: number, cacheRead: number, off: number[], source: string): PriceRow => ({
  id, name, input, output, cacheRead, cacheWrite5m: input, cacheWrite1h: input,
  priceSource: source, priceUrl: DEEPSEEK_PRICING_URL,
  priceNote: `峰时 API 参考价；谷时输入 $${off[0]}、输出 $${off[1]}、缓存读 $${off[2]} / 百万 Token`
})

/** Verified 2026-10-07; API reference only, never converted into WorkBuddy credits. */
export const DEEPSEEK_ROWS = [
  row('deepseek-v4.1-flash', 'DeepSeek V4.1 Flash', 0.3, 1.2, 0.006, [0.15, 0.6, 0.003], 'DeepSeek 官方快照 · 10/7'),
  row('deepseek-v4-pro', 'DeepSeek V4 Pro', 1.32, 3.96, 0.044, [0.66, 1.98, 0.022], 'DeepSeek 官方快照 · 10/7')
]

/** Parse the provider table's merged cells; reject changed versions or incomplete prices. */
export function parseDeepSeekPricing(html: string): PriceRow[] {
  const table = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].find((m) => m[1].includes('MODEL VERSION'))?.[1]
  const lines = [...(table ?? '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1].replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').trim())
  if (!lines.some((l) => /^MODEL VERSION DeepSeek-V4\.1-Flash DeepSeek-V4-Pro(?:-0813)?$/.test(l))) throw new Error('DeepSeek 模型版本已变化')
  const rates = (label: string) => {
    const i = lines.findIndex((l) => l.includes(label))
    const off = lines[i] ?? '', peak = lines[i + 1] ?? ''
    const values = (s: string) => [...s.matchAll(/\$(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]))
    const low = values(off), high = values(peak)
    if (!off.includes('OFF-PEAK') || !/^PEAK\b/.test(peak) || low.length !== 2 || high.length !== 2 || [...low, ...high].some((n) => n <= 0)) throw new Error('DeepSeek 价格表不完整')
    return { low, high }
  }
  const input = rates('1M INPUT TOKENS (CACHE MISS)'), output = rates('1M OUTPUT TOKENS'), cache = rates('1M INPUT TOKENS (CACHE HIT)')
  return DEEPSEEK_ROWS.map((r, i) => row(r.id, r.name, input.high[i], output.high[i], cache.high[i], [input.low[i], output.low[i], cache.low[i]], 'DeepSeek 官方定价'))
}
