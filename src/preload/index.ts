import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC, type EzClipApi } from '../shared/api'
import type { ExportProgress } from '../shared/types'

const api: EzClipApi = {
  getPathForFile: (file) => webUtils.getPathForFile(file),
  openFiles: () => ipcRenderer.invoke(IPC.openFiles),
  probe: (filePath) => ipcRenderer.invoke(IPC.probe, filePath),
  keyframes: (filePath) => ipcRenderer.invoke(IPC.keyframes, filePath),
  thumbnail: (filePath, atSeconds) => ipcRenderer.invoke(IPC.thumbnail, filePath, atSeconds),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (patch) => ipcRenderer.invoke(IPC.setSettings, patch),
  chooseOutputDir: () => ipcRenderer.invoke(IPC.chooseOutputDir),
  ffmpegInfo: () => ipcRenderer.invoke(IPC.ffmpegInfo),
  exportVideo: (request) => ipcRenderer.invoke(IPC.exportVideo, request),
  cancelExport: () => ipcRenderer.invoke(IPC.cancelExport),
  onExportProgress: (listener) => {
    const handler = (_e: Electron.IpcRendererEvent, progress: ExportProgress): void => listener(progress)
    ipcRenderer.on(IPC.exportProgress, handler)
    return () => {
      ipcRenderer.removeListener(IPC.exportProgress, handler)
    }
  },
  revealInFolder: (filePath) => ipcRenderer.invoke(IPC.revealInFolder, filePath)
}

contextBridge.exposeInMainWorld('ezclip', api)
