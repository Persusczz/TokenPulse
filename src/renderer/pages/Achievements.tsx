import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import type { Achievement, AchievementGroup } from '@shared/types'
import { PosterDialog } from '../components/Poster'
import { PulseRings } from '../components/PulseRings'
import { AchievementSky, SignCard } from '../components/Stars'
import { useData } from '../state'

const TIER_NAME = ['', '铜', '银', '金', '传说']
const GROUP_NAME: Record<AchievementGroup, string> = {
  volume: '用量',
  streak: '坚持',
  time: '时段',
  efficiency: '效率与花费',
  sessions: '会话',
  explore: '探索',
  guardian: '守护',
  cosmos: '天体',
  collect: '收藏'
}
const GROUP_ICON: Record<AchievementGroup, string> = { volume: '◆', streak: '🔥', time: '☾', efficiency: '$', sessions: '❖', explore: '✦', guardian: '⛨', cosmos: '✶', collect: '◈' }

/** a secret badge shows nothing until it is earned */
const masked = (a: Achievement) => a.kind === 'secret' && !a.unlocked
const titleOf = (a: Achievement) => (masked(a) ? '隐藏成就' : a.title)
const descOf = (a: Achievement) => (masked(a) ? '继续用下去，也许某一刻就会遇到它' : a.desc)

const dateText = (t: number) => new Date(t).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })

function Badge({ a, fresh, size = 'md' }: { a: Achievement; fresh: boolean; size?: 'md' | 'lg' }) {
  const deg = Math.round(a.progress * 360)
  return (
    <div
      className={`ach tier-${a.tier}${a.unlocked ? ' on' : ''}${fresh ? ' fresh' : ''}${masked(a) ? ' secret' : ''} big${size === 'lg' ? ' huge' : ''}`}
      title={`${titleOf(a)} · ${TIER_NAME[a.tier]}\n${descOf(a)}`}
    >
      <span className="ach-ring" style={{ ['--deg' as string]: `${a.unlocked ? 360 : masked(a) ? 0 : deg}deg` }}>
        {fresh && <PulseRings trigger={1} />}
        <span className={`badge-glyph${a.unlocked ? ' unlocked' : ''}`}>{masked(a) ? '?' : a.icon}</span>
      </span>
    </div>
  )
}

/** The big ring: share of badges earned */
function TotalRing({ done, total }: { done: number; total: number }) {
  const R = 58
  const C = 2 * Math.PI * R
  const p = total ? done / total : 0
  return (
    <div className="ach-total">
      <svg viewBox="0 0 140 140">
        <defs>
          <linearGradient id="ach-total-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--accent-hi, var(--accent))" />
            <stop offset="1" stopColor="var(--accent)" />
          </linearGradient>
        </defs>
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="11" />
        <motion.circle
          cx="70"
          cy="70"
          r={R}
          fill="none"
          stroke="url(#ach-total-g)"
          strokeWidth="11"
          strokeLinecap="round"
          strokeDasharray={C}
          initial={{ strokeDashoffset: C }}
          animate={{ strokeDashoffset: C * (1 - p) }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          style={{ transform: 'rotate(-90deg)', transformOrigin: '70px 70px' }}
        />
      </svg>
      <div className="ach-total-in">
        <b className="serif tnum">{Math.round(p * 100)}%</b>
        <small>
          {done} / {total}
        </small>
      </div>
    </div>
  )
}

/** Every badge, by group, with how far along each locked one is */
export function AchievementsPage() {
  const list = useData(() => window.api.getAchievements(), [], 120_000)
  const [tab, setTab] = useState<AchievementGroup | 'all' | 'locked' | 'secret'>('all')
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const [poster, setPoster] = useState(false)
  useEffect(
    () =>
      window.api.onAchievement((a) => {
        setFresh(new Set(a.map((x) => x.id)))
        setTimeout(() => setFresh(new Set()), 5000)
      }),
    []
  )
  const all = list ?? []
  const done = all.filter((a) => a.unlocked)
  const recent = useMemo(() => [...done].sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, 6), [list]) // eslint-disable-line react-hooks/exhaustive-deps
  const next = useMemo(() => all.filter((a) => !a.unlocked && !masked(a)).sort((a, b) => b.progress - a.progress || a.tier - b.tier).slice(0, 3), [list]) // eslint-disable-line react-hooks/exhaustive-deps
  const groups = Object.keys(GROUP_NAME) as AchievementGroup[]
  const shown = all.filter((a) => (tab === 'all' ? true : tab === 'locked' ? !a.unlocked : tab === 'secret' ? a.kind === 'secret' : a.group === tab))
  const secrets = all.filter((a) => a.kind === 'secret')
  const tally = [1, 2, 3, 4].map((t) => ({ t, n: done.filter((a) => a.tier === t).length, of: all.filter((a) => a.tier === t).length }))

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">成就殿堂</h1>
          <div className="page-sub">
            {list
              ? `已解锁 ${done.length} / ${all.length} · 隐藏成就 ${secrets.filter((a) => a.unlocked).length} / ${secrets.length}${recent[0]?.at ? ` · 最近一枚：${recent[0].title}（${dateText(recent[0].at)}）` : ''}`
              : '正在统计…'}
          </div>
        </div>
        <button className="btn" onClick={() => setPoster(true)}>
          生成海报
        </button>
      </div>

      {list && (
        <div className="ach-hero">
          <div className="card ach-hero-total">
            <TotalRing done={done.length} total={all.length} />
            <div className="ach-tally">
              {tally.map((x) => (
                <div key={x.t} className={`ach-tier-row tier-${x.t}`}>
                  <span className="tier-dot" />
                  <span className="ach-tier-name">{TIER_NAME[x.t]}</span>
                  <span className="ach-tier-bar">
                    <motion.i initial={{ width: 0 }} animate={{ width: `${x.of ? (x.n / x.of) * 100 : 0}%` }} transition={{ duration: 0.9, delay: 0.1 * x.t, ease: [0.16, 1, 0.3, 1] }} />
                  </span>
                  <span className="tnum muted">
                    {x.n}/{x.of}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="card ach-next">
            <div className="card-title" style={{ marginBottom: 10 }}>
              <span className="serif">下一个目标</span>
            </div>
            {next.length ? (
              next.map((a) => (
                <div key={a.id} className="ach-next-row">
                  <Badge a={a} fresh={false} />
                  <div className="ach-next-text">
                    <div className="wall-name">
                      {a.title}
                      <span className={`tier-tag tier-${a.tier}`}>{TIER_NAME[a.tier]}</span>
                    </div>
                    <div className="wall-prog">
                      <span>
                        <i style={{ width: `${Math.max(2, a.progress * 100)}%` }} />
                      </span>
                      <small>{a.hint}</small>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty">全部解锁了，了不起</div>
            )}
          </div>
          <div className="card ach-recent">
            <div className="card-title" style={{ marginBottom: 10 }}>
              <span className="serif">最近解锁</span>
            </div>
            {recent.length ? (
              <div className="ach-recent-grid">
                {recent.map((a, i) => (
                  <motion.div key={a.id} className="ach-recent-item" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.05 }}>
                    <Badge a={a} fresh={fresh.has(a.id)} />
                    <span className="ach-name">{a.title}</span>
                    <small className="muted">{a.at ? dateText(a.at) : ''}</small>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="empty">还没有解锁的成就</div>
            )}
          </div>
        </div>
      )}

      <div className="star-row">
        <SignCard />
        {list && <AchievementSky list={list} />}
      </div>

      <div className="wall-tabs ach-tabs">
        {(['all', 'locked', ...groups, 'secret'] as const).map((g) => (
          <button key={g} className={`wall-tab${tab === g ? ' on' : ''}`} onClick={() => setTab(g)}>
            {g === 'all' ? '全部' : g === 'locked' ? '未解锁' : g === 'secret' ? '🔒 隐藏' : `${GROUP_ICON[g]} ${GROUP_NAME[g]}`}
            <span className="muted">
              {' '}
              {g === 'all'
                ? done.length
                : g === 'locked'
                  ? all.length - done.length
                  : g === 'secret'
                    ? secrets.filter((a) => a.unlocked).length
                    : all.filter((a) => a.group === g && a.unlocked).length}
              {g !== 'locked' && `/${g === 'all' ? all.length : g === 'secret' ? secrets.length : all.filter((a) => a.group === g).length}`}
            </span>
          </button>
        ))}
      </div>

      {list ? (
        <AnimatePresence mode="popLayout">
          <motion.div key={tab} className="wall-grid ach-page-grid" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
            {shown.map((a, i) => (
              <motion.div
                key={a.id}
                className={`card wall-item tier-${a.tier}${a.unlocked ? ' on' : ''}${masked(a) ? ' secret' : ''}${a.kind === 'collect' ? ' collect' : ''}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.012, 0.35) }}
              >
                <Badge a={a} fresh={fresh.has(a.id)} />
                <div className="wall-text">
                  <div className="wall-name">
                    {titleOf(a)}
                    <span className={`tier-tag tier-${a.tier}`}>{TIER_NAME[a.tier]}</span>
                    {a.kind === 'collect' && <span className="kind-tag">收集</span>}
                    {a.kind === 'secret' && <span className="kind-tag secret">隐藏</span>}
                  </div>
                  <div className="wall-desc">{descOf(a)}</div>
                  {a.items && (
                    <div className="collect-items">
                      {a.items.map((it) => (
                        <span key={it.label} className={it.got ? 'got' : ''}>
                          {it.label}
                        </span>
                      ))}
                    </div>
                  )}
                  {a.unlocked ? (
                    <div className="wall-at">✓ {a.at ? `解锁于 ${dateText(a.at)}` : '已解锁'}</div>
                  ) : (
                    <div className="wall-prog">
                      <span>
                        <i style={{ width: `${Math.max(2, a.progress * 100)}%` }} />
                      </span>
                      <small>{a.hint}</small>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </motion.div>
        </AnimatePresence>
      ) : (
        <div className="skeleton" style={{ height: 320 }} />
      )}
      <PosterDialog open={poster} onClose={() => setPoster(false)} />
    </>
  )
}
