import { DropOverlay } from './components/DropOverlay'
import { MediaBin } from './components/MediaBin'
import { ShortcutBar } from './components/ShortcutBar'
import { SourceScrubber } from './components/SourceScrubber'
import { ToastView } from './components/ToastView'
import { Transport } from './components/Transport'
import { Viewer } from './components/Viewer'
import { useShortcuts } from './hooks/useShortcuts'
import { useStore } from './store'

export default function App() {
  useShortcuts()
  const activeItem = useStore((s) => s.media.find((m) => m.id === s.activeSourceId))
  const segmentCount = useStore((s) => s.segments.length)

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-800 px-4">
        <span className="text-lg font-semibold tracking-tight">
          Ez<span className="text-accent">-clip</span>
        </span>
        <span className="ml-auto text-xs text-zinc-500">{segmentCount} clip{segmentCount === 1 ? '' : 's'} on timeline</span>
      </header>

      <div className="flex min-h-0 flex-1">
        <MediaBin />
        <section className="flex min-w-0 flex-1 flex-col">
          <Viewer />
          {activeItem && <SourceScrubber item={activeItem} />}
          <Transport />
        </section>
      </div>

      <ShortcutBar />
      <DropOverlay />
      <ToastView />
    </div>
  )
}
