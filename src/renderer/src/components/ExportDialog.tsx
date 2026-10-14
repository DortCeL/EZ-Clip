import { useEffect, useMemo, useState } from 'react'
import { checkCompatibility, encodedAudioTracks } from '../../../shared/compat'
import {
  CODEC_LABEL,
  estimateOutputSize,
  LOSSLESS_QUALITY,
  MIN_QUALITY,
  type EncoderOption,
  type VideoCodec
} from '../../../shared/encoding'
import { timestampedName } from '../../../shared/naming'
import type { ExportProgress, ExportResult, Settings } from '../../../shared/types'
import { formatBytes, formatTime } from '../lib/format'
import { errorMessage } from '../lib/importMedia'
import { snapToKeyframe } from '../lib/keyframes'
import { layoutSequence } from '../lib/sequence'
import { engine } from '../player'
import { useStore } from '../store'
import { Modal } from './Modal'

type Status =
  | { kind: 'idle' }
  | { kind: 'running'; progress: ExportProgress | null }
  | { kind: 'done'; result: Extract<ExportResult, { ok: true }> }
  | { kind: 'failed'; message: string; canceled?: boolean }

const PHASE_LABEL: Record<ExportProgress['phase'], string> = {
  cutting: 'Cutting clips',
  encoding: 'Encoding',
  joining: 'Joining',
  finalizing: 'Finalizing'
}

const QUALITY_PRESETS = [100, 75, 50, 30]

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const segments = useStore((s) => s.segments)
  const media = useStore((s) => s.media)
  const layout = useMemo(() => layoutSequence(segments, media), [segments, media])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [encoders, setEncoders] = useState<EncoderOption[] | null>(null)
  const [quality, setQuality] = useState(LOSSLESS_QUALITY)
  const [codec, setCodec] = useState<VideoCodec>('h264')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  useEffect(() => {
    engine.pause()
    void window.ezclip.getSettings().then((s) => {
      setSettings(s)
      setQuality(s.exportQuality)
      setCodec(s.exportCodec)
    })
    void window.ezclip.ffmpegInfo().then((info) => setEncoders(info.videoEncoders))
  }, [])

  const sources = useMemo(() => [...new Set(layout.placed.map((p) => p.item))], [layout])
  const infos = useMemo(() => sources.map((s) => s.info), [sources])
  const issues = useMemo(() => checkCompatibility(infos), [infos])
  const indexing = sources.some((s) => s.keyframeStatus === 'indexing')
  const lossless = quality >= LOSSLESS_QUALITY
  const encoder = encoders?.find((e) => e.codec === codec) ?? encoders?.[0] ?? null
  const audioTracks = encodedAudioTracks(infos)

  const parts = layout.placed.map((p) => ({ info: p.item.info, duration: p.duration }))
  const estimatedSize = estimateOutputSize(parts, quality, audioTracks)
  const losslessSize = estimateOutputSize(parts, LOSSLESS_QUALITY, audioTracks)
  const savedPct = losslessSize > 0 ? Math.round((1 - estimatedSize / losslessSize) * 100) : 0

  const running = status.kind === 'running'
  const blockedByIssues = lossless && issues.length > 0
  const canExport =
    layout.placed.length > 0 && !blockedByIssues && !indexing && !running && (lossless || !!encoder)

  const start = async (): Promise<void> => {
    setStatus({ kind: 'running', progress: null })
    const unsubscribe = window.ezclip.onExportProgress((progress) => setStatus({ kind: 'running', progress }))
    try {
      const chosenCodec = encoder?.codec ?? codec
      void window.ezclip.setSettings({ exportQuality: quality, exportCodec: chosenCodec })
      const result = await window.ezclip.exportVideo({
        segments: layout.placed.map((p) => ({
          path: p.item.info.path,
          start: snapToKeyframe(p.item.keyframes, p.seg.start),
          end: p.seg.end
        })),
        quality,
        codec: chosenCodec
      })
      setStatus(
        result.ok
          ? { kind: 'done', result }
          : { kind: 'failed', message: result.error, canceled: result.canceled }
      )
    } catch (e) {
      setStatus({ kind: 'failed', message: errorMessage(e) })
    } finally {
      unsubscribe()
    }
  }

  const footer =
    status.kind === 'done' ? (
      <>
        <button className="btn-secondary" onClick={() => void window.ezclip.revealInFolder(status.result.outputPath)}>
          Show in folder
        </button>
        <button className="btn-primary" onClick={onClose}>
          Done
        </button>
      </>
    ) : running ? (
      <button className="btn-secondary" onClick={() => void window.ezclip.cancelExport()}>
        Cancel
      </button>
    ) : (
      <>
        <button className="btn-secondary" onClick={onClose}>
          Close
        </button>
        <button className="btn-primary" disabled={!canExport} onClick={() => void start()}>
          {status.kind === 'failed' ? 'Try again' : 'Export'}
        </button>
      </>
    )

  return (
    <Modal title="Export" onClose={onClose} closable={!running} footer={footer}>
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Clips" value={String(layout.placed.length)} />
          <Stat label="Length" value={formatTime(layout.total)} />
          <Stat
            label="Estimated size"
            value={`≈ ${formatBytes(estimatedSize)}`}
            sub={!lossless && savedPct > 0 ? `−${savedPct}% vs lossless` : undefined}
          />
        </div>

        <fieldset disabled={running} className="space-y-3 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-3">
          <div className="flex items-center justify-between">
            <span className="text-xs tracking-wider text-zinc-500 uppercase">Quality</span>
            <span className="font-mono text-zinc-100">
              {lossless ? 'Lossless' : `${quality}%`}
              <span className="ml-2 text-xs text-zinc-500">
                {lossless ? 'original bits, no re-encode' : 'of the original bitrate'}
              </span>
            </span>
          </div>
          <input
            type="range"
            min={MIN_QUALITY}
            max={LOSSLESS_QUALITY}
            step={5}
            value={quality}
            onChange={(e) => setQuality(Number(e.target.value))}
            className="accent-accent w-full"
          />
          <div className="flex gap-2">
            {QUALITY_PRESETS.map((q) => (
              <button
                key={q}
                className={`rounded-md border px-2 py-0.5 text-xs ${
                  quality === q ? 'border-accent text-zinc-100' : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'
                }`}
                onClick={() => setQuality(q)}
              >
                {q === LOSSLESS_QUALITY ? 'Lossless' : `${q}%`}
              </button>
            ))}
          </div>

          {!lossless && (
            <div className="space-y-1.5">
              <div className="text-xs tracking-wider text-zinc-500 uppercase">Format</div>
              {encoders === null ? (
                <div className="text-xs text-zinc-500">Checking encoders…</div>
              ) : encoders.length === 0 ? (
                <Notice kind="error">No working video encoder was found, so only lossless export is available.</Notice>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {encoders.map((e) => (
                    <button
                      key={e.codec}
                      className={`rounded-md border px-2 py-1.5 text-left ${
                        encoder?.codec === e.codec ? 'border-accent bg-zinc-800' : 'border-zinc-700 hover:border-zinc-500'
                      }`}
                      onClick={() => setCodec(e.codec)}
                    >
                      <div className="text-xs font-semibold text-zinc-100">
                        {CODEC_LABEL[e.codec].name}
                        {!e.hardware && <span className="ml-1 font-normal text-amber-400">CPU</span>}
                      </div>
                      <div className="text-[10px] text-zinc-500">{CODEC_LABEL[e.codec].hint}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </fieldset>

        <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs">
          <div className="text-zinc-500">Saves to</div>
          <div className="truncate font-mono text-zinc-300" title={settings?.outputDir}>
            {settings ? `${settings.outputDir}\\${timestampedName(settings.filePrefix, new Date())}.mp4` : '…'}
          </div>
        </div>

        <p className="text-xs leading-relaxed text-zinc-500">
          {lossless
            ? 'Video and every audio track are copied bit-for-bit, so quality is identical to your recording and export runs at disk speed.'
            : `Video is re-encoded ${
                encoder?.hardware ? 'on your NVIDIA GPU, a few times faster than real time' : 'on the CPU, which is slower'
              }. Audio is re-encoded to high-quality AAC so it stays in sync at every cut.`}
        </p>

        {layout.placed.length === 0 && <Notice kind="warn">The timeline is empty — add some clips first.</Notice>}
        {indexing && <Notice kind="info">Still indexing keyframes… export unlocks in a moment.</Notice>}
        {issues.length > 0 && lossless && (
          <Notice kind="error">
            <div className="mb-1 font-semibold">These recordings can’t be joined losslessly</div>
            <IssueList issues={issues} />
            <div className="mt-1.5 text-red-200/70">
              Lossless joining needs matching recording settings. Lower the quality below 100% to re-encode them into
              one file.
            </div>
          </Notice>
        )}
        {issues.length > 0 && !lossless && (
          <Notice kind="info">
            <div className="mb-1 font-semibold">Mixed recordings will be converted to match the first clip</div>
            <IssueList issues={issues} />
            {infos.some((i) => i.audio.length > audioTracks) && (
              <div className="mt-1.5">
                Only the first {audioTracks} audio track{audioTracks === 1 ? '' : 's'} can be kept.
              </div>
            )}
          </Notice>
        )}

        {running && <ProgressBar progress={status.progress} />}
        {status.kind === 'done' && (
          <Notice kind="success">
            <div className="font-semibold">Exported in {(status.result.elapsedMs / 1000).toFixed(1)}s</div>
            <div className="truncate font-mono">{status.result.outputPath}</div>
            <div>{formatBytes(status.result.size)}</div>
          </Notice>
        )}
        {status.kind === 'failed' && (
          <Notice kind={status.canceled ? 'info' : 'error'}>{status.message}</Notice>
        )}
      </div>
    </Modal>
  )
}

function ProgressBar({ progress }: { progress: ExportProgress | null }) {
  const pct = Math.round((progress?.progress ?? 0) * 100)
  const label = progress
    ? `${PHASE_LABEL[progress.phase]}${
        (progress.phase === 'cutting' || progress.phase === 'encoding') &&
        progress.segmentCount &&
        progress.segmentCount > 1
          ? ` ${(progress.segmentIndex ?? 0) + 1}/${progress.segmentCount}`
          : ''
      }`
    : 'Starting…'
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-zinc-400">
        <span>{label}</span>
        <span className="font-mono">{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
        <div className="bg-accent h-full transition-[width] duration-150" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2">
      <div className="text-[10px] tracking-wider text-zinc-500 uppercase">{label}</div>
      <div className="font-mono text-base text-zinc-100">{value}</div>
      {sub && <div className="text-[10px] text-emerald-400">{sub}</div>}
    </div>
  )
}

function IssueList({ issues }: { issues: string[] }) {
  return (
    <ul className="list-disc space-y-0.5 pl-4">
      {issues.map((i) => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  )
}

function Notice({ kind, children }: { kind: 'info' | 'warn' | 'error' | 'success'; children: React.ReactNode }) {
  const styles = {
    info: 'border-sky-800 bg-sky-950/50 text-sky-200',
    warn: 'border-amber-800 bg-amber-950/40 text-amber-200',
    error: 'border-red-800 bg-red-950/50 text-red-200',
    success: 'border-emerald-800 bg-emerald-950/40 text-emerald-200'
  }[kind]
  return <div className={`rounded-md border px-3 py-2 text-xs ${styles}`}>{children}</div>
}
