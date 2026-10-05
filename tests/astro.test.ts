import { describe, expect, it } from 'vitest'
import { heliocentric, moonPhase, placeOf, sunTimes } from '../src/shared/astro'

const BEIJING = { name: '北京', lat: 39.9, lon: 116.4 }
const at = (iso: string) => Date.parse(iso)
/** hours:minutes of t in Beijing time */
const bj = (t: number | null) => (t === null ? null : new Date(t + 8 * 3_600_000).toISOString().slice(11, 16))

describe('astro', () => {
  it('sunrise and sunset in Beijing', () => {
    const s = sunTimes(at('2026-10-04T04:00:00Z'), BEIJING)
    // published: about 06:10 and 17:58
    expect(bj(s.rise)).toMatch(/^06:(0[5-9]|1[0-5])$/)
    expect(bj(s.set)).toMatch(/^17:(5[2-9]|0[0-4])|18:0[0-4]$/)
    expect(s.dawn! < s.rise!).toBe(true)
  })

  it('moon phases match published dates', () => {
    // full moon 2026-10-26 04:12 UTC, new moon 2026-10-10 15:50 UTC
    const full = moonPhase(at('2026-10-26T04:12:00Z'))
    expect(full.fraction).toBeGreaterThan(0.98)
    expect(full.name).toBe('满月')
    expect(moonPhase(at('2026-10-10T15:50:00Z')).fraction).toBeLessThan(0.02)
    expect(moonPhase(at('2026-10-18T12:00:00Z')).name).toMatch(/上弦/)
  })

  it('puts Saturn in line with the Earth at its 2026-10-04 opposition', () => {
    const t = at('2026-10-04T12:00:00Z')
    const d = Math.abs(heliocentric('saturn', t).lon - heliocentric('earth', t).lon)
    expect(Math.min(d, 360 - d)).toBeLessThan(3)
  })

  it('guesses the place from the time zone', () => {
    expect(placeOf(null, 'Asia/Shanghai').name).toBe('北京')
    expect(placeOf(null, 'Nowhere/Else', 480).lon).toBe(120)
    expect(placeOf({ name: 'x', lat: 1, lon: 2 }).name).toBe('x')
  })
})
