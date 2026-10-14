import { toggleMode } from '../lib/timelineActions'
import { useStore } from '../store'

export function ModeTabs() {
  const mode = useStore((s) => s.mode)
  const sourceName = useStore((s) => s.media.find((m) => m.id === s.activeSourceId)?.info.name)
  const segmentCount = useStore((s) => s.segments.length)

  const tab = (active: boolean): string =>
    `flex items-center gap-2 rounded-t-md px-3 py-1.5 text-xs transition-colors ${
      active ? 'bg-zinc-900 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
    }`

  return (
    <div className="flex h-9 shrink-0 items-end gap-1 px-3">
      <button className={tab(mode === 'source')} onClick={() => mode !== 'source' && toggleMode()}>
        <span className="font-semibold">Source</span>
        <span className="max-w-64 truncate text-zinc-500">{sourceName ?? 'no clip'}</span>
      </button>
      <button className={tab(mode === 'timeline')} onClick={() => mode !== 'timeline' && toggleMode()}>
        <span className="font-semibold">Timeline</span>
        <span className="text-zinc-500">
          {segmentCount} clip{segmentCount === 1 ? '' : 's'}
        </span>
      </button>
      <span className="ml-2 pb-1.5 text-[10px] text-zinc-600">
        <kbd>Tab</kbd> to switch
      </span>
    </div>
  )
}
