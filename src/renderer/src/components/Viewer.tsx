import { useEffect, useMemo, useRef, useState } from 'react'
import fastForward from '../../../../resources/fast-forward.png'
import { segmentSpeed } from '../../../shared/speed'
import { layoutSequence, locate } from '../lib/sequence'
import { engine, usePlayback } from '../player'
import { useStore } from '../store'

export function Viewer() {
  const ref = useRef<HTMLVideoElement>(null)
  const hasMedia = useStore((s) => s.media.length > 0)

  useEffect(() => engine.attach(ref.current!), [])

  return (
    <div className="relative min-h-0 flex-1 bg-black">
      <video
        ref={ref}
        className="h-full w-full object-contain"
        preload="auto"
        onClick={() => engine.togglePlay()}
      />
      <SpeedMark videoRef={ref} />
      {!hasMedia && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-500">
          <div className="text-lg font-semibold text-zinc-300">Drop clips here</div>
        </div>
      )}
    </div>
  )
}

/** The same fast-forward mark the export draws onto a sped-up stretch. */
function SpeedMark({ videoRef }: { videoRef: React.RefObject<HTMLVideoElement | null> }) {
  const mode = useStore((s) => s.mode)
  const segments = useStore((s) => s.segments)
  const media = useStore((s) => s.media)
  const time = usePlayback((s) => s.time)
  const layout = useMemo(() => layoutSequence(segments, media), [segments, media])
  const placed = mode === 'timeline' ? layout.placed[locate(layout, time)] : undefined
  const speed = segmentSpeed(placed?.seg.speed)
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const measure = (): void => {
      const vw = video.videoWidth
      const vh = video.videoHeight
      const cw = video.clientWidth
      const ch = video.clientHeight
      if (!vw || !vh || !cw || !ch) {
        setBox(null)
        return
      }
      const scale = Math.min(cw / vw, ch / vh)
      const width = vw * scale
      const height = vh * scale
      setBox({ left: (cw - width) / 2, top: (ch - height) / 2, width, height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(video)
    video.addEventListener('loadedmetadata', measure)
    return () => {
      observer.disconnect()
      video.removeEventListener('loadedmetadata', measure)
    }
  }, [videoRef])

  if (!(speed > 1) || !box) return null

  return (
    <div className="pointer-events-none absolute" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
      <img
        src={fastForward}
        alt=""
        className="absolute top-[4%] right-[3%]"
        style={{ width: Math.round(box.height * 0.2), height: Math.round(box.height * 0.2) }}
      />
    </div>
  )
}
