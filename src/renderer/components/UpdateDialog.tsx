import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { parseMarkdown, withoutSections } from '@shared/markdown'
import type { UpdateState } from '@shared/types'
import { useIntroDone, useUpdate } from '../state'
import { IconClose } from './Icons'
import { Markdown } from './Markdown'

export const APP_ICON = new URL('../../../resources/icon.png', import.meta.url).href

/** asks the main window's update dialog to open (sidebar pill, settings) */
export const openUpdateDialog = () => document.dispatchEvent(new CustomEvent('tp-update'))

const mb = (bytes: number) => `${(bytes / 1048576).toFixed(bytes >= 100 * 1048576 ? 0 : 1)} MB`

function dateOf(t: number): string {
  const d = new Date(t)
  return d.toLocaleDateString('zh-CN', d.getFullYear() === new Date().getFullYear() ? { month: 'long', day: 'numeric' } : { year: 'numeric', month: 'long', day: 'numeric' })
}

const HOW: Record<UpdateState['kind'], string> = {
  portable: '下载后校验 SHA-256，原地替换当前的 exe 并重新打开，快捷方式和开机自启都不受影响',
  installer: '下载后校验 SHA-256，静默安装新版本并重新打开',
  dev: '开发版不会自动安装，可以到发布页下载'
}

// little sparks drifting in the header: left %, top %, size px, delay s
const SPARKS = [
  [8, 22, 9, 0],
  [21, 70, 6, 1.4],
  [47, 16, 7, 0.7],
  [63, 64, 10, 2.1],
  [78, 26, 6, 1.1],
  [90, 58, 8, 0.3],
  [36, 46, 5, 2.6]
]

/**
 * The new-version dialog: opens when a check finds a release (every launch,
 * or 检查更新 in settings), shows its notes as Markdown, and on 立即更新
 * downloads, verifies and restarts into it in one go.
 */
export function UpdateDialog() {
  const u = useUpdate()
  const intro = useIntroDone()
  const [open, setOpen] = useState(false)
  // the user asked to update: restart as soon as the download is verified
  const [want, setWant] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const was = useRef<UpdateState['status'] | null>(null)

  useEffect(() => {
    const before = was.current
    was.current = u?.status ?? null
    if (u?.status === 'available' && before !== 'available') setOpen(true)
  }, [u?.status])

  useEffect(() => {
    const show = () => setOpen(true)
    document.addEventListener('tp-update', show)
    return () => document.removeEventListener('tp-update', show)
  }, [])

  useEffect(() => {
    if (!open || !want || u?.status !== 'ready' || restarting) return
    setRestarting(true)
    // a beat for the "verified" tick to show before the window goes
    const t = setTimeout(() => void window.api.updateInstall().then((ok) => !ok && setRestarting(false)), 900)
    return () => clearTimeout(t)
  }, [open, want, u?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    if (restarting) return
    setOpen(false)
    setWant(false)
  }

  useEffect(() => {
    if (!open || restarting) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      setWant(false)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [open, restarting])

  const notes = useMemo(() => withoutSections(parseMarkdown(u?.latest?.notes ?? ''), /^(下载|验证|校验)$/), [u?.latest?.notes])

  const latest = u?.latest
  const shown = open && intro && !!u && !!latest
  const canInstall = !!u && u.kind !== 'dev' && !(u.status === 'available' && u.error)
  const progress = Math.round((u?.progress ?? 0) * 100)

  const start = () => {
    setWant(true)
    if (u?.status === 'ready') return
    void window.api.updateDownload()
  }

  return (
    <AnimatePresence>
      {shown && (
        <motion.div className="modal upd-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close}>
          <motion.div
            className="upd-box"
            role="dialog"
            aria-label={`TokenPulse ${latest.version} 更新`}
            initial={{ y: 40, scale: 0.92, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 24, scale: 0.96, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="upd-hero">
              <span className="upd-aura" aria-hidden />
              {SPARKS.map(([x, y, s, d], k) => (
                <i key={k} className="upd-spark" style={{ left: `${x}%`, top: `${y}%`, width: s, height: s, animationDelay: `${d}s` }} aria-hidden />
              ))}
              <motion.div className="upd-icon" initial={{ scale: 0.5, rotate: -20, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ delay: 0.12, type: 'spring', stiffness: 260, damping: 16 }}>
                <span className="upd-icon-ring" aria-hidden />
                <img src={APP_ICON} alt="" draggable={false} />
              </motion.div>
              <div className="upd-head">
                <motion.span className="upd-eyebrow" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}>
                  {u.status === 'ready' ? '✓ 新版本已就绪' : '✦ 发现新版本'}
                </motion.span>
                <motion.h2 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }}>
                  TokenPulse <em>{latest.version}</em>
                </motion.h2>
                <motion.div className="upd-meta" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.32 }}>
                  <span className="upd-ver">{u.current}</span>
                  <span className="upd-arrow" aria-hidden />
                  <span className="upd-ver new">{latest.version}</span>
                  {latest.publishedAt > 0 && <span className="upd-dot">{dateOf(latest.publishedAt)}发布</span>}
                  {!!latest.size && <span className="upd-dot">{mb(latest.size)}</span>}
                </motion.div>
              </div>
              <button className="upd-close" onClick={close} title="关闭（Esc）" disabled={restarting}>
                <IconClose />
              </button>
            </div>

            <div className="upd-body">
              {notes.length ? <Markdown blocks={notes} className="upd-notes" /> : <div className="upd-empty">这个版本没有写更新说明</div>}
            </div>

            <div className="upd-foot">
              {u.status === 'downloading' || u.status === 'ready' || restarting ? (
                <div className={`upd-progress${u.status === 'ready' ? ' done' : ''}`}>
                  <div className="upd-progress-text">
                    <span>{restarting ? '已校验，正在重启到新版本…' : u.status === 'ready' ? '已下载并通过 SHA-256 校验' : `正在下载${latest.size ? ` ${mb(((u.progress ?? 0) * latest.size) | 0)} / ${mb(latest.size)}` : '…'}`}</span>
                    <b>{u.status === 'ready' ? '✓' : `${progress}%`}</b>
                  </div>
                  <div className="upd-track">
                    <i style={{ transform: `scaleX(${u.status === 'ready' ? 1 : Math.max(0.02, u.progress ?? 0)})` }} />
                  </div>
                </div>
              ) : (
                <div className={`upd-how${u.status === 'error' || u.error ? ' bad' : ''}`}>
                  {!(u.status === 'error' || u.error) && (
                    <svg viewBox="0 0 16 16" aria-hidden>
                      <path d="M8 1.6 2.8 3.5v4.1c0 3.1 2.2 5.8 5.2 6.8 3-1 5.2-3.7 5.2-6.8V3.5L8 1.6Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                      <path d="m5.6 8 1.7 1.7 3.2-3.3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  <span>{u.status === 'error' || u.error ? u.error : HOW[u.kind]}</span>
                </div>
              )}
              <div className="upd-actions">
                {u.status === 'downloading' ? (
                  <>
                    <button className="btn" onClick={close}>
                      后台下载
                    </button>
                    <button className="btn primary" disabled>
                      <span className="upd-spin" aria-hidden />
                      {want ? '下载完自动重启' : '下载中'}
                    </button>
                  </>
                ) : restarting ? (
                  <button className="btn primary" disabled>
                    <span className="upd-spin" aria-hidden />
                    正在重启
                  </button>
                ) : u.status === 'ready' ? (
                  <>
                    <button className="btn" onClick={close}>
                      稍后
                    </button>
                    <button className="btn primary upd-go" onClick={start} autoFocus>
                      重启并更新
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn ghost" onClick={() => void window.api.openExternal(latest.page)} title={latest.page}>
                      在 GitHub 查看
                    </button>
                    <button className="btn" onClick={close}>
                      稍后
                    </button>
                    {canInstall ? (
                      <button className="btn primary upd-go" onClick={start} autoFocus>
                        {u.status === 'error' ? '重试' : '立即更新'}
                      </button>
                    ) : (
                      <button className="btn primary upd-go" onClick={() => void window.api.openExternal(latest.page)}>
                        前往下载页
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
