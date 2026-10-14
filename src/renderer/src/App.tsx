import { useCallback } from 'react'
import { DropOverlay } from './components/DropOverlay'
import { ExportDialog } from './components/ExportDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { MediaBin } from './components/MediaBin'
import { ModeTabs } from './components/ModeTabs'
import { ShortcutBar } from './components/ShortcutBar'
import { SourceScrubber } from './components/SourceScrubber'
import { Timeline } from './components/Timeline'
import { ToastView } from './components/ToastView'
import { Transport } from './components/Transport'
import { Viewer } from './components/Viewer'
import { useShortcuts } from './hooks/useShortcuts'
import { useStore } from './store'

export default function App() {
  useShortcuts()
  const mode = useStore((s) => s.mode)
  const activeItem = useStore((s) => s.media.find((m) => m.id === s.activeSourceId))
  const dialog = useStore((s) => s.dialog)
  const hasSegments = useStore((s) => s.segments.length > 0)
  const setDialog = useStore((s) => s.setDialog)
  const closeDialog = useCallback(() => setDialog(null), [setDialog])

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-800 px-4">
        <span className="text-lg font-semibold tracking-tight">
          Ez<span className="text-accent">-clip</span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button className="btn-secondary" onClick={() => setDialog('settings')} title="Settings (Ctrl+,)">
            Settings
          </button>
          <button
            className="btn-primary"
            onClick={() => setDialog('export')}
            disabled={!hasSegments}
            title="Export the timeline (Ctrl+E)"
          >
            Export
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <MediaBin />
        <section className="flex min-w-0 flex-1 flex-col">
          <ModeTabs />
          <Viewer />
          {mode === 'source' && activeItem && <SourceScrubber item={activeItem} />}
          <Transport />
        </section>
      </div>

      <Timeline />
      <ShortcutBar />
      <DropOverlay />
      <ToastView />
      {dialog === 'export' && <ExportDialog onClose={closeDialog} />}
      {dialog === 'settings' && <SettingsDialog onClose={closeDialog} />}
    </div>
  )
}
