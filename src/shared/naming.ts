const pad = (n: number): string => String(n).padStart(2, '0')

/** `<prefix>_YYYY-MM-DD_HH-mm-ss` — sorts chronologically and is valid on Windows (no colons). */
export function timestampedName(prefix: string, date: Date): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  return `${prefix}_${day}_${time}`
}
