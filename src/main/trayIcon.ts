type RGB = [number, number, number]

export interface TrayLook {
  /** 5h quota percent; null hides the ring and enlarges the spark */
  pct: number | null
  /** spark rotation, degrees */
  angle: number
  /** the guard holds a task: pause bars instead of the spark */
  paused: boolean
  accent: RGB
  /** Claude's spark, or Codex's hexagon */
  glyph?: 'spark' | 'codex'
}

export const QUOTA_GREEN: RGB = [76, 175, 80]
export const QUOTA_AMBER: RGB = [250, 178, 25]
export const QUOTA_RED: RGB = [208, 59, 59]
const TRACK: RGB = [150, 150, 150]
const SS = 4

export const quotaColor = (pct: number): RGB => (pct >= 90 ? QUOTA_RED : pct >= 75 ? QUOTA_AMBER : QUOTA_GREEN)

/**
 * Draws the tray icon into a premultiplied BGRA bitmap (what
 * nativeImage.createFromBitmap takes on Windows): a 5h quota ring filling
 * clockwise from the top, and the spark (or pause bars) in the middle.
 * Edges are antialiased by 4x4 supersampling.
 */
export function trayBitmap(size: number, o: TrayLook): Buffer {
  const buf = Buffer.alloc(size * size * 4)
  const k = size / 32
  const c = size / 2
  const hasRing = o.pct !== null
  const ringR = 12.4 * k
  const ringW = 3.6 * k
  const sweep = hasRing ? (Math.max(0, Math.min(100, o.pct!)) / 100) * 360 : 0
  const arc = hasRing ? quotaColor(o.pct!) : o.accent
  const sparkR = (hasRing ? 7.6 : 13) * k
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = ((o.angle + i * 45) * Math.PI) / 180
    return { dx: Math.sin(a), dy: -Math.cos(a), len: sparkR * (i % 2 ? 0.68 : 1) }
  })
  // Codex: a hexagon outline (edge normals turn with the angle) around a dot
  const hexN = Array.from({ length: 6 }, (_, i) => {
    const a = ((o.angle * 0.5 + i * 60) * Math.PI) / 180
    return [Math.cos(a), Math.sin(a)]
  })
  const hexA = sparkR * 0.82
  const inCodex = (x: number, y: number) => {
    let d = -Infinity
    for (const [nx, ny] of hexN) d = Math.max(d, x * nx + y * ny)
    return Math.abs(d - hexA) <= 1.35 * k || Math.hypot(x, y) <= 1.9 * k
  }

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS - c
          const y = py + (sy + 0.5) / SS - c
          // composite this sample bottom-up (premultiplied "over")
          let sr = 0
          let sg = 0
          let sb = 0
          let sa = 0
          const over = (col: RGB, alpha: number) => {
            sr = col[0] * alpha + sr * (1 - alpha)
            sg = col[1] * alpha + sg * (1 - alpha)
            sb = col[2] * alpha + sb * (1 - alpha)
            sa = alpha + sa * (1 - alpha)
          }
          const d = Math.hypot(x, y)
          if (hasRing && Math.abs(d - ringR) <= ringW / 2) {
            over(TRACK, 0.42)
            const theta = ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360
            if (theta <= sweep) over(arc, 1)
          }
          if (o.paused) {
            if (Math.abs(y) <= 4.6 * k && Math.abs(Math.abs(x) - 2.4 * k) <= 1.3 * k) over(QUOTA_RED, 1)
          } else if (o.glyph === 'codex') {
            if (inCodex(x, y)) over(o.accent, 1)
          } else {
            let inSpark = d <= 2.3 * k
            for (const ray of rays) {
              if (inSpark) break
              const along = x * ray.dx + y * ray.dy
              if (along < 0 || along > ray.len) continue
              const perp = Math.abs(x * ray.dy - y * ray.dx)
              inSpark = perp <= 1.55 * k * (1 - (along / ray.len) * 0.62)
            }
            if (inSpark) over(o.accent, 1)
          }
          r += sr
          g += sg
          b += sb
          a += sa
        }
      }
      const n = SS * SS
      const i = (py * size + px) * 4
      buf[i] = Math.round(b / n)
      buf[i + 1] = Math.round(g / n)
      buf[i + 2] = Math.round(r / n)
      buf[i + 3] = Math.round((a / n) * 255)
    }
  }
  return buf
}

/** Taskbar overlay badge: a red disc with white pause bars */
export function pauseBadge(size: number): Buffer {
  const buf = Buffer.alloc(size * size * 4)
  const c = size / 2
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS - c
          const y = py + (sy + 0.5) / SS - c
          if (Math.hypot(x, y) > c - 0.5) continue
          const bar = Math.abs(y) <= size * 0.24 && Math.abs(Math.abs(x) - size * 0.14) <= size * 0.065
          const col = bar ? [255, 255, 255] : QUOTA_RED
          r += col[0]
          g += col[1]
          b += col[2]
          a += 1
        }
      }
      const n = SS * SS
      const i = (py * size + px) * 4
      buf[i] = Math.round(b / n)
      buf[i + 1] = Math.round(g / n)
      buf[i + 2] = Math.round(r / n)
      buf[i + 3] = Math.round((a / n) * 255)
    }
  }
  return buf
}
