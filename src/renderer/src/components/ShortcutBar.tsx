const SHORTCUTS: [string, string][] = [
  ['Space', 'play'],
  ['J K L', 'shuttle'],
  ['← →', '5s'],
  [', .', 'frame'],
  ['↑ ↓', 'keyframe'],
  ['I O', 'mark'],
  ['A', 'add']
]

export function ShortcutBar() {
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-zinc-800 px-4 text-[10px] text-zinc-500">
      {SHORTCUTS.map(([keys, label]) => (
        <span key={keys} className="flex items-center gap-1">
          <kbd>{keys}</kbd> {label}
        </span>
      ))}
    </footer>
  )
}
