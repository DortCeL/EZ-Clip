import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { IPC, VIDEO_EXTENSIONS } from '../shared/api'
import type { Settings } from '../shared/types'
import { getFfmpegInfo } from './binaries'
import { keyframes, probe, thumbnail } from './media'
import { allowMediaPath } from './mediaProtocol'
import { loadSettings, saveSettings } from './settings'

function showOpenDialog(e: IpcMainInvokeEvent, options: Electron.OpenDialogOptions) {
  const win = BrowserWindow.fromWebContents(e.sender)
  return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)
}

export function registerIpc(): void {
  ipcMain.handle(IPC.openFiles, async (e) => {
    const result = await showOpenDialog(e, {
      title: 'Import videos',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Videos', extensions: VIDEO_EXTENSIONS },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle(IPC.probe, async (_e, filePath: string) => {
    const info = await probe(filePath)
    allowMediaPath(filePath)
    return info
  })

  ipcMain.handle(IPC.keyframes, (_e, filePath: string) => keyframes(filePath))

  ipcMain.handle(IPC.thumbnail, (_e, filePath: string, atSeconds: number) =>
    thumbnail(filePath, atSeconds)
  )

  ipcMain.handle(IPC.getSettings, () => loadSettings())

  ipcMain.handle(IPC.setSettings, (_e, patch: Partial<Settings>) => saveSettings(patch))

  ipcMain.handle(IPC.chooseOutputDir, async (e) => {
    const current = await loadSettings()
    const result = await showOpenDialog(e, {
      title: 'Choose export folder',
      defaultPath: current.outputDir,
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(IPC.ffmpegInfo, () => getFfmpegInfo())

  ipcMain.handle(IPC.revealInFolder, (_e, filePath: string) => {
    shell.showItemInFolder(filePath)
  })
}
