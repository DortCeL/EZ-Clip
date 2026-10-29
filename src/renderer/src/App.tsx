import { useCallback, useEffect } from 'react'
import { DropOverlay } from './components/DropOverlay'
import { ExportDialog } from './components/ExportDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { MediaBin } from './components/MediaBin'
import { SourceScrubber } from './components/SourceScrubber'
import { Timeline } from './components/Timeline'
import { ToastView } from './components/ToastView'
import { Transport } from './components/Transport'
import { Viewer } from './components/Viewer'
import { useShortcuts } from './hooks/useShortcuts'
import { openImportDialog } from './lib/importMedia'
import { bootSession } from './lib/session'
import { useStore } from './store'

export default function App() {
  useShortcuts()
  useEffect(() => bootSession(), [])
  const mode = useStore((s) => s.mode)
  const activeItem = useStore((s) => s.media.find((m) => m.id === s.activeSourceId))
  const dialog = useStore((s) => s.dialog)
  const setDialog = useStore((s) => s.setDialog)
  const closeDialog = useCallback(() => setDialog(null), [setDialog])

  return (
    <div className="flex h-full flex-col">
      <header className="relative flex h-11 shrink-0 items-center border-b border-zinc-800 px-3">
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md bg-emerald-500 px-2.5 py-1.5 text-[13px] font-medium text-white hover:bg-emerald-400"
          onClick={() => void openImportDialog()}
          title="Import videos (Ctrl+O)"
        >
          <ImportIcon />
          Import clip
        </button>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-semibold tracking-tight text-zinc-100">Ez clip</span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-md bg-zinc-800 text-white ring-1 ring-zinc-600 hover:bg-zinc-700"
            onClick={() => setDialog('settings')}
            title="Settings (Ctrl+,)"
          >
            <GearIcon />
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setDialog('export')}
            title="Export the timeline (Ctrl+E)"
          >
            Export
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <MediaBin />
        <section className="relative flex min-w-0 flex-1 flex-col">
          <Viewer />
          {mode === 'source' && activeItem && <SourceScrubber item={activeItem} />}
          <Transport />
          <p className="pointer-events-none absolute top-3 left-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-zinc-100 ring-1 ring-white/10 backdrop-blur-sm">
            {mode === 'source' ? 'Previewing original media' : 'Previewing timeline'}
          </p>
        </section>
      </div>

      <Timeline />
      <DropOverlay />
      <ToastView />
      {dialog === 'export' && <ExportDialog onClose={closeDialog} />}
      {dialog === 'settings' && <SettingsDialog onClose={closeDialog} />}
    </div>
  )
}

function ImportIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M8 2.5v8M4.5 7.5 8 11l3.5-3.5M3 13.5h10" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
