import type { MiniMode } from '@shared/types'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}
export type Dock = 'left' | 'right' | 'top' | null

/** Window size per display mode at scale 1, including the transparent margin around the panel */
export const MINI_BASE: Record<MiniMode, { width: number; height: number }> = {
  card: { width: 324, height: 140 },
  capsule: { width: 256, height: 62 },
  orb: { width: 148, height: 148 }
}
/** CSS margin between the window edge and the visible panel, at scale 1 */
export const MINI_MARGIN = 6

export function miniSize(mode: MiniMode, scale: number): { width: number; height: number } {
  const b = MINI_BASE[mode] ?? MINI_BASE.card
  return { width: Math.round(b.width * scale), height: Math.round(b.height * scale) }
}

/**
 * Snaps a window whose panel is within `threshold` px of a work-area edge
 * flush against it. Left/right docking wins over top.
 */
export function snapToEdge(b: Rect, wa: Rect, margin: number, threshold = 28): { x: number; y: number; dock: Dock } {
  let { x, y } = b
  let dock: Dock = null
  const left = b.x + margin - wa.x
  const right = wa.x + wa.width - (b.x + b.width - margin)
  const top = b.y + margin - wa.y
  const bottom = wa.y + wa.height - (b.y + b.height - margin)
  if (left <= threshold && left <= right) {
    x = wa.x - margin
    dock = 'left'
  } else if (right <= threshold) {
    x = wa.x + wa.width - b.width + margin
    dock = 'right'
  }
  if (top <= threshold) {
    y = wa.y - margin
    dock ??= 'top'
  } else if (bottom <= threshold) {
    y = wa.y + wa.height - b.height + margin
  }
  return { x, y, dock }
}

/** The flush position for a window of this size docked to `dock` (after a resize) */
export function dockedPosition(b: Rect, dock: Exclude<Dock, null>, wa: Rect, margin: number): { x: number; y: number } {
  if (dock === 'left') return { x: wa.x - margin, y: b.y }
  if (dock === 'right') return { x: wa.x + wa.width - b.width + margin, y: b.y }
  return { x: b.x, y: wa.y - margin }
}

/** Where a docked window rests while hidden: only `peek` px of the panel stay on screen */
export function hiddenPosition(b: Rect, dock: Exclude<Dock, null>, wa: Rect, margin: number, peek = 8): { x: number; y: number } {
  if (dock === 'left') return { x: wa.x + peek - b.width + margin, y: b.y }
  if (dock === 'right') return { x: wa.x + wa.width - peek - margin, y: b.y }
  return { x: b.x, y: wa.y + peek - b.height + margin }
}

export function contains(b: Rect, p: { x: number; y: number }, slack = 0): boolean {
  return p.x >= b.x - slack && p.x < b.x + b.width + slack && p.y >= b.y - slack && p.y < b.y + b.height + slack
}
