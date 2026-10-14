import { DropOverlay } from './components/DropOverlay'
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

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-800 px-4">
        <span className="text-lg font-semibold tracking-tight">
          Ez<span className="text-accent">-clip</span>
        </span>
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
    </div>
  )
}
