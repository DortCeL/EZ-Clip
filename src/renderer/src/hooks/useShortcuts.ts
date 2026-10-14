import { useEffect } from 'react'
import { addMarkedRange, clearMarks, jumpKeyframe, markIn, markOut } from '../lib/actions'
import { openImportDialog } from '../lib/importMedia'
import { engine } from '../player'

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isTyping(e.target) || document.querySelector('[data-modal-open]')) return

      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'o') {
          e.preventDefault()
          void openImportDialog()
        }
        return
      }

      const handled = handleKey(e)
      if (handled) e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

function handleKey(e: KeyboardEvent): boolean {
  switch (e.key) {
    case ' ':
      engine.togglePlay()
      return true
    case 'k':
    case 'K':
      engine.stop()
      return true
    case 'l':
    case 'L':
      engine.shuttleForward()
      return true
    case 'j':
    case 'J':
      engine.shuttleReverse()
      return true
    case 'ArrowLeft':
      engine.nudge(e.shiftKey ? -1 : -5)
      return true
    case 'ArrowRight':
      engine.nudge(e.shiftKey ? 1 : 5)
      return true
    case 'ArrowUp':
      jumpKeyframe(-1)
      return true
    case 'ArrowDown':
      jumpKeyframe(1)
      return true
    case ',':
      engine.stepFrames(-1)
      return true
    case '.':
      engine.stepFrames(1)
      return true
    case 'Home':
      void engine.seek(0)
      return true
    case 'End':
      void engine.seek(engine.duration)
      return true
    case 'i':
    case 'I':
      markIn()
      return true
    case 'o':
    case 'O':
      markOut()
      return true
    case 'x':
    case 'X':
      clearMarks()
      return true
    case 'a':
    case 'A':
    case 'Enter':
      if (e.repeat) return true
      addMarkedRange()
      return true
  }
  return false
}
