import { useStore } from '../store'

export function ToastView() {
  const toast = useStore((s) => s.toast)
  if (!toast) return null
  return (
    <div
      key={toast.id}
      className={`fixed top-16 left-1/2 z-40 -translate-x-1/2 rounded-lg px-4 py-2 text-sm shadow-xl ${
        toast.kind === 'error' ? 'bg-red-600 text-white' : 'bg-zinc-100 text-zinc-900'
      }`}
    >
      {toast.message}
    </div>
  )
}
