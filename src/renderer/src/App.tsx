import { useEffect, useState } from 'react'
import type { FfmpegInfo } from '../../shared/types'

export default function App() {
  const [ffmpeg, setFfmpeg] = useState<FfmpegInfo | null>(null)
  const [ffmpegError, setFfmpegError] = useState<string | null>(null)

  useEffect(() => {
    window.ezclip
      .ffmpegInfo()
      .then(setFfmpeg)
      .catch((e: unknown) => setFfmpegError(String(e)))
  }, [])

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-800 px-4">
        <span className="text-lg font-semibold tracking-tight">
          Ez<span className="text-accent">-clip</span>
        </span>
        <span className="ml-auto text-xs text-zinc-500">
          {ffmpegError
            ? `FFmpeg error: ${ffmpegError}`
            : ffmpeg
              ? `${ffmpeg.version.replace(/ Copyright.*/, '')} · ${ffmpeg.hwEncoders.length} HW encoders`
              : 'Loading FFmpeg…'}
        </span>
      </header>
      <main className="flex min-h-0 flex-1 items-center justify-center text-zinc-500">
        Foundation ready.
      </main>
    </div>
  )
}
