import { useEffect, useState } from 'react'
import { finishIntro, useApp, useMotionLevel, useSource } from '../state'
import { SourceMark } from './CodexMark'

const RAYS = 16

/**
 * Launch animation: a point of light unfolds into the tool's mark with rays
 * shooting out and a shock ring, then the window opens from the centre and
 * the numbers roll up from zero (the overview waits for finishIntro).
 */
export function Splash() {
  const { settings } = useApp()
  const level = useMotionLevel()
  const source = useSource()
  const [phase, setPhase] = useState<'in' | 'out' | 'gone'>('in')
  const ready = !!settings

  useEffect(() => {
    if (!ready) return
    if (level === 0) {
      finishIntro()
      setPhase('gone')
      return
    }
    const hold = level >= 3 ? 1500 : 1250
    const a = setTimeout(() => {
      setPhase('out')
      finishIntro()
    }, hold)
    const b = setTimeout(() => setPhase('gone'), hold + 900)
    // the walkthrough and a click both skip it
    const skip = () => {
      clearTimeout(a)
      setPhase('out')
      finishIntro()
    }
    addEventListener('pointerdown', skip, { once: true })
    return () => {
      clearTimeout(a)
      clearTimeout(b)
      removeEventListener('pointerdown', skip)
    }
  }, [ready]) // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === 'gone') return null
  return (
    <div className={`splash ${phase}${ready ? ' go' : ''}`} aria-hidden>
      <div className="splash-glow" />
      <div className="splash-rays">
        {Array.from({ length: RAYS }, (_, i) => (
          <i key={i} style={{ ['--a' as string]: `${(360 / RAYS) * i}deg`, ['--d' as string]: `${(i % 4) * 40}ms`, ['--l' as string]: i % 2 ? '0.62' : '1' }} />
        ))}
      </div>
      <div className="splash-ring" />
      <div className="splash-ring two" />
      <div className="splash-mark">{ready && <SourceMark size={132} intensity={3} pulse={1} source={source} />}</div>
      <div className="splash-word serif">
        Token<em>Pulse</em>
      </div>
    </div>
  )
}
