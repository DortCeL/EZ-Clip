import { useEffect, useState } from 'react'
import { timestampedName } from '../../../shared/naming'
import type { FfmpegInfo, Settings } from '../../../shared/types'
import { Modal } from './Modal'

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [prefix, setPrefix] = useState('')
  const [ffmpeg, setFfmpeg] = useState<FfmpegInfo | null>(null)

  useEffect(() => {
    void window.ezclip.getSettings().then((s) => {
      setSettings(s)
      setPrefix(s.filePrefix)
    })
    void window.ezclip.ffmpegInfo().then(setFfmpeg)
  }, [])

  const save = async (patch: Partial<Settings>): Promise<void> => {
    const next = await window.ezclip.setSettings(patch)
    setSettings(next)
    setPrefix(next.filePrefix)
  }

  const browse = async (): Promise<void> => {
    const dir = await window.ezclip.chooseOutputDir()
    if (dir) await save({ outputDir: dir })
  }

  const nvenc = ffmpeg?.hwEncoders.filter((e) => e.endsWith('_nvenc')) ?? []

  return (
    <Modal title="Settings" onClose={onClose} footer={<button className="btn-primary" onClick={onClose}>Done</button>}>
      {!settings ? (
        <div className="text-sm text-zinc-500">Loading…</div>
      ) : (
        <div className="space-y-5 text-sm">
          <Field label="Export folder">
            <div className="flex gap-2">
              <div className="flex-1 truncate rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-xs" title={settings.outputDir}>
                {settings.outputDir}
              </div>
              <button className="btn-secondary" onClick={() => void browse()}>
                Browse…
              </button>
              <button className="btn-secondary" onClick={() => void window.ezclip.revealInFolder(settings.outputDir)}>
                Open
              </button>
            </div>
          </Field>

          <Field label="File name prefix">
            <input
              className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-accent"
              value={prefix}
              maxLength={40}
              onChange={(e) => setPrefix(e.target.value)}
              onBlur={() => prefix !== settings.filePrefix && void save({ filePrefix: prefix })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            <div className="mt-1.5 text-xs text-zinc-500">
              Example: <span className="font-mono text-zinc-300">{timestampedName(prefix || 'EzClip', new Date())}.mp4</span>
              <br />
              Date and time in the name keep exports sorted chronologically.
            </div>
          </Field>

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="accent-accent h-4 w-4"
              checked={settings.revealAfterExport}
              onChange={(e) => void save({ revealAfterExport: e.target.checked })}
            />
            Show the file in Explorer after exporting
          </label>

          <Field label="FFmpeg">
            <div className="space-y-1 text-xs text-zinc-400">
              <div className="font-mono">{ffmpeg?.version.replace(/ Copyright.*/, '') ?? 'loading…'}</div>
              <div>
                NVIDIA encoders available:{' '}
                {nvenc.length ? <span className="text-emerald-400">{nvenc.join(', ')}</span> : <span>none</span>}
                <span className="text-zinc-600"> (used by compressed export, coming next)</span>
              </div>
            </div>
          </Field>
        </div>
      )}
    </Modal>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold tracking-wider text-zinc-400 uppercase">{label}</div>
      {children}
    </div>
  )
}
