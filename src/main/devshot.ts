import { execFileSync } from 'node:child_process'
import { appendFile, mkdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { nativeImage as images, screen, type BrowserWindow } from 'electron'
import { PACK_KEYS, PACKS } from '@shared/packs'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Clicks the first button whose text matches */
const click = (text: string) =>
  `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); b && b.click(); return !!b })()`
const clickSel = (sel: string, i = 0) => `(() => { const b = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; b && b.click(); return !!b })()`
const scrollTo = (sel: string) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); el && el.scrollIntoView({ block: 'start' }); return !!el })()`
const rectOf = (sel: string) =>
  `(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } : null })()`

/**
 * Development aid: with TP_SCREENSHOT=<dir>, walks through the main views and
 * saves PNGs of each, then calls `done`. Never runs otherwise. The app runs
 * with a profile and Claude folder inside <dir>, so enabling the guard here
 * edits <dir>/claude/settings.json, not the real one.
 */
export async function runDevShots(dir: string, main: BrowserWindow, mini: BrowserWindow | null, done: () => void) {
  await mkdir(dir, { recursive: true })
  const log = (v: unknown) => appendFile(join(dir, 'devshot.log'), JSON.stringify(v) + '\n').catch(() => {})
  const shot = async (win: BrowserWindow, name: string, rect?: Electron.Rectangle | null) => {
    const img = await win.webContents.capturePage(rect ?? undefined)
    await writeFile(join(dir, `${name}.png`), img.toPNG())
  }
  const js = (code: string) => main.webContents.executeJavaScript(code)
  const set = (patch: object) => js(`window.api.setSettings(${JSON.stringify(patch)})`)
  /** what the main process broadcasts after new log lines, so the drop / ripple effects play */
  const fakeUpdate = (win: BrowserWindow | null, tokens: number) =>
    win && !win.isDestroyed() && win.webContents.send('data:update', { addedTokens: tokens, addedCost: tokens / 4e5, at: Date.now() })

  await wait(Number(process.env.TP_SCREENSHOT_DELAY ?? 6000))
  const measureFps = () =>
    js(`new Promise((done) => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < 2000 ? requestAnimationFrame(f) : done(Math.round(n / 2)) }; requestAnimationFrame(f) })`)
  const clickSub = (title: string) => js(`(() => { const b = [...document.querySelectorAll('.nav-sub')].find((x) => x.querySelector('.nav-sub-label')?.textContent === ${JSON.stringify(title)}); b && b.click(); return !!b })()`)

  // the Telegram animations: the today card and a quota alert as MP4s, checked by playing them
  if (process.env.TP_SHOTS === 'anim') {
    const { probeMp4 } = await import('./cardRender')
    type Anim = { cardAnimation: (v: 'claude' | 'codex' | 'all') => Promise<Buffer>; gauge: (g: import('./tgCard').GaugeAlert) => Promise<Buffer> }
    const tg = (globalThis as { __tpTelegram?: Anim }).__tpTelegram!
    const jobs: [string, () => Promise<Buffer>][] = [
      ['card', () => tg.cardAnimation('all')],
      ['gauge-90', () => tg.gauge({ title: 'Claude 5 小时额度', accent: '#d97757', from: 72, to: 91, note: '23:17 重置' })],
      ['gauge-reset', () => tg.gauge({ title: 'Codex 5 小时额度', accent: '#5b6cff', from: 100, to: 0, note: '新的窗口刚刚开始', reset: true })]
    ]
    for (const [name, make] of jobs) {
      const t0 = Date.now()
      try {
        const mp4 = await make()
        await writeFile(join(dir, `${name}.mp4`), mp4)
        const p = await probeMp4(mp4, name === 'card' ? 1.2 : 1.4)
        await writeFile(join(dir, `${name}-frame.png`), p.frame)
        for (const t of [0.1, 0.6, 3.0]) await writeFile(join(dir, `${name}-frame-${t}.png`), (await probeMp4(mp4, t)).frame)
        await log({ name, ms: Date.now() - t0, bytes: mp4.length, width: p.width, height: p.height, duration: p.duration })
      } catch (e) {
        await log({ name, error: String(e) })
      }
    }
    done()
    return
  }

  // the overview's calendar, today's sessions and the model table
  if (process.env.TP_SHOTS === 'more') {
    await main.webContents.insertCSS('.celebrate, .toasts, .toast { display: none !important }')
    await set({ themePack: 'none', theme: 'dark', backdrop: 'flow', sourceFilter: process.env.TP_MORE_SOURCE ?? 'all' })
    await js(click('概览'))
    await wait(3000)
    for (const sel of ['.timeline-card', '.calendar-card']) {
      await js(scrollTo(sel))
      await wait(1200)
      await shot(main, `more${sel.replace('.', '-')}`, await js(rectOf(sel)))
    }
    await js(click('7 天'))
    await wait(1500)
    await js(scrollTo('.model-table-card'))
    await wait(1200)
    await shot(main, 'more-model-table', await js(rectOf('.model-table-card')))
    await set({ theme: 'light' })
    await js(scrollTo('.calendar-card'))
    await wait(1500)
    await shot(main, 'more-calendar-light', await js(rectOf('.calendar-card')))
    done()
    return
  }

  // updating: check a stand-in release (TP_UPDATE_API), download, verify, hand over and quit; the restarted version logs itself
  if (process.env.TP_SHOTS === 'update') {
    const { app } = await import('electron')
    const u = (globalThis as { __tpUpdater?: import('./updater').Updater }).__tpUpdater!
    await log({ running: app.getVersion(), exe: process.env.PORTABLE_EXECUTABLE_FILE ?? null, kind: u.state.kind })
    const s = await u.check()
    await log({ check: s.status, latest: s.latest?.version ?? null, error: s.error ?? null })
    if (s.status === 'available' && !s.error) {
      const d = await u.download()
      await log({ download: d.status, error: d.error ?? null })
      if (d.status === 'ready' && (await u.install())) await log({ handedOver: true })
    }
    done()
    return
  }

  // 塔罗: the spread face down, turned, the collection; the 5h × 7d card; the Telegram picture
  if (process.env.TP_SHOTS === 'tarot') {
    type Tg = { onCommand: (c: import('./telegram').Command) => Promise<import('./telegram').Reply> }
    const tg = (globalThis as { __tpTelegram?: Tg }).__tpTelegram!
    await set({ themePack: 'none', theme: 'dark', backdrop: 'flow', sourceFilter: process.env.TP_TAROT_SOURCE ?? 'claude' })
    await main.webContents.insertCSS('.celebrate, .toasts, .toast { display: none !important }')
    await js(click('塔罗'))
    await wait(2600)
    await shot(main, 'tarot-1-deck')
    await js(`document.querySelector('.main').scrollBy(0, 640)`)
    await wait(800)
    await shot(main, 'tarot-2-deck')
    await js(`document.querySelector('.main').scrollBy(0, 640)`)
    await wait(800)
    await shot(main, 'tarot-3-deck')
    await js(clickSel('.deck-flip', 19))
    await js(clickSel('.deck-flip', 18))
    await wait(1200)
    await js(scrollTo('.deck-card.back'))
    await wait(500)
    await shot(main, 'tarot-4-back')
    await set({ theme: 'light' })
    await js(`document.querySelector('.main').scrollTo(0, 0)`)
    await wait(1800)
    await shot(main, 'tarot-5-light')
    await set({ theme: 'dark' })
    await js(click('概览'))
    await wait(2500)
    await js(scrollTo('.relation-card'))
    await wait(1500)
    await shot(main, 'relation', await js(rectOf('.relation-card')))
    const r = await tg.onCommand({ name: 'tarot', args: [] })
    if (typeof r !== 'string' && r.photo) await writeFile(join(dir, 'tarot-tg.jpg'), r.photo)
    await writeFile(join(dir, 'tarot-tg.txt'), typeof r === 'string' ? r : r.text)
    await log({ reading: await js('window.api.getTarot()') })
    done()
    return
  }

  // Telegram: the bot's replies and the picture cards, made by the real handler (the bot itself never connects in a shot run)
  if (process.env.TP_SHOTS === 'tg') {
    type Tg = { onCommand: (c: import('./telegram').Command) => Promise<import('./telegram').Reply>; cardPhoto: (v: 'claude' | 'codex' | 'all') => Promise<Buffer> }
    const tg = (globalThis as { __tpTelegram?: Tg }).__tpTelegram!
    const out: Record<string, unknown> = {}
    const lines = ['panel status', 'panel min', 'panel today', 'panel week', 'panel tasks', 'panel star', 'panel ach', 'panel top', 'panel sign', 'help', 'status', 'today', 'star', 'top', 'ach', 'board', 'boardnow', 'hide', 'keys', 'luckless']
    for (const line of lines) {
      const [name, ...args] = line.split(' ')
      const r = await tg.onCommand({ name, args })
      out[line] = typeof r === 'string' ? r : { ...r, photo: r.photo ? r.photo.length : undefined }
    }
    out.plain = await tg.onCommand({ name: 'plain', args: [], plain: '把 tests 里失败的用例修好' })
    for (const v of ['claude', 'codex', 'all'] as const) {
      const t0 = Date.now()
      await writeFile(join(dir, `card-${v}.jpg`), await tg.cardPhoto(v))
      out[`card ${v} ms`] = Date.now() - t0
    }
    await writeFile(join(dir, 'replies.json'), JSON.stringify(out, null, 2))
    await js(click('设置'))
    await wait(1200)
    await clickSub('通知与 Telegram')
    await set({ telegramEnabled: true, telegramToken: '1:demo', telegramChatId: '42', telegramQuietFrom: '23:00', telegramQuietTo: '08:00' })
    await wait(1500)
    await js(scrollTo('.tg-box'))
    await wait(600)
    await shot(main, 'tg-settings')
    await set({ telegramEnabled: false })
    done()
    return
  }

  // a Chromium trace of the overview, to see where the frame time goes
  if (process.env.TP_SHOTS === 'trace') {
    const { contentTracing } = await import('electron')
    const pack = process.env.TP_TRACE_PACK ?? 'none'
    await set({ backdrop: pack === 'none' ? 'flow' : pack, theme: 'dark', themePack: pack, motion: 'standard', glassCards: true, lightFx: true, sourceFilter: 'claude' })
    await js(click('概览'))
    await wait(9000)
    await contentTracing.startRecording({ included_categories: process.env.TP_TRACE_CATS ? process.env.TP_TRACE_CATS.split(',') : ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.stack', 'v8.execute', 'disabled-by-default-v8.cpu_profiler'] })
    await wait(3000)
    const path = await contentTracing.stopRecording(join(dir, 'trace.json'))
    await log({ trace: path })
    await set({ backdrop: 'flow', theme: 'system', sourceFilter: 'all' })
    done()
    return
  }

  // frame rate by page and backdrop, to find what costs
  if (process.env.TP_SHOTS === 'fps') {
    const out: Record<string, number> = {}
    for (const backdrop of ['plain', 'flow', 'orrery', 'bauhaus', 'lava'] as const) {
      await set({ backdrop, theme: 'dark', themePack: 'none', motion: 'standard', glassCards: true, sourceFilter: 'claude' })
      for (const page of ['概览', '设置', '星空', '会话']) {
        await js(click(page))
        await wait(2500)
        out[`${backdrop}/${page}`] = await measureFps()
      }
    }
    await log(out)
    await set({ themePack: 'none', theme: 'system', backdrop: 'flow', accent: 'clay', sourceFilter: 'all' })
    done()
    return
  }

  // the README's pictures: TP_SHOTS=readme (TP_SHOTS_ONLY=pages,tasks,packs,day,pockets), then copy <dir>/readme/* to docs/screenshots
  if (process.env.TP_SHOTS === 'readme') {
    const only = (process.env.TP_SHOTS_ONLY ?? '').split(',').filter(Boolean)
    const want = (group: string) => !only.length || only.includes(group)
    const out = join(dir, 'readme')
    await mkdir(out, { recursive: true })
    /** JPEG (scaled down to `width` px when given, or cut to `rect`); a `.png` name keeps the see-through windows' alpha */
    const save = async (win: BrowserWindow, name: string, width?: number, rect?: Electron.Rectangle | null) => {
      let img = await win.webContents.capturePage(rect ?? undefined)
      if (width && img.getSize().width > width) img = img.resize({ width, quality: 'best' })
      const png = name.endsWith('.png')
      if (png) {
        // cut the see-through margin around the window's content (re-read at scale 1 so sizes are pixels)
        img = images.createFromBuffer(img.toPNG())
        const { width: w, height: h } = img.getSize()
        const px = img.toBitmap()
        let [x0, y0, x1, y1] = [w, h, -1, -1]
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++)
            if (px[(y * w + x) * 4 + 3] > 8) {
              x0 = Math.min(x0, x)
              x1 = Math.max(x1, x)
              y0 = Math.min(y0, y)
              y1 = Math.max(y1, y)
            }
        if (x1 >= x0) img = img.crop({ x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
      }
      await writeFile(join(out, png ? name : `${name}.jpg`), png ? img.toPNG() : img.toJPEG(88))
    }
    const top = () => js(`document.querySelector('.main').scrollTo(0, 0)`)
    const at = async (sel: string) => {
      await js(scrollTo(sel))
      await js(`document.querySelector('.main').scrollBy(0, -16)`)
    }
    const base = { sourceFilter: 'claude', motion: 'standard', glassCards: true, lightFx: true, themePack: 'none', theme: 'dark', backdrop: 'flow', accent: 'clay', fpsMeter: false }
    main.setSize(1320, 880)
    main.center()
    // no achievement fanfare over the pictures, and the user's own prompts stay unreadable
    await main.webContents.insertCSS('.celebrate, .toasts, .toast { display: none !important } .dv-session-title, .dv-conv-title { filter: blur(5px) }')
    await set(base)
    await wait(6000)
    if (want('pages')) {
      await js(click('概览'))
      await wait(4000)
      await top()
      await wait(1500)
      await save(main, 'overview')
      for (const [sel, name] of [
        ['.cycles-card', 'overview-cycles'],
        ['.rate-card', 'overview-rate']
      ]) {
        await at(sel)
        await wait(1800)
        await save(main, name)
      }
      await set({ sourceFilter: 'codex' })
      await wait(2500)
      await top()
      await wait(1500)
      await save(main, 'overview-codex')
      await set({ sourceFilter: 'all', theme: 'light' })
      await wait(2500)
      await top()
      await wait(1500)
      await save(main, 'overview-light')
      // the sky without the galaxy overview, whose labels are the user's project folders
      await set({ ...base, backdrop: 'galaxy' })
      await js(click('星空'))
      await wait(4000)
      await at('.sky-row')
      await wait(1800)
      await save(main, 'sky-planets', undefined, await js(`(() => { const r = document.querySelector('.sky-row').getBoundingClientRect(); return { x: Math.round(r.x) - 12, y: Math.round(r.y) - 12, width: Math.round(r.width) + 24, height: Math.round(r.height) + 24 } })()`))
      // fly into the biggest galaxy: its conversations along the arms
      await top()
      await wait(800)
      await js(
        `(() => { const c = document.querySelector('.galaxy-canvas'); if (!c) return null; const r = c.getBoundingClientRect(); const o = { clientX: r.left + r.width / 2 - 34, clientY: r.top + r.height * 0.46 + 26, bubbles: true }; c.dispatchEvent(new MouseEvent('mousemove', o)); c.dispatchEvent(new MouseEvent('click', o)); return true })()`
      )
      await wait(2400)
      await save(main, 'sky-dive')
      for (let k = 0; k < 2; k++) {
        await js(clickSel('.dv-back'))
        await wait(400)
      }
      await set(base)
      for (const [page, name] of [
        ['成就', 'achievements'],
        ['定价', 'pricing']
      ]) {
        await js(click(page))
        await wait(3000)
        await top()
        await wait(800)
        await save(main, name)
      }
      // the pack grid, one of them playing its scene under the pointer
      await js(`localStorage.setItem('tp.fold.packs', '1'); localStorage.setItem('tp.fold.backdrops', '1')`)
      await js(click('设置'))
      await wait(1200)
      await clickSub('外观与动效')
      await wait(1600)
      await js(scrollTo('.packs'))
      await js(`document.querySelector('.main').scrollBy(0, -110)`)
      await js(`(() => { const b = document.querySelector('.pack.pack-cyber'); b && b.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); return !!b })()`)
      await wait(2600)
      await save(main, 'settings-packs')
      await js(`(() => { const b = document.querySelector('.pack.pack-cyber'); b && b.dispatchEvent(new PointerEvent('pointerout', { bubbles: true })); return !!b })()`)
      await js(`localStorage.removeItem('tp.fold.packs'); localStorage.removeItem('tp.fold.backdrops')`)
    }
    // the task queue with a stand-in CLI, so nothing real runs
    if (want('tasks')) {
      const svc = (globalThis as { __tpTasks?: import('./tasks').TaskService }).__tpTasks
      if (svc) {
        const fake = join(dir, 'fake-cli.cjs')
        await writeFile(
          fake,
          `const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
out({ type: 'system', subtype: 'init', model: 'claude-opus-5-5', cwd: '~/projects/' + require('path').basename(process.cwd()), session_id: 'demo-' + Date.now() })
let i = 0
const steps = [['thinking', '先看看 tests 目录里哪些用例失败，再决定从哪里改起'], ['Bash', 'npm test -- --reporter=dot'], ['Read', 'src/main/quota.ts'], ['text', '找到了：刷新时两个请求并发写同一个缓存'], ['Edit', 'src/main/quota.ts'], ['Bash', 'npm test'], ['text', '修好了，正在复查其它调用点']]
const t = setInterval(() => {
  const s = steps[i++]
  if (!s) { clearInterval(t); setInterval(() => {}, 1e4); return }
  out({ type: 'assistant', message: { content: [s[0] === 'thinking' ? { type: 'thinking', thinking: s[1] } : s[0] === 'text' ? { type: 'text', text: s[1] } : { type: 'tool_use', name: s[0], input: s[0] === 'Bash' ? { command: s[1] } : { file_path: s[1] } }] } })
}, 500)`
        )
        svc.useCommand(() => ({ cmd: 'node', pre: [fake] }))
        const add = (input: object) => js(`window.api.addTask(${JSON.stringify(input)})`) as Promise<{ id: string }>
        // stand-in project folders, so the queue shows real ones
        const here = join(dir, 'projects', 'my-app')
        const docs = join(dir, 'projects', 'docs-site')
        for (const d of [here, docs]) await mkdir(d, { recursive: true })
        const a = await add({ prompt: '把 tests 里失败的用例修好，跑一遍 npm test 确认全部通过', cwd: here, trigger: 'reset', continue: true, verify: 'npm test', retries: 2 })
        await add({ prompt: '修好以后把这次的改动写进 CHANGELOG', cwd: here, trigger: 'reset', parentId: a.id, continue: true })
        await add({ prompt: '审查一遍 quota 模块的并发问题，写一份报告', cwd: here, tool: 'codex', trigger: 'reset', permission: 'plan', continue: true })
        await add({ prompt: '在文档站同步这次的接口变化', cwd: docs, trigger: 'time', at: Date.now() + 5 * 3600_000, continue: false })
        await add({ prompt: '每晚检查依赖更新并给出升级建议', cwd: here, trigger: 'manual', repeat: true, permission: 'plan' })
        // both tools' lanes, and a tidy folder in the form
        await set({ sourceFilter: 'all', taskCwd: 'D:\\projects\\my-app' })
        await js(click('任务'))
        await wait(2500)
        await svc.action(a.id, 'start')
        await wait(1500)
        await save(main, 'tasks')
        await js(`[...document.querySelectorAll('.task-item.running button')].find((b) => b.textContent.trim() === '日志')?.click()`)
        await wait(3600)
        await at('.task-tree')
        await wait(900)
        await save(main, 'tasks-queue')
        for (const t of [...svc.tasks]) if (t.status === 'running') await svc.action(t.id, 'stop')
        await wait(1500)
        for (const t of [...svc.tasks]) {
          if (t.status === 'queued') await svc.action(t.id, 'cancel')
          await svc.action(t.id, 'remove')
        }
        await set(base)
      }
    }
    if (want('packs')) {
      await js(click('概览'))
      const packs = (process.env.TP_SHOTS_PACKS ?? 'mystic,cyber,xianxia,koi,ukiyo,pixel,lantern,sakura,borealis,abyss,matrix,orrery').split(',')
      for (const pack of packs as (keyof typeof PACKS)[]) {
        await set({ themePack: pack, backdrop: PACKS[pack].backdrop, theme: PACKS[pack].theme === 'light' ? 'light' : 'dark' })
        await wait(4500)
        await top()
        await wait(600)
        await save(main, `pack-${pack}`, 960)
      }
      await set(base)
    }
    // 昼夜 through one day and the seasons
    if (want('day')) {
      const { placeOf, sunTimes } = await import('@shared/astro')
      const st = sunTimes(Date.now(), placeOf(null))
      const M = 60_000
      const day = (t: number | null) => js(`(() => { window.__tpSetDay && window.__tpSetDay(${t === null ? 'null' : t}); return true })()`)
      const ev = (name: string) => js(`(() => { window.__tpDayEvent && window.__tpDayEvent(${JSON.stringify(name)}); return true })()`)
      const season = (k: string | null) => js(`(() => { window.__tpSeason = ${k ? JSON.stringify(k) : 'undefined'}; return true })()`)
      await set({ themePack: 'daylight', theme: 'dark', backdrop: 'daylight' })
      await js(click('概览'))
      await wait(1800)
      await top()
      await day(st.rise! + 35 * M)
      await wait(800)
      await ev('balloon')
      await wait(4000)
      await save(main, 'day-morning', 960)
      await day(st.noon)
      await wait(800)
      await ev('plane')
      await wait(9000)
      await save(main, 'day-noon', 960)
      await ev('shower')
      await wait(12000)
      await ev('rainbow')
      await wait(3000)
      await save(main, 'day-rainbow', 960)
      await day(st.set! + 18 * M)
      await wait(4000)
      await save(main, 'day-dusk', 960)
      await season('summer')
      await day(st.set! + 3 * 60 * M)
      await wait(800)
      await ev('aurora')
      await ev('sat')
      await wait(9000)
      await save(main, 'day-night', 960)
      await season('winter')
      await day(st.noon - 100 * M)
      await wait(3500)
      await save(main, 'day-winter', 960)
      await season(null)
      await day(null)
      await set(base)
    }
    // the floating window as card, capsule and orb, and the island, in a few packs
    if (want('pockets')) {
      const { BrowserWindow: BW } = await import('electron')
      const find = (hash: string) => BW.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().includes(hash))
      await set({ island: true, showMini: true, miniMode: 'card', miniScale: 1 })
      await wait(3000)
      for (const pack of (process.env.TP_SHOTS_PACKS ?? 'none,cyber,ukiyo,koi,daylight,mystic').split(',') as (keyof typeof PACKS)[]) {
        await set({ themePack: pack, backdrop: PACKS[pack].backdrop, theme: PACKS[pack].theme === 'light' ? 'light' : 'dark', miniMode: 'card' })
        await wait(2200)
        let m = find('#/mini')
        const isl = find('#/island')
        if (m) fakeUpdate(m, 2_400_000)
        if (isl) fakeUpdate(isl, 2_400_000)
        await wait(900)
        if (m) await save(m, `mini-${pack}-card.png`)
        if (isl) await save(isl, `island-${pack}.png`)
        for (const mode of ['capsule', 'orb'] as const) {
          await set({ miniMode: mode })
          await wait(1600)
          m = find('#/mini')
          if (m) await save(m, `mini-${pack}-${mode}.png`)
        }
        if (isl) {
          isl.webContents.sendInputEvent({ type: 'mouseMove', x: 230, y: 18 })
          await wait(1100)
          await save(isl, `island-${pack}-open.png`)
          isl.webContents.sendInputEvent({ type: 'mouseLeave', x: 5, y: 190 })
          await wait(500)
        }
      }
      await set({ island: false, miniMode: 'card' })
    }
    await set({ themePack: 'none', theme: 'system', backdrop: 'flow', accent: 'clay', sourceFilter: 'all' })
    done()
    return
  }

  // 2.11: the six new packs, and the richer day / night
  if (process.env.TP_SHOTS === 'v212') {
    const only = process.env.TP_SHOTS_ONLY ?? ''
    await set({ sourceFilter: 'claude', motion: 'standard', glassCards: true, lightFx: true })
    await wait(6000)
    // the window and its scroll areas against the screen's work area, on a tall sidebar
    if (!only || only === 'layout') {
      await set({ themePack: 'daylight', theme: 'dark', backdrop: 'daylight' })
      await js(click('设置'))
      await wait(1500)
      const measure = async (name: string) => {
        await wait(900)
        const b = main.getBounds()
        await log({
          [name]: {
            bounds: b,
            work: screen.getDisplayMatching(b).workArea,
            inner: await js(`({ w: innerWidth, h: innerHeight })`),
            shell: await js(rectOf('.shell')),
            side: await js(`(() => { const s = document.querySelector('.side'); return { h: s.clientHeight, scroll: s.scrollHeight } })()`),
            main: await js(`(() => { const s = document.querySelector('.main'); return { h: s.clientHeight, scroll: s.scrollHeight, rect: s.getBoundingClientRect().height } })()`)
          }
        })
        await js(`document.querySelector('.main').scrollTo(0, 1e6)`)
        await wait(400)
        await shot(main, name)
      }
      main.setSize(1320, 880)
      await measure('400-layout-normal')
      main.setSize(1100, 640)
      await measure('401-layout-short')
      main.maximize()
      await measure('402-layout-max')
      main.unmaximize()
      main.setSize(1320, 880)
    }
    // the day/night pack at the real time
    if (!only || only === 'daytime') {
      await set({ themePack: 'daylight', theme: 'dark', backdrop: 'daylight' })
      await js(click('概览'))
      await wait(3000)
      await log({
        daytime: await js(
          `({ now: new Date().toString(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone, offset: new Date().getTimezoneOffset(), clock: document.querySelector('.day-clock-text')?.textContent })`
        )
      })
      await shot(main, '410-daytime')
    }
    // frame pacing by pack and page: frame rate, the 95th-percentile frame, the share of frames that took 1.5x the usual
    if (!only || only === 'fps') {
      const frames = () =>
        js(
          `new Promise((done) => { const d = []; let p = performance.now(); const t0 = p; const f = (n) => { d.push(n - p); p = n; if (n - t0 < 3000) requestAnimationFrame(f); else { d.sort((a, b) => a - b); const med = d[d.length >> 1]; const mean = d.reduce((a, b) => a + b, 0) / d.length; done({ fps: Math.round(1000 / mean), med: +med.toFixed(1), p95: +d[Math.floor(d.length * 0.95)].toFixed(1), max: +d[d.length - 1].toFixed(1), jank: +((d.filter((x) => x > med * 1.5).length / d.length) * 100).toFixed(1) }) } }; requestAnimationFrame(f) })`
        )
      const packs = (process.env.TP_SHOTS_PACKS ?? 'none,daylight,mystic,cyber,xianxia,koi,ukiyo,pixel,lantern,abyss').split(',')
      for (const pack of packs) {
        await set({ themePack: pack, backdrop: pack === 'none' ? 'galaxy' : pack, theme: pack === 'ukiyo' ? 'light' : 'dark' })
        const row: Record<string, unknown> = {}
        for (const page of ['概览', '设置']) {
          await js(click(page))
          await wait(3500)
          await js(`window.__tpFrames?.()`)
          row[page] = { ...(await frames()), loops: await js(`(() => { const s = window.__tpFrames?.(); return s ? s.refresh + 'Hz ' + s.loops.map((l) => l.name + ':' + (l.runs / 3).toFixed(0) + '/' + l.cost.toFixed(1)).join(' ') : '' })()`) }
        }
        await log({ [`frames-${pack}`]: row })
      }
    }
    // what the GPU-bound packs cost under each setting
    if (only === 'fpsx') {
      const frames = async () => {
        await js(`window.__tpFrames?.()`)
        const page = await js(
          `new Promise((done) => { const d = []; let p = performance.now(); const t0 = p; const f = (n) => { d.push(n - p); p = n; if (n - t0 < 3000) requestAnimationFrame(f); else { d.sort((a, b) => a - b); const mean = d.reduce((a, b) => a + b, 0) / d.length; done({ fps: Math.round(1000 / mean), p95: +d[Math.floor(d.length * 0.95)].toFixed(1), jank: +((d.filter((x) => x > 10.5).length / d.length) * 100).toFixed(1) }) } }; requestAnimationFrame(f) })`
        )
        const st = await js(`(() => { const s = window.__tpFrames?.(); return s ? { missed: +(s.missed * 100).toFixed(1), q: s.quality, hz: s.refresh } : null })()`)
        return { ...page, ...st }
      }
      for (const pack of (process.env.TP_SHOTS_PACKS ?? 'daylight,ukiyo,mystic').split(',')) {
        const base = { themePack: pack, backdrop: pack, theme: pack === 'ukiyo' ? 'light' : 'dark', glassCards: true, motion: 'standard', frameCap: 'auto' }
        await set(base)
        await js(click('概览'))
        await wait(3000)
        const row: Record<string, unknown> = { base: await frames() }
        await set({ ...base, glassCards: false })
        await wait(1500)
        row.noGlass = await frames()
        await set({ ...base, motion: 'subtle' })
        await wait(1500)
        row.subtle = await frames()
        await set({ ...base, frameCap: '30' })
        await wait(1500)
        row.cap30 = await frames()
        await js(`window.__tpQuality?.(1)`)
        await wait(1500)
        row.q1 = await frames()
        await js(`window.__tpQuality?.(2)`)
        await wait(1500)
        row.q2 = await frames()
        await js(`window.__tpQuality?.(0)`)
        await wait(6000)
        row.base2 = await frames()
        await wait(4000)
        row.base3 = await frames()
        // left to itself for a while: where 自动 settles
        await wait(14000)
        row.auto = await frames()
        await log({ [`fpsx-${pack}`]: row })
      }
    }
    // the frame-rate meter and its settings
    if (!only || only === 'meter') {
      await set({ themePack: 'daylight', backdrop: 'daylight', theme: 'dark', fpsMeter: true, frameCap: 'auto' })
      await js(click('概览'))
      await wait(4000)
      await shot(main, '440-meter')
      const r = await js(rectOf('.fps-meter'))
      if (r) {
        main.webContents.sendInputEvent({ type: 'mouseMove', x: r.x + 20, y: r.y + 10 })
        await wait(1300)
        await shot(main, '441-meter-open', { x: Math.max(0, r.x - 120), y: Math.max(0, r.y - 260), width: 360, height: 320 })
      }
      await js(click('设置'))
      await wait(1500)
      await js(`(() => { const el = [...document.querySelectorAll('.row-label, .set-label, label, span')].find((x) => x.textContent?.trim() === '动画帧率'); el?.scrollIntoView({ block: 'center' }); return !!el })()`)
      await wait(800)
      await shot(main, '442-settings-frames')
      await set({ fpsMeter: false })
    }
    // each pack's pocket scene: the floating window as card, capsule and orb, the island compact and open
    if (!only || only === 'pockets') {
      const { BrowserWindow: BW } = await import('electron')
      const find = (hash: string) => BW.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().includes(hash))
      const packs = (process.env.TP_SHOTS_PACKS ?? PACK_KEYS.filter((k) => k !== 'none').join(',')).split(',')
      await set({ island: true, showMini: true, miniMode: 'card', miniScale: 1 })
      await wait(3000)
      for (const pack of packs as (keyof typeof PACKS)[]) {
        const theme = PACKS[pack].theme === 'light' ? 'light' : 'dark'
        await set({ themePack: pack, backdrop: PACKS[pack].backdrop, theme, miniMode: 'card' })
        await wait(2200)
        let m = find('#/mini')
        const isl = find('#/island')
        if (m) fakeUpdate(m, 2_400_000)
        if (isl) fakeUpdate(isl, 2_400_000)
        await wait(700)
        if (m) await shot(m, `500-${pack}-card`)
        if (isl) await shot(isl, `500-${pack}-island`)
        await set({ miniMode: 'capsule' })
        await wait(1600)
        m = find('#/mini')
        if (m) await shot(m, `500-${pack}-capsule`)
        await set({ miniMode: 'orb' })
        await wait(1600)
        m = find('#/mini')
        if (m) {
          fakeUpdate(m, 1_200_000)
          await wait(600)
          await shot(m, `500-${pack}-orb`)
        }
        if (isl) {
          isl.webContents.sendInputEvent({ type: 'mouseMove', x: 230, y: 18 })
          await wait(1000)
          await shot(isl, `500-${pack}-detail`)
          isl.webContents.sendInputEvent({ type: 'mouseLeave', x: 5, y: 190 })
          await wait(500)
        }
        // 昼夜 at noon and at night too
        if (pack === 'daylight') {
          const day = new Date()
          for (const [name, hour] of [['noon', 12.5], ['night', 23]] as const) {
            day.setHours(Math.floor(hour), (hour % 1) * 60, 0, 0)
            await set({ miniMode: 'card' })
            await wait(1500)
            m = find('#/mini')
            for (const x of [m, isl]) await x?.webContents.executeJavaScript(`window.__tpSetDay?.(${day.getTime()})`)
            await set({ backdrop: 'plain' })
            await wait(400)
            await set({ backdrop: 'daylight' })
            await wait(1800)
            m = find('#/mini')
            if (m) await shot(m, `501-daylight-${name}-card`)
            if (isl) await shot(isl, `501-daylight-${name}-island`)
          }
          for (const x of [find('#/mini'), isl]) await x?.webContents.executeJavaScript(`window.__tpSetDay?.(null)`)
        }
      }
      await set({ island: false, miniMode: 'card' })
    }
    // 额度窗口账单 on the overview
    if (!only || only === 'cycles') {
      await set({ themePack: 'none', theme: 'dark', backdrop: 'flow' })
      for (const src of ['claude', 'all'] as const) {
        await set({ sourceFilter: src })
        await js(click('概览'))
        await wait(2500)
        await log({ [`cycles-${src}`]: await js(`window.api.getQuotaCycles().then((l) => l.map((x) => ({ s: x.source, five: x.five.map((c) => [new Date(c.start).toISOString().slice(5, 16), Math.round(c.tokens / 1e3), +c.cost.toFixed(2), c.pct, c.current, c.estimated]), seven: x.seven.map((c) => [new Date(c.start).toISOString().slice(5, 16), Math.round(c.tokens / 1e3), +c.cost.toFixed(2), c.pct, c.current, c.estimated]) })))`) })
        await js(scrollTo('.cycles-card'))
        await js(`document.querySelector('.main').scrollBy(0, -20)`)
        await wait(1400)
        await shot(main, `430-cycles-${src}`)
      }
      await js(`(() => { const c = document.querySelectorAll('.cy-5h .cy-col'); c[Math.max(0, c.length - 4)]?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return c.length })()`)
      await wait(500)
      await shot(main, '431-cycles-hover')
      // a click shows that window at the top; the 7-day panel too
      await js(`(() => { const c = document.querySelectorAll('.cy-5h .cy-col'); c[Math.max(0, c.length - 5)]?.click(); const w = document.querySelectorAll('.cy-7d .cy-col'); w[Math.max(0, w.length - 2)]?.click(); document.querySelector('.cy-chart')?.dispatchEvent(new MouseEvent('mouseleave')); return c.length })()`)
      await wait(900)
      await shot(main, '431b-cycles-picked', await js(rectOf('.cycles-card')))
      if (only === 'cycles' && process.env.TP_CYCLES_PICK) {
        done()
        return
      }
      await js(click('金额'))
      await wait(900)
      await shot(main, '432-cycles-cost')
      await set({ theme: 'light' })
      await wait(1200)
      await shot(main, '433-cycles-light')
      await set({ themePack: 'cyber', backdrop: 'cyber', theme: 'dark' })
      await wait(2500)
      await js(scrollTo('.cycles-card'))
      await wait(600)
      await shot(main, '434-cycles-cyber')
      await set({ sourceFilter: 'claude' })
    }
    // the native title-bar buttons over each pack: a real screen grab of the window's top-right corner
    if (!only || only === 'titlebar') {
      const grab = (name: string) => {
        const b = main.getBounds()
        const k = screen.getDisplayMatching(b).scaleFactor
        const w = Math.round(420 * k)
        const h = Math.round(70 * k)
        const x = Math.round((b.x + b.width - 420) * k)
        const y = Math.round(b.y * k)
        const out = join(dir, `${name}.png`)
        const ps = [
          'Add-Type -AssemblyName System.Drawing',
          `Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class Dpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'`,
          '[Dpi]::SetProcessDPIAware() | Out-Null',
          `$b = New-Object System.Drawing.Bitmap ${w}, ${h}`,
          '$g = [System.Drawing.Graphics]::FromImage($b)',
          `$g.CopyFromScreen(${x}, ${y}, 0, 0, $b.Size)`,
          `$b.Save('${out.replace(/'/g, "''")}')`
        ].join('; ')
        execFileSync('powershell', ['-NoProfile', '-Command', ps])
      }
      main.setAlwaysOnTop(true)
      main.focus()
      const packs = [['none', 'dark'], ['none', 'light'], ['cyber', 'dark'], ['ukiyo', 'light'], ['mystic', 'dark'], ['daylight', 'dark'], ['pixel', 'dark'], ['sakura', 'light'], ['paper', 'light'], ['dune', 'light'], ['borealis', 'dark'], ['koi', 'light'], ['ink', 'light'], ['lantern', 'dark']] as const
      const only = process.env.TP_SHOTS_PACKS?.split(',')
      for (const [pack, theme] of packs) {
        if (only && !only.includes(`${pack}-${theme}`)) continue
        const backdrop = pack === 'none' ? 'flow' : pack
        await set({ themePack: pack, theme, backdrop })
        await js(click('概览'))
        // the buttons are looked at 1.2 s after a change and again every 8 s
        await wait(Number(process.env.TP_TITLE_WAIT ?? 2600))
        if (process.env.TP_TITLE_FULL) await shot(main, `419-full-${pack}-${theme}`)
        if (process.env.TP_TITLE_PAGE) await shot(main, `420-title-${pack}-${theme}`, { x: main.getContentSize()[0] - 420, y: 0, width: 420, height: 70 })
        else grab(`420-title-${pack}-${theme}`)
        await log({ title: pack, theme, scrim: await js(`getComputedStyle(document.documentElement).getPropertyValue('--tb-scrim')`), fg: await js(`getComputedStyle(document.documentElement).getPropertyValue('--tb-fg')`), bg: await js(`getComputedStyle(document.documentElement).getPropertyValue('--bg')`), sample: await js('window.api.titleCorner()') })
      }
      // the 昼夜 sky through a day: the corner changes from dark to bright and back
      if (only) {
        main.setAlwaysOnTop(false)
        done()
        return
      }
      await set({ themePack: 'daylight', theme: 'light', backdrop: 'daylight' })
      for (const h of [6, 9, 13, 17.5, 19, 23]) {
        const t = new Date()
        t.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0)
        await js(`(() => { window.__tpSetDay && window.__tpSetDay(${t.getTime()}); return true })()`)
        await wait(9500)
        if (process.env.TP_TITLE_PAGE) await shot(main, `421-title-day-${String(h).replace('.', '_')}`, { x: main.getContentSize()[0] - 420, y: 0, width: 420, height: 70 })
        else grab(`421-title-day-${String(h).replace('.', '_')}`)
        await log({ title: 'day', h, scrim: await js(`getComputedStyle(document.documentElement).getPropertyValue('--tb-scrim')`), fg: await js(`getComputedStyle(document.documentElement).getPropertyValue('--tb-fg')`) })
      }
      await js(`(() => { window.__tpSetDay && window.__tpSetDay(null); return true })()`)
      main.setAlwaysOnTop(false)
    }
    done()
    return
  }

  if (process.env.TP_SHOTS === 'v211') {
    const only = process.env.TP_SHOTS_ONLY ?? ''
    await set({ sourceFilter: 'claude', motion: 'standard', glassCards: true, lightFx: true })
    // let the launch's achievement fanfare pass
    await wait(6000)
    const packs = (process.env.TP_SHOTS_PACKS ?? 'mystic,cyber,xianxia,koi,ukiyo,pixel').split(',')
    if (!only || only === 'packs') {
      for (const pack of packs) {
        const theme = pack === 'ukiyo' ? 'light' : 'dark'
        await js(click('概览'))
        await wait(900)
        await set({ themePack: pack, theme, backdrop: pack, glassCards: true })
        await wait(420)
        await shot(main, `300-${pack}-entrance`)
        await wait(3800)
        await shot(main, `301-${pack}-overview`)
        fakeUpdate(main, 3_000_000)
        await wait(1300)
        await shot(main, `302-${pack}-pulse`)
        await wait(2600)
        await shot(main, `303-${pack}-after`)
        await log({ [`fps-${pack}`]: await measureFps() })
        await js(click('会话'))
        await wait(280)
        await shot(main, `304-${pack}-turn`)
        await wait(1800)
        await js(click('设置'))
        await wait(2200)
        await shot(main, `305-${pack}-settings`)
      }
      // the other theme of the two that have one
      for (const [pack, theme] of [
        ['koi', 'light'],
        ['ukiyo', 'dark']
      ] as const) {
        await set({ themePack: pack, theme, backdrop: pack })
        await js(click('概览'))
        await wait(3500)
        await shot(main, `306-${pack}-${theme}`)
      }
    }
    // does switching packs move the overview? (it should stay at the top)
    if (only === 'scroll') {
      const top = () => js(`document.querySelector('.main').scrollTop`)
      for (const pack of ['mystic', 'xianxia', 'koi', 'xianxia']) {
        await js(click('概览'))
        await wait(1500)
        const before = await top()
        await set({ themePack: pack, theme: 'dark', backdrop: pack })
        const after: number[] = []
        for (let k = 0; k < 8; k++) {
          await wait(500)
          after.push(await top())
        }
        await log({ pack, before, after })
      }
    }
    // frame rate by pack on a quiet page and on the overview
    if (only === 'fps') {
      const out: Record<string, number> = {}
      for (const pack of ['none', 'daylight', ...packs]) {
        await set({ themePack: pack, theme: pack === 'ukiyo' ? 'light' : 'dark', backdrop: pack === 'none' ? 'flow' : pack, glassCards: true })
        for (const page of ['设置', '概览']) {
          await js(click(page))
          await wait(3000)
          out[`${pack}/${page}`] = await measureFps()
        }
      }
      await log(out)
    }
    if (!only || only === 'day') {
      const { placeOf, sunTimes } = await import('@shared/astro')
      const st = sunTimes(Date.now(), placeOf(null))
      const M = 60_000
      const day = (at: number | null) => js(`(() => { window.__tpSetDay && window.__tpSetDay(${at === null ? 'null' : at}); return true })()`)
      const ev = (name: string) => js(`(() => { window.__tpDayEvent && window.__tpDayEvent(${JSON.stringify(name)}); return true })()`)
      const season = (k: string | null) => js(`(() => { window.__tpSeason = ${k ? JSON.stringify(k) : 'undefined'}; return true })()`)
      await set({ themePack: 'daylight', theme: 'dark', backdrop: 'daylight', accent: 'clay' })
      await js(click('概览'))
      await wait(1800)
      await day(st.rise! + 35 * M)
      await wait(800)
      await ev('balloon')
      await wait(4000)
      await shot(main, '320-day-morning-balloons')
      await day(st.noon)
      await wait(800)
      await ev('plane')
      await wait(9000)
      await shot(main, '321-day-noon-plane-hawks')
      await ev('shower')
      await wait(12000)
      await shot(main, '322-day-shower')
      await ev('rainbow')
      await wait(3000)
      await shot(main, '323-day-rainbow')
      await day(st.set! + 18 * M)
      await wait(4000)
      await shot(main, '324-day-dusk-bats')
      await season('summer')
      await day(st.set! + 3 * 60 * M)
      await wait(800)
      await ev('aurora')
      await ev('sat')
      await wait(9000)
      await shot(main, '325-day-night-aurora-fireflies')
      for (const k of ['winter', 'spring', 'autumn', 'summer']) {
        await season(k)
        await day(st.noon - 100 * M)
        await wait(3000)
        await shot(main, `326-day-${k}`)
      }
      await season('winter')
      await day(st.set! + 4 * 60 * M)
      await wait(3000)
      await shot(main, '327-day-winter-night')
      await season(null)
      await day(null)
    }
    if (!only || only === 'picker') {
      await set({ themePack: 'none', theme: 'dark', backdrop: 'galaxy', accent: 'clay' })
      await js(`localStorage.setItem('tp.fold.packs', '1'); localStorage.setItem('tp.fold.backdrops', '1')`)
      await js(click('设置'))
      await wait(900)
      await clickSub('外观与动效')
      await wait(1600)
      await js(scrollTo('.packs'))
      await wait(900)
      await shot(main, '310-packs')
      // a pack under the pointer plays its own scene
      const hover = (sel: string) => js(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); b && b.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); return !!b })()`)
      const leave = (sel: string) => js(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); b && b.dispatchEvent(new PointerEvent('pointerout', { bubbles: true })); return !!b })()`)
      for (const k of ['mystic', 'cyber', 'koi', 'daylight']) {
        await hover(`.pack.pack-${k}`)
        await wait(2400)
        await shot(main, `311-pack-hover-${k}`)
        await leave(`.pack.pack-${k}`)
      }
      await js(`(() => { const r = [...document.querySelectorAll('.bd-cat-name')].find((x) => x.textContent === '幻境'); r && r.scrollIntoView({ block: 'center' }); return !!r })()`)
      await wait(800)
      await hover('.bd-tile.bd-xianxia')
      await wait(2400)
      await shot(main, '312-backdrops')
      await js(`localStorage.removeItem('tp.fold.packs'); localStorage.removeItem('tp.fold.backdrops')`)
    }
    await set({ themePack: 'none', theme: 'system', backdrop: 'flow', accent: 'clay', sourceFilter: 'all' })
    done()
    return
  }

  // 2.9: the whole overview and sky page, screen by screen
  if (process.env.TP_SHOTS === 'v29') {
    const only = process.env.TP_SHOTS_ONLY ?? ''
    await set({ sourceFilter: 'claude', motion: 'standard', glassCards: true, lightFx: true, themePack: 'none', theme: 'dark', backdrop: 'galaxy', accent: 'clay' })
    const pages = async (page: string, prefix: string) => {
      await js(click(page))
      await wait(3500)
      await js(`document.querySelector('.main').scrollTo(0, 0)`)
      const total = await js(`(() => { const m = document.querySelector('.main'); return [m.scrollHeight, m.clientHeight] })()`)
      await log({ page, total })
      for (let k = 0, y = 0; y < total[0] && k < 14; k++, y += Math.round(total[1] * 0.85)) {
        await js(`document.querySelector('.main').scrollTo(0, ${y})`)
        await wait(1600)
        await shot(main, `${prefix}-${String(k).padStart(2, '0')}`)
      }
    }
    if (!only || only === 'audit') await pages('概览', '200-ov')
    if (!only || only === 'sky') {
      await pages('星空', '220-sky')
      await js(`document.querySelector('.main').scrollTo(0, 0)`)
      await wait(800)
      // new usage flies in as a comet
      fakeUpdate(main, 1_200_000)
      await wait(700)
      await shot(main, '221-comet')
      await wait(1500)
      await shot(main, '221b-comet-land')
      // a galaxy under the pointer
      const g = await js(`(() => { const c = document.querySelector('.galaxy-canvas'); if (!c) return null; const r = c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + r.width / 2, clientY: r.top + r.height * 0.44, bubbles: true })); return [r.width, r.height] })()`)
      await log({ galaxy: g })
      await wait(500)
      await shot(main, '222-galaxy-hover')
      await js(scrollTo('.sky-row'))
      await wait(1500)
      await js(`(() => { const c = document.querySelector('.planet-canvas'); if (!c) return null; const r = c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + r.width / 2, clientY: r.top + r.height * 0.47, bubbles: true })); return true })()`)
      await wait(400)
      await shot(main, '223-planets')
      await set({ theme: 'light', backdrop: 'flow' })
      await js(`document.querySelector('.main').scrollTo(0, 0)`)
      await wait(1500)
      await shot(main, '224-sky-light')
      await set({ theme: 'dark', backdrop: 'galaxy', sourceFilter: 'all' })
      await wait(2500)
      await shot(main, '225-sky-all')
      await set({ sourceFilter: 'claude' })
    }
    if (!only || only === 'dive') {
      // fly into the biggest galaxy, open a conversation, point at a prompt, pick a star
      const into = (src: string) =>
        js(`(() => { const c = document.querySelector('.galaxy-canvas'); if (!c) return null; const r = c.getBoundingClientRect(); const o = { clientX: r.left + r.width / 2 - 34, clientY: r.top + r.height * 0.46 + 26, bubbles: true }; c.dispatchEvent(new MouseEvent('mousemove', o)); c.dispatchEvent(new MouseEvent('click', o)); return '${src}' })()`)
      for (const src of ['claude', 'codex'] as const) {
        await set({ sourceFilter: src })
        await js(click('星空'))
        await wait(3500)
        await js(`document.querySelector('.main').scrollTo(0, 0)`)
        await wait(600)
        await into(src)
        await wait(450)
        await shot(main, `250-${src}-dive-flying`)
        await wait(1600)
        await shot(main, `251-${src}-dive-inside`)
        await js(`(() => { const b = document.querySelector('.dv-session'); b && b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return !!b })()`)
        await wait(500)
        await shot(main, `252-${src}-dive-hover-session`)
        await js(clickSel('.dv-session'))
        await wait(2200)
        await shot(main, `253-${src}-dive-dialogue`)
        await js(`(() => { const b = document.querySelector('.dv-prompt'); b && b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return !!b })()`)
        await wait(700)
        await shot(main, `254-${src}-dive-pulse`)
        // a star inside: scan for one under the pointer and click it
        const star = await js(`(async () => {
          const c = document.querySelector('.galaxy-canvas'); const r = c.getBoundingClientRect()
          for (let y = r.height * 0.15; y < r.height * 0.85; y += 6) for (let x = r.width * 0.08; x < r.width * 0.55; x += 6) {
            const o = { clientX: r.left + x, clientY: r.top + y, bubbles: true }
            c.dispatchEvent(new MouseEvent('mousemove', o))
            await new Promise((d) => setTimeout(d, 3))
            if (document.querySelector('.galaxy-stage .starmap-tip')) { c.dispatchEvent(new MouseEvent('click', o)); return [Math.round(x), Math.round(y)] }
          }
          return null
        })()`)
        await log({ src, star })
        await wait(1800)
        await shot(main, `255-${src}-dive-star`)
        await js(`(() => { const b = document.querySelector('.dv-back'); b && b.click(); return !!b })()`)
        await wait(300)
        await js(`(() => { const b = document.querySelector('.dv-back'); b && b.click(); return !!b })()`)
        await wait(500)
        await shot(main, `256-${src}-dive-out`)
        await wait(1500)
      }
      await set({ sourceFilter: 'claude' })
    }
    if (!only || only === 'codex') {
      await set({ sourceFilter: 'codex' })
      await wait(2500)
      await js(click('概览'))
      await wait(3000)
      await js(scrollTo('.rate-card'))
      await wait(1800)
      await shot(main, '240-codex-rate')
      await js(scrollTo('.quota-row'))
      await wait(1800)
      await shot(main, '241-codex-quota')
      await js(click('星空'))
      await wait(3500)
      await shot(main, '242-codex-sky')
      await js(scrollTo('.sky-row'))
      await wait(1800)
      await shot(main, '243-codex-planets')
      await set({ sourceFilter: 'claude' })
      await wait(1500)
    }
    if (!only || only === 'rate') {
      await js(click('概览'))
      await wait(2500)
      await js(scrollTo('.rate-card'))
      await js(`document.querySelector('.main').scrollBy(0, -16)`)
      for (const k of [0, 1, 2]) {
        if (k) fakeUpdate(main, 2_000_000)
        await wait(1800)
        await shot(main, `230-rate-${k}`, await js(rectOf('.rate-card')))
      }
    }
    await set({ themePack: 'none', theme: 'system', backdrop: 'flow', accent: 'clay', sourceFilter: 'all' })
    done()
    return
  }

  // 2.8: the 昼夜 pack through a day, the overview's clock and race, the star map, quota surge and rewind, task compaction
  if (process.env.TP_SHOTS === 'v28') {
    const only = process.env.TP_SHOTS_ONLY ?? ''
    const { placeOf, sunTimes } = await import('@shared/astro')
    const place = placeOf(null)
    const st = sunTimes(Date.now(), place)
    const day = (at: number | null) => js(`(() => { window.__tpSetDay && window.__tpSetDay(${at === null ? 'null' : at}); return true })()`)
    await set({ sourceFilter: 'claude', motion: 'standard', glassCards: true, lightFx: true })
    await log({ place, rise: st.rise && new Date(st.rise).toString(), set: st.set && new Date(st.set).toString() })
    if (!only || only === 'day') {
      await set({ themePack: 'daylight', theme: 'dark', backdrop: 'daylight', accent: 'clay' })
      await js(click('概览'))
      await wait(400)
      await shot(main, '180-day-entrance')
      const H = 3600_000
      const moments: [string, number][] = [
        ['a-night', st.rise! - 3 * H],
        ['b-dawn', st.rise! - 22 * 60_000],
        ['c-sunrise', st.rise! + 8 * 60_000],
        ['d-morning', st.rise! + 90 * 60_000],
        ['e-noon', st.noon],
        ['f-golden', st.set! - 45 * 60_000],
        ['g-sunset', st.set! - 2 * 60_000],
        ['h-dusk', st.set! + 25 * 60_000],
        ['i-late', st.set! + 4 * H]
      ]
      for (const [name, at] of moments) {
        await day(at)
        await wait(2600)
        await shot(main, `181-day-${name}`)
        if (name === 'e-noon' || name === 'h-dusk') {
          fakeUpdate(main, 4_000_000)
          await wait(1500)
          await shot(main, `181-day-${name}-pulse`)
        }
      }
      // the sidebar clock plays the day as a time-lapse
      await day(null)
      await wait(1500)
      await js(clickSel('.day-clock'))
      for (const k of [1, 2, 3, 4, 5, 6]) {
        await wait(5000)
        await shot(main, `182-lapse-${k}`)
      }
      await js(clickSel('.day-clock'))
      await log({ fpsDay: await measureFps() })
      await day(st.set! - 30 * 60_000)
      await js(click('设置'))
      await wait(900)
      await clickSub('外观与动效')
      await wait(1500)
      await js(scrollTo('.packs'))
      await wait(900)
      await shot(main, '183-day-settings')
      await day(null)
    }
    if (!only || only === 'overview') {
      await set({ themePack: 'none', theme: 'dark', backdrop: 'galaxy', accent: 'clay' })
      await js(click('概览'))
      await wait(3000)
      await shot(main, '184-hero')
      await js(scrollTo('.day-ov-row'))
      await js(`document.querySelector('.main').scrollBy(0, -16)`)
      await wait(2200)
      await shot(main, '185-dial-race')
      await js(`(() => { const r = document.querySelectorAll('.dial-hit'); const el = r[${Math.max(0, new Date().getHours() - 3)}]; el && el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return r.length })()`)
      await wait(500)
      await shot(main, '185b-dial-hover')
      await js(`(() => { const b = [...document.querySelectorAll('.race-card button')].find((x) => x.textContent.trim() === '月'); b && b.click(); return !!b })()`)
      await wait(1800)
      await shot(main, '185c-race-month')
      await set({ theme: 'light', backdrop: 'flow' })
      await wait(2000)
      await js(scrollTo('.day-ov-row'))
      await js(`document.querySelector('.main').scrollBy(0, -16)`)
      await wait(1500)
      await shot(main, '186-light')
      await set({ theme: 'dark', backdrop: 'galaxy' })
      await wait(1000)
    }
    if (!only || only === 'sky') {
      await js(click('星空'))
      await wait(4000)
      await shot(main, '187-starmap')
      // find a star under the pointer
      const found = await js(`(async () => {
        const c = document.querySelector('.starmap-canvas'); if (!c) return 'no canvas'
        const r = c.getBoundingClientRect()
        for (let y = r.height * 0.3; y < r.height * 0.8; y += 7) for (let x = r.width * 0.55; x < r.width - 20; x += 7) {
          c.dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + x, clientY: r.top + y, bubbles: true }))
          await new Promise((d) => setTimeout(d, 4))
          if (document.querySelector('.starmap-tip')) return [Math.round(x), Math.round(y)]
        }
        return 'none'
      })()`)
      await wait(600)
      await log({ starHover: found })
      await shot(main, '188-starmap-hover')
      await js(`(() => { const i = document.querySelector('.starmap-search'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'test'); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
      await wait(1200)
      await shot(main, '189-starmap-search')
      await js(`(() => { const i = document.querySelector('.starmap-search'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
      await js(scrollTo('.starmap-lists'))
      await js(clickSel('.starmap-row'))
      await wait(400)
      await js(`document.querySelector('.main').scrollTo(0, 0)`)
      await wait(900)
      await shot(main, '190-starmap-flash')
      await js(click('7 天'))
      await wait(2500)
      await shot(main, '191-starmap-7d')
      await set({ themePack: 'daylight', theme: 'dark', backdrop: 'daylight' })
      await js(click('90 天'))
      await wait(3000)
      await shot(main, '192-starmap-90d-day')
      await set({ themePack: 'none', theme: 'dark', backdrop: 'galaxy' })
    }
    if (!only || only === 'quota') {
      await js(click('概览'))
      await wait(2500)
      const q0 = await js(`window.api.getQuota()`)
      const five = q0?.windows?.find((w: { key: string }) => w.key === 'session' || w.key === 'five_hour')
      await log({ quota: q0?.status, five: five && { u: five.utilization, r: five.resetsAt } })
      if (five) {
        const send = (u: number, resetsAt: string) => main.webContents.send('quota:update', { ...q0, windows: q0.windows.map((w: { key: string }) => (w === five || w.key === five.key ? { ...w, utilization: u, resetsAt } : w)) })
        const r0 = five.resetsAt ?? new Date(Date.now() + 2 * 3600_000).toISOString()
        send(58, r0)
        await wait(2500)
        send(71, r0)
        await wait(320)
        await shot(main, '193-quota-grow', await js(rectOf('.quota-card')))
        await wait(2000)
        // the window resets: it rewinds to zero and fills to the new reading
        send(3, new Date(Date.parse(r0) + 5 * 3600_000).toISOString())
        const t0 = Date.now()
        const box = await js(rectOf('.quota-card'))
        for (const [ms, name] of [
          [250, 'a'],
          [550, 'b'],
          [900, 'c'],
          [1180, 'd'],
          [1420, 'e'],
          [1800, 'f'],
          [2600, 'g']
        ] as const) {
          await wait(Math.max(0, ms - (Date.now() - t0)))
          await shot(main, `194-quota-rewind-${name}`, box)
        }
        main.webContents.send('quota:update', q0)
      }
    }
    if (!only || only === 'tasks') {
      await js(`localStorage.setItem('tp.task.draft', JSON.stringify({ prompt: '把测试里失败的用例修好，跑 npm test 确认全部通过', cwd: 'G:\\\\code\\\\demo', compact: { on: true, at: { unit: 'pct', value: 60 } }, more: false }))`)
      await js(click('任务'))
      await wait(2000)
      await js(scrollTo('.task-new'))
      await wait(900)
      await shot(main, '195-task-compact')
      await js(click('设置'))
      await wait(800)
      await clickSub('刷新任务')
      await wait(1400)
      await js(`(() => { const r = [...document.querySelectorAll('.set-sub')].find((x) => x.textContent === '上下文'); r && r.scrollIntoView({ block: 'center' }); return !!r })()`)
      await wait(800)
      await shot(main, '196-settings-compact')
      await js(`localStorage.removeItem('tp.task.draft')`)
    }
    await set({ themePack: 'none', theme: 'system', backdrop: 'flow', accent: 'clay', sourceFilter: 'all' })
    done()
    return
  }

  // 2.7: trial and error for tasks, editing, follow-ups; the overview's sky
  if (process.env.TP_SHOTS === 'v27') {
    const only = process.env.TP_SHOTS_ONLY ?? ''
    await set({ backdrop: 'galaxy', theme: 'dark', themePack: 'none', motion: 'standard', glassCards: true, sourceFilter: 'claude', guardEnabled: false, taskQueuePaused: false })
    await wait(2500)
    if (!only || only === 'overview') {
      await js(click('概览'))
      await wait(3000)
      await shot(main, '170-hero')
      await js(scrollTo('.solar-card'))
      await js(`document.querySelector('.main').scrollBy(0, -16)`)
      await wait(2000)
      await shot(main, '171-cosmos-row')
      const h = new Date().getHours()
      await js(`(() => { const r = document.querySelectorAll('.solar-hit'); const el = r[${Math.max(0, h - 2)}]; el && el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return r.length })()`)
      await wait(500)
      await shot(main, '171b-flare-hover')
      await js(click('30 天'))
      await wait(1500)
      await shot(main, '171c-redshift-30d')
      // what the new row costs: as it is, without the pulse, without the row
      await js(`document.querySelector('.main').scrollTo(0, 0)`)
      await wait(1200)
      const fps: number[] = []
      for (const css of ['', '.solar-flare.now { animation: none !important }', '.cosmos-ov-row { display: none !important }', '']) {
        await js(`(() => { let s = document.getElementById('tp-ab'); if (!s) { s = document.createElement('style'); s.id = 'tp-ab'; document.head.appendChild(s) } s.textContent = ${JSON.stringify(css)} })()`)
        await wait(1500)
        fps.push(await measureFps())
      }
      await js(`document.getElementById('tp-ab')?.remove()`)
      await log({ fpsOverview: fps })
      await set({ theme: 'light', backdrop: 'flow' })
      await wait(2000)
      await js(scrollTo('.solar-card'))
      await js(`document.querySelector('.main').scrollBy(0, -16)`)
      await wait(1500)
      await shot(main, '172-cosmos-light')
      await set({ theme: 'dark', backdrop: 'galaxy' })
      await wait(1500)
    }
    const svc = (globalThis as { __tpTasks?: import('./tasks').TaskService }).__tpTasks
    if (svc && (!only || only === 'tasks')) {
      // a stand-in for claude: the folder's name decides how each try goes
      const fake = join(dir, 'fake-claude-v27.cjs')
      await writeFile(
        fake,
        `const fs = require('fs'), path = require('path')
const a = process.argv.slice(2); const p = a[1] || ''
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
const ri = a.indexOf('--resume'); const resumed = ri >= 0 ? a[ri + 1] : null
const n = (fs.existsSync('n.txt') ? +fs.readFileSync('n.txt', 'utf8') : 0) + 1; fs.writeFileSync('n.txt', String(n))
const name = path.basename(process.cwd())
out({ type: 'system', subtype: 'init', model: 'claude-opus-5-5', cwd: process.cwd(), session_id: resumed || ('demo-' + name + '-' + n) })
const say = (t) => out({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } })
const tool = (c) => out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: c } }] } })
setTimeout(() => {
  say(n === 1 ? '先看看哪里出了问题' : '接着上次的进度：' + p.slice(0, 30))
  tool('npm test')
  // the fix: only a try told what the check said gets it right
  if (name === 'fix' && p.includes('没有通过检查')) fs.writeFileSync('ok.txt', '1')
  setTimeout(() => {
    const err = (t) => out({ type: 'result', subtype: 'error_during_execution', is_error: true, result: t, total_cost_usd: 0.12 })
    if (name === 'net' && n === 1) err('API Error: 529 {"type":"overloaded_error","message":"Overloaded"}')
    else if (name === 'limit' && n === 1) err('Claude AI usage limit reached|1760000000')
    else if (name === 'stuck') err('npm ERR! missing script: e2e')
    else out({ type: 'result', subtype: 'success', is_error: false, num_turns: 4, result: name === 'fix' ? '修好了 tests/quota.test.ts 里 2 个失败的用例（刷新并发、额度回退），npm test 全部通过。' : '完成：' + name + '，改动已经提交到工作区。', total_cost_usd: 0.42 })
  }, 700)
}, 400)`
      )
      const check = join(dir, 'check-v27.cjs')
      await writeFile(
        check,
        `if (require('fs').existsSync('ok.txt')) { console.log(' Test Files  12 passed (12)'); process.exit(0) }
console.log(' ❯ tests/quota.test.ts (8 tests | 2 failed)')
console.log('   × refresh races > keeps the newer reading')
console.log('     → expected 2 to be 1')
console.log('   × falls back to the local estimate')
console.log(' Test Files  1 failed | 11 passed (12)')
process.exit(1)`
      )
      svc.useCommand(() => ({ cmd: 'node', pre: [fake] }))
      ;(svc as unknown as { deps: { retryDelay?: () => number } }).deps.retryDelay = () => 1500
      const folder = async (name: string) => {
        const p = join(dir, 'v27', name)
        await mkdir(p, { recursive: true })
        await unlink(join(p, 'n.txt')).catch(() => {})
        await unlink(join(p, 'ok.txt')).catch(() => {})
        return p
      }
      for (const t of [...svc.tasks]) if (t.status !== 'running') await svc.action(t.id, 'remove')
      const go = async (input: Parameters<typeof svc.add>[0]) => {
        const t = svc.add(input)
        await svc.action(t.id, 'start')
        return t
      }
      await go({ prompt: '把 tests 里失败的用例修好，跑 npm test 确认全部通过', cwd: await folder('fix'), trigger: 'now', retries: 2, verify: `node "${check}"` })
      await go({ prompt: '升级依赖的补丁版本，构建并确认没有问题', cwd: await folder('net'), trigger: 'now', retries: 2, model: 'opus', fallbackModel: 'sonnet' })
      await go({ prompt: '给 quota 模块补齐单元测试，覆盖率到 90% 以上', cwd: await folder('limit'), trigger: 'now', retries: 1 })
      await go({ prompt: '跑一遍 e2e 测试并修掉失败的', cwd: await folder('stuck'), trigger: 'now', retries: 1, timeoutMin: 30 })
      svc.add({ prompt: '整理 README，补上刷新任务和试错重试的使用说明', cwd: await folder('docs'), trigger: 'reset', verify: 'npm run lint', retries: 1, effort: 'high' })
      await wait(9000)
      await log({ v27tasks: svc.tasks.map((t) => ({ p: t.prompt.slice(0, 8), s: t.status, tries: (t.attempts ?? []).map((a) => `${a.kind}:${a.ok ? 'ok' : (a.failure ?? '?')}`), pending: t.pending?.kind ?? null, note: t.note })) })
      await js(click('任务'))
      await wait(2500)
      await shot(main, '173-tasks-top')
      await js(scrollTo('.task-stats'))
      await wait(900)
      await shot(main, '174-tasks-list')
      await js(scrollTo('.task-history-head'))
      await wait(900)
      await shot(main, '174b-history')
      // the check's output on the task it was fixed in
      await js(`(() => { const b = [...document.querySelectorAll('.try-out')][0]; b && b.click(); return !!b })()`)
      await wait(700)
      await js(scrollTo('.try-tail'))
      await js(`document.querySelector('.main').scrollBy(0, -160)`)
      await wait(600)
      await shot(main, '175-check-output')
      // adjust the failed one, follow up the fixed one
      await js(`(() => { const c = [...document.querySelectorAll('.task-item.failed')][0]; const b = c && [...c.querySelectorAll('button')].find((x) => x.textContent.trim() === '调整'); b && b.click(); return !!b })()`)
      await wait(900)
      await js(scrollTo('.task-edit'))
      await js(`document.querySelector('.main').scrollBy(0, -140)`)
      await wait(600)
      await shot(main, '176-adjust')
      await js(`(() => { const c = [...document.querySelectorAll('.task-item.done')][0]; const b = c && [...c.querySelectorAll('button')].find((x) => x.textContent.trim() === '追问'); b && b.click(); return !!b })()`)
      await wait(900)
      await js(scrollTo('.task-follow'))
      await js(`document.querySelector('.main').scrollBy(0, -140)`)
      await wait(600)
      await shot(main, '177-follow-up')
      // the form, with its options open
      await js(`document.querySelector('.main').scrollTo(0, 0)`)
      await js(`(() => { const b = [...document.querySelectorAll('.task-more')][0]; b && b.click(); return !!b })()`)
      await wait(900)
      await shot(main, '178-form')
      await set({ theme: 'light', backdrop: 'flow' })
      await wait(1500)
      await js(scrollTo('.task-stats'))
      await wait(900)
      await shot(main, '179-tasks-light')
      for (const t of [...svc.tasks]) {
        if (t.status === 'running') await svc.action(t.id, 'stop')
        else await svc.action(t.id, 'remove')
      }
      await js(`localStorage.removeItem('tp.task.draft')`)
    }
    await set({ themePack: 'none', theme: 'system', backdrop: 'flow', accent: 'clay', sourceFilter: 'all' })
    done()
    return
  }

  // 2.6: six more packs
  if (process.env.TP_SHOTS === 'v26') {
    await set({ backdrop: 'flow', theme: 'light', themePack: 'none', motion: 'standard', glassCards: true, sourceFilter: 'claude' })
    await wait(2500)
    const packs = [
      ['lava', 'dark', 'sakura'],
      ['crystal', 'dark', 'ocean'],
      ['matrix', 'dark', 'mint'],
      ['fireworks', 'dark', 'clay'],
      ['lantern', 'dark', 'clay'],
      ['bauhaus', 'light', 'clay']
    ] as const
    for (const [pack, theme, accent] of packs) {
      await js(click('概览'))
      await wait(900)
      await set({ themePack: pack, theme, backdrop: pack, accent, glassCards: true })
      await wait(380)
      await shot(main, `160-${pack}-entrance`)
      await wait(3500)
      fakeUpdate(main, 3_000_000)
      await wait(1100)
      await shot(main, `161-${pack}-overview`)
      await log({ [`fps-${pack}`]: await measureFps() })
      await js(click('会话'))
      await wait(260)
      await shot(main, `162-${pack}-turn`)
      await wait(1500)
    }
    for (const [pack, theme] of [
      ['lava', 'light'],
      ['crystal', 'light'],
      ['matrix', 'light'],
      ['fireworks', 'light'],
      ['lantern', 'light'],
      ['bauhaus', 'dark']
    ] as const) {
      await set({ themePack: 'none', backdrop: pack, theme, accent: 'clay' })
      await wait(2600)
      await shot(main, `163-${pack}-${theme}`)
    }
    await set({ themePack: 'none', theme: 'light', backdrop: 'flow', accent: 'clay' })
    await js(`localStorage.setItem('tp.fold.packs', '1'); localStorage.setItem('tp.fold.backdrops', '1')`)
    await js(click('设置'))
    await wait(900)
    await clickSub('外观与动效')
    await wait(1600)
    await js(scrollTo('.packs'))
    await wait(900)
    await shot(main, '164-packs')
    await js(scrollTo('.bd-row, .fold-row:nth-of-type(2)'))
    await js(`(() => { const r = [...document.querySelectorAll('.bd-cat-name')].find((x) => x.textContent === '节庆'); r && r.scrollIntoView({ block: 'center' }); return !!r })()`)
    await wait(800)
    await shot(main, '165-backdrops')
    await js(`localStorage.removeItem('tp.fold.packs'); localStorage.removeItem('tp.fold.backdrops')`)
    await set({ themePack: 'none', theme: 'system', backdrop: 'flow', accent: 'clay', sourceFilter: 'all' })
    done()
    return
  }

  // 2.5: habitable zone, context black hole, project system, meteors, cosmic mix and year
  if (process.env.TP_SHOTS === 'v25') {
    await set({ backdrop: 'galaxy', theme: 'dark', themePack: 'none', motion: 'standard', glassCards: true, sourceFilter: 'all' })
    await wait(2500)
    await log({
      cosmos: await js(
        `window.api.getCosmos().then((c) => ({ projects: c.projects.map((p) => p.project + ':' + Math.round(p.tokens / 1e6) + 'M:' + p.sessions), meteors: c.meteors.length, zhr: c.zhr, calendar: c.calendar.events.map((e) => e.kind + ':' + e.title) }))`
      ),
      ach: await js(`window.api.getAchievements().then((a) => a.filter((x) => ['habitable-5','meteor-storm','dark-energy','eight-planets'].includes(x.id)).map((x) => x.id + ':' + (x.unlocked ? 'Y' : Math.round(x.progress * 100))))`)
    })
    await js(click('星空'))
    await wait(3500)
    const hover = (sel: string, i = 0) => js(`(() => { const r = document.querySelectorAll(${JSON.stringify(sel)}); const el = r[${i} < 0 ? r.length + ${i} : ${i}]; el && el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return r.length })()`)
    for (const [sel, name, hov] of [
      ['.hz-card', '150-habitable', '.hz-planet'],
      ['.ps-card', '151-projects', '.ps-row'],
      ['.ms-card', '152-meteors', '.ms-meteor'],
      ['.cm-card', '153-mix', ''],
      ['.cy-card', '155-year', '.cy-ev']
    ] as const) {
      await js(scrollTo(sel))
      await js(`document.querySelector('.main').scrollBy(0, -16)`)
      await wait(1800)
      await shot(main, name)
      if (hov) {
        await hover(hov, -1)
        await wait(600)
        await shot(main, `${name}-hover`)
      }
    }
    await set({ theme: 'light' })
    await wait(1500)
    await js(scrollTo('.hz-card'))
    await wait(1500)
    await shot(main, '154-light')
    await set({ themePack: 'none', theme: 'system', backdrop: 'flow', accent: 'clay', sourceFilter: 'all' })
    done()
    return
  }

  // 2.4: the quota sky, folding settings, tree rings and quota views, new achievements
  if (process.env.TP_SHOTS === 'v24') {
    const only = process.env.TP_SHOTS_ONLY ?? ''
    await set({ backdrop: 'galaxy', theme: 'dark', themePack: 'none', motion: 'standard', glassCards: true, sourceFilter: 'claude' })
    await wait(2500)
    await log({
      cosmos: await js(
        `window.api.getCosmos().then((c) => ({ stars: c.stars.map((s) => ({ key: s.key, pct: s.pct, stage: s.stage, rate: s.pctPerHour, fate: s.fate, next: s.next, week: s.week })), remnants: c.remnants.map((r) => r.kind + ':' + Math.round(r.peak)), sessions: c.sessions.length, classes: ['O','B','A','F','G','K','M'].map((k) => k + c.sessions.filter((s) => s.cls === k).length).join(' '), rates: c.sessions.slice(0, 8).map((s) => ({ t: s.tokens, m: s.minutes, r: s.rate, b: s.branch })), me: c.me }))`
      ),
      rates: await js(`window.api.getQuotaRates(7).then((r) => r.map((x) => ({ s: x.source, pct: Math.round(x.pct), tok: x.tokens, cur: x.current })))`),
      ach: await js(`window.api.getAchievements().then((a) => ({ n: a.length, done: a.filter((x) => x.unlocked).length, fresh: a.filter((x) => ['cosmos','collect'].includes(x.group) || x.kind === 'secret').map((x) => x.id + ':' + (x.unlocked ? 'Y' : Math.round(x.progress * 100))) }))`)
    })
    if (!only || only === 'sky') {
      await set({ sourceFilter: 'all' })
      await js(click('星空'))
      await wait(3500)
      await shot(main, '140-sky')
      await js(`(() => { const p = document.querySelector('.qs-star'); p && p.dispatchEvent(new MouseEvent('click', { bubbles: true })); return !!p })()`)
      await wait(250)
      await shot(main, '140b-star-boom', await js(rectOf('.qs-card')))
      await js(`(() => { const p = document.querySelector('.qs-planet'); p && p.dispatchEvent(new MouseEvent('click', { bubbles: true })); return !!p })()`)
      await wait(900)
      await shot(main, '140c-orbit', await js(rectOf('.qs-card')))
      await js(`document.querySelector('.main').scrollBy(0, 560)`)
      await wait(1500)
      await js(`(() => { const r = document.querySelectorAll('.rem-item'); const el = r[r.length - 1]; el && el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return r.length })()`)
      await wait(600)
      await shot(main, '141-remnants')
      await js(`document.querySelector('.main').scrollBy(0, 700)`)
      await wait(1200)
      await js(`(() => { const r = document.querySelectorAll('.hr-star'); const el = r[0]; el && el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return r.length })()`)
      await wait(500)
      await shot(main, '142-hr')
      await set({ theme: 'light' })
      await js(`document.querySelector('.main').scrollTo(0, 0)`)
      await wait(3000)
      await shot(main, '143-sky-all-light')
      await set({ theme: 'dark', sourceFilter: 'claude' })
    }
    if (!only || only === 'overview') {
      await js(click('概览'))
      await wait(2000)
      await js(scrollTo('.quota-viz-row'))
      await wait(2000)
      await shot(main, '144-quota-viz')
      await js(scrollTo('.rhythm-row'))
      await wait(2200)
      await js(`(() => { const r = document.querySelectorAll('.ring'); const el = r[r.length - 2]; el && el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return r.length })()`)
      await wait(500)
      await shot(main, '145-rings')
      await set({ theme: 'light', backdrop: 'flow', sourceFilter: 'all' })
      await wait(2000)
      await js(scrollTo('.quota-viz-row'))
      await wait(1800)
      await shot(main, '144b-quota-viz-all-light')
      await js(scrollTo('.rhythm-row'))
      await wait(1500)
      await shot(main, '145b-rings-light')
    }
    if (!only || only === 'settings') {
      await js(`localStorage.removeItem('tp.fold.packs'); localStorage.removeItem('tp.fold.backdrops')`)
      await js(click('设置'))
      await wait(900)
      await clickSub('外观与动效')
      await wait(1400)
      await shot(main, '146-settings-folded')
      await js(clickSel('.fold-head', 0))
      await wait(900)
      await shot(main, '146b-packs-open')
      await js(clickSel('.fold-head', 0))
      await wait(500)
    }
    if (!only || only === 'ach') {
      await js(click('成就'))
      await wait(3000)
      await js(scrollTo('.star-row'))
      await wait(2000)
      await shot(main, '147-ach-sky')
      await js(`(() => { const b = [...document.querySelectorAll('.wall-tab')].find((x) => x.textContent.includes('收藏')); b && b.click(); return !!b })()`)
      await wait(1000)
      await js(scrollTo('.ach-tabs'))
      await wait(800)
      await shot(main, '148-ach-collect')
      await js(`(() => { const b = [...document.querySelectorAll('.wall-tab')].find((x) => x.textContent.includes('隐藏')); b && b.click(); return !!b })()`)
      await wait(1000)
      await shot(main, '148b-ach-secret')
      await js(`(() => { const b = [...document.querySelectorAll('.wall-tab')].find((x) => x.textContent.includes('天体')); b && b.click(); return !!b })()`)
      await wait(1000)
      await shot(main, '148c-ach-cosmos')
    }
    await set({ themePack: 'none', theme: 'system', backdrop: 'flow', accent: 'clay', sourceFilter: 'all' })
    done()
    return
  }

  // 2.3: narrow settings, Claude / Codex signatures, celestial packs, sky page, new overview charts, palette
  if (process.env.TP_SHOTS === 'v23') {
    const only = process.env.TP_SHOTS_ONLY ?? ''
    await set({ backdrop: 'flow', theme: 'light', themePack: 'none', motion: 'standard', glassCards: true, sourceFilter: 'all' })
    await wait(2500)
    if (only === 'check') {
      await js(click('设置'))
      await wait(900)
      await clickSub('外观与动效')
      await wait(1200)
      await js(scrollTo('.pack-row'))
      await wait(800)
      await shot(main, '130-packs')
      await js(click('概览'))
      await wait(800)
      await js(clickSel('.rtab', 2))
      await wait(2000)
      await js(scrollTo('.flow-row'))
      await wait(2200)
      await shot(main, '131-journey', await js(rectOf('.journey-card')))
      for (const pack of ['firefly', 'rain'] as const) {
        await set({ themePack: pack, theme: 'dark', backdrop: pack, accent: pack === 'rain' ? 'clay' : 'mint' })
        await js(click('会话'))
        await wait(4500)
        await shot(main, `132-${pack}`)
      }
      await set({ themePack: 'codex', theme: 'dark', backdrop: 'codex', accent: 'wisteria', sourceFilter: 'codex' })
      await wait(2500)
      for (let i = 0; i < 2; i++) {
        fakeUpdate(main, 500_000)
        await wait(1100)
      }
      await shot(main, '133-codex-emblem', { x: 0, y: 300, width: 270, height: 520 })
      await set({ themePack: 'none', theme: 'system', backdrop: 'flow', accent: 'clay', sourceFilter: 'all' })
      done()
      return
    }
    if (!only || only === 'settings') {
      // a small window: the backdrop picker and the descriptions must not break
      main.setSize(960, 680)
      await wait(800)
      await js(click('设置'))
      await wait(900)
      await clickSub('外观与动效')
      await wait(1200)
      await js(scrollTo('.bd-row'))
      await wait(900)
      await shot(main, '120-settings-narrow-backdrops')
      await js(scrollTo('.pack-row'))
      await wait(700)
      await shot(main, '120b-settings-narrow-packs')
      await js(`document.querySelector('.main').scrollBy(0, 1500)`)
      await wait(700)
      await shot(main, '120c-settings-narrow-rows')
      main.setSize(1320, 880)
      await wait(900)
    }
    if (!only || only === 'emblem') {
      for (const [pack, accent] of [
        ['claude', 'clay'],
        ['codex', 'wisteria']
      ] as const) {
        await js(click('概览'))
        await wait(800)
        await set({ themePack: pack, theme: 'dark', backdrop: pack, accent, sourceFilter: pack })
        await wait(400)
        await shot(main, `121-${pack}-entrance`)
        await wait(3000)
        await shot(main, `121b-${pack}-idle`)
        for (let i = 0; i < 3; i++) {
          fakeUpdate(main, 400_000 + i * 250_000)
          await wait(1100)
        }
        await shot(main, `121c-${pack}-working`)
        await shot(main, `121d-${pack}-emblem`, { x: 0, y: 300, width: 260, height: 520 })
      }
    }
    if (!only || only === 'packs') {
      for (const pack of ['orrery', 'lunar', 'eclipse', 'trails', 'rain', 'firefly'] as const) {
        await js(click('概览'))
        await wait(800)
        await set({ themePack: pack, theme: 'dark', backdrop: pack, accent: { orrery: 'clay', lunar: 'ocean', eclipse: 'clay', trails: 'ocean', rain: 'clay', firefly: 'mint' }[pack], glassCards: true, sourceFilter: 'claude' })
        await wait(420)
        await shot(main, `122-${pack}-entrance`)
        await wait(3800)
        fakeUpdate(main, 1_500_000)
        await wait(900)
        await shot(main, `122b-${pack}-overview`)
        await log({ [`fps-${pack}`]: await measureFps() })
        await js(click('会话'))
        await wait(260)
        await shot(main, `122c-${pack}-turn`)
        await wait(1500)
      }
      for (const backdrop of ['orrery', 'lunar', 'eclipse', 'trails', 'rain', 'firefly'] as const) {
        await set({ themePack: 'none', backdrop, theme: 'light', accent: 'clay' })
        await wait(2600)
        await shot(main, `123-${backdrop}-light`)
      }
      await set({ themePack: 'none', backdrop: 'flow', theme: 'light', accent: 'clay' })
      await wait(1200)
    }
    if (!only || only === 'sky') {
      await set({ themePack: 'astral', theme: 'dark', backdrop: 'astral', accent: 'wisteria', sourceFilter: 'all' })
      await js(click('星空'))
      await wait(3500)
      await shot(main, '124-sky')
      await js(`document.querySelector('.main').scrollBy(0, 640)`)
      await wait(1500)
      await shot(main, '124b-sky-events')
      await js(`document.querySelector('.main').scrollBy(0, 900)`)
      await wait(1500)
      await shot(main, '124c-sky-usage')
      await log({ sky: await js(`window.api.getSkyUsage()`) })
      await js(clickSel('.sky-card .seg button', 2))
      await wait(900)
      await js(scrollTo('.sky-card'))
      await wait(600)
      await shot(main, '124d-sky-midnight', await js(rectOf('.sky-card')))
    }
    if (!only || only === 'overview') {
      await set({ themePack: 'none', theme: 'light', backdrop: 'flow', accent: 'clay', sourceFilter: 'all' })
      await js(click('概览'))
      await wait(1500)
      await js(clickSel('.rtab', 2))
      await wait(2500)
      await js(scrollTo('.rhythm-row'))
      await wait(1800)
      await shot(main, '125-rhythm-flow')
      await log({ patterns: await js(`window.api.getPatterns('30d').then((p) => ({ hours: p.hours.map((v) => Math.round(v / 1e6)), all: p.allTokens, avg: Math.round(p.dailyAvg), flows: p.flows.slice(0, 6) }))`) })
      await set({ theme: 'dark' })
      await wait(1500)
      await shot(main, '125b-rhythm-flow-dark')
      await set({ theme: 'light' })
    }
    if (!only || only === 'palette') {
      await js(click('概览'))
      await wait(800)
      await js(`document.dispatchEvent(new CustomEvent('tp-palette'))`)
      await wait(700)
      await shot(main, '126-palette')
      await js(`(() => { const i = document.querySelector('.pal-search input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'ztb'); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
      await wait(600)
      await shot(main, '126b-palette-search')
      await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))`)
      await wait(400)
    }
    await set({ themePack: 'none', theme: 'system', backdrop: 'flow', accent: 'clay', sourceFilter: 'all' })
    done()
    return
  }

  // 2.2: model colours, constellations, context judged by window, new and redone packs
  if (process.env.TP_SHOTS === 'v22') {
    await set({ backdrop: 'flow', theme: 'light', themePack: 'none', motion: 'standard', glassCards: true, sourceFilter: 'claude' })
    await wait(2500)
    // a short check of the latest fixes
    if (process.env.TP_SHOTS_ONLY === 'check') {
      await set({ sourceFilter: 'all' })
      await js(clickSel('.rtab', 2))
      await wait(2500)
      await js(scrollTo('.donut-wrap'))
      await wait(1500)
      await shot(main, '110-donut')
      await js(click('成就'))
      await wait(3000)
      await js(scrollTo('.star-row'))
      await wait(2500)
      await shot(main, '111-sky')
      await log({ sign: await js(`window.api.getSign().then((s) => ({ name: s.name, desc: s.desc, traits: s.traits }))`) })
      await set({ backdrop: 'dune', theme: 'dark', sourceFilter: 'claude' })
      await js(click('会话'))
      await wait(3000)
      await shot(main, '112-dune-dark')
      await set({ theme: 'system', backdrop: 'flow', sourceFilter: 'all' })
      done()
      return
    }
    await log({
      sign: await js(`window.api.getSign().then((s) => ({ name: s.name, traits: s.traits, zodiac: { name: s.zodiac.name, lit: s.zodiac.lit, stars: s.zodiac.stars, today: s.zodiac.today, avg: Math.round(s.zodiac.average) } }))`),
      alerts: await js(`window.api.getContextAlerts().then((a) => a.map((x) => ({ p: x.project, tokens: x.tokens, window: x.window, warnAt: x.warnAt, model: x.model })))`),
      sessions: await js(`window.api.getSessions().then((r) => r.slice(0, 8).map((x) => ({ p: x.project, ctx: x.context, window: x.window, warnAt: x.warnAt })))`)
    })
    await js(clickSel('.rtab', 2))
    await wait(2500)
    await js(scrollTo('.donut-wrap'))
    await wait(1500)
    await shot(main, '100-donut-claude')
    await set({ sourceFilter: 'all' })
    await wait(2500)
    await js(scrollTo('.donut-wrap'))
    await wait(1200)
    await shot(main, '100b-donut-all')
    await js(scrollTo('.zodiac-card'))
    await wait(1200)
    await shot(main, '101-zodiac-card')
    await js(click('成就'))
    await wait(3000)
    await js(scrollTo('.star-row'))
    await wait(2200)
    await shot(main, '102-constellations')
    await js(click('设置'))
    await wait(1000)
    await clickSub('失控与上下文')
    await wait(1200)
    await shot(main, '103-context-settings')
    const packs = [
      ['claude', 'dark', 'clay'],
      ['codex', 'dark', 'wisteria'],
      ['astral', 'dark', 'wisteria'],
      ['sakura', 'light', 'sakura'],
      ['dune', 'light', 'clay'],
      ['paper', 'light', 'clay']
    ] as const
    for (const [pack, theme, accent] of packs) {
      await js(click('概览'))
      await wait(1000)
      await set({ themePack: pack, theme, backdrop: pack, accent, glassCards: true, sourceFilter: pack === 'codex' ? 'codex' : 'claude' })
      await wait(320)
      await shot(main, `104-${pack}-entrance`)
      await wait(3500)
      fakeUpdate(main, 1_500_000)
      await wait(900)
      await shot(main, `105-${pack}-overview`)
      await log({ [`fps-${pack}`]: await measureFps() })
      await js(click('会话'))
      await wait(250)
      await shot(main, `106-${pack}-turn`)
      await wait(1600)
      await shot(main, `107-${pack}-sessions`)
    }
    // the dark versions of the light scenes
    for (const backdrop of ['sakura', 'dune', 'paper', 'astral'] as const) {
      await set({ themePack: 'none', backdrop, theme: backdrop === 'astral' ? 'light' : 'dark', accent: 'clay' })
      await wait(2800)
      await shot(main, `108-${backdrop}-${backdrop === 'astral' ? 'light' : 'dark'}`)
    }
    await js(click('设置'))
    await wait(800)
    await clickSub('外观与动效')
    await wait(1500)
    await shot(main, '109-packs')
    await set({ themePack: 'none', theme: 'system', backdrop: 'flow', accent: 'clay', sourceFilter: 'all' })
    done()
    return
  }

  // 2.1: settings per tool, task tree with drag and drop and subtasks, achievements page, pricing, Claude / Codex packs, transitions
  if (process.env.TP_SHOTS === 'v21') {
    const navTexts = () => js(`[...document.querySelectorAll('.nav-sub-label')].map((x) => x.textContent)`)
    await set({ backdrop: 'flow', theme: 'light', themePack: 'none', motion: 'standard', glassCards: true, sourceFilter: 'codex' })
    await wait(2500)
    await js(click('设置'))
    await wait(1500)
    await shot(main, '90-settings-codex')
    const groupsCodex = await navTexts()
    await clickSub('Codex 额度')
    await wait(1200)
    await shot(main, '90b-settings-codex-quota')
    await clickSub('刷新任务')
    await wait(1200)
    await shot(main, '90c-settings-codex-tasks')
    await set({ sourceFilter: 'claude' })
    await wait(1500)
    const groupsClaude = await navTexts()
    await shot(main, '91-settings-claude-tasks')
    await set({ sourceFilter: 'all' })
    await wait(1500)
    await log({ groupsCodex, groupsClaude, groupsAll: await navTexts() })
    await shot(main, '91b-settings-all-tasks')

    // the task tree
    const fake = join(dir, 'fake-cli.cjs')
    await writeFile(
      fake,
      `const p = process.argv.slice(2).find((a, i, all) => all[i - 1] === '-p') ?? 'codex'
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
out({ type: 'system', subtype: 'init', model: 'claude-opus-5-5', cwd: process.cwd(), session_id: 'demo-' + Date.now() })
let i = 0
const steps = [['thinking', '先看看 tests 目录里哪些用例失败，再决定从哪里改起'], ['Bash', 'npm test -- --reporter=dot'], ['Read', 'src/main/quota.ts'], ['text', '找到了：刷新时两个请求并发写同一个缓存'], ['Edit', 'src/main/quota.ts'], ['Bash', 'npm test']]
const t = setInterval(() => {
  const s = steps[i++]
  if (!s) { clearInterval(t); out({ type: 'result', subtype: 'success', is_error: false, num_turns: 6, result: '完成：' + p.slice(0, 20), total_cost_usd: 0.84 }); return }
  out({ type: 'assistant', message: { content: [s[0] === 'thinking' ? { type: 'thinking', thinking: s[1] } : s[0] === 'text' ? { type: 'text', text: s[1] } : { type: 'tool_use', name: s[0], input: s[0] === 'Bash' ? { command: s[1] } : { file_path: s[1] } }] } })
}, 450)`
    )
    const svc = (globalThis as { __tpTasks?: import('./tasks').TaskService }).__tpTasks
    if (svc) {
      svc.useCommand(() => ({ cmd: 'node', pre: [fake] }))
      const add = (input: object) => js(`window.api.addTask(${JSON.stringify(input)})`) as Promise<{ id: string }>
      const here = 'G:\\code\\tokenpulse2'
      const a = await add({ prompt: '把 tests 里失败的用例修好，跑一遍 npm test 确认全部通过', cwd: here, trigger: 'reset', continue: true })
      const b = await add({ prompt: '修好以后把这次的改动写进 CHANGELOG', cwd: here, trigger: 'reset', parentId: a.id, continue: true, autoCompact: false })
      await add({ prompt: '在 tokentracker 里同步同样的修复', cwd: 'G:\\code\\tokentracker', trigger: 'manual', parentId: b.id, continue: false })
      await add({ prompt: '审查一遍 quota 模块的并发问题，写一份报告', cwd: here, tool: 'codex', trigger: 'reset', permission: 'plan', continue: true })
      const e = await add({ prompt: '每晚检查依赖更新并给出升级建议', cwd: here, trigger: 'manual', repeat: true, permission: 'plan' })
      await js(click('任务'))
      await wait(3000)
      await shot(main, '92-tasks-tree')
      // drag the nightly task onto the first one: the "subtask" drop
      await js(`(() => {
        const items = [...document.querySelectorAll('.task-tree .task-item')]
        const src = items.find((x) => x.textContent.includes('每晚检查'))
        const dst = items.find((x) => x.textContent.includes('把 tests'))
        if (!src || !dst) return false
        window.__dt = new DataTransfer()
        src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.__dt }))
        const r = dst.getBoundingClientRect()
        setTimeout(() => dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__dt, clientX: r.x + 80, clientY: r.y + r.height / 2 })), 100)
        return true
      })()`)
      await wait(700)
      await shot(main, '92b-tasks-drag')
      await js(`(() => {
        const dst = [...document.querySelectorAll('.task-tree .task-item')].find((x) => x.textContent.includes('把 tests'))
        const r = dst.getBoundingClientRect()
        dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__dt, clientX: r.x + 80, clientY: r.y + r.height / 2 }))
      })()`)
      await wait(1200)
      await shot(main, '92c-tasks-dropped')
      await log({ nightlyParent: svc.tasks.find((t) => t.id === e.id)?.parentId === a.id })
      // run the first by hand: its subtask in the same folder follows
      await svc.action(a.id, 'start')
      await wait(1600)
      await shot(main, '93-tasks-running')
      await js(`[...document.querySelectorAll('.task-item.running button')].find((b) => b.textContent.trim() === '日志')?.click()`)
      await wait(1500)
      await shot(main, '93b-task-log')
      await wait(5000)
      await shot(main, '93c-tasks-chain')
      await log({
        tasks: svc.tasks.map((t) => ({ p: t.prompt.slice(0, 10), tool: t.tool, status: t.status, parent: !!t.parentId, sum: t.summary?.slice(0, 20) })),
        // finished tasks must not linger in the queue's flow
        queueNodes: await js(`[...document.querySelectorAll('.task-tree > .task-node')].map((n) => ({ text: n.textContent.slice(0, 14), op: getComputedStyle(n).opacity, pos: getComputedStyle(n).position }))`),
        visible: await js(`document.visibilityState`)
      })
      for (const t of [...svc.tasks]) {
        if (t.status === 'running') await svc.action(t.id, 'stop')
      }
      await wait(1500)
      for (const t of [...svc.tasks]) {
        if (t.status === 'queued') await svc.action(t.id, 'cancel')
        await svc.action(t.id, 'remove')
      }
    }
    if (process.env.TP_SHOTS_ONLY === 'tasks') {
      done()
      return
    }

    // achievements on their own page
    await js(click('成就'))
    await wait(3000)
    await shot(main, '94-achievements')
    await js(scrollTo('.ach-tabs'))
    await wait(800)
    await shot(main, '94b-achievements-grid')

    // pricing per tool
    await set({ sourceFilter: 'claude' })
    await js(click('定价'))
    await wait(2500)
    await shot(main, '95-pricing-claude')
    await set({ sourceFilter: 'codex' })
    await wait(2000)
    await shot(main, '95b-pricing-codex')
    await set({ sourceFilter: 'all' })
    await wait(1500)
    await shot(main, '95c-pricing-all')
    await log({ pricingRows: await js(`window.api.getPricing().then((p) => ({ rows: p.rows.length, retired: p.rows.filter((r) => r.status === 'retired').length, ids: p.rows.map((r) => r.id) }))`) })

    // the two new packs, their entrance and page turn
    for (const pack of ['claude', 'codex'] as const) {
      await js(click('概览'))
      await wait(1200)
      await set({ themePack: pack, theme: 'dark', backdrop: pack, accent: pack === 'codex' ? 'wisteria' : 'clay', glassCards: true, sourceFilter: pack })
      await wait(330)
      await shot(main, `96-${pack}-entrance`)
      await wait(3500)
      fakeUpdate(main, 1_500_000)
      await wait(650)
      await shot(main, `96b-${pack}-overview`)
      await log({ [`fps-${pack}`]: await measureFps() })
      await js(click('会话'))
      await wait(230)
      await shot(main, `96c-${pack}-pageturn`)
      await wait(1500)
      // light mode of the same backdrop
      await set({ themePack: 'none', theme: 'light', backdrop: pack })
      await wait(2500)
      await js(click('概览'))
      await wait(2000)
      await shot(main, `96d-${pack}-light`)
    }
    // every other backdrop's page turn, mid-flight
    const looks: Record<string, string> = { neon: 'dark', borealis: 'dark', ink: 'light', abyss: 'dark', stars: 'dark', ripples: 'light', paper: 'light', flow: 'light', aurora: 'light' }
    let flip = false
    for (const [backdrop, theme] of Object.entries(looks)) {
      await set({ themePack: 'none', backdrop, theme, sourceFilter: 'claude' })
      await wait(2200)
      flip = !flip
      await js(click(flip ? '会话' : '概览'))
      await wait(backdrop === 'paper' || backdrop === 'neon' ? 150 : 260)
      await shot(main, `97-turn-${backdrop}`)
      await wait(1200)
    }
    await js(click('设置'))
    await wait(1000)
    await clickSub('外观与动效')
    await wait(1500)
    await shot(main, '98-packs')
    await set({ themePack: 'none', theme: 'system', backdrop: 'flow', accent: 'clay', sourceFilter: 'all' })
    done()
    return
  }

  // 2.0: tools apart (Claude / Codex / 全部), prompts, context, window replay, packs, warp, launch, cosmos in the small windows
  if (process.env.TP_SHOTS === 'v2') {
    const { BrowserWindow: BW } = await import('electron')
    await set({ backdrop: 'galaxy', theme: 'dark', motion: 'standard', sourceFilter: 'claude', showMini: true, miniMode: 'card' })
    // the launch animation, replayed
    main.webContents.reload()
    await wait(650)
    await shot(main, '70-splash-a')
    await wait(500)
    await shot(main, '70-splash-b')
    await wait(1100)
    await shot(main, '70-splash-c')
    await wait(2500)
    await js(clickSel('.rtab', 0))
    await wait(2500)
    await shot(main, '71-claude')
    await set({ sourceFilter: 'codex' })
    await wait(3000)
    await shot(main, '72-codex')
    await set({ sourceFilter: 'all' })
    await wait(3000)
    await shot(main, '73-all')
    await shot(main, '73b-all-quota', await js(rectOf('.quota-card')))
    await log({
      prompts: await js(`window.api.getPrompts('7d').then((r) => ({ count: r.count, avg: r.avgCost, top: r.top.slice(0, 3).map((p) => ({ text: p.text.slice(0, 30), cost: p.cost, req: p.requests, src: p.source })), un: r.unattributedCost }))`),
      history: await js(`window.api.getWindowHistory(7).then((h) => ({ n: h.windows.length, summary: h.summary }))`),
      alerts: await js(`window.api.getContextAlerts()`),
      value: await js(`window.api.getValue('all').then((v) => ({ plan: v.plan, price: v.planPrice, multiple: v.multiple }))`)
    })
    await js(clickSel('.rtab', 1))
    await wait(2500)
    await js(scrollTo('.prompt-row'))
    await wait(2500)
    await shot(main, '74-prompts-replay')
    await js(clickSel('.prompt-item', 0))
    await wait(600)
    await shot(main, '74b-prompt-open', await js(rectOf('.prompts-card')))
    await js(clickSel('.lane-win', 0))
    await wait(1200)
    await shot(main, '74c-replay-mid', await js(rectOf('.replay-card')))
    await wait(2200)
    await shot(main, '74d-replay-end', await js(rectOf('.replay-card')))
    // a context alert, as the main process sends it
    const big = (await js(`window.api.getSessions().then((r) => r.slice().sort((a, b) => b.context - a.context)[0])`)) as { sessionId: string; project: string; context: number; source?: string } | null
    await js(`document.querySelector('.main').scrollTo(0, 0)`)
    if (big) main.webContents.send('context:alert', { sessionId: big.sessionId, project: big.project, source: big.source ?? 'claude', tokens: Math.max(big.context, 186_000), warnAt: 120_000, growthPerRequest: 2400, at: Date.now() })
    await wait(1200)
    await shot(main, '75-context-banner')
    // the session's context curve
    if (big) await js(`document.querySelectorAll('.ctx-banner .btn')[0]?.click()`)
    await wait(600)
    await shot(main, '76-warp-mid')
    await wait(2600)
    await shot(main, '77-session-context')
    // the task draft survives leaving the page
    await js(click('任务'))
    await wait(1200)
    await js(`(() => { const t = document.querySelector('.task-prompt'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, '整理 README 的安装步骤'); t.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    await wait(300)
    await js(click('会话'))
    await wait(1200)
    await js(click('任务'))
    await wait(1500)
    await log({ draftKept: await js(`document.querySelector('.task-prompt')?.value`) })
    await shot(main, '78-task-draft')
    await js(`(() => { const t = document.querySelector('.task-prompt'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, ''); t.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    // floating window and island under the cosmos
    if (mini && !mini.isDestroyed()) {
      fakeUpdate(mini, 800_000)
      await wait(900)
      await shot(mini, '79-mini-galaxy')
      await set({ miniMode: 'orb' })
      await wait(2200)
      fakeUpdate(mini, 900_000)
      await wait(800)
      await shot(mini, '79b-mini-blackhole')
      await set({ sourceFilter: 'codex', miniMode: 'card' })
      await wait(2200)
      await shot(mini, '79c-mini-codex')
      await set({ sourceFilter: 'all' })
    }
    await set({ island: true })
    await wait(3500)
    const island = BW.getAllWindows().find((w) => w.webContents.getURL().includes('#/island'))
    if (island) {
      await shot(island, '80-island-cosmic')
      island.webContents.sendInputEvent({ type: 'mouseMove', x: 230, y: 18 })
      await wait(1000)
      await shot(island, '80b-island-detail')
    }
    await set({ island: false })
    // big screen with the pace under the rings
    await js(`window.api.openStage()`)
    await wait(4500)
    const stage = BW.getAllWindows().find((w) => w.webContents.getURL().includes('#/stage'))
    if (stage) {
      await shot(stage, '81-stage')
      stage.close()
    }
    // theme packs
    await js(click('概览'))
    for (const pack of ['neon', 'borealis', 'ink', 'abyss'] as const) {
      const look = { neon: { theme: 'dark', backdrop: 'neon', accent: 'sakura' }, borealis: { theme: 'dark', backdrop: 'borealis', accent: 'mint' }, ink: { theme: 'light', backdrop: 'ink', accent: 'clay' }, abyss: { theme: 'dark', backdrop: 'abyss', accent: 'ocean' } }[pack]
      await set({ themePack: pack, glassCards: true, sourceFilter: 'claude', ...look })
      await wait(3000)
      fakeUpdate(main, 1_500_000)
      await wait(700)
      await shot(main, `82-pack-${pack}`)
      await log({ [`fps-${pack}`]: await measureFps() })
    }
    await js(click('设置'))
    await wait(1000)
    await clickSub('外观与动效')
    await wait(1500)
    await shot(main, '83-settings-packs')
    await set({ themePack: 'none', theme: 'system', backdrop: 'flow', accent: 'clay', sourceFilter: 'all', showMini: false })
    done()
    return
  }

  // Codex, quota pace, waste reminders and the cache doctor
  if (process.env.TP_SHOTS === 'v19') {
    await set({ backdrop: 'flow', theme: 'light', sourceFilter: 'all' })
    await js(clickSel('.rtab', 0))
    await wait(3000)
    await log({
      load: await js(`window.api.getLoadState().then((l) => ({ files: l.files, codexFiles: l.codexFiles, codexDirs: l.codexDirs }))`),
      codex: await js(`window.api.getCodexQuota()`),
      pace: await js(`window.api.getPace().then((ps) => ps.map((p) => ({ key: p.key, pct: Math.round(p.pct), ideal: Math.round(p.ideal), lead: Math.round(p.lead), projected: Math.round(p.projected), unused: Math.round(p.unused), eta: p.etaFull && new Date(p.etaFull).toLocaleString(), perHour: +p.pctPerHour.toFixed(2), points: p.curve.length })))`),
      cacheToday: await js(`window.api.getCacheReport('today').then((r) => ({ ...r, tips: r.tips.length }))`),
      cache7d: await js(`window.api.getCacheReport('7d').then((r) => ({ rebuilds: r.rebuilds, extra: r.extraCost, total: r.totalCost, gaps: r.gaps, hit: r.hitRate }))`)
    })
    await shot(main, '60-overview-all')
    const quotaRect = await js(rectOf('.quota-card'))
    await js(`[...document.querySelectorAll('.quota-card .seg button')].find((b) => b.textContent.trim() === 'Codex')?.click()`)
    await wait(1200)
    await shot(main, '60b-quota-codex', quotaRect)
    await js(scrollTo('.pace-row'))
    await wait(1500)
    await shot(main, '61-pace-cache')
    for (const label of ['Claude 7d', 'Codex 5h', 'Codex 7d']) {
      await js(`[...document.querySelectorAll('.pace-card .seg button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})?.click()`)
      await wait(900)
      await shot(main, `61-pace-${label.replace(' ', '-')}`, await js(rectOf('.pace-card')))
    }
    await js(clickSel('.rtab', 1))
    await wait(2000)
    await js(scrollTo('.pace-row'))
    await wait(800)
    await shot(main, '61e-cache-7d', await js(rectOf('.cache-card')))
    await js(`document.querySelector('.main').scrollTo(0, 0)`)
    await set({ sourceFilter: 'codex' })
    await wait(2500)
    await shot(main, '62-source-codex')
    await set({ sourceFilter: 'all' })
    // a waste reminder, as the main process sends it
    main.webContents.send('waste', { key: 'claude_5h', label: 'Claude 5 小时', source: 'claude', unused: 58, resetsAt: Date.now() + 24 * 60_000, startedTask: null })
    await wait(700)
    await shot(main, '63-waste-toast')
    await js(click('会话'))
    await wait(2000)
    await shot(main, '64-sessions')
    await js(click('设置'))
    await wait(800)
    await js(`[...document.querySelectorAll('.nav-sub')].find((x) => x.querySelector('.nav-sub-label')?.textContent === '订阅额度')?.click()`)
    await wait(1200)
    await js(`[...document.querySelectorAll('.set-label')].find((e) => e.textContent.startsWith('Codex'))?.scrollIntoView({ block: 'start' })`)
    await wait(700)
    await shot(main, '65-settings-codex')
    await js(click('概览'))
    await wait(500)
    done()
    return
  }

  // the cosmos backdrop's wonders: comet, supernova, the whole sky on the big screen
  if (process.env.TP_SHOTS === 'cosmos') {
    const { BrowserWindow: BW } = await import('electron')
    await set({ backdrop: 'galaxy', theme: 'dark', motion: 'standard', lightFx: true })
    await wait(3000)
    await shot(main, '50-cosmos-dark')
    await js(`document.dispatchEvent(new CustomEvent('tp-comet'))`)
    await wait(7000)
    await shot(main, '50b-comet')
    await js(`document.dispatchEvent(new CustomEvent('tp-nova'))`)
    await wait(700)
    await shot(main, '50c-nova-flash')
    await wait(1300)
    await shot(main, '50d-nova-shell')
    await log({ fpsCosmos: await measureFps() })
    await js(`window.api.openStage()`)
    await wait(4500)
    const stage = BW.getAllWindows().find((w) => w.webContents.getURL().includes('#/stage'))
    if (stage) {
      stage.webContents.on('render-process-gone', (_e, d) => void log({ stageGone: d }))
      stage.on('closed', () => void log({ stageClosed: true }))
      await shot(stage, '51-stage-dark')
      try {
        await set({ theme: 'light' })
        await wait(3000)
        await log({ stageAlive: !stage.isDestroyed() })
        if (!stage.isDestroyed()) {
          await shot(stage, '51b-stage-light')
          stage.close()
        }
      } catch (e) {
        await log({ stageError: String(e) })
      }
    }
    await wait(1500)
    await shot(main, '52-cosmos-light')
    await set({ theme: 'system', backdrop: 'flow' })
    done()
    return
  }

  // this round only: cosmos backdrop, light and token effects, settings tree, achievements
  if (process.env.TP_SHOTS === 'v18') {
    await js(clickSel('.rtab', 0))
    await set({ backdrop: 'galaxy', theme: 'dark', motion: 'standard', lightFx: true })
    await wait(3500)
    await shot(main, '40-galaxy-dark')
    await log({ fpsGalaxyDark: await measureFps() })
    fakeUpdate(main, 3_000_000)
    await wait(380)
    await shot(main, '40b-galaxy-pulse')
    await wait(500)
    await shot(main, '40c-token-fx', await js(rectOf('.grid-hero')))
    // a run of batches: the combo badge and per-tile "+N"
    for (let i = 0; i < 4; i++) {
      fakeUpdate(main, 120_000 + i * 50_000)
      await wait(900)
    }
    await wait(300)
    await shot(main, '40d-combo', await js(rectOf('.hero')))
    await set({ motion: 'rich' })
    main.webContents.sendInputEvent({ type: 'mouseMove', x: 1200, y: 200 })
    await wait(2500)
    await shot(main, '40e-galaxy-rich')
    await set({ motion: 'standard', theme: 'light' })
    await wait(3000)
    await shot(main, '41-galaxy-light')
    fakeUpdate(main, 2_000_000)
    await wait(420)
    await shot(main, '41b-light-pulse')
    await log({ fpsGalaxyLight: await measureFps() })

    // settings: groups as sub-items of 设置
    await js(click('设置'))
    await wait(1500)
    await shot(main, '42-settings-tree')
    await clickSub('灵动岛')
    await wait(1200)
    await shot(main, '42b-settings-island')
    await clickSub('通知与 Telegram')
    await set({ telegramEnabled: true })
    await wait(1200)
    await shot(main, '42c-settings-notify')
    await set({ telegramEnabled: false, theme: 'dark' })
    await clickSub('外观与动效')
    await wait(1500)
    await shot(main, '42d-settings-appearance-dark')

    // achievements: the wall, a group, and unlock celebrations
    await js(click('概览'))
    await wait(1500)
    await js(`document.dispatchEvent(new CustomEvent('tp-wall'))`)
    await wait(1500)
    await shot(main, '43-wall')
    await js(`[...document.querySelectorAll('.wall-tab')].find((b) => b.textContent.startsWith('守护'))?.click()`)
    await wait(900)
    await shot(main, '43b-wall-guardian')
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await wait(700)
    const list = (await js(`window.api.getAchievements()`)) as { tier: number }[]
    for (const tier of [4, 3]) {
      const a = list.find((x) => x.tier === tier)
      await js(`document.dispatchEvent(new CustomEvent('tp-celebrate', { detail: ${JSON.stringify({ ...a, unlocked: true })} }))`)
      await wait(tier === 4 ? 900 : 4600)
      await shot(main, `44-celebrate-tier${tier}`)
    }
    await wait(4200)
    await log({ achievements: list.length })
    await set({ theme: 'system', backdrop: 'flow' })
    done()
    return
  }

  await js(clickSel('.rtab', 0))
  await wait(2500)
  await shot(main, '01-today')
  // frame rate with the default effects (flow backdrop, glass cards) running
  const fps = await js(
    `new Promise((done) => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < 2000 ? requestAnimationFrame(f) : done(Math.round(n / 2)) }; requestAnimationFrame(f) })`
  )
  await log({ fps, settings: await js(`window.api.getSettings().then((s) => ({ backdrop: s.backdrop, glass: s.glassCards, motion: s.motion }))`) })

  // the eye-dropper mid-drip, and the ripples where the drops land
  fakeUpdate(main, 400_000)
  await wait(520)
  const tank = await js(rectOf('.tank-card'))
  await shot(main, '01a-drip', tank)
  await wait(420)
  await shot(main, '01b-ripples', tank)
  await wait(300)
  await shot(main, '01c-hero-pulse', await js(rectOf('.hero')))
  // a click: ripple + sparks
  main.webContents.sendInputEvent({ type: 'mouseDown', x: 700, y: 40, button: 'left', clickCount: 1 })
  main.webContents.sendInputEvent({ type: 'mouseUp', x: 700, y: 40, button: 'left', clickCount: 1 })
  await wait(160)
  await shot(main, '01d-click-sparks', { x: 600, y: 0, width: 200, height: 100 })
  await set({ motion: 'rich', backdropVivid: 1 })
  await wait(1500)
  await shot(main, '01e-vivid-rich')
  await set({ motion: 'standard', backdropVivid: 0.7 })

  await js(clickSel('.rtab', 1))
  await wait(2500)
  await shot(main, '02-7d')
  await js(scrollTo('.rate-card'))
  await wait(1500)
  await shot(main, '03-rate')
  await js(`document.querySelector('.main').scrollTo(0, 0)`)
  await js(clickSel('.rtab', 4))
  await wait(2500)
  await shot(main, '04-all')
  await js(`document.querySelector('.main').scrollTo(0, 99999)`)
  await wait(900)
  await shot(main, '05-all-bottom')

  await js(click('设置'))
  await wait(1500)
  await shot(main, '06-settings')
  await js(`[...document.querySelectorAll('.set-label')].find((e) => e.textContent === '悬浮窗')?.scrollIntoView({ block: 'center' })`)
  await wait(800)
  await shot(main, '06b-settings-mini')
  await set({ guardEnabled: true, quotaSource: 'auto' })
  await wait(2000)
  await js(scrollTo('.guard-info'))
  await wait(800)
  await shot(main, '07-guard-on')

  // the statusline bridge, fed the way Claude Code feeds it
  const bridgeDir = join(dir, 'claude', 'tokenpulse')
  const resets = Math.floor(Date.now() / 1000) + 83 * 60
  const feed = (pct: number) =>
    execFileSync('node', [join(bridgeDir, 'statusline.cjs')], {
      input: JSON.stringify({ session_id: 'demo', rate_limits: { five_hour: { used_percentage: pct, resets_at: resets }, seven_day: { used_percentage: 31, resets_at: resets + 4 * 86400 } } }),
      env: { ...process.env, TOKENPULSE_BRIDGE_DIR: bridgeDir },
      encoding: 'utf8'
    })
  await js(`window.api.installBridge(true)`)
  await wait(1000)
  await writeFile(join(dir, 'statusline-output.txt'), feed(72))
  await js(click('概览'))
  await wait(800)
  await js(`document.querySelector('.main').scrollTo(0, 0)`)
  await wait(6500)
  await shot(main, '08-statusline')

  // a fake paused task, owned by this (live) process so the scanner keeps it
  feed(91)
  const paused = join(bridgeDir, 'paused', 'demo.json')
  await mkdir(join(bridgeDir, 'paused'), { recursive: true })
  await writeFile(
    paused,
    JSON.stringify({ sessionId: 'demo-session', cwd: 'G:\\code\\tokenpulse2', since: Date.now() - 40 * 60_000, until: resets * 1000, pct: 91, pid: process.pid })
  )
  await wait(6500)
  await shot(main, '09-paused')
  if (mini) await shot(mini, '09-mini-paused')
  await unlink(paused).catch(() => {})
  await wait(4000)

  // backdrops, rich motion and a toast
  await set({ backdrop: 'ripples', motion: 'rich' })
  await wait(1500)
  fakeUpdate(main, 2_000_000)
  await js(`document.dispatchEvent(new CustomEvent('tp-toast', { detail: { kind: 'milestone', title: '今日突破 1 亿 Token', sub: '已用 100.42M tokens · $41.20' } }))`)
  await wait(700)
  await shot(main, '13-ripples-toast')
  await set({ backdrop: 'paper' })
  await wait(2000)
  await shot(main, '14-paper')

  // star river: a burst out of the hero spark, light and dark
  await set({ backdrop: 'stars', motion: 'standard' })
  await wait(2500)
  fakeUpdate(main, 3_000_000)
  await wait(450)
  await shot(main, '17-stars-burst')
  await set({ theme: 'dark' })
  await wait(2500)
  fakeUpdate(main, 3_000_000)
  await wait(700)
  await shot(main, '17b-stars-dark')
  await set({ theme: 'light', backdrop: 'flow' })

  // accent presets
  await set({ accent: 'ocean' })
  await wait(2500)
  await shot(main, '18-accent-ocean')
  await set({ accent: 'mint' })
  await js(click('设置'))
  await wait(2000)
  await shot(main, '18b-accent-mint-settings')
  await js(click('概览'))
  await set({ accent: 'clay' })
  await wait(1500)

  // 3D tank, overflowing once today's spend passes a small daily budget
  await set({ dailyBudget: 40 })
  await wait(3500)
  await shot(main, '19-overflow', await js(rectOf('.tank-card')))
  await set({ dailyBudget: null, theme: 'system' })
  await wait(1500)

  await js(`document.documentElement.dataset.theme = 'dark'`)
  await wait(2500)
  await shot(main, '10-dark')
  await js(scrollTo('.rate-card'))
  await wait(1200)
  await shot(main, '11-dark-rate')
  if (mini) await shot(mini, '12-mini')

  // insight cards, an achievement unlocking, the weekly poster
  await js(`document.querySelector('.main').scrollTo(0, 0)`)
  await js(scrollTo('.grid-3'))
  await wait(1800)
  const ach = (await js(`window.api.getAchievements()`)) as { id: string; unlocked: boolean }[]
  const sample = ach.find((a) => a.unlocked) ?? ach[0]
  main.webContents.send('achievement:new', [{ ...sample, unlocked: true }])
  await wait(500)
  await shot(main, '20-insights')
  await js(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '生成周报海报')?.click()`)
  await wait(2500)
  await shot(main, '21-poster-dialog')
  const poster = (await js(`document.querySelector('canvas.poster')?.toDataURL('image/png') ?? ''`)) as string
  if (poster) await writeFile(join(dir, '21b-poster.png'), Buffer.from(poster.split(',')[1], 'base64'))
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await wait(600)

  // settings: notifications (telegram box), guard rules, desktop
  await set({ telegramEnabled: true, guardWeeklyAt: 95, guardResumeFrom: '00:00', guardResumeTo: '08:00' })
  await js(click('设置'))
  await wait(1500)
  await js(scrollTo('.tg-box'))
  await wait(700)
  await shot(main, '22-settings-notify')
  await js(`[...document.querySelectorAll('.set-label')].find((e) => e.textContent === '7 天额度暂停线')?.scrollIntoView({ block: 'center' })`)
  await wait(600)
  await shot(main, '22b-settings-guard')
  await log({ hotkey: await js(`window.api.hotkeyStatus()`) })
  await set({ telegramEnabled: false })
  await js(click('概览'))
  await wait(800)

  // tray icon states, rendered the way the tray gets them
  const { nativeImage, BrowserWindow: BW } = await import('electron')
  const { trayBitmap } = await import('./trayIcon')
  for (const [name, look] of [
    ['tray-50', { pct: 50, angle: 0, paused: false }],
    ['tray-82-spin', { pct: 82, angle: 30, paused: false }],
    ['tray-95-paused', { pct: 95, angle: 0, paused: true }],
    ['tray-noquota', { pct: null, angle: 10, paused: false }]
  ] as const) {
    const img = nativeImage.createFromBitmap(trayBitmap(64, { ...look, accent: [217, 119, 87] }), { width: 64, height: 64 })
    await writeFile(join(dir, `23-${name}.png`), img.toPNG())
  }

  // refresh tasks, run by a stand-in for claude
  const fakeClaude = join(dir, 'fake-claude.cjs')
  await writeFile(
    fakeClaude,
    `const a = process.argv.slice(2); const p = a[1]; const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
out({ type: 'system', subtype: 'init', model: 'claude-opus-5-5', cwd: process.cwd() })
const steps = [['text', '先看看 tests 目录里哪些用例失败了'], ['Bash', 'npm test -- --reporter=dot'], ['Read', 'src/main/quota.ts'], ['Edit', 'src/main/quota.ts'], ['Bash', 'npm test']]
if (p.includes('FAIL')) { process.stderr.write('npm ERR! missing script: lint'); process.exit(1) }
let i = 0
const tick = () => {
  const s = steps[i++ % steps.length]
  out({ type: 'assistant', message: { content: [s[0] === 'text' ? { type: 'text', text: s[1] } : { type: 'tool_use', name: s[0], input: s[0] === 'Bash' ? { command: s[1] } : { file_path: s[1] } }] } })
  if (!p.includes('SLOW') && i >= steps.length) { out({ type: 'result', subtype: 'success', is_error: false, num_turns: 6, result: '修好了 2 个失败的用例（quota 刷新并发、额度回退），npm test 全部通过。没有改动其他文件。', total_cost_usd: 1.37 }); process.exit(0) }
}
setInterval(tick, p.includes('SLOW') ? 900 : 120)`
  )
  const svc = (globalThis as { __tpTasks?: import('./tasks').TaskService }).__tpTasks
  if (svc) {
    svc.useCommand(() => ({ cmd: 'node', pre: [fakeClaude] }))
    const add = (input: object) => js(`window.api.addTask(${JSON.stringify(input)})`) as Promise<{ id: string }>
    // the simulated 5h is past the guard line, so "now" tasks would wait; start them by hand like the button does
    const start = async (input: object) => {
      const t = await add(input)
      await svc.action(t.id, 'start')
    }
    await start({ prompt: '把 tests 里失败的用例修好，跑一遍 npm test 确认全部通过', cwd: 'G:\\code\\tokenpulse2', trigger: 'now' })
    await wait(2500)
    await start({ prompt: 'FAIL 跑一遍 lint 并修掉警告', cwd: 'G:\\code\\tokenpulse2', trigger: 'now', permission: 'acceptEdits' })
    await wait(2500)
    await start({ prompt: 'SLOW 给 quota 模块补齐单元测试，覆盖率到 90% 以上', cwd: 'G:\\code\\tokenpulse2', trigger: 'now', model: 'sonnet' })
    await add({ prompt: '整理 README，补上刷新任务和 Telegram 遥控的使用说明', cwd: 'G:\\code\\tokenpulse2', trigger: 'reset' })
    await add({ prompt: '每晚检查依赖更新并提交一份升级建议', cwd: 'G:\\code\\tokenpulse2', trigger: 'reset', repeat: true, permission: 'plan' })
    await js(click('任务'))
    await wait(4000)
    await shot(main, '30-tasks')
    await js(`[...document.querySelectorAll('.task-item.running button')].find((b) => b.textContent.trim() === '日志')?.click()`)
    await wait(2500)
    await shot(main, '30b-task-log')
    const running = svc.tasks.find((t) => t.status === 'running')
    if (running) await svc.action(running.id, 'stop')
    await log({ tasks: svc.tasks.map((t) => ({ prompt: t.prompt.slice(0, 12), status: t.status, cost: t.costUsd })) })
  }
  // settings: the refresh-task group from the sidebar tree
  await js(click('设置'))
  await wait(1200)
  await clickSub('刷新任务')
  await wait(1200)
  await shot(main, '31-settings-tasks')
  await js(click('概览'))
  await wait(800)

  // dynamic island: compact, an event springing it open, hovered details
  await set({ island: true, runawayDetect: true })
  await wait(3500)
  const island = BW.getAllWindows().find((w) => w.webContents.getURL().includes('#/island'))
  if (island) {
    await shot(island, '26-island-compact')
    fakeUpdate(island, 4_000_000)
    await wait(900)
    await shot(island, '26b-island-event')
    await wait(5000)
    island.webContents.sendInputEvent({ type: 'mouseMove', x: 230, y: 18 })
    await wait(900)
    await shot(island, '26c-island-detail')
    island.webContents.sendInputEvent({ type: 'mouseLeave', x: 5, y: 190 })
  }
  await log({ island: !!island })

  // a runaway session, as the detector would report it
  const alert = { sessionId: 'demo-runaway', project: 'tokenpulse2', kind: 'burst', cost5: 9.4, tokens5: 41_000_000, requests5: 18, ratio: 6.2, repeats: 2, at: Date.now(), held: false }
  for (const w of BW.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('runaway:update', [alert])
  await js(`document.querySelector('.main').scrollTo(0, 0)`)
  await wait(1200)
  await shot(main, '27-runaway')
  if (island) await shot(island, '27b-island-runaway')
  for (const w of BW.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('runaway:update', [])
  // a remote command arriving
  if (island) {
    await wait(7500)
    island.webContents.send('remote:command', { command: 'pause', reply: '⏸ 已暂停所有 Claude Code 任务' })
    await wait(700)
    await shot(island, '27c-island-remote')
  }
  // manual hold banner
  await js(`window.api.setManualHold(true)`)
  await wait(1500)
  await shot(main, '28-manual-hold')
  await js(`window.api.setManualHold(false)`)
  await set({ island: false })
  // settings for the new features
  await set({ telegramEnabled: true })
  await js(click('设置'))
  await wait(1500)
  await js(`[...document.querySelectorAll('.set-label')].find((e) => e.textContent === '失控检测')?.scrollIntoView({ block: 'start' })`)
  await wait(700)
  await shot(main, '29-settings-runaway')
  await set({ telegramEnabled: false })
  await js(click('概览'))
  await wait(800)

  // big screen
  await js(`window.api.openStage()`)
  await wait(4500)
  // the page's <title> replaces the window title, so find it by URL
  const stage = BW.getAllWindows().find((w) => w.webContents.getURL().includes('#/stage'))
  if (stage) {
    fakeUpdate(stage, 900_000)
    await wait(600)
    await shot(stage, '24-stage')
    stage.close()
  }
  await log({ stage: !!stage })
  await wait(800)

  // live wallpaper behind the desktop icons (briefly)
  await set({ wallpaper: true })
  await wait(5000)
  const wall = BW.getAllWindows().find((w) => w.webContents.getURL().includes('#/wallpaper'))
  if (wall) await shot(wall, '25-wallpaper')
  await set({ wallpaper: false })
  await wait(1500)
  await log({ wallpaperWindowAfterOff: BW.getAllWindows().some((w) => w.webContents.getURL().includes('#/wallpaper')) })

  if (mini && !mini.isDestroyed()) {
    // each floating-window mode, after the window has resized
    for (const mode of ['capsule', 'orb'] as const) {
      await set({ miniMode: mode })
      await wait(1800)
      fakeUpdate(mini, 600_000)
      await wait(mode === 'orb' ? 700 : 400)
      await shot(mini, `15-mini-${mode}`)
      await log({ mode, bounds: mini.getBounds() })
    }
    await set({ miniMode: 'orb', miniScale: 1.25 })
    await wait(1500)
    await shot(mini, '16-mini-orb-large')
    await log({ mode: 'orb@1.25', bounds: mini.getBounds() })

    // edge docking: drop it near the right edge, then let it hide while the pointer is away
    await set({ miniMode: 'card', miniScale: 1, miniEdgeHide: true })
    await wait(800)
    const wa = screen.getDisplayMatching(mini.getBounds()).workArea
    const b = mini.getBounds()
    mini.setPosition(wa.x + wa.width - b.width + 6 - 18, wa.y + 300)
    mini.emit('moved')
    await wait(700)
    await log({ step: 'snapped', bounds: mini.getBounds(), workArea: wa })
    await wait(2600)
    await log({ step: 'hidden', bounds: mini.getBounds(), cursor: screen.getCursorScreenPoint() })
    await set({ miniEdgeHide: false })
    await wait(800)
    await log({ step: 'edge-hide off', bounds: mini.getBounds() })
  }
  done()
}
