const SHORTCUTS: [string, string][] = [
  ['Space', 'play'],
  ['J K L', 'shuttle'],
  ['← →', '5s'],
  [', .', 'frame'],
  ['I O', 'mark'],
  ['A', 'add'],
  ['Tab', 'source / timeline'],
  ['S', 'split'],
  ['Q W', 'trim'],
  ['Del', 'remove'],
  ['Ctrl+Z / Ctrl+Y', 'undo / redo']
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
