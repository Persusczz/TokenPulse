/** Accent presets; the CSS side (styles.css, [data-accent]) defines the same colours */
export const ACCENTS = {
  clay: { label: '陶土', hex: '#d97757' },
  ocean: { label: '海蓝', hex: '#3b82c4' },
  mint: { label: '薄荷', hex: '#2fa585' },
  wisteria: { label: '紫藤', hex: '#8a6fd1' },
  sakura: { label: '樱粉', hex: '#d9668f' }
} as const

export type AccentKey = keyof typeof ACCENTS
export const ACCENT_KEYS = Object.keys(ACCENTS) as AccentKey[]

/** Codex's own colour: while only Codex is on view the app wears it ([data-source='codex'] in styles.css) */
export const CODEX_ACCENT = '#5b6cff'
export const WORKBUDDY_ACCENT = '#2fa585'

/** The accent the app shows: Codex's while Codex alone is on view, else the chosen preset */
export const accentHex = (s: { accent: AccentKey; sourceFilter: string } | null | undefined): string =>
  s?.sourceFilter === 'workbuddy' ? WORKBUDDY_ACCENT : s?.sourceFilter === 'codex' ? CODEX_ACCENT : ACCENTS[s?.accent ?? 'clay']?.hex ?? ACCENTS.clay.hex
