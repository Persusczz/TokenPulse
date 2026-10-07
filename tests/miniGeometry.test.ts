import { describe, expect, it } from 'vitest'
import { contains, dockedPosition, hiddenPosition, miniSize, miniPlace, restorePosition, snapToEdge } from '../src/main/miniGeometry'

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

  // a laptop at 125% (1536 DIP wide) and a large monitor at 100%
  const laptop = { id: 1, workArea: { x: 0, y: 0, width: 1536, height: 824 } }
  const big = { id: 2, workArea: { x: 0, y: 0, width: 2560, height: 1392 } }
  const size = { width: 324, height: 140 }

  it('keeps a window docked to the right edge of a small screen at the right edge of a large one', () => {
    // docked right on the laptop, as the user had it
    const place = miniPlace({ x: 1218, y: 648, ...size }, laptop)
    expect(place).toEqual({ x: 1218, y: 648, display: 1, h: 'right', dx: -6, v: 'bottom', dy: 36 })
    // the laptop is closed: the large monitor is the only (primary) display
    const at = restorePosition(place, size, [big], big, m)
    expect(at).toEqual({ x: 2560 - 324 + 6, y: 1392 - 140 - 36 })
    expect(snapToEdge({ ...at, ...size }, big.workArea, m, 2).dock).toBe('right')
    // back on the laptop
    expect(restorePosition(place, size, [laptop, big], big, m)).toEqual({ x: 1218, y: 648 })
  })

  it('keeps the gap from the near sides, and the window inside the screen', () => {
    const place = miniPlace({ x: 40, y: 30, ...size }, big)
    expect(place).toMatchObject({ h: 'left', dx: 40, v: 'top', dy: 30 })
    expect(restorePosition(place, size, [laptop], laptop, m)).toEqual({ x: 40, y: 30 })
    // a gap larger than the new screen is clamped
    const far = { ...miniPlace({ x: 1300, y: 900, ...size }, big), dx: 3000 }
    expect(restorePosition(far, size, [laptop], laptop, m).x).toBe(-m)
  })

  it('starts positions saved without their sides in the primary corner', () => {
    expect(restorePosition({ x: 1218, y: 648 }, size, [big], big, m)).toEqual({ x: 2560 - 324 - 16, y: 1392 - 140 - 24 })
    expect(restorePosition(null, size, [laptop, big], laptop, m)).toEqual({ x: 1536 - 324 - 16, y: 824 - 140 - 24 })
  })

  it('places on a secondary display left of the primary one', () => {
    const left = { id: 3, workArea: { x: -1920, y: 200, width: 1920, height: 1040 } }
    const place = miniPlace({ x: -1920 - m, y: 600, ...size }, left)
    expect(place).toMatchObject({ display: 3, h: 'left', dx: -m })
    expect(restorePosition(place, size, [big, left], big, m)).toEqual({ x: -1920 - m, y: 600 })
  })
})
