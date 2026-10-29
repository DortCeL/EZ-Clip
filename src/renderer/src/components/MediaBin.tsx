import { formatTime } from '../lib/format'
import { addWholeClip } from '../lib/timelineActions'
import { useStore, type MediaItem } from '../store'

export function MediaBin() {
  const media = useStore((s) => s.media)
  const importing = useStore((s) => s.importing)

  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950/60">
      <div className="flex-1 space-y-0.5 overflow-y-auto px-1.5 py-2">
        {media.map((item) => (
          <MediaCard key={item.id} item={item} />
        ))}
        {importing > 0 && (
          <div className="px-2 py-3 text-center text-[11px] text-zinc-500">
            Reading {importing} file{importing > 1 ? 's' : ''}…
          </div>
        )}
        {media.length === 0 && importing === 0 && (
          <div className="px-3 pt-6 text-center text-[11px] text-zinc-500">Drop clips here</div>
        )}
      </div>
    </aside>
  )
}

function MediaCard({ item }: { item: MediaItem }) {
  const active = useStore((s) => s.activeSourceId === item.id && s.mode === 'source')
  const { info } = item

  const open = (): void => {
    const s = useStore.getState()
    s.setActiveSource(item.id)
    s.setMode('source')
  }

  return (
    <div
      className={`group relative flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 ${
        active ? 'bg-zinc-800' : 'hover:bg-zinc-900'
      }`}
      onClick={open}
      title={info.path}
    >
      <div className="relative h-10 w-[4.5rem] shrink-0 overflow-hidden rounded bg-black">
        {item.thumbnail && <img src={item.thumbnail} className="h-full w-full object-cover" alt="" />}
        <span className="absolute right-0.5 bottom-0.5 rounded bg-black/75 px-0.5 font-mono text-[9px] text-zinc-100">
          {formatTime(info.duration, false)}
        </span>
        <span className="absolute top-0.5 left-0.5 h-1.5 w-1.5 rounded-full" style={{ background: item.color }} />
      </div>
      <div className="min-w-0 flex-1 pr-1">
        <div className="truncate text-xs text-zinc-200">{info.name}</div>
        {item.keyframeStatus === 'indexing' && <div className="text-[10px] text-amber-400">Indexing</div>}
        {item.keyframeStatus === 'error' && <div className="text-[10px] text-red-400">No keyframes</div>}
      </div>
      <div className="absolute top-1 right-1 hidden items-center gap-0.5 group-hover:flex">
        <button
          className="bg-accent hover:bg-accent-strong grid h-5 w-5 place-items-center rounded text-[11px] font-medium text-white"
          onClick={(e) => {
            e.stopPropagation()
            addWholeClip(item.id)
          }}
          title="Add the whole clip to the timeline"
        >
          +
        </button>
        <button
          className="grid h-5 w-5 place-items-center rounded bg-black/80 text-xs text-zinc-300 hover:bg-red-600 hover:text-white"
          onClick={(e) => {
            e.stopPropagation()
            useStore.getState().removeMedia(item.id)
          }}
          title="Remove from project"
        >
          ×
        </button>
      </div>
    </div>
  )
}
