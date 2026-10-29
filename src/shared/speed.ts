/** Playback rates offered in the timeline. 1 is the recording's own speed. */
export const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4] as const

export const MIN_SPEED = SPEED_PRESETS[0]
export const MAX_SPEED = SPEED_PRESETS[SPEED_PRESETS.length - 1]

/** Missing or junk values (older projects) play at the recording's own speed. */
export function segmentSpeed(speed: number | undefined): number {
  if (typeof speed !== 'number' || !Number.isFinite(speed)) return 1
  const clamped = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed))
  return Math.round(clamped * 100) / 100
}

/** How long a source range runs on the timeline and in the exported file. */
export function outputDuration(start: number, end: number, speed: number | undefined): number {
  return Math.max(0, end - start) / segmentSpeed(speed)
}

export function formatSpeed(speed: number | undefined): string {
  const n = segmentSpeed(speed)
  return `${Number.isInteger(n) ? n.toFixed(0) : String(n)}×`
}
