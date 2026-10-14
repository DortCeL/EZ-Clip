import { create } from 'zustand'
import type { MediaInfo } from '../../shared/types'
import { colorForIndex } from './lib/colors'
import { snapToKeyframe } from './lib/keyframes'

export interface MediaItem {
  id: string
  info: MediaInfo
  color: string
  thumbnail: string | null
  keyframes: number[] | null
  keyframeStatus: 'indexing' | 'ready' | 'error'
}

export interface Marks {
  in: number | null
  out: number | null
}

export interface Segment {
  id: string
  sourceId: string
  start: number
  end: number
}

export type Mode = 'source' | 'timeline'

export interface Toast {
  id: number
  message: string
  kind: 'info' | 'error'
}

interface State {
  media: MediaItem[]
  activeSourceId: string | null
  marks: Record<string, Marks>
  segments: Segment[]
  selectedSegmentId: string | null
  mode: Mode
  importing: number
  toast: Toast | null
  dialog: 'export' | 'settings' | null

  setDialog(dialog: State['dialog']): void

  addMedia(info: MediaInfo): MediaItem
  updateMedia(id: string, patch: Partial<MediaItem>): void
  removeMedia(id: string): void
  setActiveSource(id: string | null): void
  setMode(mode: Mode): void
  setImporting(delta: number): void

  setMark(sourceId: string, which: keyof Marks, t: number | null): void
  clearMarks(sourceId: string): void

  addSegment(sourceId: string, start: number, end: number): Segment | null
  removeSegment(id: string): void
  selectSegment(id: string | null): void
  /** Splits at a source time; the second half starts at the keyframe at or before it. */
  splitSegment(id: string, sourceTime: number): [Segment, Segment] | null
  /** Moves a segment edge to a source time (starts snap to keyframes). */
  trimSegment(id: string, side: 'start' | 'end', sourceTime: number): boolean
  moveSegment(id: string, toIndex: number): void

  showToast(message: string, kind?: Toast['kind']): void
}

const MIN_SEGMENT = 0.05

let nextId = 1
const uid = (prefix: string): string => `${prefix}${nextId++}`
let colorIndex = 0

export const useStore = create<State>((set, get) => ({
  media: [],
  activeSourceId: null,
  marks: {},
  segments: [],
  selectedSegmentId: null,
  mode: 'source',
  importing: 0,
  toast: null,
  dialog: null,

  setDialog(dialog) {
    set({ dialog })
  },

  addMedia(info) {
    const item: MediaItem = {
      id: uid('m'),
      info,
      color: colorForIndex(colorIndex++),
      thumbnail: null,
      keyframes: null,
      keyframeStatus: 'indexing'
    }
    set((s) => ({ media: [...s.media, item] }))
    return item
  },

  updateMedia(id, patch) {
    set((s) => ({ media: s.media.map((m) => (m.id === id ? { ...m, ...patch } : m)) }))
  },

  removeMedia(id) {
    set((s) => {
      const media = s.media.filter((m) => m.id !== id)
      const segments = s.segments.filter((seg) => seg.sourceId !== id)
      const { [id]: _removed, ...marks } = s.marks
      return {
        media,
        segments,
        marks,
        activeSourceId: s.activeSourceId === id ? (media[0]?.id ?? null) : s.activeSourceId,
        selectedSegmentId: segments.some((seg) => seg.id === s.selectedSegmentId)
          ? s.selectedSegmentId
          : null
      }
    })
  },

  setActiveSource(id) {
    set({ activeSourceId: id })
  },

  setMode(mode) {
    set({ mode })
  },

  setImporting(delta) {
    set((s) => ({ importing: Math.max(0, s.importing + delta) }))
  },

  setMark(sourceId, which, t) {
    set((s) => {
      const current = s.marks[sourceId] ?? { in: null, out: null }
      return { marks: { ...s.marks, [sourceId]: { ...current, [which]: t } } }
    })
  },

  clearMarks(sourceId) {
    set((s) => ({ marks: { ...s.marks, [sourceId]: { in: null, out: null } } }))
  },

  addSegment(sourceId, start, end) {
    const item = get().media.find((m) => m.id === sourceId)
    if (!item) return null
    const snappedStart = snapToKeyframe(item.keyframes, Math.max(0, start))
    const clampedEnd = Math.min(end, item.info.duration)
    if (clampedEnd - snappedStart < MIN_SEGMENT) return null
    const segment: Segment = { id: uid('s'), sourceId, start: snappedStart, end: clampedEnd }
    set((s) => ({ segments: [...s.segments, segment], selectedSegmentId: segment.id }))
    return segment
  },

  removeSegment(id) {
    set((s) => {
      const index = s.segments.findIndex((seg) => seg.id === id)
      if (index < 0) return s
      const segments = s.segments.filter((seg) => seg.id !== id)
      const neighbour = segments[Math.min(index, segments.length - 1)]
      return { segments, selectedSegmentId: neighbour?.id ?? null }
    })
  },

  selectSegment(id) {
    set({ selectedSegmentId: id })
  },

  splitSegment(id, sourceTime) {
    const s = get()
    const index = s.segments.findIndex((seg) => seg.id === id)
    const seg = s.segments[index]
    if (!seg) return null
    const item = s.media.find((m) => m.id === seg.sourceId)
    const secondStart = snapToKeyframe(item?.keyframes ?? null, sourceTime)
    if (sourceTime - seg.start < MIN_SEGMENT || seg.end - sourceTime < MIN_SEGMENT) return null
    if (secondStart - seg.start < MIN_SEGMENT) return null
    const first: Segment = { ...seg, end: sourceTime }
    const second: Segment = { id: uid('s'), sourceId: seg.sourceId, start: secondStart, end: seg.end }
    const segments = [...s.segments]
    segments.splice(index, 1, first, second)
    set({ segments, selectedSegmentId: first.id })
    return [first, second]
  },

  trimSegment(id, side, sourceTime) {
    const s = get()
    const seg = s.segments.find((x) => x.id === id)
    if (!seg) return false
    const item = s.media.find((m) => m.id === seg.sourceId)
    const next =
      side === 'start'
        ? { ...seg, start: snapToKeyframe(item?.keyframes ?? null, sourceTime) }
        : { ...seg, end: sourceTime }
    if (next.end - next.start < MIN_SEGMENT || (side === 'start' && next.start <= seg.start)) return false
    set({ segments: s.segments.map((x) => (x.id === id ? next : x)) })
    return true
  },

  moveSegment(id, toIndex) {
    set((s) => {
      const from = s.segments.findIndex((seg) => seg.id === id)
      if (from < 0 || from === toIndex) return s
      const segments = [...s.segments]
      const [moved] = segments.splice(from, 1)
      segments.splice(Math.max(0, Math.min(toIndex, segments.length)), 0, moved)
      return { segments }
    })
  },

  showToast(message, kind = 'info') {
    const toast = { id: Date.now(), message, kind }
    set({ toast })
    setTimeout(() => {
      if (get().toast?.id === toast.id) set({ toast: null })
    }, 3200)
  }
}))

export const getMedia = (id: string | null): MediaItem | undefined =>
  id ? useStore.getState().media.find((m) => m.id === id) : undefined
