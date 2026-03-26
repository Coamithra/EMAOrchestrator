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
    ipcRenderer.invoke(IpcChannels.WORKTREE_CLEANUP_ORPHANS, repoPath),

  // Agent persistence
  listAgents: (): Promise<unknown> => ipcRenderer.invoke(IpcChannels.AGENT_LIST),
  getAgent: (agentId: string): Promise<unknown> =>
    ipcRenderer.invoke(IpcChannels.AGENT_GET, agentId),
  dismissAgent: (agentId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.AGENT_DISMISS, agentId),
  onAgentEvent: (callback: (payload: unknown) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: unknown): void => callback(payload)
    ipcRenderer.on(IpcChannels.AGENT_EVENT, handler)
    return () => ipcRenderer.removeListener(IpcChannels.AGENT_EVENT, handler)
  },

  // Orchestration loop
  startOrchestration: (agentId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.ORCHESTRATION_START, agentId),
  stopOrchestration: (agentId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.ORCHESTRATION_STOP, agentId),
  respondToOrchestrationPermission: (agentId: string, response: unknown): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.ORCHESTRATION_RESPOND_PERMISSION, agentId, response),
  respondToOrchestrationQuestion: (agentId: string, response: unknown): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.ORCHESTRATION_RESPOND_QUESTION, agentId, response),
  isOrchestrationRunning: (agentId: string): Promise<boolean> =>
    ipcRenderer.invoke(IpcChannels.ORCHESTRATION_IS_RUNNING, agentId),
  getConcurrencyStatus: (): Promise<unknown> =>
    ipcRenderer.invoke(IpcChannels.ORCHESTRATION_GET_CONCURRENCY_STATUS),

  // Trello
  getTrelloLists: (): Promise<unknown> => ipcRenderer.invoke(IpcChannels.TRELLO_GET_LISTS),
  getTrelloBacklogCards: (): Promise<unknown> =>
    ipcRenderer.invoke(IpcChannels.TRELLO_GET_BACKLOG_CARDS)
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
