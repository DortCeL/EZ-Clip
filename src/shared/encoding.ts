import type { MediaInfo } from './types'

export type VideoCodec = 'h264' | 'hevc' | 'av1'

export interface EncoderOption {
  codec: VideoCodec
  /** ffmpeg encoder name, e.g. "hevc_nvenc". */
  encoder: string
  hardware: boolean
}

export const CODEC_LABEL: Record<VideoCodec, { name: string; hint: string }> = {
  h264: { name: 'H.264', hint: 'Plays everywhere' },
  hevc: { name: 'HEVC', hint: 'Same look, smaller file' },
  av1: { name: 'AV1', hint: 'Smallest, newer players only' }
}

/** Quality at or above this exports by stream copy. */
export const LOSSLESS_QUALITY = 100
export const MIN_QUALITY = 10

/**
 * Compressed exports re-encode audio at this rate per track. Copied audio can't be trimmed
 * between packets and would start at the keyframe before the cut, ahead of the video.
 */
export const ENCODED_AUDIO_BITRATE = 192_000
const FALLBACK_AUDIO_BITRATE = 160_000
const MIN_VIDEO_BITRATE = 300_000

function totalBitrate(info: MediaInfo): number {
  return info.bitRate ?? (info.duration > 0 ? (info.size * 8) / info.duration : 0)
}

export function sourceVideoBitrate(info: MediaInfo): number {
  if (info.video?.bitRate) return info.video.bitRate
  return Math.max(0, totalBitrate(info) - FALLBACK_AUDIO_BITRATE * info.audio.length)
}

/** Target video bitrate for a quality percentage of the source's own bitrate. */
export function targetVideoBitrate(info: MediaInfo, quality: number): number {
  return Math.max(MIN_VIDEO_BITRATE, Math.round((sourceVideoBitrate(info) * quality) / 100))
}

export interface SizeEstimateInput {
  info: MediaInfo
  duration: number
}

/** Expected output size in bytes. Compressed exports target a bitrate, so the estimate is close. */
export function estimateOutputSize(parts: SizeEstimateInput[], quality: number, audioTracks: number): number {
  return parts.reduce((sum, { info, duration }) => {
    if (quality >= LOSSLESS_QUALITY) return sum + (duration * info.size) / Math.max(info.duration, 0.001)
    const bitrate = targetVideoBitrate(info, quality) + audioTracks * ENCODED_AUDIO_BITRATE
    return sum + (duration * bitrate) / 8
  }, 0)
}
