import type { EzClipApi } from '../../shared/api'

declare global {
  interface Window {
    ezclip: EzClipApi
  }
}
