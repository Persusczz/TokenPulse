import { describe, expect, it } from 'vitest'
import { computeAchievements } from '../src/main/achievements'
import { DEFAULT_SETTINGS, sanitize } from '../src/main/settings'
import { PACK_KEYS, PACKS } from '../src/shared/packs'

const T0 = new Date(2026, 9, 5, 12).getTime()

describe('2.11 packs', () => {
  it('has the six new packs, each with its own backdrop the settings accept', () => {
    for (const k of ['mystic', 'cyber', 'xianxia', 'koi', 'ukiyo', 'pixel'] as const) {
      expect(PACK_KEYS).toContain(k)
      expect(PACKS[k].backdrop).toBe(k)
      expect(sanitize({ themePack: k, backdrop: k }, DEFAULT_SETTINGS)).toMatchObject({ themePack: k, backdrop: k })
    }
    // every pack has its own entrance name
    const names = PACK_KEYS.map((k) => PACKS[k].entrance)
    expect(new Set(names).size).toBe(names.length)
  })

  it('counts packs tried toward 16 and the three fantasy worlds', () => {
    const at = (i: number) => T0 + i * 60_000
    const three = ['mystic', 'cyber', 'xianxia'].map((key, i) => ({ key, at: at(i) }))
    let a = Object.fromEntries(computeAchievements([], {}, { packs: three, now: T0 + 3_600_000 }).map((x) => [x.id, x]))
    expect(a.worlds.unlocked).toBe(true)
    expect(a.worlds.at).toBe(at(2))
    expect(a['packs-16'].unlocked).toBe(false)
    const many = PACK_KEYS.filter((k) => k !== 'none')
      .slice(0, 16)
      .map((key, i) => ({ key, at: at(i) }))
    a = Object.fromEntries(computeAchievements([], {}, { packs: many, now: T0 + 3_600_000 }).map((x) => [x.id, x]))
    expect(a['packs-16'].unlocked).toBe(true)
    expect(a['packs-16'].at).toBe(at(15))
  })
})
