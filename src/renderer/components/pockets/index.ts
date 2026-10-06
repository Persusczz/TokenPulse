import type { BackdropStyle } from '@shared/types'
import type { Pocket } from '../Pocket'
import { CRAFT_POCKETS } from './crafts'
import { SKY_POCKETS } from './sky'
import { WORLD_POCKETS } from './worlds'

/** each theme pack's pocket scene, by its backdrop */
export const POCKETS: Partial<Record<BackdropStyle, () => Pocket>> = { ...SKY_POCKETS, ...CRAFT_POCKETS, ...WORLD_POCKETS }
