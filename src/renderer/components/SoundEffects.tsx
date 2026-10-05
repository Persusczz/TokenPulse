import { useEffect, useRef } from 'react'
import { crossed } from '@shared/milestones'
import { playSound, type SoundKind } from '../sound'
import { useApp } from '../state'

/** Plays the sound effects in the main window (hidden or not), when switched on */
export function SoundEffects() {
  const { settings, lastUpdate, quota, guard } = useApp()
  const cfg = useRef({ on: false, volume: 0.5 })
  cfg.current = { on: !!settings?.sound, volume: settings?.soundVolume ?? 0.5 }
  const play = (k: SoundKind) => cfg.current.on && playSound(k, cfg.current.volume)

  // a drip per batch of new usage, at most every 1.5 s
  const lastDrip = useRef(0)
  useEffect(() => {
    if (!lastUpdate?.addedTokens || Date.now() - lastDrip.current < 1500) return
    lastDrip.current = Date.now()
    play('drip')
  }, [lastUpdate]) // eslint-disable-line react-hooks/exhaustive-deps

  const five = quota?.windows.find((w) => w.key === 'session' || w.key === 'five_hour')?.utilization ?? null
  const prevFive = useRef<number | null>(null)
  useEffect(() => {
    const p = prevFive.current
    prevFive.current = five
    if (p === null || five === null) return
    const m = crossed(p, five, [75, 90])
    if (m) play(m >= 90 ? 'alarm' : 'warn')
  }, [five]) // eslint-disable-line react-hooks/exhaustive-deps

  const pausedCount = guard?.paused.length ?? 0
  const prevPaused = useRef(pausedCount)
  useEffect(() => {
    const p = prevPaused.current
    prevPaused.current = pausedCount
    if (!p && pausedCount) play('pause')
    if (p && !pausedCount) play('resume')
  }, [pausedCount]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => window.api.onAchievement(() => play('achievement')), []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () =>
      window.api.onRunaway((list) => {
        if (list.some((a) => Date.now() - a.at < 10_000)) play('alarm')
      }),
    []
  ) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
