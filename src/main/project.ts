import { app, type BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { IPC } from '../shared/api'
import { segmentSpeed } from '../shared/speed'
import type { SavedMediaRef, SavedProject, SavedSegment } from '../shared/types'

const projectFile = (): string => path.join(app.getPath('userData'), 'project.json')

function isMediaRef(v: unknown): v is SavedMediaRef {
  if (!v || typeof v !== 'object') return false
  const m = v as SavedMediaRef
  return typeof m.id === 'string' && typeof m.path === 'string' && typeof m.color === 'string'
}

function isSegment(v: unknown, ids: Set<string>): v is SavedSegment {
  if (!v || typeof v !== 'object') return false
  const s = v as SavedSegment
  return (
    typeof s.id === 'string' &&
    ids.has(s.sourceId) &&
    typeof s.start === 'number' &&
    typeof s.end === 'number' &&
    s.end > s.start
  )
}

function sanitize(raw: unknown): SavedProject | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Partial<SavedProject>
  if (p.version !== 1 || !Array.isArray(p.media) || !Array.isArray(p.segments)) return null

  const media = p.media.filter(isMediaRef)
  const ids = new Set(media.map((m) => m.id))
  const segments = p.segments.filter((s) => isSegment(s, ids)).map((s) => ({
    id: s.id,
    sourceId: s.sourceId,
    start: s.start,
    end: s.end,
    speed: segmentSpeed(s.speed)
  }))
  const marks: SavedProject['marks'] = {}
  if (p.marks && typeof p.marks === 'object') {
    for (const [id, mark] of Object.entries(p.marks)) {
      if (!ids.has(id) || !mark) continue
      marks[id] = {
        in: typeof mark.in === 'number' ? mark.in : null,
        out: typeof mark.out === 'number' ? mark.out : null
      }
    }
  }

  const selected = segments.some((s) => s.id === p.selectedSegmentId) ? (p.selectedSegmentId ?? null) : null
  const active = typeof p.activeSourceId === 'string' && ids.has(p.activeSourceId) ? p.activeSourceId : (media[0]?.id ?? null)

  return {
    version: 1,
    media,
    marks,
    segments,
    selectedSegmentId: selected,
    activeSourceId: active,
    mode: p.mode === 'timeline' && segments.length > 0 ? 'timeline' : 'source'
  }
}

export async function loadProject(): Promise<SavedProject | null> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(projectFile(), 'utf8'))
    return sanitize(raw)
  } catch {
    return null
  }
}

export async function saveProject(project: SavedProject | null): Promise<void> {
  const file = projectFile()
  const clean = project ? sanitize(project) : null
  if (!clean || clean.media.length === 0) {
    await fs.rm(file, { force: true })
    return
  }
  const tmp = `${file}.tmp`
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(tmp, JSON.stringify(clean), 'utf8')
  await fs.rename(tmp, file)
}

let flushWaiter: (() => void) | null = null

/** Asks the window to write the project, then continues even if it never answers. */
export function requestRendererFlush(win: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      flushWaiter = null
      resolve()
    }
    const timer = setTimeout(done, 800)
    flushWaiter = done
    if (win.isDestroyed() || win.webContents.isDestroyed()) {
      done()
      return
    }
    win.webContents.send(IPC.projectFlush)
  })
}

export function ackProjectFlush(): void {
  flushWaiter?.()
}
