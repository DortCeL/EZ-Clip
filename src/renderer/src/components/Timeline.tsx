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
import { formatSpeed, segmentSpeed, SPEED_PRESETS } from '../../../shared/speed'
import { formatTime } from '../lib/format'
import { layoutSequence, mergeBlocker, type PlacedSegment } from '../lib/sequence'
import {
  copySelected,
  deleteSelected,
  duplicateBeside,
  mergeCut,
  mergeWithNext,
  pasteClipboard,
  redo,
  selectAndSeek,
  splitAtPlayhead,
  undo,
  useClipClipboard
} from '../lib/timelineActions'
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
  const canPaste = useClipClipboard((s) => s.clip != null)
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
    <section className="flex h-52 shrink-0 flex-col border-t border-zinc-800 bg-zinc-950">
      <div className="flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto px-2 text-xs">
        <ToolButton onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          Undo
        </ToolButton>
        <ToolButton onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">
          Redo
        </ToolButton>
        <ToolButton onClick={copySelected} disabled={!selectedId} title="Copy the selected clip (Ctrl+C)">
          Copy
        </ToolButton>
        <ToolButton onClick={pasteClipboard} disabled={!canPaste} title="Paste a copy after the selected clip (Ctrl+V)">
          Paste
        </ToolButton>
        <ToolButton
          onClick={splitAtPlayhead}
          disabled={mode !== 'timeline' || layout.placed.length === 0}
          title="Split at playhead (S)"
        >
          Split
        </ToolButton>
        <ToolButton
          onClick={() => mergeCut()}
          disabled={!selectedId || segments.length < 2}
          title="Join this clip with the neighboring piece of the same recording (M)"
        >
          Merge
        </ToolButton>
        <ToolButton onClick={deleteSelected} disabled={!selectedId} title="Remove selected clip (Delete)" danger>
          Delete
        </ToolButton>
        <span className="ml-auto text-zinc-500">{formatTime(layout.total, false)}</span>
        <input
          type="range"
          min={1}
          max={30}
          step={0.5}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="accent-accent w-24"
          title="Zoom"
          aria-label="Zoom"
        />
      </div>

      <SpeedRow selectedId={selectedId} />

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
              Add a clip
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={segments.map((s) => s.id)} strategy={horizontalListSortingStrategy}>
                <div
                  className="pointer-events-none absolute top-7 bottom-3 flex"
                  style={{ left: TRACK_PADDING }}
                >
                  {layout.placed.map((p, i) => {
                    const prev = layout.placed[i - 1]
                    const next = layout.placed[i + 1]
                    return (
                      <Block
                        key={p.seg.id}
                        placed={p}
                        pxPerSec={pxPerSec}
                        selected={p.seg.id === selectedId}
                        prevMergeId={prev && !mergeBlocker(prev.seg, p.seg) ? prev.seg.id : null}
                        canMergeNext={!!next && !mergeBlocker(p.seg, next.seg)}
                      />
                    )
                  })}
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

function SpeedRow({ selectedId }: { selectedId: string | null }) {
  const seg = useStore((s) => s.segments.find((x) => x.id === selectedId))
  const speed = segmentSpeed(seg?.speed)

  return (
    <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-zinc-800 px-4">
      <span className="mr-1 text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">Speed</span>
      {SPEED_PRESETS.map((preset) => {
        const selected = !!seg && speed === preset
        return (
          <button
            key={preset}
            type="button"
            disabled={!seg}
            className={`rounded-md border px-2 py-0.5 font-mono text-[11px] disabled:opacity-40 ${
              selected
                ? 'border-accent bg-zinc-800 text-zinc-100'
                : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'
            }`}
            onClick={() => seg && useStore.getState().setSegmentSpeed(seg.id, preset)}
          >
            {formatSpeed(preset)}
          </button>
        )
      })}
    </div>
  )
}

function Block({
  placed,
  pxPerSec,
  selected,
  prevMergeId,
  canMergeNext
}: {
  placed: PlacedSegment
  pxPerSec: number
  selected: boolean
  prevMergeId: string | null
  canMergeNext: boolean
}) {
  const { seg, item, duration, playStart, playEnd } = placed
  const speed = segmentSpeed(seg.speed)
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
      className={`group pointer-events-auto relative h-full shrink-0 cursor-grab rounded-md border-2 bg-zinc-800 active:cursor-grabbing ${
        selected ? 'border-white' : 'border-zinc-950'
      } ${isDragging ? 'z-10 opacity-80 shadow-2xl' : 'hover:z-30'}`}
      style={{
        width,
        transform: CSS.Translate.toString(transform),
        transition
      }}
      title={`${item.info.name}\n${formatTime(playStart)} – ${formatTime(playEnd)} of the recording\nPlays for ${formatTime(duration)} at ${formatSpeed(speed)}`}
    >
      <div className="absolute inset-0 overflow-hidden rounded-[4px]">
        <div className="h-1.5 w-full" style={{ background: item.color }} />
        {item.thumbnail && width > 60 && (
          <img src={item.thumbnail} alt="" className="absolute inset-x-0 top-1.5 bottom-0 h-full w-full object-cover opacity-25" />
        )}
        {speed !== 1 && (
          <span className="absolute top-2 right-1 rounded bg-black/80 px-1 font-mono text-[10px] text-violet-200">
            {formatSpeed(speed)}
          </span>
        )}
        {width > 48 && (
          <div className="relative px-1.5 py-1 text-[10px] leading-tight">
            <div className="truncate pr-8 font-medium text-zinc-100">{item.info.name}</div>
            <div className="truncate font-mono text-zinc-400">{formatTime(duration)}</div>
          </div>
        )}
      </div>
      {!isDragging && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <div className="pointer-events-auto" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            <ClipTool title="Duplicate" onClick={() => duplicateBeside(seg.id)}>
              <DuplicateIcon />
            </ClipTool>
          </div>
        </div>
      )}
      {!isDragging && prevMergeId && <SeamButton side="left" onClick={() => mergeWithNext(prevMergeId)} />}
      {!isDragging && canMergeNext && <SeamButton side="right" onClick={() => mergeWithNext(seg.id)} />}
    </div>
  )
}

function SeamButton({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  return (
    <button
      type="button"
      title="Merge"
      aria-label="Merge"
      className={`group/tip pointer-events-none absolute top-1/2 z-40 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-zinc-950/92 text-zinc-100 opacity-0 shadow-lg shadow-black/50 backdrop-blur-md transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-zinc-800 ${
        side === 'right' ? 'right-0 translate-x-1/2' : 'left-0 -translate-x-1/2'
      }`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      <MergeIcon />
      <span className="pointer-events-none absolute bottom-[calc(100%+7px)] left-1/2 z-10 -translate-x-1/2 rounded-md bg-zinc-950 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-white opacity-0 shadow-lg ring-1 ring-white/15 transition-opacity group-hover/tip:opacity-100">
        Merge
      </span>
    </button>
  )
}

function ClipTool({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className="group/tip relative grid h-7 w-7 place-items-center rounded-full border border-white/15 bg-zinc-950/92 text-zinc-100 shadow-lg shadow-black/50 backdrop-blur-md hover:bg-zinc-800"
      onClick={onClick}
    >
      {children}
      <span className="pointer-events-none absolute bottom-[calc(100%+7px)] left-1/2 z-10 -translate-x-1/2 rounded-md bg-zinc-950 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-white opacity-0 shadow-lg ring-1 ring-white/15 transition-opacity group-hover/tip:opacity-100">
        {title}
      </span>
    </button>
  )
}

function DuplicateIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.25" />
      <path d="M15.5 8.5V6.25A2.25 2.25 0 0 0 13.25 4h-7A2.25 2.25 0 0 0 4 6.25v7A2.25 2.25 0 0 0 6.25 15.5H8.5" />
    </svg>
  )
}

function MergeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="M8.5 7.5 4 12l4.5 4.5" />
      <path d="M15.5 7.5 20 12l-4.5 4.5" />
    </svg>
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

function ToolButton({
  onClick,
  disabled,
  title,
  danger,
  children
}: {
  onClick: () => void
  disabled?: boolean
  title: string
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={`shrink-0 rounded px-1.5 py-0.5 text-zinc-400 hover:text-zinc-100 disabled:opacity-30 ${
        danger ? 'hover:text-red-300' : ''
      }`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
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
