import { fmtMoney } from '@shared/format'
import type { LiveStats, Settings } from '@shared/types'
import { dayKey } from './aggregate'

export interface BudgetAlert {
  key: string
  title: string
  body: string
}

const THRESHOLDS = [0.8, 1] as const

/**
 * Alerts for budgets crossing 80% / 100%, at most once per period and
 * threshold. Crossing 100% directly suppresses the 80% alert. `fired` is
 * updated in place.
 */
export function checkBudgets(live: LiveStats, s: Settings, fired: Set<string>): BudgetAlert[] {
  const out: BudgetAlert[] = []
  const day = dayKey(live.now)
  const periods = [
    { budget: s.dailyBudget, spent: live.today.cost, prefix: `d:${day}`, name: '今日' },
    { budget: s.monthlyBudget, spent: live.monthCost, prefix: `m:${day.slice(0, 7)}`, name: '本月' }
  ]
  for (const p of periods) {
    if (!p.budget) continue
    const pct = p.spent / p.budget
    const hit = THRESHOLDS.filter((t) => pct >= t)
    if (!hit.length) continue
    const top = hit[hit.length - 1]
    const keys = hit.map((t) => `${p.prefix}:${t}`)
    const topKey = `${p.prefix}:${top}`
    const isNew = !fired.has(topKey)
    keys.forEach((k) => fired.add(k))
    if (!isNew) continue
    out.push({
      key: topKey,
      title: top >= 1 ? `${p.name}预算已用完` : `${p.name}预算已用 ${Math.round(top * 100)}%`,
      body: `${p.name}已花费 ${fmtMoney(p.spent, s)}，预算 ${fmtMoney(p.budget, s)}（${Math.round(pct * 100)}%）`
    })
  }
  return out
}

/** Drops fired keys from earlier days/months */
export function pruneFired(fired: Set<string>, now: number): void {
  const day = dayKey(now)
  for (const k of fired) {
    if (!(k.startsWith(`d:${day}`) || k.startsWith(`m:${day.slice(0, 7)}`))) fired.delete(k)
  }
}
