import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IpcChannels } from '../shared/ipc'

// Custom APIs for renderer — typed in index.d.ts
const api = {
  // Config
  loadConfig: (): Promise<unknown> => ipcRenderer.invoke(IpcChannels.CONFIG_LOAD),
  saveConfig: (config: unknown): Promise<unknown> =>
    ipcRenderer.invoke(IpcChannels.CONFIG_SAVE, config),
  validateConfig: (config: unknown): Promise<unknown> =>
    ipcRenderer.invoke(IpcChannels.CONFIG_VALIDATE, config),
  configExists: (): Promise<boolean> => ipcRenderer.invoke(IpcChannels.CONFIG_EXISTS),
  openDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke(IpcChannels.DIALOG_OPEN_DIRECTORY),
  openFile: (filters?: { name: string; extensions: string[] }[]): Promise<string | null> =>
    ipcRenderer.invoke(IpcChannels.DIALOG_OPEN_FILE, filters),

  // CLI sessions
  startSession: (options: unknown): Promise<string> =>
    ipcRenderer.invoke(IpcChannels.CLI_START, options),
  abortSession: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.CLI_ABORT, sessionId),
  getSessionState: (sessionId: string): Promise<unknown> =>
    ipcRenderer.invoke(IpcChannels.CLI_GET_STATE, sessionId),
  respondToPermission: (sessionId: string, response: unknown): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.CLI_RESPOND_PERMISSION, sessionId, response),
  respondToQuestion: (sessionId: string, response: unknown): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.CLI_RESPOND_QUESTION, sessionId, response),
  onCliEvent: (callback: (payload: unknown) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: unknown): void => callback(payload)
    ipcRenderer.on(IpcChannels.CLI_EVENT, handler)
    return () => ipcRenderer.removeListener(IpcChannels.CLI_EVENT, handler)
  },

  // Worktrees
  createWorktree: (repoPath: string, branch: string): Promise<unknown> =>
    ipcRenderer.invoke(IpcChannels.WORKTREE_CREATE, repoPath, branch),
  listWorktrees: (repoPath: string): Promise<unknown> =>
    ipcRenderer.invoke(IpcChannels.WORKTREE_LIST, repoPath),
  removeWorktree: (repoPath: string, worktree: unknown): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.WORKTREE_REMOVE, repoPath, worktree),
  cleanupOrphanedWorktrees: (repoPath: string): Promise<unknown> =>
    ipcRenderer.invoke(IpcChannels.WORKTREE_CLEANUP_ORPHANS, repoPath)
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
