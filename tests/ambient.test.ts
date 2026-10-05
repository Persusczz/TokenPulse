import { describe, expect, it } from 'vitest'
import { ambient, mixHex, moodAt } from '../src/shared/ambient'
import { cnCount, crossed, QUOTA_MARKS, TOKEN_MARKS } from '../src/shared/milestones'

describe('adaptive backdrop', () => {
  it('follows the time of day', () => {
    expect([4, 5, 7, 8, 16, 17, 19, 20, 23].map(moodAt)).toEqual(['night', 'dawn', 'dawn', 'day', 'day', 'dusk', 'dusk', 'night', 'night'])
  })

  it('mixes colours', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mixHex('#d97757', '#d03b3b', 0)).toBe('#d97757')
    expect(mixHex('#d97757', '#d03b3b', 2)).toBe('#d03b3b')
  })

  it('warms toward red from 70% of the 5h quota and brightens with intensity', () => {
    const calm = ambient({ hour: 12, quotaPct: 40, intensity: 0, adaptive: true })
    const hot = ambient({ hour: 12, quotaPct: 95, intensity: 3, adaptive: true })
    expect(calm.heat).toBe(0)
    expect(hot.heat).toBe(1)
    expect(hot.glow).toBeGreaterThan(calm.glow)
    expect(hot.colors[1]).not.toBe(calm.colors[1])
    expect(ambient({ hour: 12, quotaPct: 82.5, intensity: 1, adaptive: true }).heat).toBeCloseTo(0.5)
  })

  it('builds the palette around the accent colour', () => {
    const clay = ambient({ hour: 12, quotaPct: null, intensity: 1, adaptive: true })
    const ocean = ambient({ hour: 12, quotaPct: null, intensity: 1, adaptive: true, accent: '#3b82c4' })
    // day palette: clay is the first colour; it becomes the accent, the rest lean toward it
    expect(clay.colors[0]).toBe('#d97757')
    expect(ocean.colors[0]).toBe('#3b82c4')
    expect(ocean.colors[2]).toBe(mixHex('#5e9b4a', '#3b82c4', 0.35))
    expect(ambient({ hour: 12, quotaPct: null, intensity: 1, adaptive: true, accent: '#D97757' }).colors).toEqual(clay.colors)
  })

  it('stays fixed when not adaptive', () => {
    const a = ambient({ hour: 2, quotaPct: 99, intensity: 3, adaptive: false })
    expect(a).toEqual(ambient({ hour: 14, quotaPct: null, intensity: 0, adaptive: false }))
    expect(a.heat).toBe(0)
  })
})

describe('milestones', () => {
  it('reports the highest mark passed', () => {
    expect(crossed(900_000, 1_200_000, TOKEN_MARKS)).toBe(1e6)
    expect(crossed(900_000, 12_000_000, TOKEN_MARKS)).toBe(1e7)
    expect(crossed(1e6, 1.5e6, TOKEN_MARKS)).toBeNull()
    // a new day starts low again
    expect(crossed(3e8, 2000, TOKEN_MARKS)).toBeNull()
    expect(crossed(74, 76, QUOTA_MARKS)).toBe(75)
  })

  it('formats counts the Chinese way', () => {
    expect(cnCount(1e6)).toBe('100 万')
    expect(cnCount(2.5e7)).toBe('2500 万')
    expect(cnCount(1e8)).toBe('1 亿')
    expect(cnCount(2.5e9)).toBe('25 亿')
  })
})
