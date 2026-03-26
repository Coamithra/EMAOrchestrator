import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer — typed in index.d.ts
const api = {
  // Config
  loadConfig: (): Promise<unknown> => ipcRenderer.invoke('config:load'),
  saveConfig: (config: unknown): Promise<unknown> => ipcRenderer.invoke('config:save', config),
  validateConfig: (config: unknown): Promise<unknown> =>
    ipcRenderer.invoke('config:validate', config),
  configExists: (): Promise<boolean> => ipcRenderer.invoke('config:exists'),
  openDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:openDirectory'),
  openFile: (filters?: { name: string; extensions: string[] }[]): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openFile', filters),

  // CLI sessions
  startSession: (options: unknown): Promise<string> => ipcRenderer.invoke('cli:start', options),
  abortSession: (sessionId: string): Promise<void> => ipcRenderer.invoke('cli:abort', sessionId),
  getSessionState: (sessionId: string): Promise<unknown> =>
    ipcRenderer.invoke('cli:getState', sessionId),
  respondToPermission: (sessionId: string, response: unknown): Promise<void> =>
    ipcRenderer.invoke('cli:respondPermission', sessionId, response),
  respondToQuestion: (sessionId: string, response: unknown): Promise<void> =>
    ipcRenderer.invoke('cli:respondQuestion', sessionId, response),
  onCliEvent: (callback: (_event: unknown, payload: unknown) => void): void => {
    ipcRenderer.on('cli:event', callback)
  },
  offCliEvent: (): void => {
    ipcRenderer.removeAllListeners('cli:event')
  },

  // Worktrees
  createWorktree: (repoPath: string, branch: string): Promise<unknown> =>
    ipcRenderer.invoke('worktree:create', repoPath, branch),
  listWorktrees: (repoPath: string): Promise<unknown> =>
    ipcRenderer.invoke('worktree:list', repoPath),
  removeWorktree: (repoPath: string, worktree: unknown): Promise<void> =>
    ipcRenderer.invoke('worktree:remove', repoPath, worktree),
  cleanupOrphanedWorktrees: (repoPath: string): Promise<unknown> =>
    ipcRenderer.invoke('worktree:cleanupOrphans', repoPath)
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
