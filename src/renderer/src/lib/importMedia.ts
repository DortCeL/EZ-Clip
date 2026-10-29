import { VIDEO_EXTENSIONS } from '../../../shared/api'
import { addWholeClip } from './timelineActions'
import { useStore } from '../store'

const isVideo = (p: string): boolean =>
  VIDEO_EXTENSIONS.includes(p.split('.').pop()?.toLowerCase() ?? '')

export async function importPaths(paths: string[]): Promise<void> {
  const store = useStore.getState()
  const existing = new Set(store.media.map((m) => m.info.path.toLowerCase()))
  const fresh = paths.filter((p) => p && isVideo(p) && !existing.has(p.toLowerCase()))
  const skipped = paths.length - fresh.length
  if (skipped > 0 && fresh.length === 0) {
    store.showToast(paths.length === 1 ? 'Already imported or not a video' : 'Nothing new to import')
    return
  }

  for (const filePath of fresh) await importOne(filePath)
}

async function importOne(filePath: string): Promise<void> {
  const store = useStore.getState()
  store.setImporting(1)
  try {
    const info = await window.ezclip.probe(filePath)
    if (!info.video) throw new Error('No video stream found')
    const item = useStore.getState().addMedia(info)
    if (!useStore.getState().activeSourceId) useStore.getState().setActiveSource(item.id)
    addWholeClip(item.id)
    startIndexing(item.id, filePath, info.duration)
  } catch (e) {
    const name = filePath.split(/[\\/]/).pop()
    useStore.getState().showToast(`Couldn't import ${name}: ${errorMessage(e)}`, 'error')
  } finally {
    useStore.getState().setImporting(-1)
  }
}

export function startIndexing(id: string, filePath: string, duration: number): void {
  void window.ezclip
    .thumbnail(filePath, Math.min(3, duration / 3))
    .then((thumbnail) => useStore.getState().updateMedia(id, { thumbnail }))

  window.ezclip
    .keyframes(filePath)
    .then((keyframes) => useStore.getState().updateMedia(id, { keyframes, keyframeStatus: 'ready' }))
    .catch(() => useStore.getState().updateMedia(id, { keyframeStatus: 'error' }))
}

export function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export async function openImportDialog(): Promise<void> {
  const paths = await window.ezclip.openFiles()
  if (paths.length) await importPaths(paths)
}
