import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { PACK_KEYS, PACKS } from '@shared/packs'
import type { MotionLevel, Settings, SourceView, ThemePack, ThemeSetting } from '@shared/types'
import { BACKDROPS, useSettingsGroups } from '../pages/SettingsPage'
import { resolveTheme, useApp } from '../state'

interface Item {
  id: string
  group: string
  label: string
  hint?: string
  /** extra words to match: pinyin initials, English */
  keys?: string
  run: () => void
}

/** applies a theme pack: colours, backdrop, theme and fonts in one go */
export function applyPack(k: ThemePack, save: (p: Partial<Settings>) => void): void {
  const p = PACKS[k]
  const d = document.documentElement.dataset
  if (k === 'none') delete d.pack
  else d.pack = k
  d.theme = resolveTheme(p.theme)
  d.accent = p.accent
  save({ themePack: k, theme: p.theme, backdrop: p.backdrop, accent: p.accent, ...(k === 'none' ? {} : { glassCards: true }) })
}

const nav = (to: string) => document.dispatchEvent(new CustomEvent('tp-nav', { detail: to }))

/**
 * Ctrl+K: jump to any page or settings group, switch packs, backdrops, the
 * tool on view, the theme or the motion level, and run the common actions.
 */
export function CommandPalette({ pages }: { pages: { id: string; label: string; key: string; keys: string }[] }) {
  const { settings, saveSettings, setQuota, guard } = useApp()
  const groups = useSettingsGroups()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    const onOpen = () => setOpen(true)
    addEventListener('keydown', onKey)
    document.addEventListener('tp-palette', onOpen)
    return () => {
      removeEventListener('keydown', onKey)
      document.removeEventListener('tp-palette', onOpen)
    }
  }, [])
  useEffect(() => {
    if (!open) return
    setQ('')
    setSel(0)
    setTimeout(() => input.current?.focus(), 30)
  }, [open])

  const items = useMemo<Item[]>(() => {
    if (!settings) return []
    const save = (p: Partial<Settings>) => saveSettings(p)
    const out: Item[] = []
    for (const p of pages) out.push({ id: `page-${p.id}`, group: '页面', label: p.label, hint: `Ctrl+${p.key}`, keys: p.keys, run: () => nav(p.id) })
    for (const g of groups) out.push({ id: `set-${g.id}`, group: '设置', label: `设置 · ${g.title}`, hint: g.summary, keys: 'sz settings', run: () => nav(`settings:${g.id}`) })
    for (const k of PACK_KEYS) {
      out.push({ id: `pack-${k}`, group: '主题包', label: `主题包 · ${PACKS[k].label}`, hint: settings.themePack === k ? '正在使用' : PACKS[k].entrance, keys: `ztb theme pack ${k}`, run: () => applyPack(k, save) })
    }
    for (const b of BACKDROPS) out.push({ id: `bd-${b.value}`, group: '背景', label: `背景 · ${b.label}`, hint: settings.backdrop === b.value ? '正在使用' : undefined, keys: `bj backdrop ${b.value}`, run: () => save({ backdrop: b.value }) })
    const tools: [SourceView, string][] = [
      ['claude', '只看 Claude'],
      ['codex', '只看 Codex'],
      ['all', '全部工具']
    ]
    for (const [v, l] of tools) out.push({ id: `src-${v}`, group: '切换', label: l, hint: settings.sourceFilter === v ? '当前' : undefined, keys: `qh source ${v}`, run: () => save({ sourceFilter: v }) })
    const themes: [ThemeSetting, string][] = [
      ['light', '浅色主题'],
      ['dark', '深色主题'],
      ['system', '主题跟随系统']
    ]
    for (const [v, l] of themes) out.push({ id: `th-${v}`, group: '切换', label: l, keys: `zt theme ${v}`, run: () => save({ theme: v }) })
    const motions: [MotionLevel, string][] = [
      ['off', '动效：关闭'],
      ['subtle', '动效：柔和'],
      ['standard', '动效：标准'],
      ['rich', '动效：华丽']
    ]
    for (const [v, l] of motions) out.push({ id: `mo-${v}`, group: '切换', label: l, hint: settings.motion === v ? '当前' : undefined, keys: `dx motion ${v}`, run: () => save({ motion: v }) })
    out.push(
      { id: 'act-mini', group: '操作', label: settings.showMini ? '隐藏悬浮窗' : '显示悬浮窗', hint: 'Ctrl+M', keys: 'xfc mini', run: () => window.api.toggleMini() },
      { id: 'act-stage', group: '操作', label: '大屏模式', hint: 'F11', keys: 'dp stage', run: () => window.api.openStage() },
      { id: 'act-quota', group: '操作', label: '刷新额度', hint: 'F5', keys: 'sxed quota refresh', run: () => void window.api.refreshQuota().then(setQuota) },
      { id: 'act-task', group: '操作', label: '新建任务', keys: 'xjrw task new', run: () => nav('tasks') },
      {
        id: 'act-hold',
        group: '操作',
        label: guard?.manualHold ? '恢复所有 Claude Code 任务' : '暂停所有 Claude Code 任务',
        keys: 'zt hf pause resume hold',
        run: () => void window.api.setManualHold(!guard?.manualHold)
      },
      { id: 'act-daynight', group: '操作', label: settings.dayNight ? '关闭日出日落自动换主题' : '开启日出日落自动换主题', keys: 'rcrl daynight', run: () => save({ dayNight: !settings.dayNight }) }
    )
    if (settings.telegramEnabled) out.push({ id: 'act-report', group: '操作', label: '立即发送晚报到 Telegram', keys: 'wb report telegram', run: () => void window.api.sendReport() })
    return out
  }, [settings, groups, pages, guard?.manualHold]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return items.filter((i) => i.group === '页面' || i.group === '操作' || i.id === `pack-${settings?.themePack}`)
    return items.filter((i) => {
      const hay = `${i.label} ${i.keys ?? ''} ${i.hint ?? ''}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
  }, [q, items, settings?.themePack])
  useEffect(() => setSel(0), [q])
  useEffect(() => {
    list.current?.querySelector('.pal-item.on')?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const run = (i: Item | undefined) => {
    if (!i) return
    setOpen(false)
    window.api.bumpCounter('palette')
    // after the palette has gone, so reveals and transitions play over the page
    setTimeout(i.run, 60)
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="pal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => setOpen(false)}>
          <motion.div
            className="pal"
            initial={{ opacity: 0, y: -14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 520, damping: 36 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="pal-search">
              <span className="pal-icon">⌕</span>
              <input
                ref={input}
                value={q}
                placeholder="搜索页面、设置、主题包、背景或操作…（支持拼音首字母，如 ztb）"
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') setSel((s) => Math.min(shown.length - 1, s + 1))
                  else if (e.key === 'ArrowUp') setSel((s) => Math.max(0, s - 1))
                  else if (e.key === 'Enter') run(shown[sel])
                  else if (e.key === 'Escape') setOpen(false)
                  else return
                  e.preventDefault()
                }}
              />
              <kbd>Esc</kbd>
            </div>
            <div className="pal-list" ref={list}>
              {shown.length ? (
                shown.map((i, k) => (
                  <div key={i.id}>
                    {(k === 0 || shown[k - 1].group !== i.group) && <div className="pal-group">{i.group}</div>}
                    <button className={`pal-item${k === sel ? ' on' : ''}`} onMouseEnter={() => setSel(k)} onClick={() => run(i)}>
                      <span>{i.label}</span>
                      {i.hint && <em>{i.hint}</em>}
                    </button>
                  </div>
                ))
              ) : (
                <div className="pal-empty">没有找到「{q}」</div>
              )}
            </div>
            <div className="pal-foot">
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd> 选择
              </span>
              <span>
                <kbd>Enter</kbd> 执行
              </span>
              <span>
                <kbd>Ctrl</kbd>
                <kbd>K</kbd> 随时打开
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
