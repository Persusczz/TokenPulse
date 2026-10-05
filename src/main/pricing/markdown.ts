import type { PriceRow } from '@shared/types'
import { nameToId } from './resolve'

export interface ParsedPricing {
  rows: PriceRow[]
  webSearchPer1k: number | null
  usGeoMultiplier: number | null
}

function cleanCell(c: string): string {
  return c
    .replace(/<sup>.*?<\/sup>/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\(.*?\)/g, '')
    .replace(/[*_`]/g, '')
    .trim()
}

function price(c: string): number | null {
  const m = c.replace(/,/g, '').match(/\$\s*([\d.]+)\s*\/\s*MTok/i)
  return m ? Number(m[1]) : null
}

/** Markdown table rows (cells) of the first table after `heading` */
function tableAfter(md: string, heading: RegExp): string[][] | null {
  const lines = md.split(/\r?\n/)
  const at = lines.findIndex((l) => heading.test(l))
  if (at < 0) return null
  const rows: string[][] = []
  let started = false
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i].trim()
    if (l.startsWith('|')) {
      started = true
      rows.push(l.replace(/^\||\|$/g, '').split('|'))
    } else if (started) break
    else if (/^#{1,6}\s/.test(l)) break
  }
  return rows.length ? rows : null
}

/**
 * Parses the official pricing page (platform.claude.com/.../pricing.md).
 * Columns are located by header text so reordering doesn't break it.
 */
export function parsePricingMarkdown(md: string): ParsedPricing {
  const table = tableAfter(md, /^##\s+Model pricing/i)
  if (!table || table.length < 3) throw new Error('model pricing table not found')
  const header = table[0].map((h) => cleanCell(h).toLowerCase())
  const col = (re: RegExp) => header.findIndex((h) => re.test(h))
  const iModel = col(/^model/)
  const iIn = col(/base input/)
  const iW5 = col(/5m cache/)
  const iW1 = col(/1h cache/)
  const iHit = col(/cache hit/)
  const iOut = col(/^output/)
  if ([iModel, iIn, iW5, iW1, iHit, iOut].some((i) => i < 0)) throw new Error('unexpected pricing table header')

  const rows: PriceRow[] = []
  for (const cells of table.slice(1)) {
    if (cells.every((c) => /^\s*:?-+:?\s*$/.test(c))) continue
    const raw = cells[iModel] ?? ''
    const name = cleanCell(raw)
    const vals = [iIn, iW5, iW1, iHit, iOut].map((i) => price(cells[i] ?? ''))
    if (!name || vals.some((v) => v === null)) continue
    const [input, cacheWrite5m, cacheWrite1h, cacheRead, output] = vals as number[]
    // "Claude Opus 4 ([retired, except on Google Cloud](…))", "Claude Mythos 5 ([limited availability](…))"
    const status = /retired|deprecated/i.test(raw) ? ('retired' as const) : /limited availability/i.test(raw) ? ('limited' as const) : undefined
    rows.push({ id: nameToId(name), name, input, cacheWrite5m, cacheWrite1h, cacheRead, output, ...(status ? { status } : {}) })
  }
  if (rows.length < 5) throw new Error(`only ${rows.length} pricing rows parsed`)

  const fast = tableAfter(md, /^#{2,4}\s+Fast mode pricing/i)
  if (fast) {
    for (const cells of fast.slice(1)) {
      const input = price(cells[1] ?? '')
      const output = price(cells[2] ?? '')
      if (input === null || output === null) continue
      for (const n of cleanCell(cells[0] ?? '').split(/\s*\/\s*(?=Claude)/)) {
        const row = rows.find((r) => r.id === nameToId(n))
        if (row) {
          row.fastInput = input
          row.fastOutput = output
        }
      }
    }
  }

  const ws = md.replace(/,/g, '').match(/\$\s*([\d.]+)\s+per\s+1000\s+searches/i)
  const geo = md.match(/inference_geo[^\n]{0,80}?(\d+(?:\.\d+)?)x\s+(?:pricing\s+)?multiplier/i)
  return {
    rows,
    webSearchPer1k: ws ? Number(ws[1]) : null,
    usGeoMultiplier: geo ? Number(geo[1]) : null
  }
}
