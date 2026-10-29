import { spawn, type ChildProcess } from 'node:child_process'
import { app } from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { checkCompatibility, encodedAudioTracks } from '../shared/compat'
import {
  codecForEncoder,
  ENCODED_AUDIO_BITRATE,
  LOSSLESS_QUALITY,
  sameLookMaxBitrate,
  sameLookVideoBitrate,
  targetVideoBitrate
} from '../shared/encoding'
import { outputDuration, segmentSpeed } from '../shared/speed'
import { exportFileStem, timestampedName } from '../shared/naming'
import type {
  ExportProgress,
  ExportQualityMode,
  ExportRequest,
  ExportResult,
  ExportSegment,
  MediaInfo
} from '../shared/types'
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
  /** Re-encode under the source bitrate so the picture stays and the file gets smaller. */
  sameLook: boolean
  /** Set when sources differ: every part is converted to the first source's format. */
  normalize: { width: number; height: number; fps: string } | null
  /** Forces one frame rate so a slowed part can be joined to the others. */
  lockFps: string | null
  audioTracks: number
}

export async function exportVideo(
  request: ExportRequest,
  onProgress: (p: ExportProgress) => void
): Promise<ExportResult> {
  if (activeJob) return { ok: false, error: 'An export is already running' }

  const segments = request.segments
    .filter((s) => s.end - s.start > 0.01)
    .map((s) => ({ ...s, speed: segmentSpeed(s.speed) }))
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
    const anySpeed = segments.some((s) => s.speed !== 1)
    const mode = qualityMode(request)
    const sameLook = mode === 'same'
    // A speed change cannot be stream-copied, and a copied part cannot be joined to a re-encoded one.
    const lossless = mode === 'lossless' && !anySpeed

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
        sameLook,
        normalize:
          issues.length > 0 && ref ? { width: ref.width, height: ref.height, fps: ref.fpsNominal } : null,
        lockFps: anySpeed && segments.length > 1 && ref ? ref.fpsNominal : null,
        audioTracks: encodedAudioTracks(infoList)
      }
    }

    const settings = await loadSettings()
    const outputDir = request.outputDir?.trim() || settings.outputDir
    await fs.mkdir(outputDir, { recursive: true })
    const stem = exportFileStem(request.fileName ?? '', timestampedName(settings.filePrefix, new Date()))
    outputPath = await reserveOutputPath(outputDir, stem, 'mp4')

    const span = (s: ExportSegment): number => outputDuration(s.start, s.end, s.speed)
    const total = segments.reduce((sum, s) => sum + span(s), 0)
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
        done += span(seg)
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

function videoFilterFor(seg: ExportSegment, plan: EncodePlan): string | null {
  const speed = segmentSpeed(seg.speed)
  const chain: string[] = []
  if (plan.normalize) {
    const { width: w, height: h } = plan.normalize
    chain.push(
      `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1`
    )
  }
  if (speed !== 1) chain.push(`setpts=${(1 / speed).toFixed(6)}*(PTS-STARTPTS)`)
  const fps = plan.normalize?.fps ?? plan.lockFps
  if (fps) chain.push(`fps=${fps}`)
  return chain.length > 0 ? chain.join(',') : null
}

/** Fast-forward graphic drawn onto sped-up frames. */
function fastForwardPng(): string | null {
  const candidates = [
    path.join(process.cwd(), 'resources', 'fast-forward.png'),
    path.join(app.getAppPath(), 'resources', 'fast-forward.png'),
    path.join(process.resourcesPath, 'fast-forward.png')
  ]
  return candidates.find((file) => existsSync(file)) ?? null
}

function speedMarkGraph(chain: string | null): string {
  const prep = chain ? `[0:v]${chain}[base]` : '[0:v]null[base]'
  return [
    prep,
    '[1:v]format=rgba[marksrc]',
    '[marksrc][base]scale2ref=w=ih*0.2:h=ih*0.2[mark][base2]',
    "[base2][mark]overlay=x='W-w-W/28':y='H/28':shortest=1:format=auto[v]"
  ].join(';')
}

// Input -ss with re-encoding decodes from the previous keyframe and drops frames before the
// seek point, so encoded parts start exactly at seg.start.
function encodeArgs(seg: ExportSegment, info: MediaInfo, plan: EncodePlan, out: string): string[] {
  const speed = segmentSpeed(seg.speed)
  const sourceDur = (seg.end - seg.start).toFixed(6)
  const mark = speed > 1 ? fastForwardPng() : null
  // -t after -i limits the output. A slowed clip is longer than the source range, so the
  // limit has to be on the input or ffmpeg would cut the slow motion short.
  const args =
    speed === 1
      ? ['-ss', seg.start.toFixed(6), '-i', seg.path, '-t', sourceDur]
      : ['-ss', seg.start.toFixed(6), '-t', sourceDur, '-i', seg.path]
  if (mark) args.push('-loop', '1', '-i', mark)

  const videoFilter = videoFilterFor(seg, plan)
  if (mark) {
    args.push('-filter_complex', speedMarkGraph(videoFilter), '-map', '[v]')
  } else {
    args.push('-map', '0:v:0')
    if (videoFilter) args.push('-vf', videoFilter)
  }

  for (let i = 0; i < plan.audioTracks; i++) args.push('-map', `0:a:${i}`)
  if (plan.audioTracks > 0) {
    args.push('-c:a', 'aac', '-b:a', String(ENCODED_AUDIO_BITRATE), '-ar', '48000')
    if (plan.normalize) args.push('-ac', '2')
    if (speed !== 1) {
      for (let i = 0; i < plan.audioTracks; i++) {
        const rate = info.audio[i]?.sampleRate || 48000
        const tuned = Math.max(1000, Math.round(rate * speed))
        // asetrate keeps the samples and changes the rate, so pitch moves with speed.
        args.push(`-filter:a:${i}`, `asetrate=${tuned},aresample=48000`)
      }
    }
  }

  args.push('-c:v', plan.encoder, ...rateControlArgs(plan.encoder, plan, info), '-pix_fmt', 'yuv420p')
  if (plan.encoder.startsWith('hevc') || plan.encoder === 'libx265') args.push('-tag:v', 'hvc1')
  args.push('-avoid_negative_ts', 'make_zero', '-map_metadata', '0', '-movflags', '+faststart', out)
  return args
}

/**
 * High-quality encode capped under the recording's own bitrate.
 * An open quality target (CQ with unlimited bitrate) spends more bits than the capture and the file grows.
 */
function sameLookArgs(encoder: string, info: MediaInfo): string[] {
  const codec = codecForEncoder(encoder)
  const target = sameLookVideoBitrate(info, codec)
  const peak = sameLookMaxBitrate(info, codec)
  const cap = ['-maxrate', String(peak), '-bufsize', String(peak * 2)]
  if (encoder.endsWith('_nvenc')) {
    return [
      '-preset', 'p6',
      '-tune', 'hq',
      '-rc', 'vbr',
      '-b:v', String(target),
      ...cap,
      '-spatial-aq', '1',
      '-multipass', 'qres'
    ]
  }
  const crf = encoder === 'libx265' ? '22' : '20'
  return ['-preset', 'medium', '-crf', crf, ...cap]
}

/** Average-bitrate targeting so the output size is predictable, with headroom for fast action. */
function rateControlArgs(encoder: string, plan: EncodePlan, info: MediaInfo): string[] {
  if (plan.sameLook) return sameLookArgs(encoder, info)
  const bitrate = targetVideoBitrate(info, plan.quality)
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

function qualityMode(request: ExportRequest): ExportQualityMode {
  if (request.mode === 'lossless' || request.mode === 'same' || request.mode === 'bitrate') return request.mode
  if (request.sameLook) return 'same'
  return request.quality >= LOSSLESS_QUALITY ? 'lossless' : 'bitrate'
}

function escapeConcatPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/'/g, "'\\''")
}

/** Creates an empty placeholder so concurrent exports never pick the same name. */
async function reserveOutputPath(dir: string, base: string, ext: string): Promise<string> {
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
