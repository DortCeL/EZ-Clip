import type { EncoderOption, VideoCodec } from './encoding'

export interface VideoStreamInfo {
  codec: string
  profile?: string
  width: number
  height: number
  /** Average frame rate, used for display and frame stepping. */
  fps: number
  /** Nominal frame rate string as reported by ffprobe (e.g. "60/1"). */
  fpsNominal: string
  pixFmt: string
  bitRate?: number
}

export interface AudioStreamInfo {
  index: number
  codec: string
  channels: number
  channelLayout?: string
  sampleRate: number
  title?: string
  language?: string
}

export interface MediaInfo {
  path: string
  name: string
  size: number
  duration: number
  formatName: string
  bitRate?: number
  video: VideoStreamInfo | null
  audio: AudioStreamInfo[]
}

export interface Settings {
  outputDir: string
  filePrefix: string
  /** When true, source files used in a successful export are deleted from disk. */
  deleteOriginalsAfterExport: boolean
  /** Visually lossless encode. Ignored while export quality is used as a percentage. */
  exportSameLook: boolean
  /** 100 = lossless stream copy; lower re-encodes at that percentage of the source bitrate. */
  exportQuality: number
  exportCodec: VideoCodec
}

export interface FfmpegInfo {
  ffmpegPath: string
  ffprobePath: string
  version: string
  hwEncoders: string[]
  /** Best working encoder per codec, verified with a test encode. */
  videoEncoders: EncoderOption[]
}

export interface ExportSegment {
  path: string
  start: number
  end: number
  /** 1 = recording speed. Below 1 slows the picture and drops the pitch; above 1 does the opposite. */
  speed?: number
}

export type ExportQualityMode = 'lossless' | 'same' | 'bitrate'

export interface ExportRequest {
  segments: ExportSegment[]
  quality: number
  codec: VideoCodec
  /** lossless copies the picture. same re-encodes at a matching look. bitrate uses `quality`. */
  mode?: ExportQualityMode
  /** File name without a folder or extension. Blank uses the usual dated name. */
  fileName?: string
  /** Folder for this export. Blank uses the saved export folder. */
  outputDir?: string
  /** Re-encode so the picture looks the same and high-bitrate recordings get smaller. */
  sameLook?: boolean
}

export type ExportPhase = 'cutting' | 'encoding' | 'joining' | 'finalizing'

export interface ExportProgress {
  phase: ExportPhase
  /** 0..1 */
  progress: number
  segmentIndex?: number
  segmentCount?: number
}

export type ExportResult =
  | { ok: true; outputPath: string; size: number; elapsedMs: number }
  | { ok: false; canceled?: boolean; error: string }

export interface DeleteImportedResult {
  deleted: string[]
  failed: { path: string; error: string }[]
}

export interface SavedMediaRef {
  id: string
  path: string
  color: string
}

export interface SavedSegment {
  id: string
  sourceId: string
  start: number
  end: number
  /** Absent in projects saved before speed edits; treated as 1. */
  speed?: number
}

/** Timeline plus imported clips, so closing the app doesn't drop the edit. */
export interface SavedProject {
  version: 1
  media: SavedMediaRef[]
  marks: Record<string, { in: number | null; out: number | null }>
  segments: SavedSegment[]
  selectedSegmentId: string | null
  activeSourceId: string | null
  mode: 'source' | 'timeline'
}
