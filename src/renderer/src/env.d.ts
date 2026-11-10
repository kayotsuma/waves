/// <reference types="vite/client" />
import type { WaveApi } from '@shared/api'

declare global {
  interface Window {
    wave: WaveApi
  }
}
export {}
