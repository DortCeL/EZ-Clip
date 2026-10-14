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

/** The undoable part of the project. Media is stored by id so imports are never undone. */
interface Snapshot {
  segments: Segment[]
  marks: Record<string, Marks>
  selectedSegmentId: string | null
  mediaIds: string[]
  importSeq: number
}

interface HistoryEntry {
  label: string
  snapshot: Snapshot
}

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
  past: HistoryEntry[]
  future: HistoryEntry[]

  setDialog(dialog: State['dialog']): void

  /** Runs several edits as a single undo step. */
  transact<T>(label: string, fn: () => T): T
  undo(): string | null
  redo(): string | null

  addMedia(info: MediaInfo): MediaItem
  updateMedia(id: string, patch: Partial<MediaItem>): void
  removeMedia(id: string): void
  setActiveSource(id: string | null): void
  setMode(mode: Mode): void
  setImporting(delta: number): void

  setMarks(sourceId: string, patch: Partial<Marks>): void
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
const HISTORY_LIMIT = 200

let nextId = 1
const uid = (prefix: string): string => `${prefix}${nextId++}`
let colorIndex = 0

/** Every imported item, kept after removal so undo can bring it back. */
const mediaArchive = new Map<string, MediaItem>()
const importOrder = new Map<string, number>()
let importSeq = 0

let txDepth = 0
let txRecorded = false
let txLabel = ''

export const useStore = create<State>((set, get) => {
  const snapshot = (s: State): Snapshot => ({
    segments: s.segments,
    marks: s.marks,
    selectedSegmentId: s.selectedSegmentId,
    mediaIds: s.media.map((m) => m.id),
    importSeq
  })

  /** Call right before an edit is applied; pushes the pre-edit state onto the undo stack. */
  const record = (label: string): void => {
    if (txDepth > 0) {
      if (txRecorded) return
      txRecorded = true
      label = txLabel
    }
    const s = get()
    set({ past: [...s.past, { label, snapshot: snapshot(s) }].slice(-HISTORY_LIMIT), future: [] })
  }

  /**
   * Restores a snapshot. Media imported after the snapshot was taken stays; media that
   * existed then is re-added or removed to match it.
   */
  const restore = (snap: Snapshot): void => {
    const s = get()
    const wanted = new Set(snap.mediaIds)
    const media = [...mediaArchive.values()]
      .filter((m) => {
        if (wanted.has(m.id)) return true
        const importedLater = (importOrder.get(m.id) ?? 0) > snap.importSeq
        return importedLater && s.media.some((x) => x.id === m.id)
      })
      .sort((a, b) => (importOrder.get(a.id) ?? 0) - (importOrder.get(b.id) ?? 0))
    const activeSourceId = media.some((m) => m.id === s.activeSourceId)
      ? s.activeSourceId
      : (media[0]?.id ?? null)
    set({
      media,
      activeSourceId,
      segments: snap.segments,
      marks: snap.marks,
      selectedSegmentId: snap.selectedSegmentId
    })
  }

  return {
    media: [],
    activeSourceId: null,
    marks: {},
    segments: [],
    selectedSegmentId: null,
    mode: 'source',
    importing: 0,
    toast: null,
    dialog: null,
    past: [],
    future: [],

    setDialog(dialog) {
      set({ dialog })
    },

    transact(label, fn) {
      if (txDepth === 0) {
        txRecorded = false
        txLabel = label
      }
      txDepth++
      try {
        return fn()
      } finally {
        txDepth--
      }
    },

    undo() {
      const s = get()
      const entry = s.past[s.past.length - 1]
      if (!entry) return null
      set({
        past: s.past.slice(0, -1),
        future: [...s.future, { label: entry.label, snapshot: snapshot(s) }]
      })
      restore(entry.snapshot)
      return entry.label
    },

    redo() {
      const s = get()
      const entry = s.future[s.future.length - 1]
      if (!entry) return null
      set({
        future: s.future.slice(0, -1),
        past: [...s.past, { label: entry.label, snapshot: snapshot(s) }]
      })
      restore(entry.snapshot)
      return entry.label
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
      mediaArchive.set(item.id, item)
      importOrder.set(item.id, ++importSeq)
      set((s) => ({ media: [...s.media, item] }))
      return item
    },

    updateMedia(id, patch) {
      const archived = mediaArchive.get(id)
      if (archived) mediaArchive.set(id, { ...archived, ...patch })
      set((s) => ({ media: s.media.map((m) => (m.id === id ? { ...m, ...patch } : m)) }))
    },

    removeMedia(id) {
      if (!get().media.some((m) => m.id === id)) return
      record('Remove media')
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

    setMarks(sourceId, patch) {
      const current = get().marks[sourceId] ?? { in: null, out: null }
      const next = { ...current, ...patch }
      if (next.in === current.in && next.out === current.out) return
      record(patch.in !== undefined ? 'Mark in' : 'Mark out')
      set((s) => ({ marks: { ...s.marks, [sourceId]: next } }))
    },

    clearMarks(sourceId) {
      const current = get().marks[sourceId]
      if (!current || (current.in == null && current.out == null)) return
      record('Clear marks')
      set((s) => ({ marks: { ...s.marks, [sourceId]: { in: null, out: null } } }))
    },

    addSegment(sourceId, start, end) {
      const item = get().media.find((m) => m.id === sourceId)
      if (!item) return null
      const snappedStart = snapToKeyframe(item.keyframes, Math.max(0, start))
      const clampedEnd = Math.min(end, item.info.duration)
      if (clampedEnd - snappedStart < MIN_SEGMENT) return null
      const segment: Segment = { id: uid('s'), sourceId, start: snappedStart, end: clampedEnd }
      record('Add clip')
      set((s) => ({ segments: [...s.segments, segment], selectedSegmentId: segment.id }))
      return segment
    },

    removeSegment(id) {
      const index = get().segments.findIndex((seg) => seg.id === id)
      if (index < 0) return
      record('Delete clip')
      set((s) => {
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
      record('Split')
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
      if (next.start === seg.start && next.end === seg.end) return false
      record('Trim')
      set({ segments: s.segments.map((x) => (x.id === id ? next : x)) })
      return true
    },

    moveSegment(id, toIndex) {
      const from = get().segments.findIndex((seg) => seg.id === id)
      if (from < 0 || from === toIndex) return
      record('Reorder')
      set((s) => {
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
  }
})

export const getMedia = (id: string | null): MediaItem | undefined =>
  id ? useStore.getState().media.find((m) => m.id === id) : undefined
