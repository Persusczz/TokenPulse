export function fmtTokens(n: number, digits = 1): string {
  const a = Math.abs(n)
  if (a < 1000) return String(Math.round(n))
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K']
  ]
  for (const [v, u] of units) {
    if (a >= v) {
      const x = n / v
      return `${x.toFixed(x >= 100 ? 0 : digits)}${u}`
    }
  }
  return String(n)
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

export interface MoneyOpts {
  currency: 'USD' | 'CNY'
  cnyRate: number
}

export function toCurrency(usd: number, o: MoneyOpts): number {
  return o.currency === 'CNY' ? usd * o.cnyRate : usd
}

export function fmtMoney(usd: number, o: MoneyOpts, digits?: number): string {
  const v = toCurrency(usd, o)
  const sym = o.currency === 'CNY' ? '¥' : '$'
  const d = digits ?? (Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 1 || v === 0 ? 2 : Math.abs(v) >= 0.01 ? 3 : 4)
  return `${v < 0 ? '-' : ''}${sym}${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`
}

export function fmtPct(x: number, digits = 0): string {
  return `${(x * 100).toFixed(digits)}%`
}
