import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { Achievement, RangeSummary } from '@shared/types'
import { cssVar, useApp } from '../state'
import { IconClose } from './Icons'
import { SPARK_CORE, STATIC_PATHS } from './Starburst'

const W = 1080
const H = 1440
const SERIF = "'Source Serif 4 Variable', 'Microsoft YaHei UI', serif"
const SANS = "'Segoe UI Variable Text', 'Microsoft YaHei UI', sans-serif"
const WEEK = '日一二三四五六'

const cn = (n: number) => (n >= 1e8 ? `${(n / 1e8).toFixed(2)} 亿` : n >= 1e4 ? `${(n / 1e4).toFixed(n >= 1e7 ? 0 : 1)} 万` : String(Math.round(n)))
const md = (t: number) => `${new Date(t).getMonth() + 1}/${new Date(t).getDate()}`

function spark(c: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  c.save()
  c.translate(x, y)
  c.scale(size / 2.24, size / 2.24)
  c.fillStyle = color
  c.beginPath()
  c.arc(0, 0, SPARK_CORE, 0, Math.PI * 2)
  c.fill()
  for (const d of STATIC_PATHS) c.fill(new Path2D(d))
  c.restore()
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath()
  c.roundRect(x, y, w, h, r)
}

/** Draws the weekly report onto a 1080×1440 canvas */
async function draw(canvas: HTMLCanvasElement, s: RangeSummary, ach: Achievement[], money: (n: number) => string) {
  await document.fonts.ready
  canvas.width = W
  canvas.height = H
  const c = canvas.getContext('2d')!
  const accent = cssVar('--accent') || '#d97757'
  const hi = cssVar('--accent-hi') || '#f3c08f'

  // night sky with glowing colour fields
  c.fillStyle = '#141318'
  c.fillRect(0, 0, W, H)
  const blob = (x: number, y: number, r: number, col: string, a: number) => {
    const g = c.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, col)
    g.addColorStop(1, 'transparent')
    c.globalAlpha = a
    c.fillStyle = g
    c.fillRect(x - r, y - r, r * 2, r * 2)
  }
  c.globalCompositeOperation = 'lighter'
  blob(180, 160, 620, accent, 0.5)
  blob(980, 520, 560, '#7e62c8', 0.35)
  blob(200, 1180, 640, '#3f7fcb', 0.3)
  blob(900, 1350, 520, hi, 0.28)
  c.globalAlpha = 1
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 180; i++) {
    c.globalAlpha = 0.15 + rnd() * 0.5
    c.fillStyle = '#ffffff'
    c.beginPath()
    c.arc(rnd() * W, rnd() * H, rnd() * 1.6 + 0.3, 0, Math.PI * 2)
    c.fill()
  }
  c.globalAlpha = 1
  c.globalCompositeOperation = 'source-over'

  // header
  spark(c, 118, 132, 92, accent)
  c.fillStyle = '#faf9f5'
  c.font = `600 46px ${SERIF}`
  c.fillText('TokenPulse', 182, 128)
  c.font = `400 28px ${SANS}`
  c.fillStyle = 'rgba(250,249,245,0.7)'
  c.fillText('本周 Claude Code 用量报告', 184, 172)
  c.textAlign = 'right'
  c.font = `500 30px ${SANS}`
  c.fillText(`${md(s.start)} – ${md(Math.min(s.end - 1, Date.now()))}`, W - 80, 128)
  c.font = `400 22px ${SANS}`
  c.fillStyle = 'rgba(250,249,245,0.45)'
  c.fillText(`生成于 ${new Date().toLocaleDateString('zh-CN')}`, W - 80, 170)
  c.textAlign = 'left'

  // hero number
  const t = s.totals
  c.fillStyle = 'rgba(250,249,245,0.65)'
  c.font = `500 32px ${SANS}`
  c.fillText('7 天总用量', 80, 300)
  const grad = c.createLinearGradient(80, 330, 900, 470)
  grad.addColorStop(0, '#ffffff')
  grad.addColorStop(0.6, hi)
  grad.addColorStop(1, accent)
  c.fillStyle = grad
  c.font = `500 168px ${SERIF}`
  const big = cn(t.tokens)
  c.fillText(big, 72, 470)
  const bw = c.measureText(big).width
  c.font = `400 44px ${SERIF}`
  c.fillStyle = 'rgba(250,249,245,0.75)'
  c.fillText('Token', 90 + bw, 470)
  c.font = `500 36px ${SANS}`
  c.fillStyle = accent
  c.fillText(`API 等价 ${money(t.cost)}`, 82, 540)

  // seven days of bars
  const days = s.buckets.slice(-7)
  const max = Math.max(...days.map((d) => d.tokens), 1)
  const top = days.reduce((a, b) => (b.tokens > a.tokens ? b : a), days[0])
  const bx = 80
  const by = 900
  const slot = (W - 160) / 7
  days.forEach((d, i) => {
    const h = Math.max(6, (d.tokens / max) * 260)
    const x = bx + i * slot + slot * 0.18
    const w = slot * 0.64
    const g = c.createLinearGradient(0, by - h, 0, by)
    g.addColorStop(0, d === top ? hi : accent)
    g.addColorStop(1, d === top ? accent : `${accent}40`)
    c.fillStyle = g
    roundRect(c, x, by - h, w, h, 14)
    c.fill()
    c.textAlign = 'center'
    c.fillStyle = d === top ? '#faf9f5' : 'rgba(250,249,245,0.55)'
    c.font = `${d === top ? 600 : 400} 26px ${SANS}`
    c.fillText(`周${WEEK[new Date(d.t).getDay()]}`, x + w / 2, by + 44)
    if (d === top && d.tokens > 0) {
      c.font = `600 28px ${SANS}`
      c.fillStyle = hi
      c.fillText(`最忙 ${cn(d.tokens)}`, x + w / 2, by - h - 18)
    }
  })
  c.textAlign = 'left'

  // stats grid
  const model = s.byModel[0]?.name ?? '—'
  const active = days.filter((d) => d.tokens > 0).length
  const stats: [string, string][] = [
    ['响应次数', t.messages.toLocaleString('en-US')],
    ['会话', String(t.sessions)],
    ['活跃天数', `${active} / 7`],
    ['缓存命中率', s.cacheUnreported ? '未知（日志缺少缓存字段）' : `${(s.cacheHitRate * 100).toFixed(1)}%`],
    ['缓存省下', money(t.costParts.cacheSavings)],
    ['最常用模型', model]
  ]
  stats.forEach(([label, value], i) => {
    const col = i % 3
    const row = Math.floor(i / 3)
    const x = 80 + col * 316
    const y = 1010 + row * 150
    c.fillStyle = 'rgba(255,255,255,0.07)'
    roundRect(c, x, y, 288, 124, 22)
    c.fill()
    c.strokeStyle = 'rgba(255,255,255,0.12)'
    c.stroke()
    c.fillStyle = 'rgba(250,249,245,0.6)'
    c.font = `400 24px ${SANS}`
    c.fillText(label, x + 24, y + 42)
    c.fillStyle = '#faf9f5'
    c.font = `500 ${value.length > 10 ? 30 : 40}px ${SERIF}`
    c.fillText(value, x + 24, y + 96, 248)
  })

  // badges
  const got = ach.filter((a) => a.unlocked).slice(0, 9)
  c.fillStyle = 'rgba(250,249,245,0.6)'
  c.font = `400 24px ${SANS}`
  c.fillText(got.length ? `已解锁成就 ${ach.filter((a) => a.unlocked).length} / ${ach.length}` : '还没有解锁成就', 80, 1338)
  got.forEach((a, i) => {
    const x = 104 + i * 104
    const y = 1384
    const g = c.createLinearGradient(x - 30, y - 30, x + 30, y + 30)
    g.addColorStop(0, hi)
    g.addColorStop(1, accent)
    c.fillStyle = g
    c.beginPath()
    c.arc(x, y, 30, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = '#1b1a1f'
    c.font = `700 ${a.icon.length > 1 ? 22 : 30}px ${SANS}`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(a.icon, x, y + 1)
    c.textAlign = 'left'
    c.textBaseline = 'alphabetic'
  })
}

export function PosterDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { money } = useApp()
  const ref = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!open) return
    setReady(false)
    setMsg('')
    let alive = true
    void Promise.all([window.api.getSummary('7d'), window.api.getAchievements()]).then(async ([s, a]) => {
      if (!alive || !ref.current) return
      await draw(ref.current, s, a, money)
      if (alive) setReady(true)
    })
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', esc)
    return () => {
      alive = false
      removeEventListener('keydown', esc)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const name = `TokenPulse 周报 ${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}`
  const save = async () => {
    const path = await window.api.savePoster(ref.current!.toDataURL('image/png'), name)
    if (path) setMsg(`已保存到 ${path}`)
  }
  const copy = async () => {
    await window.api.copyPoster(ref.current!.toDataURL('image/png'))
    setMsg('已复制到剪贴板')
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            className="poster-box"
            initial={{ y: 30, scale: 0.94, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 20, scale: 0.96, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
          >
            <canvas ref={ref} className={`poster${ready ? ' ready' : ''}`} />
            <div className="poster-actions">
              <button className="btn primary" disabled={!ready} onClick={save}>
                保存 PNG
              </button>
              <button className="btn" disabled={!ready} onClick={copy}>
                复制图片
              </button>
              <span className="muted poster-msg">{msg}</span>
              <button className="btn ghost" onClick={onClose} title="关闭">
                <IconClose />
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
