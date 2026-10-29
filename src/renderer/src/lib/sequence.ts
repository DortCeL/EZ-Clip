import { outputDuration, segmentSpeed } from '../../../shared/speed'
import type { MediaItem, Segment } from '../store'

export interface PlacedSegment {
  seg: Segment
  item: MediaItem
  /** Start position on the timeline (seconds). */
  offset: number
  duration: number
  /**
   * Source range that actually plays. A split snaps the next piece back to a keyframe,
   * which repeats a short stretch. Once either piece changes speed that repeat is dropped
   * and the two pieces meet at the cut, because the speed change is re-encoded anyway.
   */
  playStart: number
  playEnd: number
}

export interface SequenceLayout {
  placed: PlacedSegment[]
  total: number
}

export function layoutSequence(segments: Segment[], media: MediaItem[]): SequenceLayout {
  const byId = new Map(media.map((m) => [m.id, m]))
  const placed: PlacedSegment[] = []
  let offset = 0
  for (const seg of segments) {
    const item = byId.get(seg.sourceId)
    if (!item) continue
    const prev = placed[placed.length - 1]
    let playStart = seg.start
    const playEnd = seg.end
    const speedChange =
      !!prev && (segmentSpeed(prev.seg.speed) !== 1 || segmentSpeed(seg.speed) !== 1)
    if (
      speedChange &&
      prev.item.id === item.id &&
      prev.playEnd > playStart + 0.001 &&
      prev.playEnd < playEnd - 0.001
    ) {
      playStart = prev.playEnd
    }
    const duration = outputDuration(playStart, playEnd, seg.speed)
    placed.push({ seg, item, offset, duration, playStart, playEnd })
    offset += duration
  }
  return { placed, total: offset }
}

/** Why two neighboring clips cannot become one, or null when a merge is safe. */
export function mergeBlocker(left: Segment, right: Segment): string | null {
  if (left.sourceId !== right.sourceId) return 'Can’t merge different recordings'
  if (segmentSpeed(left.speed) !== segmentSpeed(right.speed)) return 'Can’t merge different speeds'
  if (right.start > left.end + 0.02) return 'Can’t merge across a gap'
  if (right.end <= left.end + 0.02) return 'These clips don’t extend each other'
  return null
}

/** Index of the segment containing timeline time t (boundaries belong to the later segment). */
export function locate(layout: SequenceLayout, t: number): number {
  const { placed } = layout
  if (placed.length === 0) return -1
  for (let i = placed.length - 1; i >= 0; i--) {
    if (t >= placed[i].offset - 1e-6) return i
  }
  return 0
}
