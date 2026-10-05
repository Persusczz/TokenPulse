import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, sanitize } from '../src/main/settings'

describe('settings sanitize: appearance and floating window', () => {
  it('accepts known values', () => {
    const s = sanitize(
      {
        motion: 'rich',
        backdrop: 'ripples',
        adaptiveBackdrop: false,
        windowMaterial: 'mica',
        miniMode: 'orb',
        miniOpacity: 0.55,
        miniScale: 1.25,
        miniClickThrough: true,
        miniEdgeHide: true
      },
      DEFAULT_SETTINGS
    )
    expect(s).toMatchObject({
      motion: 'rich',
      backdrop: 'ripples',
      adaptiveBackdrop: false,
      windowMaterial: 'mica',
      miniMode: 'orb',
      miniOpacity: 0.55,
      miniScale: 1.25,
      miniClickThrough: true,
      miniEdgeHide: true
    })
  })

  it('ignores unknown values and clamps numbers', () => {
    const s = sanitize(
      { motion: 'wild', backdrop: 'video', windowMaterial: 'glass', miniMode: 'cube', miniOpacity: 0.05, miniScale: 9, miniEdgeHide: 'yes' },
      DEFAULT_SETTINGS
    )
    expect(s.motion).toBe(DEFAULT_SETTINGS.motion)
    expect(s.backdrop).toBe(DEFAULT_SETTINGS.backdrop)
    expect(s.windowMaterial).toBe('none')
    expect(s.miniMode).toBe('card')
    expect(s.miniOpacity).toBe(0.3)
    expect(s.miniScale).toBe(1.5)
    expect(s.miniEdgeHide).toBe(false)
    expect(sanitize({ miniOpacity: 0.8567, miniScale: 0.1 }, DEFAULT_SETTINGS)).toMatchObject({ miniOpacity: 0.86, miniScale: 0.8 })
  })

  it('reads backdrop strength and glass cards', () => {
    expect(DEFAULT_SETTINGS.backdrop).toBe('flow')
    expect(sanitize({ backdrop: 'flow', backdropVivid: 0.95, glassCards: false }, DEFAULT_SETTINGS)).toMatchObject({
      backdrop: 'flow',
      backdropVivid: 0.95,
      glassCards: false
    })
    expect(sanitize({ backdropVivid: 3 }, DEFAULT_SETTINGS).backdropVivid).toBe(1)
    expect(sanitize({ backdropVivid: 0 }, DEFAULT_SETTINGS).backdropVivid).toBe(0.2)
    expect(sanitize({ glassCards: 'on' }, DEFAULT_SETTINGS).glassCards).toBe(true)
  })

  it('accepts accent presets only', () => {
    expect(DEFAULT_SETTINGS.accent).toBe('clay')
    expect(sanitize({ accent: 'mint' }, DEFAULT_SETTINGS).accent).toBe('mint')
    expect(sanitize({ accent: 'neon' }, DEFAULT_SETTINGS).accent).toBe('clay')
    expect(sanitize({ backdrop: 'stars' }, DEFAULT_SETTINGS).backdrop).toBe('stars')
  })

  it('reads notification, guard and desktop options', () => {
    const s = sanitize(
      {
        sound: true,
        soundVolume: 2,
        planPrice: 17,
        telegramEnabled: true,
        telegramToken: '  123:ABC  ',
        telegramChatId: -100123,
        pushQuota: false,
        guardWeeklyAt: 120,
        guardResumeFrom: '0:00',
        guardResumeTo: '25:00',
        globalHotkey: false,
        wallpaper: true
      },
      DEFAULT_SETTINGS
    )
    expect(s).toMatchObject({
      sound: true,
      soundVolume: 1,
      planPrice: 17,
      telegramEnabled: true,
      telegramToken: '123:ABC',
      telegramChatId: '-100123',
      pushQuota: false,
      pushGuard: true,
      guardWeeklyAt: 100,
      guardResumeFrom: '00:00',
      guardResumeTo: null,
      globalHotkey: false,
      wallpaper: true
    })
    expect(sanitize({ guardWeeklyAt: null, planPrice: null }, s)).toMatchObject({ guardWeeklyAt: null, planPrice: null })
    expect(sanitize({ reportTime: '7:30', runawaySensitivity: 'high', runawayAction: 'pause', island: true, pushRunaway: false }, s)).toMatchObject({
      reportTime: '07:30',
      runawaySensitivity: 'high',
      runawayAction: 'pause',
      island: true,
      pushRunaway: false
    })
    expect(sanitize({ reportTime: null, runawayAction: 'kill' }, s)).toMatchObject({ reportTime: null, runawayAction: 'notify' })
    expect(sanitize({ taskPermission: 'plan', taskModel: 'sonnet', taskCwd: '  G:\\code\\x ', taskQueuePaused: true, pushTasks: false }, s)).toMatchObject({
      taskPermission: 'plan',
      taskModel: 'sonnet',
      taskCwd: 'G:\\code\\x',
      taskQueuePaused: true,
      pushTasks: false
    })
    expect(sanitize({ taskPermission: 'root', taskModel: 'gpt' }, s)).toMatchObject({ taskPermission: 'inherit', taskModel: null })
    expect(sanitize({ hotkey: 'Control+Alt+K' }, s).hotkey).toBe('Control+Alt+K')
    expect(sanitize({ hotkey: 'Alt+F4' }, s).hotkey).toBe('Control+Alt+T')
    expect(DEFAULT_SETTINGS).toMatchObject({ sound: false, telegramEnabled: false, globalHotkey: true, wallpaper: false, guardWeeklyAt: null })
  })

  it('reads the 2.1 task options and the Claude / Codex packs', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ taskContinue: true, taskAutoCompact: true, taskTerminal: true, codexTaskPermission: 'inherit', codexTaskModel: null })
    expect(
      sanitize({ taskContinue: false, taskAutoCompact: false, taskTerminal: false, codexTaskPermission: 'acceptEdits', codexTaskModel: 'gpt-6.1-sol', themePack: 'codex', backdrop: 'claude' }, DEFAULT_SETTINGS)
    ).toMatchObject({ taskContinue: false, taskAutoCompact: false, taskTerminal: false, codexTaskPermission: 'acceptEdits', codexTaskModel: 'gpt-6.1-sol', themePack: 'codex', backdrop: 'claude' })
    expect(sanitize({ codexTaskModel: 'rm -rf /', codexTaskPermission: 'root' }, DEFAULT_SETTINGS)).toMatchObject({ codexTaskModel: null, codexTaskPermission: 'inherit' })
    expect(sanitize({ codexTaskModel: '' }, { ...DEFAULT_SETTINGS, codexTaskModel: 'gpt-5.5' }).codexTaskModel).toBeNull()
  })

  it('keeps older settings files working', () => {
    const s = sanitize({ theme: 'dark', showMini: true }, DEFAULT_SETTINGS)
    expect(s.theme).toBe('dark')
    expect(s.miniMode).toBe('card')
    expect(s.motion).toBe('standard')
  })
})
