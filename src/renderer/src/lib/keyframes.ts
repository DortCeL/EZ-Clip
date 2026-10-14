// Stream-copy cuts can only start on a keyframe, so segment starts snap backwards.
const EPSILON = 1e-3

/** Index of the last keyframe <= t, or -1. */
function lastIndexAtOrBefore(keyframes: number[], t: number): number {
  let lo = 0
  let hi = keyframes.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (keyframes[mid] <= t + EPSILON) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

export function snapToKeyframe(keyframes: number[] | null, t: number): number {
  if (!keyframes || keyframes.length === 0) return t
  const i = lastIndexAtOrBefore(keyframes, t)
  return i < 0 ? 0 : keyframes[i]
}

export function previousKeyframe(keyframes: number[], t: number): number | null {
  const i = lastIndexAtOrBefore(keyframes, t - 2 * EPSILON)
  return i < 0 ? null : keyframes[i]
}

export function nextKeyframe(keyframes: number[], t: number): number | null {
  const i = lastIndexAtOrBefore(keyframes, t + 2 * EPSILON)
  return keyframes[i + 1] ?? null
}
