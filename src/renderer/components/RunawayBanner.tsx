import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { fmtTokens } from '@shared/format'
import type { RunawayAlert } from '@shared/types'
import { useApp } from '../state'

/** Sessions burning far faster than usual (or looping), with hold / resume / dismiss */
export function RunawayBanner() {
  const { money } = useApp()
  const [list, setList] = useState<RunawayAlert[]>([])
  useEffect(() => {
    void window.api.getRunaway().then(setList)
    return window.api.onRunaway(setList)
  }, [])
  return (
    <AnimatePresence>
      {list.map((r) => (
        <motion.div
          key={r.sessionId}
          className="runaway"
          initial={{ opacity: 0, height: 0, marginBottom: 0 }}
          animate={{ opacity: 1, height: 'auto', marginBottom: 12 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="runaway-in">
            <span className="runaway-icon">{r.kind === 'loop' ? '↻' : '⚠'}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="guard-title">
                会话「{r.project || r.sessionId.slice(0, 8)}」{r.kind === 'loop' ? '疑似陷入循环' : '消耗异常'}
                {r.held && <span className="badge accent">已暂停</span>}
              </div>
              <div className="guard-sub">
                {r.kind === 'loop'
                  ? `连续 ${r.repeats} 次输出完全相同的响应，可能卡在同一个失败的操作上`
                  : `最近 5 分钟 ${money(r.cost5)} · ${fmtTokens(r.tokens5, 1)} tokens · ${r.requests5} 次响应${r.ratio ? `，是你平时高强度时的 ${r.ratio.toFixed(1)} 倍` : ''}`}
              </div>
            </div>
            {r.held ? (
              <button className="btn small" onClick={() => void window.api.releaseSessions(r.sessionId)}>
                继续运行
              </button>
            ) : (
              <button className="btn primary small" onClick={() => void window.api.holdSession(r.sessionId)}>
                暂停这个会话
              </button>
            )}
            <button className="btn ghost small" onClick={() => window.api.dismissRunaway(r.sessionId)}>
              忽略
            </button>
          </div>
        </motion.div>
      ))}
    </AnimatePresence>
  )
}
