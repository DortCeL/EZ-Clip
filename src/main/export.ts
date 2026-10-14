import { spawn, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { checkCompatibility } from '../shared/compat'
import { timestampedName } from '../shared/naming'
import type { ExportProgress, ExportRequest, ExportResult, ExportSegment } from '../shared/types'
import { ffmpegPath } from './binaries'
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

export async function exportLossless(
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
    const infos = await Promise.all(sources.map((p) => probe(p)))
    const issues = checkCompatibility(infos)
    if (issues.length > 0) {
      return { ok: false, error: `These clips can't be joined losslessly: ${issues.join('; ')}` }
    }

    const settings = await loadSettings()
    await fs.mkdir(settings.outputDir, { recursive: true })
    outputPath = await reserveOutputPath(settings.outputDir, settings.filePrefix, 'mp4')

    const total = segments.reduce((sum, s) => sum + (s.end - s.start), 0)
    const run = (args: string[], onTime: (sec: number) => void): Promise<void> => {
      if (canceled) return Promise.reject(new CanceledError())
      return runFfmpeg(args, onTime, processes, () => canceled)
    }

    if (segments.length === 1) {
      await run(cutArgs(segments[0], outputPath), (sec) =>
        onProgress({ phase: 'cutting', progress: Math.min(1, sec / total), segmentIndex: 0, segmentCount: 1 })
      )
    } else {
      tmpDir = await fs.mkdtemp(path.join(settings.outputDir, '.ezclip-tmp-'))
      const parts: string[] = []
      let done = 0
      for (const [i, seg] of segments.entries()) {
        const part = path.join(tmpDir, `part_${String(i).padStart(3, '0')}.mp4`)
        await run(cutArgs(seg, part), (sec) =>
          onProgress({
            phase: 'cutting',
            progress: (0.5 * Math.min(total, done + sec)) / total,
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
        onProgress({ phase: 'joining', progress: 0.5 + (0.5 * Math.min(total, sec)) / total })
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
