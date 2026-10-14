import { VIDEO_EXTENSIONS } from '../../../shared/api'
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

  await Promise.all(fresh.map(importOne))
}

async function importOne(filePath: string): Promise<void> {
  const store = useStore.getState()
  store.setImporting(1)
  try {
    const info = await window.ezclip.probe(filePath)
    if (!info.video) throw new Error('No video stream found')
    const item = useStore.getState().addMedia(info)
    if (!useStore.getState().activeSourceId) useStore.getState().setActiveSource(item.id)

    void window.ezclip
      .thumbnail(filePath, Math.min(3, info.duration / 3))
      .then((thumbnail) => useStore.getState().updateMedia(item.id, { thumbnail }))

    window.ezclip
      .keyframes(filePath)
      .then((keyframes) =>
        useStore.getState().updateMedia(item.id, { keyframes, keyframeStatus: 'ready' })
      )
      .catch(() => useStore.getState().updateMedia(item.id, { keyframeStatus: 'error' }))
  } catch (e) {
    const name = filePath.split(/[\\/]/).pop()
    useStore.getState().showToast(`Couldn't import ${name}: ${errorMessage(e)}`, 'error')
  } finally {
    useStore.getState().setImporting(-1)
  }
}

export function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export async function openImportDialog(): Promise<void> {
  const paths = await window.ezclip.openFiles()
  if (paths.length) await importPaths(paths)
}
