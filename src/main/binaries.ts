import { spawn } from 'node:child_process'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from '@derhuerst/ffprobe-static'
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

export function getFfmpegInfo(): Promise<FfmpegInfo> {
  cachedInfo ??= (async () => {
    const [version, encoders] = await Promise.all([
      run(ffmpegPath, ['-hide_banner', '-version']),
      run(ffmpegPath, ['-hide_banner', '-encoders'])
    ])
    const hwEncoders = [...encoders.stdout.matchAll(/^\s*V\S*\s+(\S+_(?:nvenc|qsv|amf))\s/gm)].map(
      (m) => m[1]
    )
    return {
      ffmpegPath,
      ffprobePath,
      version: version.stdout.split(/\r?\n/)[0] ?? 'unknown',
      hwEncoders
    }
  })()
  return cachedInfo
}
