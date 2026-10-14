import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Settings } from '../shared/types'

const settingsFile = (): string => path.join(app.getPath('userData'), 'settings.json')

function defaults(): Settings {
  return {
    outputDir: path.join(app.getPath('videos'), 'Ez-clip'),
    filePrefix: 'EzClip',
    revealAfterExport: true
  }
}

let current: Settings | null = null

export async function loadSettings(): Promise<Settings> {
  if (current) return current
  try {
    const raw = JSON.parse(await fs.readFile(settingsFile(), 'utf8')) as Partial<Settings>
    current = { ...defaults(), ...raw }
  } catch {
    current = defaults()
  }
  return current
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch }
  next.filePrefix = sanitizePrefix(next.filePrefix)
  const file = settingsFile()
  const tmp = `${file}.tmp`
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8')
  await fs.rename(tmp, file)
  current = next
  return next
}

function sanitizePrefix(prefix: string): string {
  const cleaned = prefix.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim()
  return cleaned || 'EzClip'
}
