import type {
  ExportProgress,
  ExportRequest,
  ExportResult,
  FfmpegInfo,
  MediaInfo,
  DeleteImportedResult,
  SavedProject,
  Settings
} from './types'

export const IPC = {
  openFiles: 'media:open-files',
  probe: 'media:probe',
  deleteImported: 'media:delete-imported',
  keyframes: 'media:keyframes',
  thumbnail: 'media:thumbnail',
  getSettings: 'settings:get',
  setSettings: 'settings:set',
  chooseOutputDir: 'settings:choose-output-dir',
  ffmpegInfo: 'ffmpeg:info',
  exportVideo: 'export:start',
  cancelExport: 'export:cancel',
  exportProgress: 'export:progress',
  loadProject: 'project:load',
  saveProject: 'project:save',
  projectFlush: 'project:flush',
  projectFlushed: 'project:flushed',
  revealInFolder: 'shell:reveal'
} as const

export interface EzClipApi {
  /** Absolute path of a File from a drag-and-drop or file input. */
  getPathForFile(file: File): string
  openFiles(): Promise<string[]>
  probe(path: string): Promise<MediaInfo>
  /** Deletes imported source files. Paths that were never imported are refused. */
  deleteImportedFiles(paths: string[], protect?: string[]): Promise<DeleteImportedResult>
  keyframes(path: string): Promise<number[]>
  thumbnail(path: string, atSeconds: number): Promise<string | null>
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  chooseOutputDir(): Promise<string | null>
  ffmpegInfo(): Promise<FfmpegInfo>
  exportVideo(request: ExportRequest): Promise<ExportResult>
  cancelExport(): Promise<void>
  onExportProgress(listener: (progress: ExportProgress) => void): () => void
  loadProject(): Promise<SavedProject | null>
  saveProject(project: SavedProject | null): Promise<void>
  onProjectFlush(listener: () => void): () => void
  ackProjectFlush(): void
  revealInFolder(path: string): Promise<void>
}

export const MEDIA_SCHEME = 'media'

export const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'mov', 'm4v', 'webm', 'ts']

export function mediaUrl(filePath: string): string {
  return `${MEDIA_SCHEME}://local/?path=${encodeURIComponent(filePath)}`
}
