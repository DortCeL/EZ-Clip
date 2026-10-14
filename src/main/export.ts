import { spawn, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { checkCompatibility, encodedAudioTracks } from '../shared/compat'
import { ENCODED_AUDIO_BITRATE, LOSSLESS_QUALITY, targetVideoBitrate } from '../shared/encoding'
import { timestampedName } from '../shared/naming'
import type { ExportProgress, ExportRequest, ExportResult, ExportSegment, MediaInfo } from '../shared/types'
import { ffmpegPath, getFfmpegInfo } from './binaries'
import { probe } from './media'
import { loadSettings } from './settings'

// ffmpeg's input -ss with stream copy starts at the keyframe at or before the seek point;
// nudging forward keeps float rounding from landing on the previous keyframe.
const SEEK_NUDGE = 0.001

class CanceledError extends Error {}

let activeJob: { cancel(): void } | null = null

export function cancelExport(): void {
  activeJob?.cancel()
}

/** How a compressed export encodes every part, so the parts can be joined by stream copy. */
interface EncodePlan {
  encoder: string
  quality: number
  /** Set when sources differ: every part is converted to the first source's format. */
  normalize: { width: number; height: number; fps: string } | null
  audioTracks: number
}

export async function exportVideo(
  request: ExportRequest,
  onProgress: (p: ExportProgress) => void
): Promise<ExportResult> {
  if (activeJob) return { ok: false, error: 'An export is already running' }

  const segments = request.segments.filter((s) => s.end - s.start > 0.01)
  if (segments.length === 0) return { ok: false, error: 'Nothing to export — the timeline is empty' }

  const started = Date.now()
  const processes = new Set<ChildProcess>()
  let canceled = false
  activeJob = {
    cancel: () => {
      canceled = true
      for (const p of processes) p.kill()
    }
  }

  let outputPath: string | null = null
  let tmpDir: string | null = null
  try {
    const sources = [...new Set(segments.map((s) => s.path))]
    const infos = new Map(await Promise.all(sources.map(async (p) => [p, await probe(p)] as const)))
    const infoList = [...infos.values()]
    const issues = checkCompatibility(infoList)
    const lossless = request.quality >= LOSSLESS_QUALITY

    let plan: EncodePlan | null = null
    if (lossless) {
      if (issues.length > 0) {
        return { ok: false, error: `These clips can't be joined losslessly: ${issues.join('; ')}` }
      }
    } else {
      const encoder = (await getFfmpegInfo()).videoEncoders.find((e) => e.codec === request.codec)
      if (!encoder) return { ok: false, error: `No working ${request.codec.toUpperCase()} encoder found` }
      const ref = infoList[0].video
      plan = {
        encoder: encoder.encoder,
        quality: request.quality,
        normalize:
          issues.length > 0 && ref ? { width: ref.width, height: ref.height, fps: ref.fpsNominal } : null,
        audioTracks: encodedAudioTracks(infoList)
      }
    }

    const settings = await loadSettings()
    await fs.mkdir(settings.outputDir, { recursive: true })
    outputPath = await reserveOutputPath(settings.outputDir, settings.filePrefix, 'mp4')

    const total = segments.reduce((sum, s) => sum + (s.end - s.start), 0)
    const run = (args: string[], onTime: (sec: number) => void): Promise<void> => {
      if (canceled) return Promise.reject(new CanceledError())
      return runFfmpeg(args, onTime, processes, () => canceled)
    }
    const partArgs = (seg: ExportSegment, out: string): string[] =>
      plan ? encodeArgs(seg, infos.get(seg.path)!, plan, out) : cutArgs(seg, out)
    const phase = plan ? 'encoding' : 'cutting'
    // Joining is a stream copy either way; when encoding, nearly all the time goes to the parts.
    const partsWeight = plan ? 0.95 : 0.5

    if (segments.length === 1) {
      await run(partArgs(segments[0], outputPath), (sec) =>
        onProgress({ phase, progress: Math.min(1, sec / total), segmentIndex: 0, segmentCount: 1 })
      )
    } else {
      tmpDir = await fs.mkdtemp(path.join(settings.outputDir, '.ezclip-tmp-'))
      const parts: string[] = []
      let done = 0
      for (const [i, seg] of segments.entries()) {
        const part = path.join(tmpDir, `part_${String(i).padStart(3, '0')}.mp4`)
        await run(partArgs(seg, part), (sec) =>
          onProgress({
            phase,
            progress: (partsWeight * Math.min(total, done + sec)) / total,
            segmentIndex: i,
            segmentCount: segments.length
          })
        )
        done += seg.end - seg.start
        parts.push(part)
      }

      const listFile = path.join(tmpDir, 'list.txt')
      await fs.writeFile(listFile, parts.map((p) => `file '${escapeConcatPath(p)}'`).join('\n'), 'utf8')
      await run(concatArgs(listFile, outputPath), (sec) =>
        onProgress({ phase: 'joining', progress: partsWeight + ((1 - partsWeight) * Math.min(total, sec)) / total })
      )
    }

    onProgress({ phase: 'finalizing', progress: 1 })
    const size = (await fs.stat(outputPath)).size
    return { ok: true, outputPath, size, elapsedMs: Date.now() - started }
  } catch (e) {
    if (outputPath) await fs.rm(outputPath, { force: true }).catch(() => undefined)
    if (canceled || e instanceof CanceledError) return { ok: false, canceled: true, error: 'Export canceled' }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    activeJob = null
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

function cutArgs(seg: ExportSegment, out: string): string[] {
  const nudge = seg.start > 0 ? SEEK_NUDGE : 0
  const duration = seg.end - seg.start - nudge
  return [
    '-ss', (seg.start + nudge).toFixed(6),
    '-i', seg.path,
    '-t', duration.toFixed(6),
    '-map', '0:v:0',
    '-map', '0:a?',
    '-c', 'copy',
    '-avoid_negative_ts', 'make_zero',
    '-map_metadata', '0',
    '-movflags', '+faststart',
    out
  ]
}

// Input -ss with re-encoding decodes from the previous keyframe and drops frames before the
// seek point, so encoded parts start exactly at seg.start.
function encodeArgs(seg: ExportSegment, info: MediaInfo, plan: EncodePlan, out: string): string[] {
  const bitrate = targetVideoBitrate(info, plan.quality)
  const args = [
    '-ss', seg.start.toFixed(6),
    '-i', seg.path,
    '-t', (seg.end - seg.start).toFixed(6),
    '-map', '0:v:0'
  ]

  for (let i = 0; i < plan.audioTracks; i++) args.push('-map', `0:a:${i}`)
  if (plan.audioTracks > 0) {
    args.push('-c:a', 'aac', '-b:a', String(ENCODED_AUDIO_BITRATE), '-ar', '48000')
    if (plan.normalize) args.push('-ac', '2')
  }

  if (plan.normalize) {
    const { width: w, height: h, fps } = plan.normalize
    args.push(
      '-vf',
      `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}`
    )
  }

  args.push('-c:v', plan.encoder, ...rateControlArgs(plan.encoder, bitrate), '-pix_fmt', 'yuv420p')
  if (plan.encoder.startsWith('hevc') || plan.encoder === 'libx265') args.push('-tag:v', 'hvc1')
  args.push('-avoid_negative_ts', 'make_zero', '-map_metadata', '0', '-movflags', '+faststart', out)
  return args
}

/** Average-bitrate targeting so the output size is predictable, with headroom for fast action. */
function rateControlArgs(encoder: string, bitrate: number): string[] {
  const rate = ['-b:v', String(bitrate), '-maxrate', String(Math.round(bitrate * 1.5)), '-bufsize', String(bitrate * 2)]
  if (encoder.endsWith('_nvenc')) {
    return ['-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-multipass', 'qres', '-spatial-aq', '1', ...rate]
  }
  return ['-preset', 'medium', ...rate]
}

function concatArgs(listFile: string, out: string): string[] {
  return [
    '-f', 'concat',
    '-safe', '0',
    '-i', listFile,
    '-map', '0',
    '-c', 'copy',
    '-movflags', '+faststart',
    out
  ]
}

function escapeConcatPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/'/g, "'\\''")
}

/** Creates an empty placeholder so concurrent exports never pick the same name. */
async function reserveOutputPath(dir: string, prefix: string, ext: string): Promise<string> {
  const base = timestampedName(prefix, new Date())
  for (let n = 1; n < 1000; n++) {
    const candidate = path.join(dir, `${base}${n === 1 ? '' : `_${n}`}.${ext}`)
    try {
      const handle = await fs.open(candidate, 'wx')
      await handle.close()
      return candidate
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
  }
  throw new Error('Could not find a free output file name')
}

function runFfmpeg(
  args: string[],
  onTime: (seconds: number) => void,
  processes: Set<ChildProcess>,
  isCanceled: () => boolean
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats', ...args],
      { windowsHide: true }
    )
    processes.add(child)
    let stderr = ''
    let buffer = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      buffer += chunk
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        const m = /^out_time_us=(\d+)/.exec(line)
        if (m) onTime(Number(m[1]) / 1e6)
      }
    })
    child.stderr.setEncoding('utf8').on('data', (d: string) => {
      stderr = (stderr + d).slice(-4000)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      processes.delete(child)
      if (isCanceled()) reject(new CanceledError())
      else if (code === 0) resolve()
      else reject(new Error(stderr.trim().split(/\r?\n/).slice(-3).join(' ') || `ffmpeg exited with code ${code}`))
    })
  })
}
