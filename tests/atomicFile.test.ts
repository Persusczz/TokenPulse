import { lstatSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppState } from '../src/main/appState'
import { writeFileAtomic, writeFileAtomicSync } from '../src/main/atomicFile'
import { SettingsStore } from '../src/main/settings'
import { TaskService } from '../src/main/tasks'
import { ClaudeWindowLog } from '../src/main/windowHistory'

const dir = () => mkdtempSync(join(tmpdir(), 'tp-atomic-'))

describe('whole-file writes', () => {
  it('replaces the file and leaves no temp file behind', async () => {
    const d = dir()
    const path = join(d, 'settings.json')
    writeFileSync(path, '{"old":true,"padding":"' + 'x'.repeat(500) + '"}')
    await writeFileAtomic(path, '{"new":true}')
    expect(readFileSync(path, 'utf8')).toBe('{"new":true}')
    writeFileAtomicSync(path, '{"sync":true}')
    expect(readFileSync(path, 'utf8')).toBe('{"sync":true}')
    expect(readdirSync(d)).toEqual(['settings.json'])
  })

  it('writes made at the same moment end with the newest, whole', async () => {
    const d = dir()
    const path = join(d, 'tasks.json')
    const long = JSON.stringify({ v: 'a'.repeat(200_000) })
    const short = JSON.stringify({ v: 'b' })
    await Promise.all([writeFileAtomic(path, short), writeFileAtomic(path, long), writeFileAtomic(path, short), writeFileAtomic(path, long)])
    expect(readFileSync(path, 'utf8')).toBe(long)
    // one in progress, more coming in behind it
    const first = writeFileAtomic(path, long)
    await new Promise((r) => setTimeout(r, 0))
    await Promise.all([first, writeFileAtomic(path, long), writeFileAtomic(path, short)])
    expect(readFileSync(path, 'utf8')).toBe(short)
    expect(readdirSync(d)).toEqual(['tasks.json'])
  })

  it('a write on quit is not undone by one still queued', async () => {
    const path = join(dir(), 'tasks.json')
    const queued = writeFileAtomic(path, '{"old":1}')
    writeFileAtomicSync(path, '{"quit":1}')
    await queued
    expect(readFileSync(path, 'utf8')).toBe('{"quit":1}')
  })

  it('writes through a link instead of replacing it', async () => {
    const d = dir()
    const real = join(d, 'real.json')
    const link = join(d, 'link.json')
    writeFileSync(real, '{}')
    try {
      symlinkSync(real, link, 'file')
    } catch {
      return // creating links needs developer mode on Windows
    }
    await writeFileAtomic(link, '{"via":"link"}')
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readFileSync(real, 'utf8')).toBe('{"via":"link"}')
  })

  it('saves still waiting on their timers go out on quit', async () => {
    const d = dir()
    const state = new AppState(join(d, 'state.json'))
    state.bump('palette')
    state.flush()
    const reread = new AppState(join(d, 'state.json'))
    await reread.load()
    expect(reread.counters.palette?.n).toBe(1)

    const log = new ClaudeWindowLog(join(d, 'window-history.json'))
    const now = Date.now()
    expect(log.record(42, now + 3_600_000, now)).toBe(true)
    expect(log.recordWeek(30, now + 3 * 86_400_000, now)).toBe(true)
    log.flush()
    const relog = new ClaudeWindowLog(join(d, 'window-history.json'))
    await relog.load()
    expect(relog.windows[0]?.peak).toBe(42)
    expect(relog.weeks[0]?.peak).toBe(30)
    // nothing waiting: nothing written again
    log.flush()
    expect(readdirSync(d).sort()).toEqual(['state.json', 'window-history.json'])
  })

  it('settings with a byte-order mark load, unreadable ones are kept aside', async () => {
    const d = dir()
    const path = join(d, 'settings.json')
    writeFileSync(path, '﻿' + JSON.stringify({ guardEnabled: true, guardPauseAt: 85 }), 'utf8')
    const store = new SettingsStore(path)
    await store.load()
    expect(store.value.guardEnabled).toBe(true)
    expect(store.value.guardPauseAt).toBe(85)

    writeFileSync(path, '{"guardEnabled": true,', 'utf8')
    await store.load()
    expect(store.value.guardEnabled).toBe(false)
    expect(readFileSync(`${path}.broken`, 'utf8')).toBe('{"guardEnabled": true,')
  })

  it('an unreadable task list is kept aside, not written over', async () => {
    const path = join(dir(), 'tasks.json')
    writeFileSync(path, '[{"id":"a1","prompt":"修好', 'utf8')
    const svc = new TaskService(path, join(dir(), 'logs'), {
      window: () => ({ five: null, localEnd: null }),
      blocker: () => null,
      claude: async () => null,
      command: () => ({ cmd: process.execPath, pre: [] })
    })
    await svc.load()
    expect(svc.tasks).toEqual([])
    expect(readFileSync(`${path}.broken`, 'utf8')).toBe('[{"id":"a1","prompt":"修好')
  })

  it('settings saved quickly one after another read back as the last', async () => {
    const path = join(dir(), 'settings.json')
    const store = new SettingsStore(path)
    await store.load()
    await Promise.all([store.update({ fpsMeter: true }), store.update({ frameCap: '60' }), store.update({ guardEnabled: true })])
    const again = new SettingsStore(path)
    await again.load()
    expect(again.value.fpsMeter).toBe(true)
    expect(again.value.frameCap).toBe('60')
    expect(again.value.guardEnabled).toBe(true)
  })
})
