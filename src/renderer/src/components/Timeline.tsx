import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatTime } from '../lib/format'
import { layoutSequence, type PlacedSegment } from '../lib/sequence'
import { deleteSelected, redo, selectAndSeek, splitAtPlayhead, undo } from '../lib/timelineActions'
import { engine, usePlayback } from '../player'
import { useStore } from '../store'

const TRACK_PADDING = 16
const EDGE_SCROLL_ZONE = 40
const EDGE_SCROLL_STEP = 24

export function Timeline() {
  const segments = useStore((s) => s.segments)
  const media = useStore((s) => s.media)
  const mode = useStore((s) => s.mode)
  const selectedId = useStore((s) => s.selectedSegmentId)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const layout = useMemo(() => layoutSequence(segments, media), [segments, media])
  const [zoom, setZoom] = useState(1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const viewportWidth = useElementWidth(scrollRef)

  const fitPxPerSec = layout.total > 0 ? Math.max(1, (viewportWidth - TRACK_PADDING * 2) / layout.total) : 10
  const pxPerSec = fitPxPerSec * zoom
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const onDragEnd = (e: DragEndEvent): void => {
    if (!e.over || e.active.id === e.over.id) return
    const to = segments.findIndex((s) => s.id === e.over!.id)
    useStore.getState().moveSegment(String(e.active.id), to)
  }

  const [scrubbing, setScrubbing] = useState(false)

  const timeAt = (clientX: number, el: HTMLElement): number =>
    (clientX - el.getBoundingClientRect().left - TRACK_PADDING) / pxPerSec

  const autoScroll = (clientX: number): void => {
    const sc = scrollRef.current
    if (!sc) return
    const rect = sc.getBoundingClientRect()
    if (clientX > rect.right - EDGE_SCROLL_ZONE) sc.scrollLeft += EDGE_SCROLL_STEP
    else if (clientX < rect.left + EDGE_SCROLL_ZONE) sc.scrollLeft -= EDGE_SCROLL_STEP
  }

  const onTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || layout.total === 0) return
    if ((e.target as HTMLElement).closest('[data-block]')) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setScrubbing(true)
    engine.pause()
    const t = timeAt(e.clientX, e.currentTarget)
    const store = useStore.getState()
    if (store.mode !== 'timeline') {
      engine.setTimelineTimeHint(t)
      store.setMode('timeline')
    } else {
      engine.scrub(t)
    }
  }

  const onTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    autoScroll(e.clientX)
    engine.scrub(timeAt(e.clientX, e.currentTarget))
  }

  const endScrub = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    setScrubbing(false)
  }

  return (
    <section
      className={`flex h-44 shrink-0 flex-col border-t ${
        mode === 'timeline' ? 'border-accent/60' : 'border-zinc-800'
      } bg-zinc-950`}
    >
      <div className="flex h-9 shrink-0 items-center gap-3 px-4 text-xs">
        <span className="font-semibold tracking-wider text-zinc-400 uppercase">Timeline</span>
        <span className="text-zinc-500">
          {layout.placed.length} clip{layout.placed.length === 1 ? '' : 's'} · {formatTime(layout.total)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            className="rounded-md border border-zinc-700 px-2 py-1 hover:border-zinc-500 disabled:opacity-40"
            onClick={undo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
          >
            Undo
          </button>
          <button
            className="rounded-md border border-zinc-700 px-2 py-1 hover:border-zinc-500 disabled:opacity-40"
            onClick={redo}
            disabled={!canRedo}
            title="Redo (Ctrl+Y)"
          >
            Redo
          </button>
          <button
            className="rounded-md border border-zinc-700 px-2 py-1 hover:border-zinc-500 disabled:opacity-40"
            onClick={splitAtPlayhead}
            disabled={mode !== 'timeline' || layout.placed.length === 0}
            title="Split at playhead (S)"
          >
            Split <kbd>S</kbd>
          </button>
          <button
            className="rounded-md border border-zinc-700 px-2 py-1 hover:border-red-500 hover:text-red-300 disabled:opacity-40"
            onClick={deleteSelected}
            disabled={!selectedId}
            title="Remove selected clip (Delete)"
          >
            Delete <kbd>Del</kbd>
          </button>
          <span className="ml-2 text-zinc-500">Zoom</span>
          <input
            type="range"
            min={1}
            max={30}
            step={0.5}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="accent-accent w-28"
          />
        </div>
      </div>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div
          className="relative h-full"
          style={{ width: Math.max(viewportWidth, layout.total * pxPerSec + TRACK_PADDING * 2) }}
          onPointerDown={onTrackPointerDown}
          onPointerMove={onTrackPointerMove}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
        >
          <Ruler total={layout.total} pxPerSec={pxPerSec} />
          {layout.placed.length === 0 ? (
            <div className="pointer-events-none absolute inset-x-0 top-8 text-center text-xs text-zinc-500">
              Mark a kill with <kbd>I</kbd> / <kbd>O</kbd> and press <kbd>A</kbd>, or use “+ Timeline” on a clip.
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={segments.map((s) => s.id)} strategy={horizontalListSortingStrategy}>
                <div
                  className="pointer-events-none absolute top-7 bottom-3 flex"
                  style={{ left: TRACK_PADDING }}
                >
                  {layout.placed.map((p) => (
                    <Block key={p.seg.id} placed={p} pxPerSec={pxPerSec} selected={p.seg.id === selectedId} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
          {mode === 'timeline' && layout.total > 0 && <Playhead pxPerSec={pxPerSec} dragging={scrubbing} />}
        </div>
      </div>
    </section>
  )
}

function Block({ placed, pxPerSec, selected }: { placed: PlacedSegment; pxPerSec: number; selected: boolean }) {
  const { seg, item, duration } = placed
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: seg.id })
  const width = Math.max(4, duration * pxPerSec)

  const onClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    selectAndSeek(seg.id, (e.clientX - rect.left) / pxPerSec)
  }

  return (
    <div
      ref={setNodeRef}
      data-block
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={`pointer-events-auto relative h-full shrink-0 cursor-grab overflow-hidden rounded-md border-2 bg-zinc-800 active:cursor-grabbing ${
        selected ? 'border-white' : 'border-zinc-950'
      } ${isDragging ? 'z-10 opacity-80 shadow-2xl' : ''}`}
      style={{
        width,
        transform: CSS.Translate.toString(transform),
        transition
      }}
      title={`${item.info.name}\n${formatTime(seg.start)} – ${formatTime(seg.end)} (${formatTime(duration)})`}
    >
      <div className="h-1.5 w-full" style={{ background: item.color }} />
      {item.thumbnail && width > 60 && (
        <img src={item.thumbnail} alt="" className="absolute inset-x-0 top-1.5 bottom-0 h-full w-full object-cover opacity-25" />
      )}
      {width > 48 && (
        <div className="relative px-1.5 py-1 text-[10px] leading-tight">
          <div className="truncate font-medium text-zinc-100">{item.info.name}</div>
          <div className="truncate font-mono text-zinc-400">{formatTime(duration)}</div>
        </div>
      )}
    </div>
  )
}

function Playhead({ pxPerSec, dragging }: { pxPerSec: number; dragging: boolean }) {
  const time = usePlayback((s) => s.time)
  return (
    <div
      className="group absolute top-0 bottom-0 z-20 w-3 -translate-x-1/2 cursor-ew-resize"
      style={{ left: TRACK_PADDING + time * pxPerSec }}
      title="Drag to scrub"
    >
      <div className="pointer-events-none absolute top-0 bottom-0 left-1/2 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_6px_rgba(255,255,255,0.7)]" />
      <div
        className={`pointer-events-none absolute top-0 left-1/2 h-0 w-0 -translate-x-1/2 border-x-[7px] border-t-[10px] border-x-transparent ${
          dragging ? 'border-t-accent' : 'border-t-white group-hover:border-t-accent'
        }`}
      />
      {dragging && (
        <div className="pointer-events-none absolute top-3 left-2 rounded bg-black/80 px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-white">
          {formatTime(time)}
        </div>
      )}
    </div>
  )
}

function Ruler({ total, pxPerSec }: { total: number; pxPerSec: number }) {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  const step = steps.find((s) => s * pxPerSec >= 70) ?? 600
  const ticks: number[] = []
  for (let t = 0; t <= total + 1e-6; t += step) ticks.push(t)
  return (
    <div className="absolute inset-x-0 top-0 h-6 cursor-ew-resize border-b border-zinc-800 hover:bg-zinc-900">
      {ticks.map((t) => (
        <div key={t} className="pointer-events-none absolute top-0 h-full" style={{ left: TRACK_PADDING + t * pxPerSec }}>
          <div className="h-2 w-px bg-zinc-600" />
          <span className="absolute top-2 left-1 font-mono text-[9px] text-zinc-500">{formatTime(t, false)}</span>
        </div>
      ))}
    </div>
  )
}

function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(800)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [ref])
  return width
}
