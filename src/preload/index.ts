import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer — typed in index.d.ts
const api = {
  loadConfig: (): Promise<unknown> => ipcRenderer.invoke('config:load'),
  saveConfig: (config: unknown): Promise<unknown> => ipcRenderer.invoke('config:save', config),
  validateConfig: (config: unknown): Promise<unknown> =>
    ipcRenderer.invoke('config:validate', config),
  configExists: (): Promise<boolean> => ipcRenderer.invoke('config:exists'),
  openDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:openDirectory'),
  openFile: (filters?: { name: string; extensions: string[] }[]): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openFile', filters)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
