import type { TokenPulseApi } from '../shared/types'

declare global {
  interface Window {
    api: TokenPulseApi
  }
}

export {}
