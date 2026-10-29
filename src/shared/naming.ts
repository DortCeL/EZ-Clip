const pad = (n: number): string => String(n).padStart(2, '0')

/** `<prefix>_YYYY-MM-DD_HH-mm-ss` — sorts chronologically and is valid on Windows (no colons). */
export function timestampedName(prefix: string, date: Date): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  return `${prefix}_${day}_${time}`
}

const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** A single file name with no folders. Empty or reserved names fall back. */
export function exportFileStem(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\.mp4$/i, '')
    .trim()
    .replace(/\.+$/g, '')
    .slice(0, 120)
  if (!cleaned || RESERVED_NAME.test(cleaned)) return fallback
  return cleaned
}
