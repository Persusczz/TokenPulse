import { describe, expect, it } from 'vitest'
import { sunTimes } from '../src/shared/astro'
import { mix, nextPhase, phaseOf, skyAt, uiColors } from '../src/shared/daycycle'
import { isReset } from '../src/shared/rewind'

const BEIJING = { name: '北京', lat: 39.9, lon: 116.4 }
const SF = { name: '旧金山', lat: 37.77, lon: -122.42 }
/** 2026-10-05 at hh:mm Beijing time (UTC+8) */
const bj = (hh: number, mm = 0) => Date.UTC(2026, 9, 5, hh - 8, mm)

describe('the day at a place', () => {
  it('goes night → morning → noon → dusk → night with the real sun', () => {
    const at = (h: number, m = 0) => skyAt(bj(h, m), BEIJING).phase
    expect(at(2)).toBe('night')
    expect(at(5, 50)).toBe('morning')
    expect(at(7)).toBe('morning')
    expect(at(12)).toBe('noon')
    expect(at(17)).toBe('dusk')
    expect(at(18, 30)).toBe('dusk')
    expect(at(21)).toBe('night')
  })

  it('changes gradually: no jump in colour from one minute to the next', () => {
    const dist = (a: string, b: string) => {
      const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
      const x = p(a)
      const y = p(b)
      return Math.max(...x.map((v, i) => Math.abs(v - y[i])))
    }
    let worst = 0
    let prev = skyAt(bj(0), BEIJING)
    for (let t = bj(0) + 60_000; t < bj(24); t += 60_000) {
      const s = skyAt(t, BEIJING)
      worst = Math.max(worst, dist(prev.horizon, s.horizon), dist(prev.zenith, s.zenith), dist(prev.accent, s.accent))
      prev = s
    }
    // a minute never moves a colour channel by more than a few steps (the steepest is the dusk horizon turning from violet to red)
    expect(worst).toBeLessThanOrEqual(12)
  })

  it('takes about an hour from deep blue to sunrise colours', () => {
    const times = sunTimes(bj(12), BEIJING)
    const rise = times.rise!
    expect(skyAt(rise - 70 * 60_000, BEIJING).stars).toBeGreaterThan(0.5)
    expect(skyAt(rise + 10 * 60_000, BEIJING).stars).toBe(0)
    // dawn pink at the horizon around sunrise, deep orange around sunset
    expect(skyAt(rise, BEIJING).horizon).not.toBe(skyAt(times.set!, BEIJING).horizon)
  })

  it('finds the next change of phase to the minute', () => {
    const n = nextPhase(bj(17), BEIJING)!
    expect(n.phase).toBe('night')
    expect(phaseOf(skyAt(n.at, BEIJING).alt, false, 20)).toBe('night')
    expect(skyAt(n.at - 120_000, BEIJING).phase).toBe('dusk')
  })

  it('works anywhere on the real clock: San Francisco is dark when Beijing has noon', () => {
    expect(skyAt(bj(12), SF).phase).toBe('night')
  })

  it('gives the app colours of the hour', () => {
    const noon = uiColors(skyAt(bj(12), BEIJING))
    const night = uiColors(skyAt(bj(2), BEIJING))
    expect(noon['--accent']).not.toBe(night['--accent'])
    expect(noon['--surface']).toMatch(/^rgba\(/)
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
  })
})

describe('quota meters', () => {
  it('rewinds on a reset, not on a small correction', () => {
    const prev = { pct: 64, reset: 1_000_000_000 }
    expect(isReset(prev, 2, prev.reset + 5 * 3600_000)).toBe(true)
    expect(isReset(prev, 63, prev.reset)).toBe(false)
    expect(isReset(prev, 40, prev.reset)).toBe(true)
    expect(isReset(prev, 70, prev.reset + 5 * 3600_000)).toBe(false)
  })
})
