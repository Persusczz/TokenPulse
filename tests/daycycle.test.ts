import { describe, expect, it } from 'vitest'
import { sunTimes } from '../src/shared/astro'
import { dayLabel, labelOf, mix, nextLabel, nextPhase, phaseOf, seasonAt, skyAt, uiColors } from '../src/shared/daycycle'
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

  it('names the time of day the way people do', () => {
    expect(labelOf(30, true, 20, 9.8)).toBe('上午')
    expect(labelOf(35, false, 20, 12.2)).toBe('中午')
    expect(labelOf(30, false, 20, 15)).toBe('下午')
    expect(labelOf(10, false, 20, 17.5)).toBe('傍晚')
    expect(labelOf(-3, false, 20, 18.6)).toBe('黄昏')
    expect(labelOf(-20, false, 20, 20)).toBe('夜晚')
    expect(labelOf(-20, false, 20, 23)).toBe('深夜')
    expect(labelOf(-20, true, 20, 3)).toBe('凌晨')
    expect(labelOf(-3, true, 20, 5.8)).toBe('黎明')
    expect(labelOf(8, true, 20, 7)).toBe('早晨')
  })

  it('calls 9:44 on an autumn morning in San Francisco 上午, then 中午', () => {
    const t = Date.UTC(2026, 9, 5, 16, 44)
    expect(dayLabel(t, SF)).toBe('上午')
    expect(nextLabel(t, SF)!.label).toBe('中午')
    expect(dayLabel(bj(12, 30), BEIJING)).toBe('中午')
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

describe('seasons and solar terms', () => {
  it('names the term by the sun and blends the seasons at their boundaries', () => {
    // 2026-10-05: just after the autumn equinox, 寒露 on the 8th
    const bj = seasonAt(Date.UTC(2026, 9, 5, 4), BEIJING.lat)
    expect(bj.term).toBe('秋分')
    expect(bj.next).toBe('寒露')
    expect(bj.season).toBe('autumn')
    expect(bj.k.autumn).toBeCloseTo(1)
    expect(seasonAt(Date.UTC(2026, 9, 9, 4), BEIJING.lat).term).toBe('寒露')
    // the winter solstice and the summer one
    expect(seasonAt(Date.UTC(2026, 11, 22, 12), BEIJING.lat).term).toBe('冬至')
    expect(seasonAt(Date.UTC(2026, 5, 22, 12), BEIJING.lat).season).toBe('summer')
    // 立冬 (about 7 November) is half autumn, half winter
    const lidong = seasonAt(Date.UTC(2026, 10, 7, 12), BEIJING.lat)
    expect(lidong.k.autumn + lidong.k.winter).toBeCloseTo(1)
    expect(Math.abs(lidong.k.autumn - lidong.k.winter)).toBeLessThan(0.25)
  })

  it('runs half a year on south of the equator', () => {
    const sydney = seasonAt(Date.UTC(2026, 9, 5, 4), -33.87)
    expect(sydney.season).toBe('spring')
    expect(sydney.term).toBe('春分')
  })
})
