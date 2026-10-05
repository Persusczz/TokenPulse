import { describe, expect, it } from 'vitest'
import { contains, dockedPosition, hiddenPosition, miniSize, snapToEdge } from '../src/main/miniGeometry'

const wa = { x: 0, y: 0, width: 1920, height: 1040 }
const m = 6

describe('floating window geometry', () => {
  it('sizes each mode by scale', () => {
    expect(miniSize('card', 1)).toEqual({ width: 324, height: 140 })
    expect(miniSize('orb', 1.5)).toEqual({ width: 222, height: 222 })
    expect(miniSize('capsule', 0.85)).toEqual({ width: 218, height: 53 })
  })

  it('snaps a panel near an edge flush against it', () => {
    // panel 20px from the right edge
    const b = { x: 1920 - 324 - 20 + m, y: 400, width: 324, height: 140 }
    expect(snapToEdge(b, wa, m)).toEqual({ x: 1920 - 324 + m, y: 400, dock: 'right' })
    expect(snapToEdge({ ...b, x: 10 }, wa, m)).toEqual({ x: -m, y: 400, dock: 'left' })
    expect(snapToEdge({ ...b, x: 800, y: 12 }, wa, m)).toEqual({ x: 800, y: -m, dock: 'top' })
    // the bottom edge snaps but does not dock (no room for the taskbar side)
    expect(snapToEdge({ ...b, x: 800, y: 1040 - 140 - 10 }, wa, m)).toEqual({ x: 800, y: 1040 - 140 + m, dock: null })
    expect(snapToEdge({ ...b, x: 800 }, wa, m).dock).toBeNull()
  })

  it('docks left/right before top in a corner', () => {
    expect(snapToEdge({ x: 4, y: 4, width: 324, height: 140 }, wa, m)).toEqual({ x: -m, y: -m, dock: 'left' })
  })

  it('hides all but a peek of the panel and finds the way back', () => {
    const shown = { x: 1920 - 324 + m, y: 400, width: 324, height: 140 }
    const hidden = hiddenPosition(shown, 'right', wa, m, 8)
    // the panel's left edge sits 8px inside the screen
    expect(hidden.x + m).toBe(1920 - 8)
    expect(hiddenPosition({ ...shown, x: -m }, 'left', wa, m, 8).x + 324 - m).toBe(8)
    expect(hiddenPosition({ ...shown, y: -m }, 'top', wa, m, 8).y + 140 - m).toBe(8)
    expect(dockedPosition({ ...shown, width: 148 }, 'right', wa, m).x).toBe(1920 - 148 + m)
  })

  it('tests pointer containment with slack', () => {
    const b = { x: 10, y: 10, width: 100, height: 50 }
    expect(contains(b, { x: 10, y: 10 })).toBe(true)
    expect(contains(b, { x: 111, y: 30 })).toBe(false)
    expect(contains(b, { x: 111, y: 30 }, 2)).toBe(true)
  })
})
