import { engine } from '../player'
import { getMedia, useStore } from '../store'
import { formatTime } from './format'
import { nextKeyframe, previousKeyframe, snapToKeyframe } from './keyframes'

function activeSource() {
  const s = useStore.getState()
  return s.mode === 'source' ? getMedia(s.activeSourceId) : undefined
}

export function markIn(): void {
  const item = activeSource()
  if (!item) return
  const store = useStore.getState()
  const t = engine.time
  const out = store.marks[item.id]?.out
  const outInvalid = out != null && out <= snapToKeyframe(item.keyframes, t)
  store.setMarks(item.id, outInvalid ? { in: t, out: null } : { in: t })
}

export function markOut(): void {
  const item = activeSource()
  if (!item) return
  const store = useStore.getState()
  const t = engine.time
  const inMark = store.marks[item.id]?.in
  if (inMark != null && t <= snapToKeyframe(item.keyframes, inMark)) {
    store.showToast('Out point must be after the in point', 'error')
    return
  }
  store.setMarks(item.id, { out: t })
}

export function clearMarks(): void {
  const item = activeSource()
  if (item) useStore.getState().clearMarks(item.id)
}

/** Adds the marked range (or the whole clip when nothing is marked) to the timeline. */
export function addMarkedRange(): void {
  const item = activeSource()
  if (!item) return
  const store = useStore.getState()
  const marks = store.marks[item.id] ?? { in: null, out: null }
  const start = marks.in ?? 0
  const end = marks.out ?? item.info.duration
  const segment = store.transact('Add clip', () => {
    const added = store.addSegment(item.id, start, end)
    if (added) store.clearMarks(item.id)
    return added
  })
  if (!segment) {
    store.showToast('Range is too short to add', 'error')
    return
  }
  const count = store.segments.length + 1
  store.showToast(
    `Added ${formatTime(segment.end - segment.start)} to timeline (${count} clip${count === 1 ? '' : 's'})`
  )
}

export function jumpKeyframe(direction: -1 | 1): void {
  const item = activeSource()
  if (!item?.keyframes?.length) return
  const t = engine.time
  const target = direction < 0 ? previousKeyframe(item.keyframes, t) : nextKeyframe(item.keyframes, t)
  if (target != null) {
    engine.pause()
    void engine.seek(target)
  }
}
