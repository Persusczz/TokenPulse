/**
 * Page-wide pointer effects, installed once per window:
 * - a ripple spreading from the click point on buttons, tabs and nav items
 * - a burst of sparks at every click (standard motion and up)
 * - a soft spotlight following the pointer over cards; rich motion also tilts them in 3D
 * - a circular reveal from the last click when the theme changes
 */

const RIPPLE_TARGETS = '.btn, .nav-item, .seg button, .rtab, .mini-btns button, [data-ripple]'

let lastPointer = { x: innerWidth / 2, y: innerHeight / 2 }

const motion = () => document.documentElement.dataset.motion ?? 'standard'
/** CSS zoom on <html> (the floating window scales this way) */
const zoom = () => parseFloat(getComputedStyle(document.documentElement).zoom) || 1

/** Adds an expanding ripple to `el`, centred on (x, y) in viewport coordinates or on the element */
export function ripple(el: HTMLElement, at?: { x: number; y: number }, className = 'ripple'): void {
  if (motion() === 'off') return
  let host = el.querySelector<HTMLElement>(':scope > .ripple-host')
  if (!host) {
    host = document.createElement('span')
    host.className = 'ripple-host'
    el.appendChild(host)
  }
  const r = el.getBoundingClientRect()
  const z = zoom()
  const w = r.width / z
  const h = r.height / z
  const cx = at ? (at.x - r.left) / z : w / 2
  const cy = at ? (at.y - r.top) / z : h / 2
  const size = 2 * Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy))
  const dot = document.createElement('span')
  dot.className = className
  dot.style.width = dot.style.height = `${size}px`
  dot.style.left = `${cx - size / 2}px`
  dot.style.top = `${cy - size / 2}px`
  host.appendChild(dot)
  dot.addEventListener('animationend', () => dot.remove(), { once: true })
}

/** Claude-star sparks flying out from a click */
function sparks(x: number, y: number): void {
  const m = motion()
  if (m === 'off' || m === 'subtle') return
  let layer = document.getElementById('spark-layer')
  if (!layer) {
    layer = document.createElement('div')
    layer.id = 'spark-layer'
    document.body.appendChild(layer)
  }
  const z = zoom()
  const n = m === 'rich' ? 12 : 8
  const base = Math.random() * Math.PI * 2
  for (let i = 0; i < n; i++) {
    const a = base + (i / n) * Math.PI * 2 + Math.random() * 0.4
    const d = 34 + Math.random() * (m === 'rich' ? 54 : 36)
    const s = document.createElement('i')
    s.className = i % 3 === 0 ? 'spark star' : 'spark'
    s.style.left = `${x / z}px`
    s.style.top = `${y / z}px`
    s.style.setProperty('--dx', `${Math.cos(a) * d}px`)
    s.style.setProperty('--dy', `${Math.sin(a) * d}px`)
    s.style.animationDuration = `${520 + Math.random() * 260}ms`
    layer.appendChild(s)
    s.addEventListener('animationend', () => s.remove(), { once: true })
  }
}

export function installEffects(): () => void {
  const down = (e: PointerEvent) => {
    lastPointer = { x: e.clientX, y: e.clientY }
    if (e.button !== 0) return
    const el = (e.target as Element | null)?.closest?.(RIPPLE_TARGETS) as HTMLElement | null
    if (el && !el.hasAttribute('disabled')) ripple(el, lastPointer)
    sparks(e.clientX, e.clientY)
  }
  let raf = 0
  const move = (e: PointerEvent) => {
    const m = motion()
    if (m === 'off' || m === 'subtle' || raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      const card = (e.target as Element | null)?.closest?.('.card') as HTMLElement | null
      if (!card) return
      const r = card.getBoundingClientRect()
      const x = e.clientX - r.left
      const y = e.clientY - r.top
      card.style.setProperty('--mx', `${x}px`)
      card.style.setProperty('--my', `${y}px`)
      if (m === 'rich') {
        card.style.setProperty('--ry', `${((x / r.width - 0.5) * 6).toFixed(2)}deg`)
        card.style.setProperty('--rx', `${((0.5 - y / r.height) * 5).toFixed(2)}deg`)
      }
    })
  }
  document.addEventListener('pointerdown', down, true)
  document.addEventListener('pointermove', move, { passive: true })
  return () => {
    document.removeEventListener('pointerdown', down, true)
    document.removeEventListener('pointermove', move)
    cancelAnimationFrame(raf)
  }
}

/**
 * Runs `apply` (which must update the DOM synchronously) inside a view
 * transition that reveals the new state as a circle growing from the last click.
 */
export function revealFromPointer(apply: () => void): void {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  if (!doc.startViewTransition || motion() === 'off') return apply()
  const root = document.documentElement.style
  root.setProperty('--vt-x', `${lastPointer.x}px`)
  root.setProperty('--vt-y', `${lastPointer.y}px`)
  doc.startViewTransition(apply)
}
