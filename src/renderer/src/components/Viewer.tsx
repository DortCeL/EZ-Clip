import { useEffect, useRef } from 'react'
import { engine } from '../player'
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
      {!hasMedia && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-500">
          <div className="text-2xl font-semibold text-zinc-300">Drop your gaming clips here</div>
          <div className="text-sm">
            or press <kbd>Ctrl</kbd>+<kbd>O</kbd> to import
          </div>
        </div>
      )}
    </div>
  )
}
