import { useEffect, useState } from 'react'
import { frameStats, type FrameStats } from '../frames'

const NAMES: Record<string, string> = {
  scene: '背景场景',
  flow: '流光',
  galaxy: '星系',
  stars: '星空',
  ripples: '涟漪',
  tank: '能量罐',
  monitor: '心电图',
  pulse: '速率曲线',
  gauge: '速率表盘',
  mark: '标志',
  hole: '黑洞',
  sky: '星图'
}

/**
 * A small meter in the corner: how many frames the backdrop drew in the last
 * second, the slowest frame, the share of animation frames that came late
 * (what shows as a stutter), and on hover each animation with its rate and
 * cost.
 */
export function FpsMeter() {
  const [m, setM] = useState<{ fps: number; worst: number; late: number; stats: FrameStats } | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let raf = 0
    let prev = 0
    let n = 0
    let worst = 0
    let late = 0
    let hz = 60
    let t0 = performance.now()
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (prev) {
        const gap = now - prev
        n++
        worst = Math.max(worst, gap)
        // a frame that took half a refresh longer than it should have
        if (gap > 1.5 * (1000 / hz)) late++
      }
      prev = now
      if (now - t0 >= 1000) {
        const stats = frameStats()
        hz = stats.refresh
        setM({ fps: Math.round((n * 1000) / (now - t0)), worst, late: n ? late / n : 0, stats })
        n = 0
        worst = 0
        late = 0
        t0 = now
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  if (!m) return null
  const scene = m.stats.loops.find((l) => l.name === 'scene') ?? [...m.stats.loops].sort((a, b) => b.runs - a.runs)[0]
  // smooth means the animations got their turns on time; the page's own frames may skip a refresh without anything showing it
  const miss = m.stats.missed
  const tone = miss > 0.05 || m.worst > 60 ? 'bad' : miss > 0.01 || m.worst > 40 ? 'meh' : 'good'
  return (
    <div className={`fps-meter ${tone}${open ? ' open' : ''}`} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <span className="fps-main">
        <b>{scene ? scene.runs : m.fps}</b>
        <small>帧 · {m.stats.refresh}Hz</small>
      </span>
      <span className="fps-sub">
        最慢 {m.worst.toFixed(0)}ms · 掉帧 {(miss * 100).toFixed(miss > 0 && miss < 0.01 ? 1 : 0)}%
        {m.stats.quality > 0 && ` · 背景 ${m.stats.quality === 1 ? '80' : '65'}%`}
      </span>
      {open && (
        <span className="fps-list">
          <span>
            页面 {m.fps} 帧/秒 · 晚到 {(m.late * 100).toFixed(0)}%
          </span>
          {m.stats.loops.map((l, i) => (
            <span key={i}>
              {NAMES[l.name] ?? (l.name || '动画')} {l.runs} 帧 · {l.cost.toFixed(1)}ms
            </span>
          ))}
        </span>
      )}
    </div>
  )
}
