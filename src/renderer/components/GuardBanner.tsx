import { AnimatePresence, motion } from 'motion/react'
import { clock, countdown, useApp, useNow } from '../state'

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p

/** Shown while the quota guard is holding Claude Code tasks */
export function GuardBanner() {
  const { guard } = useApp()
  const now = useNow(1000)
  const paused = guard?.paused ?? []
  const until = paused.find((p) => p.until)?.until ?? null
  const since = paused.length ? Math.min(...paused.map((p) => p.since)) : now
  const progress = until ? Math.min(1, Math.max(0, (now - since) / Math.max(1, until - since))) : 0

  const manual = !!guard?.manualHold
  return (
    <AnimatePresence>
      {manual && paused.length === 0 && (
        <motion.div
          key="manual"
          className="guard-banner"
          initial={{ opacity: 0, height: 0, marginBottom: 0 }}
          animate={{ opacity: 1, height: 'auto', marginBottom: 16 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="guard-banner-in manual">
            <span className="guard-pause-icon" aria-hidden>
              <i />
              <i />
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="guard-title">已暂停所有 Claude Code 任务</div>
              <div className="guard-sub">正在运行的任务会在下一次工具调用时停住等待；新提问也会等待</div>
            </div>
            <button className="btn primary" onClick={() => void window.api.setManualHold(false)}>
              恢复任务
            </button>
          </div>
        </motion.div>
      )}
      {paused.length > 0 && (
        <motion.div
          className="guard-banner"
          initial={{ opacity: 0, height: 0, marginBottom: 0 }}
          animate={{ opacity: 1, height: 'auto', marginBottom: 16 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="guard-banner-in">
            <span className="guard-pause-icon" aria-hidden>
              <i />
              <i />
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="guard-title">
                已暂停 {paused.length} 个 Claude Code 任务 ·{' '}
                {paused.every((p) => p.reason === 'manual')
                  ? '手动 / 远程暂停'
                  : paused.every((p) => p.reason === 'window')
                    ? '额度已重置，等待设定的续跑时段'
                    : `${paused.some((p) => p.reason === 'week') ? '7 天' : '5h'} 额度 ${Math.round(Math.max(...paused.map((p) => p.pct)))}%`}
              </div>
              <div className="guard-sub">
                {until ? `将在 ${clock(until)} 自动继续` : '额度回落到阈值以下后自动继续'}
                {' · '}
                {paused.map((p) => base(p.cwd) || p.sessionId.slice(0, 8)).join('、')}
              </div>
              <div className="guard-progress">
                <motion.div className="guard-progress-fill" animate={{ width: `${progress * 100}%` }} transition={{ duration: 0.9, ease: 'linear' }} />
              </div>
            </div>
            {until && (
              <div className="guard-count">
                <span className="tnum">{countdown(until, now)}</span>
                <small>后恢复</small>
              </div>
            )}
            {(manual || paused.some((p) => p.reason === 'manual')) && (
              <button className="btn primary" onClick={() => void window.api.setManualHold(false).then(() => window.api.releaseSessions())}>
                恢复任务
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
