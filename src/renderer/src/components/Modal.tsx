import { useEffect, type ReactNode } from 'react'

export function Modal(props: {
  title: string
  onClose: () => void
  closable?: boolean
  children: ReactNode
  footer?: ReactNode
}) {
  const { onClose, closable = true } = props

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && closable) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, closable])

  return (
    <div
      data-modal-open
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && closable && onClose()}
    >
      <div className="w-[560px] max-w-[92vw] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl select-text">
        <div className="flex h-12 items-center justify-between border-b border-zinc-800 px-5">
          <h2 className="text-sm font-semibold">{props.title}</h2>
          {closable && (
            <button className="text-zinc-500 hover:text-zinc-200" onClick={onClose} title="Close (Esc)">
              ✕
            </button>
          )}
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{props.children}</div>
        {props.footer && (
          <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-5 py-3">{props.footer}</div>
        )}
      </div>
    </div>
  )
}
