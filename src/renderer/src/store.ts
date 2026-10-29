import { create } from 'zustand'
import { segmentSpeed } from '../../shared/speed'
import type { MediaInfo, SavedProject } from '../../shared/types'
import { layoutSequence, mergeBlocker } from './lib/sequence'
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
  /** 1 = recording speed. Pitch follows this rate. */
  speed: number
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
  /** Drops sources whose files were deleted. Clears undo so they cannot come back. */
  forgetMedia(ids: string[]): void
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
  setSegmentSpeed(id: string, speed: number): void
  /** Inserts a duplicate after `afterId`, or at the end when that clip is gone. */
  duplicateSegment(afterId: string | null, copy: Pick<Segment, 'sourceId' | 'start' | 'end' | 'speed'>): Segment | null
  /** Joins a clip with the one after it. Returns false when they cannot become one clip. */
  mergeSegments(leftId: string): boolean

  showToast(message: string, kind?: Toast['kind']): void

  captureProject(): SavedProject
  restoreProject(project: {
    media: MediaItem[]
    marks: Record<string, Marks>
    segments: Segment[]
    selectedSegmentId: string | null
    activeSourceId: string | null
    mode: Mode
  }): void
}

const MIN_SEGMENT = 0.05
const HISTORY_LIMIT = 200

function dropSources(
  s: State,
  drop: Set<string>
): Pick<State, 'media' | 'segments' | 'marks' | 'activeSourceId' | 'selectedSegmentId'> {
  const media = s.media.filter((m) => !drop.has(m.id))
  const segments = s.segments.filter((seg) => !drop.has(seg.sourceId))
  const marks = { ...s.marks }
  for (const id of drop) delete marks[id]
  return {
    media,
    segments,
    marks,
    activeSourceId: drop.has(s.activeSourceId ?? '') ? (media[0]?.id ?? null) : s.activeSourceId,
    selectedSegmentId: segments.some((seg) => seg.id === s.selectedSegmentId) ? s.selectedSegmentId : null
  }
}

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
      set((s) => dropSources(s, new Set([id])))
    },

    forgetMedia(ids) {
      const drop = new Set(ids)
      if (drop.size === 0) return
      for (const id of drop) {
        mediaArchive.delete(id)
        importOrder.delete(id)
      }
      set((s) => ({ ...dropSources(s, drop), past: [], future: [] }))
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
      const segment: Segment = { id: uid('s'), sourceId, start: snappedStart, end: clampedEnd, speed: 1 }
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
      // A speed change is re-encoded, so the cut can fall anywhere. Stream copy still starts on a keyframe.
      const secondStart =
        segmentSpeed(seg.speed) === 1 ? snapToKeyframe(item?.keyframes ?? null, sourceTime) : sourceTime
      if (sourceTime - seg.start < MIN_SEGMENT || seg.end - sourceTime < MIN_SEGMENT) return null
      if (secondStart - seg.start < MIN_SEGMENT) return null
      const first: Segment = { ...seg, end: sourceTime, speed: segmentSpeed(seg.speed) }
      const second: Segment = {
        id: uid('s'),
        sourceId: seg.sourceId,
        start: secondStart,
        end: seg.end,
        speed: segmentSpeed(seg.speed)
      }
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

    setSegmentSpeed(id, speed) {
      const s = get()
      const seg = s.segments.find((x) => x.id === id)
      const next = segmentSpeed(speed)
      if (!seg || segmentSpeed(seg.speed) === next) return
      // Drop the keyframe overlap once the clip will be re-encoded, so a later duplicate
      // does not replay the neighboring clip.
      const preview = s.segments.map((x) => (x.id === id ? { ...x, speed: next } : x))
      const placed = layoutSequence(preview, s.media).placed.find((p) => p.seg.id === id)
      const start = placed?.playStart ?? seg.start
      const end = placed?.playEnd ?? seg.end
      record('Change speed')
      set({
        segments: s.segments.map((x) => (x.id === id ? { ...x, speed: next, start, end } : x))
      })
    },

    duplicateSegment(afterId, copy) {
      const item = get().media.find((m) => m.id === copy.sourceId)
      if (!item) return null
      const start = Math.max(0, copy.start)
      const end = Math.min(copy.end, item.info.duration)
      if (end - start < MIN_SEGMENT) return null
      const segment: Segment = {
        id: uid('s'),
        sourceId: copy.sourceId,
        start,
        end,
        speed: segmentSpeed(copy.speed)
      }
      record('Paste')
      set((s) => {
        const index = afterId ? s.segments.findIndex((seg) => seg.id === afterId) : -1
        const segments = [...s.segments]
        segments.splice(index < 0 ? segments.length : index + 1, 0, segment)
        return { segments, selectedSegmentId: segment.id }
      })
      return segment
    },

    mergeSegments(leftId) {
      const s = get()
      const index = s.segments.findIndex((seg) => seg.id === leftId)
      const left = s.segments[index]
      const right = s.segments[index + 1]
      if (!left || !right || mergeBlocker(left, right)) return false
      const merged: Segment = { ...left, end: Math.max(left.end, right.end), speed: segmentSpeed(left.speed) }
      const segments = [...s.segments]
      segments.splice(index, 2, merged)
      record('Merge')
      set({ segments, selectedSegmentId: merged.id })
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
    },

    captureProject() {
      const s = get()
      return {
        version: 1,
        media: s.media.map((m) => ({ id: m.id, path: m.info.path, color: m.color })),
        marks: s.marks,
        segments: s.segments.map((seg) => ({
          id: seg.id,
          sourceId: seg.sourceId,
          start: seg.start,
          end: seg.end,
          speed: segmentSpeed(seg.speed)
        })),
        selectedSegmentId: s.selectedSegmentId,
        activeSourceId: s.activeSourceId,
        mode: s.mode
      }
    },

    restoreProject(project) {
      mediaArchive.clear()
      importOrder.clear()
      project.media.forEach((m, i) => {
        mediaArchive.set(m.id, m)
        importOrder.set(m.id, i + 1)
      })
      importSeq = project.media.length
      let maxId = 0
      const bump = (id: string): void => {
        const n = Number(id.replace(/^\D+/, ''))
        if (n > maxId) maxId = n
      }
      for (const m of project.media) bump(m.id)
      for (const seg of project.segments) bump(seg.id)
      nextId = maxId + 1
      colorIndex = project.media.length
      const known = new Set(project.media.map((m) => m.id))
      set({
        media: project.media,
        marks: project.marks,
        segments: project.segments
          .filter((seg) => known.has(seg.sourceId))
          .map((seg) => ({ ...seg, speed: segmentSpeed(seg.speed) })),
        selectedSegmentId: project.selectedSegmentId,
        activeSourceId: known.has(project.activeSourceId ?? '')
          ? project.activeSourceId
          : (project.media[0]?.id ?? null),
        mode: project.mode,
        past: [],
        future: []
      })
    }
  }
})

export const getMedia = (id: string | null): MediaItem | undefined =>
  id ? useStore.getState().media.find((m) => m.id === id) : undefined
