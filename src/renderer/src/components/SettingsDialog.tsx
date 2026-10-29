import { useEffect, useState } from 'react'
import { timestampedName } from '../../../shared/naming'
import type { Settings } from '../../../shared/types'
import { Modal } from './Modal'

/** Short names people actually put on clip files. EzClip stays so the default is one click away. */
const PREFIX_PRESETS = [
  'EzClip',
  'Siege',
  'CS2',
  'Valorant',
  'Dota',
  'League',
  'Apex',
  'Fortnite',
  'Overwatch',
  'Warzone',
  'Rust',
  'Tarkov',
  'PUBG',
  'Rivals',
  'RocketLeague',
  'Minecraft',
  'GTA',
  'Deadlock',
  'Helldivers',
  'WoW',
  'Destiny',
  'Halo'
]

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [prefix, setPrefix] = useState('')

  useEffect(() => {
    void window.ezclip.getSettings().then((s) => {
      setSettings(s)
      setPrefix(s.filePrefix)
    })
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

  const pickPrefix = (name: string): void => {
    setPrefix(name)
    if (settings && name !== settings.filePrefix) void save({ filePrefix: name })
  }

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
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PREFIX_PRESETS.map((name) => {
                const selected = prefix.trim().toLowerCase() === name.toLowerCase()
                return (
                  <button
                    key={name}
                    type="button"
                    className={`rounded-md border px-2 py-0.5 text-xs ${
                      selected
                        ? 'border-accent text-zinc-100'
                        : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'
                    }`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickPrefix(name)}
                  >
                    {name}
                  </button>
                )
              })}
            </div>
            <div className="mt-1.5 font-mono text-xs text-zinc-500">
              {timestampedName(prefix || 'EzClip', new Date())}.mp4
            </div>
          </Field>

          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              className="accent-accent mt-0.5 h-4 w-4"
              checked={settings.deleteOriginalsAfterExport}
              onChange={(e) => void save({ deleteOriginalsAfterExport: e.target.checked })}
            />
            <span>
              Delete original clips after export
              <span className="mt-0.5 block text-xs text-zinc-500">
                After a successful export, the source files used in it are deleted from disk. This can’t be undone.
              </span>
            </span>
          </label>
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
