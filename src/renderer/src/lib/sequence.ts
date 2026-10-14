import type { MediaItem, Segment } from '../store'

export interface PlacedSegment {
  seg: Segment
  item: MediaItem
  /** Start position on the timeline (seconds). */
  offset: number
  duration: number
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
    const duration = seg.end - seg.start
    placed.push({ seg, item, offset, duration })
    offset += duration
  }
  return { placed, total: offset }
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
