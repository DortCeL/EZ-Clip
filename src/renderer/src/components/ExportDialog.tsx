import { useEffect, useMemo, useState } from 'react'
import { checkCompatibility } from '../../../shared/compat'
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
  joining: 'Joining',
  finalizing: 'Finalizing'
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const segments = useStore((s) => s.segments)
  const media = useStore((s) => s.media)
  const layout = useMemo(() => layoutSequence(segments, media), [segments, media])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  useEffect(() => {
    engine.pause()
    void window.ezclip.getSettings().then(setSettings)
  }, [])

  const sources = useMemo(() => [...new Set(layout.placed.map((p) => p.item))], [layout])
  const issues = useMemo(() => checkCompatibility(sources.map((s) => s.info)), [sources])
  const indexing = sources.some((s) => s.keyframeStatus === 'indexing')
  const estimatedSize = layout.placed.reduce(
    (sum, p) => sum + (p.duration * p.item.info.size) / Math.max(p.item.info.duration, 0.001),
    0
  )
  const running = status.kind === 'running'
  const canExport = layout.placed.length > 0 && issues.length === 0 && !indexing && !running

  const start = async (): Promise<void> => {
    setStatus({ kind: 'running', progress: null })
    const unsubscribe = window.ezclip.onExportProgress((progress) => setStatus({ kind: 'running', progress }))
    try {
      const result = await window.ezclip.exportLossless({
        segments: layout.placed.map((p) => ({
          path: p.item.info.path,
          start: snapToKeyframe(p.item.keyframes, p.seg.start),
          end: p.seg.end
        }))
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
    <Modal title="Export — lossless" onClose={onClose} closable={!running} footer={footer}>
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Clips" value={String(layout.placed.length)} />
          <Stat label="Length" value={formatTime(layout.total)} />
          <Stat label="Estimated size" value={`≈ ${formatBytes(estimatedSize)}`} />
        </div>

        <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs">
          <div className="text-zinc-500">Saves to</div>
          <div className="truncate font-mono text-zinc-300" title={settings?.outputDir}>
            {settings ? `${settings.outputDir}\\${timestampedName(settings.filePrefix, new Date())}.mp4` : '…'}
          </div>
        </div>

        <p className="text-xs leading-relaxed text-zinc-500">
          Video and every audio track are copied bit-for-bit, so quality is identical to your recording and
          export runs at disk speed. Clip starts land on keyframes.
        </p>

        {layout.placed.length === 0 && <Notice kind="warn">The timeline is empty — add some clips first.</Notice>}
        {indexing && <Notice kind="info">Still indexing keyframes… export unlocks in a moment.</Notice>}
        {issues.length > 0 && (
          <Notice kind="error">
            <div className="mb-1 font-semibold">These recordings can’t be joined losslessly</div>
            <ul className="list-disc space-y-0.5 pl-4">
              {issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
            <div className="mt-1.5 text-red-200/70">
              Lossless joining needs matching recording settings. Re-encoding mixed sources comes with compressed
              export.
            </div>
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
        progress.phase === 'cutting' && progress.segmentCount && progress.segmentCount > 1
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2">
      <div className="text-[10px] tracking-wider text-zinc-500 uppercase">{label}</div>
      <div className="font-mono text-base text-zinc-100">{value}</div>
    </div>
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
