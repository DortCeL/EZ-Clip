import { spawn } from 'node:child_process'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from '@derhuerst/ffprobe-static'
import type { EncoderOption, VideoCodec } from '../shared/encoding'
import type { FfmpegInfo } from '../shared/types'

// Binaries can't be executed from inside app.asar; electron-builder unpacks them next to it.
function unpacked(p: string): string {
  return p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
}

export const ffmpegPath = unpacked(ffmpegStatic ?? 'ffmpeg')
export const ffprobePath = unpacked(ffprobeStatic ?? 'ffprobe')

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

export function run(bin: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d))
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

let cachedInfo: Promise<FfmpegInfo> | null = null

/** Preferred encoders per codec, best first. CPU encoders are the fallback without an NVIDIA GPU. */
const ENCODER_CANDIDATES: Record<VideoCodec, string[]> = {
  h264: ['h264_nvenc', 'libx264'],
  hevc: ['hevc_nvenc', 'libx265'],
  av1: ['av1_nvenc']
}

/** Being compiled in doesn't mean the GPU and driver support it, so try a tiny encode. */
async function encoderWorks(encoder: string): Promise<boolean> {
  const result = await run(ffmpegPath, [
    '-hide_banner', '-nostdin', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=black:s=320x240:d=0.1',
    '-c:v', encoder, '-f', 'null', '-'
  ]).catch(() => null)
  return result?.code === 0
}

export function getFfmpegInfo(): Promise<FfmpegInfo> {
  cachedInfo ??= (async () => {
    const [version, encoders] = await Promise.all([
      run(ffmpegPath, ['-hide_banner', '-version']),
      run(ffmpegPath, ['-hide_banner', '-encoders'])
    ])
    const hwEncoders = [...encoders.stdout.matchAll(/^\s*V\S*\s+(\S+_(?:nvenc|qsv|amf))\s/gm)].map(
      (m) => m[1]
    )
    const compiled = new Set([...encoders.stdout.matchAll(/^\s*V\S*\s+(\S+)\s/gm)].map((m) => m[1]))
    const videoEncoders = (
      await Promise.all(
        (Object.keys(ENCODER_CANDIDATES) as VideoCodec[]).map(async (codec) => {
          for (const encoder of ENCODER_CANDIDATES[codec]) {
            if (compiled.has(encoder) && (await encoderWorks(encoder))) {
              return { codec, encoder, hardware: encoder.includes('_nvenc') }
            }
          }
          return null
        })
      )
    ).filter((e): e is EncoderOption => e !== null)
    return {
      ffmpegPath,
      ffprobePath,
      version: version.stdout.split(/\r?\n/)[0] ?? 'unknown',
      hwEncoders,
      videoEncoders
    }
  })()
  return cachedInfo
}
