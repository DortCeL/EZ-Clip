import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC, type EzClipApi } from '../shared/api'

const api: EzClipApi = {
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (patch) => ipcRenderer.invoke(IPC.setSettings, patch),
  chooseOutputDir: () => ipcRenderer.invoke(IPC.chooseOutputDir),
  ffmpegInfo: () => ipcRenderer.invoke(IPC.ffmpegInfo),
  revealInFolder: (filePath) => ipcRenderer.invoke(IPC.revealInFolder, filePath)
}

contextBridge.exposeInMainWorld('ezclip', api)
