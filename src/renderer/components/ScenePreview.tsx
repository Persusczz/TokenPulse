import { useEffect, useRef, useState, type ComponentType } from 'react'
import type { BackdropStyle } from '@shared/types'
import { useApp, useMotionLevel } from '../state'
import { DayCycleScene, usePlace } from './DayCycle'
import { Abyss, Borealis, InkWash, NeonGrid, type SceneProps } from './ThemeScenes'
import { Astral, ClaudeGlow, CodexNight, Dune, PaperDesk, Sakura } from './ThemeScenes2'
import { Eclipse, Firefly, Lunar, Orrery, Rain, Trails } from './ThemeScenes3'
import { Bauhaus, Crystal, DigitalRain, Fireworks, Lanterns, LavaLamp } from './ThemeScenes4'
import { Cyberpunk, Mystic, Xianxia } from './ThemeScenes5'
import { KoiPond, PixelQuest, Ukiyo } from './ThemeScenes6'

/** the canvas scenes, by backdrop */
const SCENES: Partial<Record<BackdropStyle, ComponentType<SceneProps>>> = {
  neon: NeonGrid,
  borealis: Borealis,
  ink: InkWash,
  abyss: Abyss,
  astral: Astral,
  claude: ClaudeGlow,
  codex: CodexNight,
  dune: Dune,
  paper: PaperDesk,
  sakura: Sakura,
  eclipse: Eclipse,
  firefly: Firefly,
  lunar: Lunar,
  orrery: Orrery,
  rain: Rain,
  trails: Trails,
  bauhaus: Bauhaus,
  crystal: Crystal,
  matrix: DigitalRain,
  fireworks: Fireworks,
  lantern: Lanterns,
  lava: LavaLamp,
  mystic: Mystic,
  cyber: Cyberpunk,
  xianxia: Xianxia,
  koi: KoiPond,
  ukiyo: Ukiyo,
  pixel: PixelQuest
}

/**
 * A backdrop's real scene, small, inside a preview tile: it plays while the
 * pointer rests on the tile and shows how it answers a batch of new usage.
 */
export function ScenePreview({ style, dark }: { style: BackdropStyle; dark: boolean }) {
  const { settings } = useApp()
  const level = useMotionLevel()
  const place = usePlace()
  const [pulse, setPulse] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setPulse(Date.now()), 900)
    return () => clearTimeout(t)
  }, [])
  const S = SCENES[style]
  if (!level || (!S && style !== 'daylight')) return null
  const p: SceneProps = { intensity: 1, level, pulse, size: 1_500_000, vivid: settings?.backdropVivid ?? 0.7, dark }
  // drawn at a few times the tile's size and shrunk, so the scene keeps the proportions it has as a window backdrop
  return (
    <span className="scene-preview">
      <span className="scene-preview-stage">{S ? <S {...p} /> : <DayCycleScene {...p} place={place} quiet />}</span>
    </span>
  )
}

/** live while the pointer rests on it a moment: one tile at a time plays */
export function useLivePreview(delay = 260) {
  const [on, setOn] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  return {
    on,
    bind: {
      onPointerEnter: () => {
        clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setOn(true), delay)
      },
      onPointerLeave: () => {
        clearTimeout(timer.current)
        setOn(false)
      }
    }
  }
}
