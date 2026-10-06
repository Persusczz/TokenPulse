import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, sanitize } from '../src/main/settings'

describe('2.12 settings', () => {
  it('keeps the frame-rate cap and the meter, and nothing else in their place', () => {
    expect(DEFAULT_SETTINGS.frameCap).toBe('auto')
    expect(DEFAULT_SETTINGS.fpsMeter).toBe(false)
    for (const frameCap of ['auto', '30', '60', 'max'] as const) expect(sanitize({ frameCap }, DEFAULT_SETTINGS).frameCap).toBe(frameCap)
    expect(sanitize({ frameCap: '45' }, DEFAULT_SETTINGS).frameCap).toBe('auto')
    expect(sanitize({ frameCap: 60 }, DEFAULT_SETTINGS).frameCap).toBe('auto')
    expect(sanitize({ fpsMeter: true }, DEFAULT_SETTINGS).fpsMeter).toBe(true)
    expect(sanitize({ fpsMeter: 'yes' }, DEFAULT_SETTINGS).fpsMeter).toBe(false)
  })
})
