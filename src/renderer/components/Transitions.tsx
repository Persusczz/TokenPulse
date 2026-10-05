import type { TargetAndTransition, Transition } from 'motion/react'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { BackdropStyle } from '@shared/types'
import type { MotionScale } from '../state'

/**
 * Every backdrop has its own way in: how a page arrives when you switch pages
 * (the page container's motion) and a one-shot overlay played over the page
 * area, or over the whole window when the theme itself is switched on.
 *
 * - 宇宙 warp through hyperspace (GalaxyField draws it, on 'tp-warp')
 * - Claude 星芒 a spark blooms open · Codex 终端 the page is scanned in line by line
 * - 霓虹 a glitch · 极光 a curtain of light sweeps by · 水墨 ink spreads · 深海 bubbles rise
 * - 星河 stars twinkle · 涟漪 a ring spreads · 纸笺 a page turns · 流光 a wave of light
 * - 樱花 petals fly across · 沙丘 a gust of sand · 星图 a constellation draws itself
 * - 行星仪 planets swing into their orbits · 月夜 the moon rises · 日冕 totality and a diamond ring
 * - 星轨 star trails sweep round · 雨夜 a curtain of rain · 萤火 fireflies rise
 * - 熔岩灯 blobs well up · 冰晶 facets catch the light · 数字雨 code falls · 烟花 a burst
 * - 天灯 lanterns rise · 包豪斯 shapes slide in and snap · 昼夜 the sun arcs over and sets, the moon follows
 */

const EASE = [0.16, 1, 0.3, 1] as const

export interface PageMotion {
  initial: TargetAndTransition
  animate: TargetAndTransition
  exit: TargetAndTransition
  transition: Transition
}

const CALM: PageMotion = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 }, transition: { duration: 0.22, ease: EASE } }
const STILL: PageMotion = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.12 } }

const PAGE: Partial<Record<BackdropStyle, PageMotion>> = {
  galaxy: {
    initial: { opacity: 0, scale: 0.9, filter: 'blur(6px)' },
    animate: { opacity: 1, scale: 1, filter: 'blur(0px)' },
    exit: { opacity: 0, scale: 1.12, filter: 'blur(10px)' },
    transition: { duration: 0.34, ease: [0.5, 0, 0.2, 1] }
  },
  claude: {
    initial: { opacity: 0, scale: 0.95, filter: 'blur(6px) brightness(1.35)' },
    animate: { opacity: 1, scale: 1, filter: 'blur(0px) brightness(1)' },
    exit: { opacity: 0, scale: 1.03, filter: 'blur(4px) brightness(1.2)' },
    transition: { duration: 0.38, ease: EASE }
  },
  codex: {
    initial: { opacity: 0, x: -6 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: 6 },
    transition: { duration: 0.16, ease: 'linear' }
  },
  neon: {
    initial: { opacity: 0, x: -20, skewX: -7, filter: 'hue-rotate(-70deg) saturate(2.4)' },
    animate: { opacity: 1, x: 0, skewX: 0, filter: 'hue-rotate(0deg) saturate(1)' },
    exit: { opacity: 0, x: 16, skewX: 5, filter: 'hue-rotate(60deg) saturate(2)' },
    transition: { duration: 0.28, ease: [0.7, 0, 0.2, 1] }
  },
  borealis: {
    initial: { opacity: 0, y: -12, filter: 'blur(8px) saturate(1.6)' },
    animate: { opacity: 1, y: 0, filter: 'blur(0px) saturate(1)' },
    exit: { opacity: 0, y: 8, filter: 'blur(6px)' },
    transition: { duration: 0.42, ease: EASE }
  },
  ink: {
    initial: { opacity: 0, filter: 'blur(5px) grayscale(1) contrast(1.4)' },
    animate: { opacity: 1, filter: 'blur(0px) grayscale(0) contrast(1)' },
    exit: { opacity: 0, filter: 'blur(3px) grayscale(1)' },
    transition: { duration: 0.46, ease: EASE }
  },
  abyss: {
    initial: { opacity: 0, y: 28, filter: 'blur(6px)' },
    animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
    exit: { opacity: 0, y: -18, filter: 'blur(4px)' },
    transition: { duration: 0.46, ease: EASE }
  },
  stars: {
    initial: { opacity: 0, scale: 1.025, filter: 'blur(3px)' },
    animate: { opacity: 1, scale: 1, filter: 'blur(0px)' },
    exit: { opacity: 0, scale: 0.985 },
    transition: { duration: 0.3, ease: EASE }
  },
  aurora: {
    initial: { opacity: 0, filter: 'blur(6px) saturate(1.5)' },
    animate: { opacity: 1, filter: 'blur(0px) saturate(1)' },
    exit: { opacity: 0, filter: 'blur(4px)' },
    transition: { duration: 0.34, ease: EASE }
  },
  ripples: {
    initial: { opacity: 0, scale: 0.98 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 1.01 },
    transition: { duration: 0.3, ease: EASE }
  },
  sakura: {
    initial: { opacity: 0, x: -14, rotate: -0.6, filter: 'blur(4px) saturate(1.3)' },
    animate: { opacity: 1, x: 0, rotate: 0, filter: 'blur(0px) saturate(1)' },
    exit: { opacity: 0, x: 12, rotate: 0.4, filter: 'blur(3px)' },
    transition: { duration: 0.42, ease: EASE }
  },
  dune: {
    initial: { opacity: 0, x: -30, filter: 'blur(5px) sepia(0.5)' },
    animate: { opacity: 1, x: 0, filter: 'blur(0px) sepia(0)' },
    exit: { opacity: 0, x: 24, filter: 'blur(4px) sepia(0.4)' },
    transition: { duration: 0.4, ease: EASE }
  },
  astral: {
    initial: { opacity: 0, scale: 0.97, filter: 'blur(5px) brightness(1.3)' },
    animate: { opacity: 1, scale: 1, filter: 'blur(0px) brightness(1)' },
    exit: { opacity: 0, scale: 1.02, filter: 'blur(4px)' },
    transition: { duration: 0.4, ease: EASE }
  },
  orrery: {
    initial: { opacity: 0, rotate: -1.2, scale: 0.96, filter: 'blur(4px) sepia(0.4)' },
    animate: { opacity: 1, rotate: 0, scale: 1, filter: 'blur(0px) sepia(0)' },
    exit: { opacity: 0, rotate: 0.8, scale: 1.02, filter: 'blur(3px)' },
    transition: { duration: 0.42, ease: EASE }
  },
  lunar: {
    initial: { opacity: 0, y: 18, filter: 'blur(6px) brightness(1.4) saturate(0.6)' },
    animate: { opacity: 1, y: 0, filter: 'blur(0px) brightness(1) saturate(1)' },
    exit: { opacity: 0, y: -10, filter: 'blur(4px)' },
    transition: { duration: 0.46, ease: EASE }
  },
  eclipse: {
    initial: { opacity: 0, filter: 'brightness(0.25) blur(4px)' },
    animate: { opacity: 1, filter: 'brightness(1) blur(0px)' },
    exit: { opacity: 0, filter: 'brightness(1.6) blur(3px)' },
    transition: { duration: 0.5, ease: EASE }
  },
  trails: {
    initial: { opacity: 0, rotate: 1.4, transformOrigin: '70% 0%', filter: 'blur(4px)' },
    animate: { opacity: 1, rotate: 0, transformOrigin: '70% 0%', filter: 'blur(0px)' },
    exit: { opacity: 0, rotate: -0.8, transformOrigin: '70% 0%', filter: 'blur(3px)' },
    transition: { duration: 0.44, ease: EASE }
  },
  rain: {
    initial: { opacity: 0, y: -16, filter: 'blur(6px)' },
    animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
    exit: { opacity: 0, y: 12, filter: 'blur(5px)' },
    transition: { duration: 0.36, ease: EASE }
  },
  firefly: {
    initial: { opacity: 0, y: 14, filter: 'blur(5px) brightness(0.7)' },
    animate: { opacity: 1, y: 0, filter: 'blur(0px) brightness(1)' },
    exit: { opacity: 0, y: -8, filter: 'blur(4px)' },
    transition: { duration: 0.44, ease: EASE }
  },
  lava: {
    initial: { opacity: 0, y: 26, scale: 0.98, filter: 'blur(6px) hue-rotate(-25deg)' },
    animate: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px) hue-rotate(0deg)' },
    exit: { opacity: 0, y: -14, filter: 'blur(5px)' },
    transition: { duration: 0.46, ease: EASE }
  },
  crystal: {
    initial: { opacity: 0, scale: 1.025, filter: 'blur(4px) saturate(1.7) hue-rotate(25deg)' },
    animate: { opacity: 1, scale: 1, filter: 'blur(0px) saturate(1) hue-rotate(0deg)' },
    exit: { opacity: 0, scale: 0.985, filter: 'blur(3px)' },
    transition: { duration: 0.36, ease: EASE }
  },
  matrix: {
    initial: { opacity: 0, y: -14, filter: 'brightness(1.6) blur(2px)' },
    animate: { opacity: 1, y: 0, filter: 'brightness(1) blur(0px)' },
    exit: { opacity: 0, y: 10, filter: 'brightness(0.6)' },
    transition: { duration: 0.24, ease: 'linear' }
  },
  fireworks: {
    initial: { opacity: 0, scale: 0.96, filter: 'brightness(1.8) blur(4px)' },
    animate: { opacity: 1, scale: 1, filter: 'brightness(1) blur(0px)' },
    exit: { opacity: 0, scale: 1.02, filter: 'blur(3px)' },
    transition: { duration: 0.4, ease: EASE }
  },
  lantern: {
    initial: { opacity: 0, y: 22, filter: 'blur(6px) sepia(0.5)' },
    animate: { opacity: 1, y: 0, filter: 'blur(0px) sepia(0)' },
    exit: { opacity: 0, y: -12, filter: 'blur(4px)' },
    transition: { duration: 0.5, ease: EASE }
  },
  daylight: {
    initial: { opacity: 0, y: 14, filter: 'blur(6px) brightness(1.25)' },
    animate: { opacity: 1, y: 0, filter: 'blur(0px) brightness(1)' },
    exit: { opacity: 0, y: -8, filter: 'blur(4px)' },
    transition: { duration: 0.42, ease: EASE }
  },
  bauhaus: {
    initial: { opacity: 0, x: -26, rotate: -0.8 },
    animate: { opacity: 1, x: 0, rotate: 0 },
    exit: { opacity: 0, x: 18, rotate: 0.5 },
    transition: { duration: 0.32, ease: [0.7, 0, 0.2, 1] }
  },
  paper: {
    initial: { opacity: 0, rotateY: -14, x: 26, transformPerspective: 1400, transformOrigin: 'left center' },
    animate: { opacity: 1, rotateY: 0, x: 0, transformPerspective: 1400, transformOrigin: 'left center' },
    exit: { opacity: 0, rotateY: 8, x: -14, transformPerspective: 1400, transformOrigin: 'left center' },
    transition: { duration: 0.38, ease: EASE }
  }
}

/** how pages arrive on this backdrop */
export function pageMotion(style: BackdropStyle | undefined, level: MotionScale): PageMotion {
  if (!level) return STILL
  return (style && PAGE[style]) || CALM
}

/** play the page-turn effect of the current backdrop */
export function playPageTransition(): void {
  document.dispatchEvent(new CustomEvent('tp-transition', { detail: { big: false } }))
}

/** play the theme's entrance over the whole window */
export function playThemeEntrance(): void {
  document.dispatchEvent(new CustomEvent('tp-transition', { detail: { big: true } }))
}

interface Shot {
  id: number
  style: BackdropStyle
  big: boolean
  rect: { left: number; top: number; width: number; height: number }
}

const LIFE: Partial<Record<BackdropStyle, number>> = {
  claude: 1300,
  codex: 900,
  neon: 700,
  borealis: 1300,
  ink: 1400,
  abyss: 1700,
  stars: 1100,
  aurora: 1200,
  ripples: 1300,
  paper: 700,
  flow: 1200,
  sakura: 1600,
  dune: 1200,
  astral: 1500,
  orrery: 1500,
  lunar: 1600,
  eclipse: 1800,
  trails: 1400,
  rain: 1200,
  firefly: 1700,
  lava: 1600,
  crystal: 1200,
  matrix: 1300,
  fireworks: 1600,
  lantern: 1800,
  bauhaus: 1100,
  daylight: 1700
}

const SPARK_COLORS = ['#ff5a78', '#ffbe50', '#78c8ff', '#b478ff', '#78ffaa']
const MATRIX_GLYPHS = 'アイウエオカキクケコサシスセソタチツテト0123456789ABCDEF'

/** Claude Code's spinner, there and back */
const SPINNER = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢', '·'].map((g) => g + '\uFE0E')

/** small constellations drawn by the star atlas's transition (0–1 points, lines by index) */
const SKETCHES: { points: [number, number][]; lines: [number, number][] }[] = [
  // the Big Dipper
  { points: [[0.08, 0.3], [0.24, 0.26], [0.38, 0.32], [0.5, 0.42], [0.56, 0.62], [0.82, 0.66], [0.86, 0.44]], lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]] },
  // Cassiopeia
  { points: [[0.1, 0.35], [0.3, 0.62], [0.5, 0.4], [0.7, 0.66], [0.9, 0.38]], lines: [[0, 1], [1, 2], [2, 3], [3, 4]] },
  // Orion
  { points: [[0.3, 0.12], [0.7, 0.16], [0.44, 0.46], [0.5, 0.48], [0.56, 0.5], [0.28, 0.86], [0.72, 0.84]], lines: [[0, 2], [1, 4], [2, 3], [3, 4], [2, 5], [4, 6]] }
]

let seq = 0
const rand = (a: number, b: number) => a + Math.random() * (b - a)

/** The overlay for one transition, with its random bits fixed for its lifetime */
function ShotView({ s }: { s: Shot }) {
  const { style, big } = s
  const n = big ? 1.6 : 1
  const bits = useMemo(
    () =>
      Array.from({ length: Math.round(28 * n) }, () => ({
        x: rand(2, 98),
        y: rand(4, 96),
        r: rand(4, 16) * (big ? 1.3 : 1),
        d: rand(0, big ? 0.5 : 0.3),
        t: rand(0.7, 1.3)
      })),
    [] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const box: CSSProperties = { left: s.rect.left, top: s.rect.top, width: s.rect.width, height: s.rect.height, ['--h' as string]: `${s.rect.height}px` }
  const cls = `tr-shot tr-${style}${big ? ' big' : ''}`
  switch (style) {
    case 'claude':
      return (
        <div className={cls} style={box}>
          <i className="tr-glow" />
          {big && (
            <span className="tr-spinner">
              <span className="tr-spin-strip">
                {SPINNER.map((g, i) => (
                  <b key={i}>{g}</b>
                ))}
              </span>
              <em>Clauding…</em>
            </span>
          )}
          {bits.slice(0, big ? 16 : 10).map((b, i, all) => {
            const a = (i / all.length) * Math.PI * 2 + b.d
            const d = (big ? 34 : 24) + b.t * 10
            return (
              <svg
                key={i}
                className="tr-ast"
                viewBox="-1 -1 2 2"
                style={{ width: b.r * 2.2, height: b.r * 2.2, ['--dx' as string]: `${(Math.cos(a) * d).toFixed(1)}vmin`, ['--dy' as string]: `${(Math.sin(a) * d).toFixed(1)}vmin`, animationDelay: `${(b.d * 0.4).toFixed(2)}s` }}
              >
                {Array.from({ length: 8 }, (_, k) => {
                  const r = k % 2 ? 0.62 : 1
                  const ang = (k / 8) * Math.PI * 2
                  return <line key={k} x1={Math.cos(ang) * 0.18} y1={Math.sin(ang) * 0.18} x2={Math.cos(ang) * r} y2={Math.sin(ang) * r} />
                })}
              </svg>
            )
          })}
        </div>
      )
    case 'codex':
      return (
        <div className={cls} style={box}>
          <i className="tr-curtain">
            <b className="tr-scan" />
            <span className="tr-prompt">&gt; codex<em>_</em></span>
            {big && (
              <span className="tr-working">
                • <b>Working</b> <i>(0s • esc to interrupt)</i>
              </span>
            )}
          </i>
        </div>
      )
    case 'neon':
      return (
        <div className={cls} style={box}>
          <i className="tr-flash" />
          {bits.slice(0, big ? 9 : 6).map((b, i) => (
            <i key={i} className={`tr-glitch${i % 2 ? ' cyan' : ''}`} style={{ top: `${b.y}%`, height: `${Math.round(b.r * 0.8)}px`, animationDelay: `${(b.d * 0.6).toFixed(2)}s` }} />
          ))}
        </div>
      )
    case 'borealis':
      return (
        <div className={cls} style={box}>
          <i className="tr-curtain-light" />
          <i className="tr-curtain-light late" />
        </div>
      )
    case 'ink':
      return (
        <div className={cls} style={box}>
          <i className="tr-ink" />
          {bits.slice(0, 5).map((b, i) => (
            <i key={i} className="tr-ink dot" style={{ left: `${30 + b.x * 0.4}%`, top: `${25 + b.y * 0.5}%`, width: b.r * 3, height: b.r * 3, animationDelay: `${(0.1 + b.d).toFixed(2)}s` }} />
          ))}
        </div>
      )
    case 'abyss':
      return (
        <div className={cls} style={box}>
          {bits.map((b, i) => (
            <i key={i} className="tr-bubble" style={{ left: `${b.x}%`, width: b.r, height: b.r, animationDelay: `${b.d.toFixed(2)}s`, animationDuration: `${b.t.toFixed(2)}s` }} />
          ))}
        </div>
      )
    case 'stars':
      return (
        <div className={cls} style={box}>
          {bits.map((b, i) => (
            <i key={i} className="tr-star" style={{ left: `${b.x}%`, top: `${b.y}%`, width: b.r * 2, height: b.r * 2, animationDelay: `${b.d.toFixed(2)}s` }} />
          ))}
        </div>
      )
    case 'aurora':
      return (
        <div className={cls} style={box}>
          <i className="tr-wash" />
        </div>
      )
    case 'ripples':
      return (
        <div className={cls} style={box}>
          <i className="tr-ring" />
          <i className="tr-ring late" />
          <i className="tr-ring later" />
        </div>
      )
    case 'paper':
      return (
        <div className={cls} style={box}>
          <i className="tr-fold" />
        </div>
      )
    case 'flow':
      return (
        <div className={cls} style={box}>
          <i className="tr-wave" />
          <i className="tr-wave late" />
        </div>
      )
    case 'sakura':
      return (
        <div className={cls} style={box}>
          {bits.map((b, i) => (
            <i
              key={i}
              className="tr-petal"
              style={{ top: `${b.y * 0.9}%`, width: b.r * 1.3, height: b.r, animationDelay: `${b.d.toFixed(2)}s`, animationDuration: `${(1.1 + b.t * 0.4).toFixed(2)}s`, ['--spin' as string]: `${Math.round(b.x * 7)}deg` }}
            />
          ))}
        </div>
      )
    case 'dune':
      return (
        <div className={cls} style={box}>
          <i className="tr-sand" />
          {bits.map((b, i) => (
            <i key={i} className="tr-grain" style={{ top: `${30 + b.y * 0.7}%`, animationDelay: `${(b.d * 0.6).toFixed(2)}s`, width: b.r * 2.5 }} />
          ))}
        </div>
      )
    case 'astral': {
      const sk = SKETCHES[s.id % SKETCHES.length]
      return (
        <div className={cls} style={box}>
          <svg className="tr-constellation" viewBox="0 0 1 1" preserveAspectRatio="xMidYMid meet">
            {sk.lines.map(([a, b2], i) => (
              <line key={i} x1={sk.points[a][0]} y1={sk.points[a][1]} x2={sk.points[b2][0]} y2={sk.points[b2][1]} pathLength={1} style={{ animationDelay: `${(i * 0.07).toFixed(2)}s` }} />
            ))}
            {sk.points.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={0.012} style={{ animationDelay: `${(i * 0.06).toFixed(2)}s` }} />
            ))}
          </svg>
        </div>
      )
    }
    case 'orrery':
      return (
        <div className={cls} style={box}>
          <svg className="tr-orrery" viewBox="-1 -0.5 2 1" preserveAspectRatio="xMidYMid meet">
            <circle r={0.022} className="tr-orr-sun" />
            {[0.22, 0.38, 0.56, 0.78].map((rx, i) => {
              const ry = rx * 0.38
              const path = `M ${rx} 0 A ${rx} ${ry} 0 1 0 ${-rx} 0 A ${rx} ${ry} 0 1 0 ${rx} 0`
              return (
                <g key={rx} style={{ animationDelay: `${i * 0.08}s` }} className="tr-orr-ring">
                  <ellipse rx={rx} ry={ry} pathLength={1} />
                  <circle r={0.012 + i * 0.003}>
                    <animateMotion dur={`${1.1 + i * 0.25}s`} repeatCount="1" fill="freeze" path={path} keyPoints="0;0.6" keyTimes="0;1" calcMode="spline" keySplines="0.16 1 0.3 1" />
                  </circle>
                </g>
              )
            })}
          </svg>
        </div>
      )
    case 'lunar':
      return (
        <div className={cls} style={box}>
          <i className="tr-silver" />
          <i className="tr-moonrise" />
        </div>
      )
    case 'eclipse':
      return (
        <div className={cls} style={box}>
          <i className="tr-dim" />
          <i className="tr-sun" />
          <i className="tr-umbra" />
          <i className="tr-diamond" />
        </div>
      )
    case 'trails':
      return (
        <div className={cls} style={box}>
          <svg className="tr-trails" viewBox="-1 -1 2 2">
            {bits.slice(0, big ? 22 : 14).map((b, i) => (
              <circle key={i} r={0.12 + (i / 22) * 0.95} style={{ strokeDasharray: `${(0.08 + b.t * 0.25).toFixed(2)} 7`, strokeDashoffset: (b.x / 10).toFixed(2), animationDelay: `${(b.d * 0.3).toFixed(2)}s` }} />
            ))}
          </svg>
        </div>
      )
    case 'rain':
      return (
        <div className={cls} style={box}>
          <i className="tr-flash-soft" />
          {bits.map((b, i) => (
            <i key={i} className="tr-drop" style={{ left: `${b.x}%`, height: `${Math.round(b.r * 5)}px`, animationDelay: `${(b.d * 0.8).toFixed(2)}s`, animationDuration: `${(0.45 + b.t * 0.25).toFixed(2)}s` }} />
          ))}
        </div>
      )
    case 'firefly':
      return (
        <div className={cls} style={box}>
          {bits.map((b, i) => (
            <i key={i} className="tr-fly" style={{ left: `${b.x}%`, top: `${45 + b.y * 0.5}%`, animationDelay: `${b.d.toFixed(2)}s`, animationDuration: `${(1.1 + b.t * 0.5).toFixed(2)}s` }} />
          ))}
        </div>
      )
    case 'lava':
      return (
        <div className={cls} style={box}>
          {bits.slice(0, big ? 9 : 6).map((b, i) => (
            <i key={i} className="tr-lava" style={{ left: `${10 + b.x * 0.8}%`, width: b.r * 8, height: b.r * 8, animationDelay: `${b.d.toFixed(2)}s`, animationDuration: `${(1.1 + b.t * 0.4).toFixed(2)}s` }} />
          ))}
        </div>
      )
    case 'crystal':
      return (
        <div className={cls} style={box}>
          <i className="tr-prism" />
          {bits.slice(0, big ? 16 : 10).map((b, i) => (
            <i key={i} className="tr-shard" style={{ left: `${b.x}%`, top: `${b.y}%`, width: b.r * 3, height: b.r * 3, animationDelay: `${(b.d * 0.8).toFixed(2)}s`, ['--spin' as string]: `${Math.round(b.x * 4)}deg` }} />
          ))}
        </div>
      )
    case 'matrix':
      return (
        <div className={cls} style={box}>
          {bits.map((b, i) => (
            <span key={i} className="tr-code" style={{ left: `${b.x}%`, animationDelay: `${(b.d * 0.6).toFixed(2)}s`, animationDuration: `${(0.7 + b.t * 0.4).toFixed(2)}s` }}>
              {Array.from({ length: 14 }, (_, k) => MATRIX_GLYPHS[Math.floor((b.x * 7 + k * 13 + b.y) % MATRIX_GLYPHS.length)]).join('\n')}
            </span>
          ))}
        </div>
      )
    case 'fireworks':
      return (
        <div className={cls} style={box}>
          <i className="tr-boom" />
          {bits.map((b, i) => {
            const a = (i / bits.length) * Math.PI * 2
            const d = (big ? 30 : 22) + b.t * 8
            return (
              <i
                key={i}
                className="tr-spark"
                style={{
                  ['--dx' as string]: `${(Math.cos(a) * d).toFixed(1)}vmin`,
                  ['--dy' as string]: `${(Math.sin(a) * d).toFixed(1)}vmin`,
                  background: SPARK_COLORS[i % SPARK_COLORS.length],
                  color: SPARK_COLORS[i % SPARK_COLORS.length],
                  animationDelay: `${(b.d * 0.2).toFixed(2)}s`
                }}
              />
            )
          })}
        </div>
      )
    case 'lantern':
      return (
        <div className={cls} style={box}>
          {bits.slice(0, big ? 12 : 8).map((b, i) => (
            <i key={i} className="tr-lantern" style={{ left: `${b.x}%`, width: b.r * 1.4, height: b.r * 1.8, animationDelay: `${b.d.toFixed(2)}s`, animationDuration: `${(1.3 + b.t * 0.4).toFixed(2)}s` }} />
          ))}
        </div>
      )
    case 'daylight':
      // the sun arcs across and sets, the moon follows it up
      return (
        <div className={cls} style={box}>
          <i className="tr-dawn" />
          <i className="tr-sunarc" />
          {big && <i className="tr-moonarc" />}
        </div>
      )
    case 'bauhaus':
      return (
        <div className={cls} style={box}>
          {['circle', 'half', 'bar', 'tri'].map((k, i) => (
            <i key={k} className={`tr-geo ${k}`} style={{ animationDelay: `${i * 0.07}s` }} />
          ))}
        </div>
      )
    default:
      return null
  }
}

/**
 * Plays the current backdrop's overlay on 'tp-transition' (standard motion and
 * up). The cosmos answers with its own warp instead.
 */
export function SceneTransition({ style, level }: { style: BackdropStyle; level: MotionScale }) {
  const [shots, setShots] = useState<Shot[]>([])
  useEffect(() => {
    const fn = (e: Event) => {
      if (level < 2) return
      const big = !!(e as CustomEvent<{ big?: boolean }>).detail?.big
      if (style === 'galaxy') {
        document.dispatchEvent(new CustomEvent('tp-warp'))
        return
      }
      if (!LIFE[style]) return
      const main = document.querySelector('.main')?.getBoundingClientRect()
      const rect = big || !main ? { left: 0, top: 0, width: innerWidth, height: innerHeight } : { left: main.left, top: main.top, width: main.width, height: main.height }
      const id = ++seq
      setShots((s) => [...s.slice(-2), { id, style, big, rect }])
      setTimeout(() => setShots((s) => s.filter((x) => x.id !== id)), (LIFE[style] ?? 1000) * (big ? 1.35 : 1))
    }
    document.addEventListener('tp-transition', fn)
    return () => document.removeEventListener('tp-transition', fn)
  }, [style, level])
  if (!shots.length) return null
  return (
    <div className="tr-layer" aria-hidden>
      {shots.map((s) => (
        <ShotView key={s.id} s={s} />
      ))}
    </div>
  )
}
