import { useEffect, useMemo, useRef } from 'react'
import { formatTime } from '../lib/format'
import { snapToKeyframe } from '../lib/keyframes'
import { layoutSequence } from '../lib/sequence'
import { engine, usePlayback } from '../player'
import { useStore, type MediaItem } from '../store'

const pct = (t: number, d: number): string => `${d > 0 ? (t / d) * 100 : 0}%`

export function SourceScrubber({ item }: { item: MediaItem }) {
  const time = usePlayback((s) => s.time)
  const marks = useStore((s) => s.marks[item.id])
  const segments = useStore((s) => s.segments)
  const media = useStore((s) => s.media)
  const onTimeline = useMemo(
    () => layoutSequence(segments, media).placed.filter((p) => p.item.id === item.id),
    [segments, media, item.id]
  )
  const trackRef = useRef<HTMLDivElement>(null)
  const duration = item.info.duration

  const inRaw = marks?.in ?? null
  const inSnapped = inRaw != null ? snapToKeyframe(item.keyframes, inRaw) : null
  const out = marks?.out ?? null

  const seekFromPointer = (clientX: number): void => {
    const rect = trackRef.current!.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    engine.scrub(ratio * duration)
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    engine.pause()
    e.currentTarget.setPointerCapture(e.pointerId)
    seekFromPointer(e.clientX)
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) seekFromPointer(e.clientX)
  }

  const markStart = inSnapped ?? (out != null ? 0 : null)
  const markEnd = out ?? (inSnapped != null ? duration : null)

  return (
    <div className="shrink-0 px-4 pt-3">
      <div
        ref={trackRef}
        className="relative h-10 cursor-pointer rounded-md bg-zinc-900"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
      >
        <KeyframeTicks keyframes={item.keyframes} duration={duration} />

        {onTimeline.map((p) => (
          <div
            key={p.seg.id}
            className="absolute top-0 bottom-0 border-t-2 border-emerald-400/70 bg-emerald-400/15"
            style={{ left: pct(p.playStart, duration), width: pct(p.playEnd - p.playStart, duration) }}
            title="Already on timeline"
          />
        ))}

        {markStart != null && markEnd != null && (
          <div
            className="bg-accent/35 border-accent absolute top-0 bottom-0 border-x-2"
            style={{ left: pct(markStart, duration), width: pct(markEnd - markStart, duration) }}
          />
        )}

        <div
          className="pointer-events-none absolute -top-1 -bottom-1 w-0.5 bg-white shadow-[0_0_6px_rgba(255,255,255,0.7)]"
          style={{ left: pct(time, duration) }}
        />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-zinc-500">
        <span>0:00</span>
        <span>{formatTime(duration, false)}</span>
      </div>
    </div>
  )
}

function KeyframeTicks({ keyframes, duration }: { keyframes: number[] | null; duration: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const draw = (): void => {
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      const ctx = canvas.getContext('2d')!
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, w, h)
      if (!keyframes || duration <= 0) return
      ctx.fillStyle = 'rgba(161,161,170,0.35)'
      let lastX = -2
      for (const k of keyframes) {
        const x = Math.round((k / duration) * w)
        if (x - lastX < 2) continue
        ctx.fillRect(x, h - 6, 1, 6)
        lastX = x
      }
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [keyframes, duration])

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" />
}
