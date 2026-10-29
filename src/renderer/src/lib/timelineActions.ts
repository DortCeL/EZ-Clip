import { create } from 'zustand'
import { segmentSpeed } from '../../../shared/speed'
import { engine } from '../player'
import { mergeBlocker } from './sequence'
import { useStore } from '../store'

/** A timeline clip kept for Ctrl+V. It is not part of the saved project. */
export interface CopiedClip {
  sourceId: string
  start: number
  end: number
  speed: number
}

export const useClipClipboard = create<{ clip: CopiedClip | null }>(() => ({ clip: null }))

function current() {
  const id = engine.currentSegmentId
  const layout = engine.sequence
  const index = layout.placed.findIndex((p) => p.seg.id === id)
  return index < 0 ? null : { placed: layout.placed[index], index }
}

export function addWholeClip(sourceId: string): void {
  const store = useStore.getState()
  const item = store.media.find((m) => m.id === sourceId)
  if (!item) return
  store.addSegment(sourceId, 0, item.info.duration)
}

export function toggleMode(): void {
  const store = useStore.getState()
  if (store.mode === 'source') {
    store.setMode('timeline')
    return
  }
  const cur = current()
  if (cur) {
    engine.rememberSourcePosition(cur.placed.item.id, engine.sourceTime)
    store.setActiveSource(cur.placed.item.id)
  }
  store.setMode('source')
}

export function splitAtPlayhead(): void {
  const store = useStore.getState()
  if (store.mode !== 'timeline') return
  const cur = current()
  if (!cur) return
  const { placed } = cur
  const into = Math.min(Math.max(0, engine.time - placed.offset), placed.duration)
  const t = placed.playStart + into * segmentSpeed(placed.seg.speed)
  engine.pause()
  if (!store.splitSegment(placed.seg.id, t)) {
    store.showToast('Can’t split here', 'error')
  }
}

/** Q: remove everything in the current clip before the playhead. */
export function trimStartToPlayhead(): void {
  const store = useStore.getState()
  const cur = store.mode === 'timeline' ? current() : null
  if (!cur) return
  engine.pause()
  engine.setTimelineTimeHint(cur.placed.offset)
  if (!store.trimSegment(cur.placed.seg.id, 'start', engine.sourceTime)) {
    store.showToast('Can’t trim here', 'error')
  }
}

/** W: remove everything in the current clip after the playhead. */
export function trimEndToPlayhead(): void {
  const store = useStore.getState()
  const cur = store.mode === 'timeline' ? current() : null
  if (!cur) return
  engine.pause()
  engine.setTimelineTimeHint(engine.time)
  if (!store.trimSegment(cur.placed.seg.id, 'end', engine.sourceTime)) {
    store.showToast('Clip would be too short', 'error')
  }
}

function targetSegmentId(): string | null {
  const store = useStore.getState()
  return store.selectedSegmentId ?? engine.currentSegmentId
}

export function copySelected(): void {
  const store = useStore.getState()
  const id = targetSegmentId()
  const seg = store.segments.find((item) => item.id === id)
  if (!seg) {
    store.showToast('Select a clip to copy', 'error')
    return
  }
  const placed = engine.sequence.placed.find((p) => p.seg.id === id)
  useClipClipboard.setState({
    clip: {
      sourceId: seg.sourceId,
      start: placed?.playStart ?? seg.start,
      end: placed?.playEnd ?? seg.end,
      speed: segmentSpeed(seg.speed)
    }
  })
}

export function pasteClipboard(): void {
  const store = useStore.getState()
  const clip = useClipClipboard.getState().clip
  if (!clip) {
    store.showToast('Copy a clip first', 'error')
    return
  }
  engine.pause()
  const segment = store.duplicateSegment(targetSegmentId(), clip)
  if (!segment) {
    store.showToast('That recording is no longer in the project', 'error')
    return
  }
  selectAndSeek(segment.id, 0)
}

/** Puts a copy of this clip directly after it. */
export function duplicateBeside(id: string): void {
  const store = useStore.getState()
  const placed = engine.sequence.placed.find((p) => p.seg.id === id)
  const seg = placed?.seg ?? store.segments.find((item) => item.id === id)
  if (!seg) return
  engine.pause()
  const segment = store.duplicateSegment(id, {
    sourceId: seg.sourceId,
    start: placed?.playStart ?? seg.start,
    end: placed?.playEnd ?? seg.end,
    speed: segmentSpeed(seg.speed)
  })
  if (!segment) {
    store.showToast('Can’t duplicate that clip', 'error')
    return
  }
  selectAndSeek(segment.id, 0)
}

/**
 * Joins the selected clip with the piece beside it. The next clip wins when both sides
 * can merge; otherwise the previous clip is used. A split can be merged back. A gap,
 * a speed change, or a different recording cannot.
 */
/** Merges one specific join, the cut after `leftId`. */
export function mergeWithNext(leftId: string): void {
  const store = useStore.getState()
  const index = store.segments.findIndex((seg) => seg.id === leftId)
  const left = store.segments[index]
  const right = store.segments[index + 1]
  if (!left || !right) return
  const blocker = mergeBlocker(left, right)
  if (blocker) {
    store.showToast(blocker, 'error')
    return
  }
  engine.pause()
  store.mergeSegments(leftId)
}

export function mergeCut(id?: string): void {
  const store = useStore.getState()
  const target = id ?? targetSegmentId()
  const index = store.segments.findIndex((seg) => seg.id === target)
  const seg = store.segments[index]
  if (!seg) {
    store.showToast('Select a clip to merge', 'error')
    return
  }
  const next = store.segments[index + 1]
  const prev = store.segments[index - 1]
  const withNext = next ? mergeBlocker(seg, next) : 'Nothing to merge'
  if (next && !withNext) {
    engine.pause()
    store.mergeSegments(seg.id)
    return
  }
  const withPrev = prev ? mergeBlocker(prev, seg) : null
  if (prev && !withPrev) {
    engine.pause()
    store.mergeSegments(prev.id)
    return
  }
  store.showToast((next ? withNext : withPrev) ?? 'Nothing to merge', 'error')
}

export function deleteSelected(): void {
  const store = useStore.getState()
  const id = store.selectedSegmentId ?? engine.currentSegmentId
  if (!id) return
  const placed = engine.sequence.placed.find((p) => p.seg.id === id)
  if (store.mode === 'timeline' && placed) {
    const playheadInside = engine.currentSegmentId === id
    if (playheadInside) engine.setTimelineTimeHint(placed.offset)
    else if (placed.offset < engine.time) engine.setTimelineTimeHint(engine.time - placed.duration)
  }
  store.removeSegment(id)
}

export function undo(): void {
  engine.pause()
  useStore.getState().undo()
}

export function redo(): void {
  engine.pause()
  useStore.getState().redo()
}

export function jumpSegmentBoundary(direction: -1 | 1): void {
  const { placed, total } = engine.sequence
  if (placed.length === 0) return
  const t = engine.time
  const edges = [...placed.map((p) => p.offset), total]
  const target =
    direction < 0
      ? [...edges].reverse().find((e) => e < t - 0.05)
      : edges.find((e) => e > t + 0.05)
  if (target != null) {
    engine.pause()
    void engine.seek(target)
  }
}

export function selectAndSeek(segmentId: string, offsetWithin = 0): void {
  const store = useStore.getState()
  store.selectSegment(segmentId)
  const placed = engine.sequence.placed.find((p) => p.seg.id === segmentId)
  const target = placed ? placed.offset + Math.min(offsetWithin, placed.duration) : 0
  if (store.mode !== 'timeline') {
    engine.setTimelineTimeHint(target)
    store.setMode('timeline')
  } else if (placed) {
    void engine.seek(target)
  }
}
