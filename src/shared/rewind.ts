/** A quota reading that fell because its window reset: the window moved on and the reading fell, or it fell a long way */
export function isReset(prev: { pct: number; reset: number }, pct: number, reset: number): boolean {
  if (!(pct < prev.pct - 0.5)) return false
  const moved = Number.isFinite(reset) && Number.isFinite(prev.reset) && reset - prev.reset > 30 * 60_000
  return moved || prev.pct - pct >= 15
}
