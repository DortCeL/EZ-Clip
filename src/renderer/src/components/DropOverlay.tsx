import { useEffect, useState } from 'react'
import { importPaths } from '../lib/importMedia'

const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes('Files')

export function DropOverlay() {
  const [active, setActive] = useState(false)

  useEffect(() => {
    let depth = 0
    const onEnter = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth++
      setActive(true)
    }
    const onLeave = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setActive(false)
    }
    const onOver = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setActive(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      const paths = files.map((f) => window.ezclip.getPathForFile(f)).filter(Boolean)
      void importPaths(paths)
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  if (!active) return null
  return (
    <div className="border-accent bg-accent/10 pointer-events-none fixed inset-3 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed backdrop-blur-sm">
      <div className="text-2xl font-semibold text-white">Drop to import</div>
    </div>
  )
}
