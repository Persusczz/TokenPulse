import { describe, expect, it } from 'vitest'
import { stepOf } from '../src/shared/frameStep'

describe('frame clock steps', () => {
  it('runs loops on whole refreshes, on a shared base step', () => {
    // 144 Hz: the base step is two refreshes, so 60 fps loops get 72 and 30 fps ones 36
    expect(stepOf(144, 60, 'auto')).toBe(2)
    expect(stepOf(144, 30, 'auto')).toBe(4)
    expect(stepOf(144, 40, 'auto')).toBe(4)
    // 60 Hz: every refresh, every other one
    expect(stepOf(60, 60, 'auto')).toBe(1)
    expect(stepOf(60, 30, 'auto')).toBe(2)
    expect(stepOf(120, 60, 'auto')).toBe(2)
    expect(stepOf(165, 30, 'auto')).toBe(6)
  })

  it('follows the cap from the settings', () => {
    expect(stepOf(144, 60, '30')).toBe(4)
    expect(stepOf(144, 30, '60')).toBe(2)
    expect(stepOf(144, 30, 'max')).toBe(1)
    expect(stepOf(60, 60, '30')).toBe(2)
  })

  it('eases everything to about 30 frames once the clock has eased off', () => {
    expect(stepOf(144, 60, 'auto', 1)).toBe(2)
    expect(stepOf(144, 60, 'auto', 2)).toBe(4)
    expect(stepOf(60, 60, 'auto', 2)).toBe(2)
  })
})
