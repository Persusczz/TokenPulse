import { useMemo, useRef, useState } from 'react'
import type { PromptCost } from '@shared/types'
import { GalaxyField, PlanetSystem } from '../components/Galaxies'
import { JourneyCard } from '../components/Patterns'
import { Segmented } from '../components/Segmented'
import { StarMapCanvas, type StarHit } from '../components/StarMap'
import { ZodiacCard } from '../components/Stars'
import { openSession } from '../components/UsageInsights'
import { useApp, useData, useSource } from '../state'

const CN = (n: number) => (n >= 1e8 ? `${(n / 1e8).toFixed(n >= 1e9 ? 1 : 2)} 亿` : n >= 1e4 ? `${(n / 1e4).toFixed(n >= 1e6 ? 0 : 1)} 万` : String(Math.round(n)))
const stamp = (t: number) => new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })
const dur = (ms: number) => {
  const m = Math.round(ms / 60_000)
  return m < 1 ? '不到 1 分钟' : m < 60 ? `${m} 分钟` : `${Math.floor(m / 60)} 小时 ${m % 60} 分`
}
const folder = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p

/**
 * 星空: your usage drawn as a universe, each picture saying what it maps.
 * Projects are galaxies whose stars are their prompts; the star map lays the
 * same prompts out by day and hour, sessions joined as constellations;
 * models are planets around the sun of the total spend.
 */
export function SkyPage() {
  const { money } = useApp()
  const source = useSource()
  const [days, setDays] = useState(30)
  const map = useData(() => window.api.getStarMap(days), [days, source], 60_000)
  const stage = useRef<HTMLDivElement>(null)
  const [hit, setHit] = useState<StarHit | null>(null)
  const [search, setSearch] = useState('')
  const [project, setProject] = useState<string | null>(null)
  const [lines, setLines] = useState(true)
  const [flash, setFlash] = useState<string | null>(null)
  const projects = useMemo(() => {
    const by = new Map<string, number>()
    for (const p of map?.prompts ?? []) by.set(p.project, (by.get(p.project) ?? 0) + p.cost)
    return [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  }, [map])
  const brightest = useMemo(() => [...(map?.prompts ?? [])].sort((a, b) => b.cost - a.cost).slice(0, 6), [map])
  const biggest = useMemo(() => [...(map?.sessions ?? [])].sort((a, b) => b.prompts - a.prompts || b.cost - a.cost).slice(0, 6), [map])
  const total = map?.prompts.reduce((n, p) => n + p.cost, 0) ?? 0
  const session = hit && map ? map.sessions.find((s) => s.id === hit.p.sessionId) : null
  const pick = (p: PromptCost) => openSession(p.sessionId)
  const hits = search.trim() ? (map?.prompts.filter((p) => p.text.toLowerCase().includes(search.trim().toLowerCase())).length ?? 0) : null

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">
            <span className="title-mark sky-mark">✶</span>
            星空
          </h1>
          <div className="page-sub">你的用量画成的宇宙：每次提问是一颗星，每个项目是一个星系，每个模型是一颗行星</div>
        </div>
        <Segmented
          value={String(days)}
          onChange={(v) => setDays(Number(v))}
          options={[
            { value: '7', label: '7 天' },
            { value: '30', label: '30 天' },
            { value: '90', label: '90 天' }
          ]}
        />
      </div>

      <div className="card starmap-card galaxy-card">
        <div className="starmap-bar">
          <span className="starmap-title serif">项目星系</span>
          <span className="muted">每个项目是一个星系，里面每颗星是一次提问，一段对话连成一条星链（越靠外越新）；星系越大，这个项目花得越多。点星系飞进去，读里面的每段对话</span>
        </div>
        {map ? (
          map.prompts.length ? (
            <GalaxyField map={map} onProject={setProject} />
          ) : (
            <div className="galaxy-stage">
              <div className="starmap-empty">这段时间还没有提问</div>
            </div>
          )
        ) : (
          <div className="galaxy-stage skeleton" />
        )}
      </div>

      <div className="card starmap-card">
        <div className="starmap-bar">
          <span className="starmap-title serif">提问星图</span>
          <span className="starmap-stats">
            {map ? (
              <>
                <b className="tnum">{map.prompts.length}</b> 颗星 · <b className="tnum">{map.sessions.length}</b> 个星座 · 共 <b className="tnum">{money(total)}</b>
                {map.days < map.asked && map.since !== null && (
                  <span className="muted">
                    {' '}
                    · 记录从 {new Date(map.since).getMonth() + 1}/{new Date(map.since).getDate()} 开始
                  </span>
                )}
              </>
            ) : (
              '正在点亮…'
            )}
          </span>
          <input className="input starmap-search" placeholder="搜提问里的字…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {hits !== null && <span className="muted">亮起 {hits} 颗</span>}
          <select className="input" value={project ?? ''} onChange={(e) => setProject(e.target.value || null)}>
            <option value="">全部项目</option>
            {projects.map(([p]) => (
              <option key={p} value={p}>
                {folder(p)}
              </option>
            ))}
          </select>
          <label className="check">
            <input type="checkbox" checked={lines} onChange={(e) => setLines(e.target.checked)} />
            星座连线
          </label>
          <span className="starmap-legend">
            {source !== 'codex' && (
              <span>
                <i className="warm" /> Claude
              </span>
            )}
            {source !== 'claude' && (
              <span>
                <i className="cool" /> Codex
              </span>
            )}
          </span>
        </div>
        <div className="starmap-stage" ref={stage}>
          {map ? (
            map.prompts.length ? (
              <StarMapCanvas map={map} search={search} project={project} lines={lines} flash={flash} onHover={setHit} onPick={pick} />
            ) : (
              <div className="starmap-empty">这段时间还没有提问：用一次 Claude Code 或 Codex，这里就会亮起第一颗星</div>
            )
          ) : (
            <div className="skeleton" style={{ position: 'absolute', inset: 0 }} />
          )}
          {hit && (
            <div className={`starmap-tip${hit.x > (stage.current?.clientWidth ?? 900) - 360 ? ' left' : ''}${hit.y > (stage.current?.clientHeight ?? 500) - 170 ? ' up' : ''}`} style={{ left: hit.x, top: hit.y }}>
              <div className="starmap-tip-time">
                {stamp(hit.p.ts)} · {folder(hit.p.project)}
              </div>
              <div className="starmap-tip-text">{hit.p.text || '（没有文字的提问）'}</div>
              <div className="starmap-tip-nums tnum">
                <b>{money(hit.p.cost)}</b> · {CN(hit.p.tokens)} Token · {hit.p.requests} 次请求 · 用时 {dur(hit.p.durationMs)}
              </div>
              {session && session.prompts > 1 && (
                <div className="muted">
                  所在星座：{session.prompts} 颗星，共 {money(session.cost)} · 点一下打开这个会话
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid-2 sky-row">
        <div className="card starmap-card planet-card">
          <div className="starmap-bar">
            <span className="starmap-title serif">模型行星</span>
            <span className="muted">每颗行星是一个模型，越大花得越多；中间的太阳是这段时间的总花费</span>
          </div>
          {map ? <PlanetSystem models={map.models} source={source} /> : <div className="planet-stage skeleton" />}
        </div>
        <JourneyCard />
      </div>

      <div className="grid-3 starmap-lists">
        <ZodiacCard />
        <div className="card">
          <div className="card-head">
            <div className="card-title">
              <span className="serif">最亮的星</span>
              <span className="muted" style={{ fontWeight: 400 }}>
                花得最多的提问，点一下在星图上找到它
              </span>
            </div>
          </div>
          <div className="starmap-list">
            {brightest.map((p, i) => (
              <button key={p.key} className={`starmap-row${flash === p.key ? ' on' : ''}`} onClick={() => setFlash(flash === p.key ? null : p.key)} onDoubleClick={() => pick(p)}>
                <span className="starmap-rank">{i + 1}</span>
                <span className="starmap-row-text">{p.text || '（没有文字）'}</span>
                <b className="tnum">{money(p.cost)}</b>
              </button>
            ))}
            {!brightest.length && <div className="empty">还没有</div>}
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <div className="card-title">
              <span className="serif">最大的星座</span>
              <span className="muted" style={{ fontWeight: 400 }}>
                提问最多的会话，点一下打开
              </span>
            </div>
          </div>
          <div className="starmap-list">
            {biggest.map((s, i) => (
              <button key={s.id} className="starmap-row" onClick={() => openSession(s.id)}>
                <span className="starmap-rank">{i + 1}</span>
                <span className="starmap-row-text">
                  {folder(s.project)} <span className="muted">· {stamp(s.first)}</span>
                </span>
                <span className="muted tnum">{s.prompts} 颗</span>
                <b className="tnum">{money(s.cost)}</b>
              </button>
            ))}
            {!biggest.length && <div className="empty">还没有</div>}
          </div>
        </div>
      </div>
    </>
  )
}
