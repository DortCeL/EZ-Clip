import { segmentSpeed } from '../../../shared/speed'
import type { SavedProject } from '../../../shared/types'
import { colorForIndex } from './colors'
import { errorMessage, startIndexing } from './importMedia'
import type { MediaItem } from '../store'
import { useStore } from '../store'

let ready = false
let lastJson = ''
let writing = false
let queued: string | null = null
let booted = false

async function persist(json: string): Promise<void> {
  queued = json
  if (writing) return
  writing = true
  try {
    while (queued !== null) {
      const next = queued
      queued = null
      const project = JSON.parse(next) as SavedProject | null
      await window.ezclip.saveProject(project)
      lastJson = next
    }
  } catch (e) {
    useStore.getState().showToast(`Couldn't save the session: ${errorMessage(e)}`, 'error')
  } finally {
    writing = false
    if (queued !== null) void persist(queued)
  }
}

function scheduleSave(): void {
  if (!ready) return
  const project = useStore.getState().captureProject()
  const empty = project.media.length === 0
  const json = JSON.stringify(empty ? null : project)
  if (json === lastJson) return
  void persist(json)
}

async function applySaved(saved: SavedProject): Promise<void> {
  const media: MediaItem[] = []
  const missing: string[] = []
  for (const [index, ref] of saved.media.entries()) {
    try {
      const info = await window.ezclip.probe(ref.path)
      if (!info.video) throw new Error('no video stream')
      media.push({
        id: ref.id,
        info,
        color: ref.color || colorForIndex(index),
        thumbnail: null,
        keyframes: null,
        keyframeStatus: 'indexing'
      })
    } catch {
      missing.push(ref.path.split(/[\\/]/).pop() || ref.path)
    }
  }

  const ids = new Set(media.map((m) => m.id))
  if (useStore.getState().media.length > 0) return

  const segments = saved.segments
    .filter((seg) => ids.has(seg.sourceId))
    .map((seg) => ({ ...seg, speed: segmentSpeed(seg.speed) }))
  const marks = Object.fromEntries(Object.entries(saved.marks).filter(([id]) => ids.has(id)))
  useStore.getState().restoreProject({
    media,
    marks,
    segments,
    selectedSegmentId: segments.some((seg) => seg.id === saved.selectedSegmentId)
      ? saved.selectedSegmentId
      : (segments.at(-1)?.id ?? null),
    activeSourceId: saved.activeSourceId && ids.has(saved.activeSourceId) ? saved.activeSourceId : (media[0]?.id ?? null),
    mode: saved.mode === 'timeline' && segments.length > 0 ? 'timeline' : 'source'
  })
  for (const item of media) startIndexing(item.id, item.info.path, item.info.duration)

  if (missing.length > 0) {
    const listed = missing.slice(0, 3).join(', ')
    const extra = missing.length > 3 ? ` and ${missing.length - 3} more` : ''
    useStore.getState().showToast(`Missing recordings were left out: ${listed}${extra}`, 'error')
  }
}

/** Restores the last edit, then writes the project whenever it changes. */
export function bootSession(): void {
  if (booted) return
  booted = true

  window.ezclip.onProjectFlush(() => {
    const project = useStore.getState().captureProject()
    const json = JSON.stringify(project.media.length === 0 ? null : project)
    void window.ezclip.saveProject(JSON.parse(json) as SavedProject | null).finally(() => {
      lastJson = json
      window.ezclip.ackProjectFlush()
    })
  })

  void (async () => {
    try {
      const saved = await window.ezclip.loadProject()
      if (saved && saved.media.length > 0) await applySaved(saved)
    } catch (e) {
      useStore.getState().showToast(`Couldn't restore the last session: ${errorMessage(e)}`, 'error')
    } finally {
      ready = true
      scheduleSave()
    }
  })()

  useStore.subscribe((s, prev) => {
    if (
      s.media === prev.media &&
      s.segments === prev.segments &&
      s.marks === prev.marks &&
      s.mode === prev.mode &&
      s.activeSourceId === prev.activeSourceId &&
      s.selectedSegmentId === prev.selectedSegmentId
    ) {
      return
    }
    scheduleSave()
  })
}
