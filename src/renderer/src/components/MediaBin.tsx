import { formatFps, formatTime } from '../lib/format'
import { openImportDialog } from '../lib/importMedia'
import { addWholeClip } from '../lib/timelineActions'
import { useStore, type MediaItem } from '../store'

export function MediaBin() {
  const media = useStore((s) => s.media)
  const importing = useStore((s) => s.importing)

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950/60">
      <div className="flex h-10 items-center justify-between px-3">
        <span className="text-xs font-semibold tracking-wider text-zinc-400 uppercase">Media</span>
        <button
          className="rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
          onClick={() => void openImportDialog()}
          title="Import videos (Ctrl+O)"
        >
          + Import
        </button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {media.map((item) => (
          <MediaCard key={item.id} item={item} />
        ))}
        {importing > 0 && (
          <div className="rounded-lg border border-dashed border-zinc-700 p-3 text-center text-xs text-zinc-400">
            Reading {importing} file{importing > 1 ? 's' : ''}…
          </div>
        )}
        {media.length === 0 && importing === 0 && (
          <div className="mt-8 px-4 text-center text-xs leading-relaxed text-zinc-500">
            Drop your recordings anywhere in the window, or press <kbd>Ctrl</kbd>+<kbd>O</kbd>.
          </div>
        )}
      </div>
    </aside>
  )
}

function MediaCard({ item }: { item: MediaItem }) {
  const active = useStore((s) => s.activeSourceId === item.id && s.mode === 'source')
  const usedCount = useStore((s) => s.segments.filter((seg) => seg.sourceId === item.id).length)
  const { info } = item
  const v = info.video

  const open = (): void => {
    const s = useStore.getState()
    s.setActiveSource(item.id)
    s.setMode('source')
  }

  return (
    <div
      className={`group relative cursor-pointer overflow-hidden rounded-lg border transition-colors ${
        active ? 'border-accent bg-zinc-900' : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-600'
      }`}
      onClick={open}
      title={info.path}
    >
      <div className="relative aspect-video bg-black">
        {item.thumbnail && <img src={item.thumbnail} className="h-full w-full object-cover" alt="" />}
        <span className="absolute right-1 bottom-1 rounded bg-black/75 px-1 font-mono text-[10px]">
          {formatTime(info.duration, false)}
        </span>
        <span className="absolute top-1 left-1 h-2 w-2 rounded-full" style={{ background: item.color }} />
        {usedCount > 0 && (
          <span className="bg-accent absolute bottom-1 left-1 rounded px-1 text-[10px] font-semibold text-white">
            {usedCount} on timeline
          </span>
        )}
      </div>
      <div className="px-2 py-1.5">
        <div className="truncate text-xs font-medium text-zinc-200">{info.name}</div>
        <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-zinc-500">
          {v && (
            <span>
              {v.width}×{v.height} · {formatFps(v.fps)}fps · {v.codec.toUpperCase()}
            </span>
          )}
          <span>
            {info.audio.length} audio track{info.audio.length === 1 ? '' : 's'}
          </span>
          {item.keyframeStatus === 'indexing' && <span className="text-amber-400">indexing keyframes…</span>}
          {item.keyframeStatus === 'error' && <span className="text-red-400">keyframes unavailable</span>}
        </div>
      </div>
      <button
        className="bg-accent hover:bg-accent-strong absolute top-1 right-7 hidden h-5 items-center rounded px-1.5 text-[10px] font-medium text-white group-hover:flex"
        onClick={(e) => {
          e.stopPropagation()
          addWholeClip(item.id)
        }}
        title="Add the whole clip to the timeline"
      >
        + Timeline
      </button>
      <button
        className="absolute top-1 right-1 hidden h-5 w-5 items-center justify-center rounded bg-black/70 text-xs text-zinc-300 group-hover:flex hover:bg-red-600 hover:text-white"
        onClick={(e) => {
          e.stopPropagation()
          useStore.getState().removeMedia(item.id)
        }}
        title="Remove from project"
      >
        ×
      </button>
    </div>
  )
}
