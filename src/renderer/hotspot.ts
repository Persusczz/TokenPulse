import { useLayoutEffect, type RefObject } from 'react'

/**
 * Tells the main process where this click-through window still takes the
 * pointer (the floating window's buttons, the island's pill), in window
 * pixels. It polls the pointer against that, since a window that ignores the
 * mouse hears nothing of it. Reported again whenever the element resizes.
 */
export function useHotspot(ref: RefObject<HTMLElement | null>, deps: unknown[] = []): void {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const report = () => {
      // layout boxes, not client rects: a layout animation scales the element with a transform as it resizes
      let x = 0
      let y = 0
      for (let n: HTMLElement | null = el; n; n = n.offsetParent as HTMLElement | null) {
        x += n.offsetLeft
        y += n.offsetTop
      }
      // window pixels per CSS pixel under a CSS zoom on <html> (the floating window's scale)
      const k = window.innerWidth / (document.documentElement.offsetWidth || window.innerWidth)
      window.api.hotspot({ x: Math.round(x * k), y: Math.round(y * k), width: Math.round(el.offsetWidth * k), height: Math.round(el.offsetHeight * k) })
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => {
      ro.disconnect()
      window.api.hotspot(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, ...deps])
}
