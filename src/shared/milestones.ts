/** Daily token counts worth a celebration */
export const TOKEN_MARKS = [1e6, 5e6, 1e7, 2.5e7, 5e7, 1e8, 2.5e8, 5e8, 1e9, 2.5e9, 5e9, 1e10]
/** 5h quota levels worth a heads-up */
export const QUOTA_MARKS = [50, 75, 90]

/** The highest mark passed when a value grows from `prev` to `next`, if any */
export function crossed(prev: number, next: number, marks: number[]): number | null {
  let hit: number | null = null
  for (const m of marks) if (prev < m && next >= m) hit = m
  return hit
}

/** 100 万 / 2500 万 / 1 亿 / 2.5 亿 */
export function cnCount(n: number): string {
  const trim = (v: number) => String(Math.round(v * 100) / 100)
  return n >= 1e8 ? `${trim(n / 1e8)} 亿` : `${trim(n / 1e4)} 万`
}
