import { engine } from '../player'
import { useStore } from '../store'
import { formatTime } from './format'

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
  if (store.addSegment(sourceId, 0, item.info.duration)) {
    store.showToast(`Added ${item.info.name} to timeline`)
  }
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
  if (store.mode !== 'timeline') {
    store.showToast('Splitting works on the timeline — press Tab to switch')
    return
  }
  const cur = current()
  if (!cur) return
  const t = engine.sourceTime
  engine.pause()
  const result = store.splitSegment(cur.placed.seg.id, t)
  if (!result) {
    store.showToast('Can’t split here — too close to an edge or no keyframe before the playhead', 'error')
    return
  }
  const overlap = t - result[1].start
  if (overlap > 0.01) {
    store.showToast(`Split · right part starts at keyframe ${formatTime(result[1].start)} (−${overlap.toFixed(2)}s)`)
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
    store.showToast('No keyframe between the clip start and the playhead', 'error')
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
  const store = useStore.getState()
  engine.pause()
  const label = store.undo()
  store.showToast(label ? `Undo: ${label}` : 'Nothing to undo')
}

export function redo(): void {
  const store = useStore.getState()
  engine.pause()
  const label = store.redo()
  store.showToast(label ? `Redo: ${label}` : 'Nothing to redo')
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
