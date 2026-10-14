import type { FfmpegInfo, Settings } from './types'

export const IPC = {
  getSettings: 'settings:get',
  setSettings: 'settings:set',
  chooseOutputDir: 'settings:choose-output-dir',
  ffmpegInfo: 'ffmpeg:info',
  revealInFolder: 'shell:reveal'
} as const

export interface EzClipApi {
  /** Absolute path of a File from a drag-and-drop or file input. */
  getPathForFile(file: File): string
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  chooseOutputDir(): Promise<string | null>
  ffmpegInfo(): Promise<FfmpegInfo>
  revealInFolder(path: string): Promise<void>
}

export const MEDIA_SCHEME = 'media'

export function mediaUrl(filePath: string): string {
  return `${MEDIA_SCHEME}://local/?path=${encodeURIComponent(filePath)}`
}
