import type { MiniMode, MiniPlace } from '@shared/types'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}
export type Dock = 'left' | 'right' | 'top' | null
/** a display as the placement needs it */
export interface Area {
  id: number
  workArea: Rect
}

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

/** The first place on a display: its bottom-right corner, clear of the edges */
export function cornerPosition(size: { width: number; height: number }, wa: Rect): { x: number; y: number } {
  return { x: wa.x + wa.width - size.width - 16, y: wa.y + wa.height - size.height - 24 }
}

/** A window's place on a display: where it is, and its gap to the nearer side across and down */
export function miniPlace(b: Rect, area: Area): MiniPlace {
  const wa = area.workArea
  const h = b.x + b.width / 2 < wa.x + wa.width / 2 ? 'left' : 'right'
  const v = b.y + b.height / 2 < wa.y + wa.height / 2 ? 'top' : 'bottom'
  return {
    x: Math.round(b.x),
    y: Math.round(b.y),
    display: area.id,
    h,
    dx: Math.round(h === 'left' ? b.x - wa.x : wa.x + wa.width - b.x - b.width),
    v,
    dy: Math.round(v === 'top' ? b.y - wa.y : wa.y + wa.height - b.y - b.height)
  }
}

/**
 * Where a window of this size goes back to: on the display it was saved on
 * (the primary one when that is gone), the same gap from the same sides, so a
 * window kept at the right edge of a small screen sits at the right edge of a
 * large one too instead of keeping its old coordinates in the middle of it.
 * Positions saved without their sides start in the primary display's corner.
 * The panel always ends up inside the work area.
 */
export function restorePosition(
  place: MiniPlace | null,
  size: { width: number; height: number },
  areas: Area[],
  primary: Area,
  margin: number
): { x: number; y: number } {
  const known = place && place.h && place.v && place.dx !== undefined && place.dy !== undefined
  const area = (known && areas.find((a) => a.id === place.display)) || primary
  const wa = area.workArea
  const at = known
    ? {
        x: place.h === 'left' ? wa.x + place.dx! : wa.x + wa.width - size.width - place.dx!,
        y: place.v === 'top' ? wa.y + place.dy! : wa.y + wa.height - size.height - place.dy!
      }
    : cornerPosition(size, wa)
  return {
    x: Math.round(Math.min(Math.max(at.x, wa.x - margin), wa.x + wa.width - size.width + margin)),
    y: Math.round(Math.min(Math.max(at.y, wa.y - margin), wa.y + wa.height - size.height + margin))
  }
}

export function contains(b: Rect, p: { x: number; y: number }, slack = 0): boolean {
  return p.x >= b.x - slack && p.x < b.x + b.width + slack && p.y >= b.y - slack && p.y < b.y + b.height + slack
}
