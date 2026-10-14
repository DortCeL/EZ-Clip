import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC } from '../shared/api'
import type { Settings } from '../shared/types'
import { getFfmpegInfo } from './binaries'
import { loadSettings, saveSettings } from './settings'

export function registerIpc(): void {
  ipcMain.handle(IPC.getSettings, () => loadSettings())

  ipcMain.handle(IPC.setSettings, (_e, patch: Partial<Settings>) => saveSettings(patch))

  ipcMain.handle(IPC.chooseOutputDir, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const current = await loadSettings()
    const options: Electron.OpenDialogOptions = {
      title: 'Choose export folder',
      defaultPath: current.outputDir,
      properties: ['openDirectory', 'createDirectory']
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(IPC.ffmpegInfo, () => getFfmpegInfo())

  ipcMain.handle(IPC.revealInFolder, (_e, filePath: string) => {
    shell.showItemInFolder(filePath)
  })
}
