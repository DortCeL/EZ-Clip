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
  revealAfterExport: boolean
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
}

export interface ExportRequest {
  segments: ExportSegment[]
  quality: number
  codec: VideoCodec
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
