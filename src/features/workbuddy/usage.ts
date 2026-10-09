import type { RangeKey, UsageEntry, WorkBuddyUsage } from '@shared/types'
import { rangeBounds } from '../../main/aggregate'

const dayKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function workbuddyUsage(entries: UsageEntry[], range: RangeKey, now: number, label: (model: string) => string = (m) => m): WorkBuddyUsage {
  const b = rangeBounds(range, now, entries[0]?.ts ?? null)
  const models = new Map<string, { model: string; rawModel: string; credits: number; requests: number }>()
  const daily = new Map<string, { day: string; credits: number; recorded: number; missing: number }>()
  let credits = 0, recorded = 0, missing = 0, lastAt: number | null = null
  for (const e of entries) {
    if (e.source !== 'workbuddy' || e.ts < b.start || e.ts >= b.end || e.ts > now) continue
    lastAt = Math.max(lastAt ?? 0, e.ts)
    const day = dayKey(new Date(e.ts))
    const bucket = daily.get(day) ?? { day, credits: 0, recorded: 0, missing: 0 }
    daily.set(day, bucket)
    if (e.credit === undefined) { missing++; bucket.missing++; continue }
    credits += e.credit; recorded++
    bucket.credits += e.credit; bucket.recorded++
    const m = models.get(e.model) ?? { model: label(e.model), rawModel: e.model, credits: 0, requests: 0 }
    m.credits += e.credit; m.requests++; models.set(e.model, m)
  }
  // every day of the range, so quiet days stay on the axis instead of closing up
  const last = Math.min(b.end - 1, now)
  for (let d = new Date(b.start); d.getTime() <= last; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const day = dayKey(d)
    if (!daily.has(day)) daily.set(day, { day, credits: 0, recorded: 0, missing: 0 })
  }
  return { range, credits: recorded ? credits : null, recorded, missing, lastAt, models: [...models.values()].sort((a, b) => b.credits - a.credits), daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)) }
}
