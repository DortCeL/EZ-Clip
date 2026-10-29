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
  hevc: { name: 'HEVC', hint: 'Smaller file' },
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
  const fileVideo = Math.max(0, totalBitrate(info) - FALLBACK_AUDIO_BITRATE * info.audio.length)
  const tagged = info.video?.bitRate ?? 0
  // A stream tag can be a peak or a placeholder far above the real file. Optimal
  // sizes itself from this number, so the file on disk wins when the tag is higher.
  if (tagged > 0 && fileVideo > 0) return Math.min(tagged, fileVideo)
  if (tagged > 0) return tagged
  return fileVideo
}

/** Target video bitrate for a quality percentage of the source's own bitrate. */
export function targetVideoBitrate(info: MediaInfo, quality: number): number {
  return Math.max(MIN_VIDEO_BITRATE, Math.round((sourceVideoBitrate(info) * quality) / 100))
}

export interface SizeEstimateInput {
  info: MediaInfo
  duration: number
}

/**
 * Average video bitrate as a percent of the recording.
 * High enough that the picture stays put, low enough that the file is smaller than a copy.
 */
const SAME_LOOK_PERCENT: Record<VideoCodec, number> = {
  h264: 55,
  hevc: 40,
  av1: 32
}

/** Short spikes may go higher, but still stay under the recording. */
const SAME_LOOK_MAX_PERCENT: Record<VideoCodec, number> = {
  h264: 75,
  hevc: 55,
  av1: 45
}

function shareOfSource(info: MediaInfo, percent: number): number {
  const source = sourceVideoBitrate(info)
  if (source <= 0) return MIN_VIDEO_BITRATE
  const share = Math.round((source * percent) / 100)
  const ceiling = Math.max(1, Math.round(source * 0.9))
  return Math.min(Math.max(share, Math.min(MIN_VIDEO_BITRATE, ceiling)), ceiling)
}

export function codecForEncoder(encoder: string): VideoCodec {
  if (encoder.includes('av1')) return 'av1'
  if (encoder.includes('265') || encoder.includes('hevc')) return 'hevc'
  return 'h264'
}

export function sameLookVideoBitrate(info: MediaInfo, codec: VideoCodec): number {
  return shareOfSource(info, SAME_LOOK_PERCENT[codec])
}

export function sameLookMaxBitrate(info: MediaInfo, codec: VideoCodec): number {
  return Math.max(sameLookVideoBitrate(info, codec), shareOfSource(info, SAME_LOOK_MAX_PERCENT[codec]))
}

export function estimateSameLookSize(parts: SizeEstimateInput[], codec: VideoCodec, audioTracks = 0): number {
  return Math.round(
    parts.reduce((sum, { info, duration }) => {
      const bitrate = sameLookVideoBitrate(info, codec) + audioTracks * ENCODED_AUDIO_BITRATE
      return sum + (duration * bitrate) / 8
    }, 0)
  )
}

/** Expected output size in bytes. Compressed exports target a bitrate, so the estimate is close. */
export function estimateOutputSize(parts: SizeEstimateInput[], quality: number, audioTracks: number): number {
  return parts.reduce((sum, { info, duration }) => {
    if (quality >= LOSSLESS_QUALITY) return sum + (duration * info.size) / Math.max(info.duration, 0.001)
    const bitrate = targetVideoBitrate(info, quality) + audioTracks * ENCODED_AUDIO_BITRATE
    return sum + (duration * bitrate) / 8
  }, 0)
}
