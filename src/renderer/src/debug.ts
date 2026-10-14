import { importPaths } from './lib/importMedia'
import { engine, usePlayback } from './player'
import { useStore } from './store'

/** Dev-only handles for driving the app from DevTools / CDP. */
export function installDebugHooks(): void {
  Object.assign(window, {
    __ezclip: { importPaths, engine, useStore, usePlayback }
  })
}
