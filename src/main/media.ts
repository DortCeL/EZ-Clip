import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AudioStreamInfo, MediaInfo } from '../shared/types'
import { ffmpegPath, ffprobePath, run } from './binaries'

interface ProbeStream {
  index: number
  codec_type?: string
  codec_name?: string
  profile?: string
  width?: number
  height?: number
  r_frame_rate?: string
  avg_frame_rate?: string
  pix_fmt?: string
  bit_rate?: string
  channels?: number
  channel_layout?: string
  sample_rate?: string
  disposition?: { attached_pic?: number }
  tags?: { title?: string; language?: string; handler_name?: string }
}

interface ProbeOutput {
  streams?: ProbeStream[]
  format?: { duration?: string; format_name?: string; bit_rate?: string; size?: string }
}

function parseRate(rate: string | undefined): number {
  if (!rate) return 0
  const [n, d] = rate.split('/').map(Number)
  if (!n || !d) return 0
  return n / d
}

export async function probe(filePath: string): Promise<MediaInfo> {
  const { code, stdout, stderr } = await run(ffprobePath, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath
  ])
  if (code !== 0) throw new Error(stderr.trim() || `ffprobe exited with code ${code}`)

  const data = JSON.parse(stdout) as ProbeOutput
  const streams = data.streams ?? []
  const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
  let audioIndex = 0
  const audio: AudioStreamInfo[] = streams
    .filter((s) => s.codec_type === 'audio')
    .map((s) => ({
      index: audioIndex++,
      codec: s.codec_name ?? 'unknown',
      channels: s.channels ?? 0,
      channelLayout: s.channel_layout,
      sampleRate: Number(s.sample_rate ?? 0),
      title: s.tags?.title ?? s.tags?.handler_name,
      language: s.tags?.language
    }))

  const stat = await fs.stat(filePath)
  return {
    path: filePath,
    name: path.basename(filePath),
    size: stat.size,
    duration: Number(data.format?.duration ?? 0),
    formatName: data.format?.format_name ?? 'unknown',
    bitRate: data.format?.bit_rate ? Number(data.format.bit_rate) : undefined,
    video: v
      ? {
          codec: v.codec_name ?? 'unknown',
          profile: v.profile,
          width: v.width ?? 0,
          height: v.height ?? 0,
          fps: parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate),
          fpsNominal: v.r_frame_rate ?? '0/0',
          pixFmt: v.pix_fmt ?? 'unknown',
          bitRate: v.bit_rate ? Number(v.bit_rate) : undefined
        }
      : null,
    audio
  }
}

async function startTime(filePath: string): Promise<number> {
  const { stdout } = await run(ffprobePath, [
    '-v', 'error',
    '-show_entries', 'format=start_time',
    '-of', 'csv=p=0',
    filePath
  ])
  const t = Number(stdout.trim())
  return Number.isFinite(t) ? t : 0
}

/**
 * Keyframe timestamps of the first video stream, read from packet flags and made
 * relative to the file start (the same timeline as `<video>.currentTime` and ffmpeg `-ss`).
 * Demux-only, so it runs at disk speed without decoding.
 */
export async function keyframes(filePath: string): Promise<number[]> {
  const offset = await startTime(filePath)
  const raw = await packetKeyframes(filePath)
  return raw.map((t) => Math.max(0, t - offset))
}

function packetKeyframes(filePath: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffprobePath,
      [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'packet=pts_time,flags',
        '-of', 'csv=p=0',
        filePath
      ],
      { windowsHide: true }
    )
    const result: number[] = []
    let buffer = ''
    let stderr = ''
    const consume = (line: string): void => {
      const comma = line.indexOf(',')
      if (comma < 0) return
      if (line.charCodeAt(comma + 1) !== 75 /* 'K' */) return
      const t = Number(line.slice(0, comma))
      if (Number.isFinite(t)) result.push(t)
    }
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      buffer += chunk
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        consume(buffer.slice(0, nl).trim())
        buffer = buffer.slice(nl + 1)
      }
    })
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d))
    child.on('error', reject)
    child.on('close', (code) => {
      consume(buffer.trim())
      if (code !== 0 && result.length === 0) {
        reject(new Error(stderr.trim() || `ffprobe exited with code ${code}`))
        return
      }
      resolve(result.sort((a, b) => a - b))
    })
  })
}

/** Small JPEG frame as a data URL, or null if extraction fails. */
export function thumbnail(filePath: string, atSeconds: number): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(
      ffmpegPath,
      [
        '-hide_banner', '-loglevel', 'error', '-nostdin',
        '-ss', String(Math.max(0, atSeconds)),
        '-i', filePath,
        '-frames:v', '1',
        '-vf', 'scale=320:-2',
        '-f', 'image2pipe',
        '-c:v', 'mjpeg',
        '-q:v', '5',
        'pipe:1'
      ],
      { windowsHide: true }
    )
    const chunks: Buffer[] = []
    child.stdout.on('data', (d: Buffer) => chunks.push(d))
    child.on('error', () => resolve(null))
    child.on('close', (code) => {
      const buf = Buffer.concat(chunks)
      resolve(code === 0 && buf.length > 0 ? `data:image/jpeg;base64,${buf.toString('base64')}` : null)
    })
  })
}
