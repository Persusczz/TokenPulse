/** Global hotkeys offered for the floating window, in fallback order */
export const HOTKEYS = ['Control+Alt+T', 'Control+Alt+K', 'Control+Alt+P', 'Control+Shift+Space', 'Alt+`'] as const
export type Hotkey = (typeof HOTKEYS)[number]

export const hotkeyLabel = (h: string) => h.replace('Control', 'Ctrl').replace(/\+/g, ' + ')

/** What is registered: the wanted combination, or the first free fallback */
export interface HotkeyStatus {
  wanted: string
  active: string | null
}
