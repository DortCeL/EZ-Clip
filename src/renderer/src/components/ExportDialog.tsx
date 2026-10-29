import { useEffect, useMemo, useRef, useState } from 'react'
import { checkCompatibility, encodedAudioTracks } from '../../../shared/compat'
import {
  CODEC_LABEL,
  estimateOutputSize,
  estimateSameLookSize,
  LOSSLESS_QUALITY,
  MIN_QUALITY,
  type EncoderOption,
  type VideoCodec
} from '../../../shared/encoding'
import { timestampedName } from '../../../shared/naming'
import { segmentSpeed } from '../../../shared/speed'
import type { ExportProgress, ExportQualityMode, Settings } from '../../../shared/types'
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
  | { kind: 'failed'; message: string; canceled?: boolean }

interface Burst {
  id: number
  name: string
}

const fileName = (filePath: string): string => filePath.split(/[\\/]/).pop() || filePath

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
  const [sameLook, setSameLook] = useState(true)
  const [codec, setCodec] = useState<VideoCodec>('h264')
  const [fileBase, setFileBase] = useState('')
  const [outputDir, setOutputDir] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [burst, setBurst] = useState<Burst | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const burstId = useRef(0)

  useEffect(() => {
    engine.pause()
    void window.ezclip.getSettings().then((s) => {
      setSettings(s)
      setQuality(s.exportQuality)
      setCodec(s.exportCodec)
      setOutputDir(s.outputDir)
      setFileBase((current) => (current.trim() ? current : timestampedName(s.filePrefix, new Date())))
    })
    void window.ezclip.ffmpegInfo().then((info) => setEncoders(info.videoEncoders))
  }, [])

  const sources = useMemo(() => [...new Set(layout.placed.map((p) => p.item))], [layout])
  const infos = useMemo(() => sources.map((s) => s.info), [sources])
  const issues = useMemo(() => checkCompatibility(infos), [infos])
  const indexing = sources.some((s) => s.keyframeStatus === 'indexing')
  const anySpeed = layout.placed.some((p) => segmentSpeed(p.seg.speed) !== 1)
  const streamCopy = !sameLook && quality >= LOSSLESS_QUALITY && !anySpeed
  const encoder = encoders?.find((e) => e.codec === codec) ?? encoders?.[0] ?? null
  const audioTracks = encodedAudioTracks(infos)

  const parts = layout.placed.map((p) => ({ info: p.item.info, duration: p.duration }))
  const estimatedSize = sameLook
    ? estimateSameLookSize(parts, encoder?.codec ?? codec, audioTracks)
    : estimateOutputSize(parts, streamCopy ? LOSSLESS_QUALITY : quality, audioTracks)

  const running = status.kind === 'running'
  const blockedByIssues = streamCopy && issues.length > 0
  const canExport =
    layout.placed.length > 0 && !blockedByIssues && !(indexing && streamCopy) && !running && (streamCopy || !!encoder)

  const qualityMode = (): ExportQualityMode =>
    sameLook ? 'same' : quality >= LOSSLESS_QUALITY ? 'lossless' : 'bitrate'

  const changeFolder = async (): Promise<void> => {
    const dir = await window.ezclip.chooseOutputDir()
    if (!dir) return
    setOutputDir(dir)
    const next = await window.ezclip.setSettings({ outputDir: dir })
    setSettings(next)
    setOutputDir(next.outputDir)
  }

  const setDeleteOriginals = (deleteOriginalsAfterExport: boolean): void => {
    setSettings((current) => (current ? { ...current, deleteOriginalsAfterExport } : current))
    void window.ezclip.setSettings({ deleteOriginalsAfterExport }).then(setSettings)
  }

  const start = async (): Promise<void> => {
    setNote(null)
    setStatus({ kind: 'running', progress: null })
    const unsubscribe = window.ezclip.onExportProgress((progress) => setStatus({ kind: 'running', progress }))
    const deleteOriginals = settings?.deleteOriginalsAfterExport === true
    const segments = layout.placed.map((p) => ({
      path: p.item.info.path,
      start: streamCopy ? snapToKeyframe(p.item.keyframes, p.playStart) : p.playStart,
      end: p.playEnd,
      speed: segmentSpeed(p.seg.speed)
    }))
    try {
      const chosenCodec = encoder?.codec ?? codec
      const mode = qualityMode()
      const typedName = nameRef.current?.value ?? fileBase
      void window.ezclip.setSettings({
        exportQuality: quality,
        exportCodec: chosenCodec,
        exportSameLook: mode === 'same',
        ...(outputDir ? { outputDir } : {})
      })
      const result = await window.ezclip.exportVideo({
        segments,
        quality: mode === 'bitrate' ? quality : LOSSLESS_QUALITY,
        codec: chosenCodec,
        mode,
        fileName: typedName,
        outputDir: outputDir || settings?.outputDir,
        sameLook: mode === 'same'
      })
      if (!result.ok) {
        setStatus({ kind: 'failed', message: result.error, canceled: result.canceled })
        return
      }

      let failed: string[] = []
      if (deleteOriginals) {
        engine.release()
        await new Promise((resolve) => setTimeout(resolve, 300))
        const sourcePaths = [...new Set(segments.map((segment) => segment.path))]
        try {
          const outcome = await window.ezclip.deleteImportedFiles(sourcePaths, [result.outputPath])
          failed = outcome.failed.map((item) => fileName(item.path))
          const deleted = new Set(outcome.deleted)
          const ids = useStore
            .getState()
            .media.filter((item) => deleted.has(item.info.path))
            .map((item) => item.id)
          if (ids.length > 0) useStore.getState().forgetMedia(ids)
        } catch (e) {
          failed = sourcePaths.map(fileName)
          useStore.getState().showToast(`Exported, but couldn’t delete the originals: ${errorMessage(e)}`, 'error')
        }
      }

      setNote(failed.length > 0 ? `Couldn’t delete ${failed.join(', ')}.` : null)
      burstId.current += 1
      setBurst({ id: burstId.current, name: fileName(result.outputPath) })
      setStatus({ kind: 'idle' })
    } catch (e) {
      setStatus({ kind: 'failed', message: errorMessage(e) })
    } finally {
      unsubscribe()
    }
  }

  const folder = outputDir || settings?.outputDir || ''

  const footer = running ? (
    <button type="button" className="btn-secondary" onClick={() => void window.ezclip.cancelExport()}>
      Cancel
    </button>
  ) : (
    <>
      <button type="button" className="btn-secondary" onClick={onClose}>
        Close
      </button>
      <button type="button" className="btn-primary" disabled={!canExport} onClick={() => void start()}>
        Export
      </button>
    </>
  )

  return (
    <>
      <Modal title="Export" onClose={onClose} closable={!running} footer={footer} widthClass="w-[460px]">
        <div className="space-y-5">
          <fieldset disabled={running} className="space-y-5">
            <label className="block" htmlFor="export-name">
              <span className="text-xs text-zinc-500">File name</span>
              <span className="mt-1.5 flex items-center rounded-lg border border-zinc-800 bg-zinc-950 focus-within:border-accent">
                <input
                  id="export-name"
                  ref={nameRef}
                  className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-sm text-zinc-100 outline-none disabled:opacity-50"
                  value={fileBase}
                  disabled={!settings}
                  spellCheck={false}
                  onChange={(e) => setFileBase(e.target.value.replace(/[<>:"/\\|?*]/g, ''))}
                />
                <span className="pr-3 font-mono text-sm text-zinc-500">.mp4</span>
              </span>
            </label>

            <div>
              <div className="mb-1.5 text-xs text-zinc-500">Quality</div>
              <div className="grid grid-cols-5 gap-1 rounded-lg bg-zinc-900 p-1">
                <QualityButton
                  active={!sameLook && quality >= LOSSLESS_QUALITY}
                  onClick={() => {
                    setSameLook(false)
                    setQuality(LOSSLESS_QUALITY)
                  }}
                >
                  Lossless
                </QualityButton>
                <QualityButton active={sameLook} onClick={() => setSameLook(true)}>
                  Optimal
                </QualityButton>
                {QUALITY_PRESETS.filter((q) => q < LOSSLESS_QUALITY).map((q) => (
                  <QualityButton
                    key={q}
                    active={!sameLook && quality === q}
                    onClick={() => {
                      setSameLook(false)
                      setQuality(q)
                    }}
                  >
                    {q}%
                  </QualityButton>
                ))}
              </div>
              {!sameLook && quality < LOSSLESS_QUALITY && (
                <input
                  type="range"
                  min={MIN_QUALITY}
                  max={LOSSLESS_QUALITY - 5}
                  step={5}
                  value={Math.min(quality, LOSSLESS_QUALITY - 5)}
                  onChange={(e) => {
                    setSameLook(false)
                    setQuality(Number(e.target.value))
                  }}
                  className="accent-accent mt-3 w-full"
                  aria-label="Quality"
                />
              )}
              {!streamCopy && (
                <div className="mt-2 flex items-center gap-1">
                  {encoders === null ? (
                    <span className="text-xs text-zinc-500">Checking formats…</span>
                  ) : encoders.length === 0 ? (
                    <span className="text-xs text-red-300">No video encoder found.</span>
                  ) : (
                    encoders.map((e) => (
                      <button
                        key={e.codec}
                        type="button"
                        className={`rounded-md px-2 py-1 text-xs ${
                          encoder?.codec === e.codec ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                        onClick={() => setCodec(e.codec)}
                      >
                        {CODEC_LABEL[e.codec].name}
                        {!e.hardware && <span className="ml-1 text-[10px] text-amber-400/80">CPU</span>}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-zinc-800 px-3 py-2.5">
                <div className="text-xs text-zinc-500">Length</div>
                <div className="mt-0.5 font-mono text-lg text-zinc-50">{formatTime(layout.total, false)}</div>
              </div>
              <div className="rounded-lg border border-zinc-800 px-3 py-2.5">
                <div className="text-xs text-zinc-500">Estimated size</div>
                <div className="mt-0.5 font-mono text-lg text-zinc-50">{formatBytes(estimatedSize)}</div>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-zinc-500">Folder</div>
                  <div className="truncate text-left font-mono text-xs text-zinc-300" title={folder}>
                    {folder || '…'}
                  </div>
                </div>
                <button
                  type="button"
                  className="shrink-0 text-xs text-accent-strong hover:text-zinc-100 disabled:opacity-40"
                  disabled={running}
                  onClick={() => void changeFolder()}
                >
                  Change
                </button>
              </div>
              <div className="mt-2.5">
                <PrettyCheck
                  checked={settings?.deleteOriginalsAfterExport ?? false}
                  disabled={!settings}
                  onChange={setDeleteOriginals}
                  label="Delete original clips"
                />
              </div>
            </div>
          </fieldset>

          {layout.placed.length === 0 && <p className="text-xs text-amber-200/90">Nothing to export.</p>}
          {indexing && streamCopy && <p className="text-xs text-zinc-400">Indexing…</p>}
          {issues.length > 0 && streamCopy && (
            <p className="text-xs text-red-300">Can’t join these losslessly. Choose Optimal, or a lower quality.</p>
          )}
          {note && <p className="text-xs text-amber-200/90">{note}</p>}
          {status.kind === 'failed' && (
            <p className={`text-xs ${status.canceled ? 'text-zinc-400' : 'text-red-300'}`}>{status.message}</p>
          )}
          {running && <ProgressBar progress={status.progress} />}
        </div>
      </Modal>
      {burst && (
        <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center">
          <div
            key={burst.id}
            className="export-burst flex flex-col items-center gap-2 rounded-2xl bg-zinc-900 px-8 py-6 shadow-2xl ring-1 ring-white/10"
            onAnimationEnd={(event) => {
              if (event.target !== event.currentTarget) return
              setBurst((current) => (current?.id === burst.id ? null : current))
            }}
          >
            <span className="grid h-10 w-10 place-items-center rounded-full bg-accent text-white">
              <svg viewBox="0 0 16 16" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3.5 8.2 6.4 11.2 12.5 4.8" />
              </svg>
            </span>
            <div className="text-sm font-medium text-zinc-50">Exported</div>
            <div className="max-w-56 truncate font-mono text-xs text-zinc-400">{burst.name}</div>
          </div>
        </div>
      )}
    </>
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

function QualityButton({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={`rounded-md px-1 py-1.5 text-xs leading-none whitespace-nowrap ${
        active ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-500 hover:text-zinc-300'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function PrettyCheck({
  checked,
  disabled,
  onChange,
  label
}: {
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <label
      className={`inline-flex items-center gap-2 text-xs ${disabled ? 'opacity-40' : 'cursor-pointer'} ${
        checked ? 'text-zinc-200' : 'text-zinc-500'
      }`}
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="grid h-3.5 w-3.5 place-items-center rounded-[4px] border border-zinc-600 bg-zinc-950 transition peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40">
        <svg
          viewBox="0 0 12 12"
          className={`h-2.5 w-2.5 text-white transition-opacity ${checked ? 'opacity-100' : 'opacity-0'}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M2.2 6.2 4.7 8.6 9.8 3.4" />
        </svg>
      </span>
      {label}
    </label>
  )
}
