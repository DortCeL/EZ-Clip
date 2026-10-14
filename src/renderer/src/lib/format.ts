export function formatTime(seconds: number, withFraction = true): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const cs = Math.floor((seconds * 100) % 100)
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  const base = `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`
  return withFraction ? `${base}.${String(cs).padStart(2, '0')}` : base
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const v = bytes / 1024 ** i
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`
}

export function formatFps(fps: number): string {
  if (!fps) return '?'
  return Math.abs(fps - Math.round(fps)) < 0.01 ? String(Math.round(fps)) : fps.toFixed(2)
}
