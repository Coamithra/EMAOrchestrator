import { ipcMain, dialog, BrowserWindow } from 'electron'
import { loadConfig, saveConfig, configExists, validateConfig } from './config-service'
import { createSession, getSession } from './session-registry'
import {
  createWorktree,
  listWorktrees,
  removeWorktree,
  cleanupOrphanedWorktrees
} from './worktree-manager'
import { removePersistedAgent } from './agent-persistence-service'
import type { AgentManager } from './agent-manager'
import type { AppConfig } from '../shared/config'
import type {
  CliSessionOptions,
  PermissionResponse,
  UserQuestionResponse
} from '../shared/cli-driver'
import type { WorktreeInfo } from '../shared/worktree'
import { IpcChannels } from '../shared/ipc'

export function registerIpcHandlers(agentManager?: AgentManager): void {
  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------

  ipcMain.handle(IpcChannels.CONFIG_LOAD, async () => {
    return await loadConfig()
  })

  ipcMain.handle(IpcChannels.CONFIG_SAVE, async (_event, config: AppConfig) => {
    const result = await validateConfig(config)
    const allOk =
      result.targetRepoPath?.ok &&
      result.contributingMdPath?.ok &&
      result.trelloConnection?.ok &&
      result.claudeCliPath?.ok
    if (allOk) {
      await saveConfig(config)
    }
    return result
  })

  ipcMain.handle(IpcChannels.CONFIG_VALIDATE, async (_event, config: AppConfig) => {
    return await validateConfig(config)
  })

  ipcMain.handle(IpcChannels.CONFIG_EXISTS, async () => {
    return await configExists()
  })

  // ---------------------------------------------------------------------------
  // Dialogs
  // ---------------------------------------------------------------------------

  ipcMain.handle(IpcChannels.DIALOG_OPEN_DIRECTORY, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(IpcChannels.DIALOG_OPEN_FILE, async (event, filters?: Electron.FileFilter[]) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: filters ?? []
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // ---------------------------------------------------------------------------
  // CLI Sessions
  // ---------------------------------------------------------------------------

  ipcMain.handle(IpcChannels.CLI_START, (_event, options: CliSessionOptions) => {
    return createSession(options)
  })

  ipcMain.handle(IpcChannels.CLI_ABORT, (_event, sessionId: string) => {
    const session = getSession(sessionId)
    if (!session) throw new Error(`Unknown session: ${sessionId}`)
    session.abort()
  })

  ipcMain.handle(IpcChannels.CLI_GET_STATE, (_event, sessionId: string) => {
    const session = getSession(sessionId)
    return session?.getState() ?? null
  })

  ipcMain.handle(
    IpcChannels.CLI_RESPOND_PERMISSION,
    (_event, sessionId: string, response: PermissionResponse) => {
      const session = getSession(sessionId)
      if (!session) throw new Error(`Unknown session: ${sessionId}`)
      session.respondToPermission(response)
    }
  )

  ipcMain.handle(
    IpcChannels.CLI_RESPOND_QUESTION,
    async (_event, sessionId: string, response: UserQuestionResponse) => {
      const session = getSession(sessionId)
      if (!session) throw new Error(`Unknown session: ${sessionId}`)
      await session.respondToUserQuestion(response)
    }
  )

  // ---------------------------------------------------------------------------
  // Worktrees
  // ---------------------------------------------------------------------------

  ipcMain.handle(IpcChannels.WORKTREE_CREATE, async (_event, repoPath: string, branch: string) => {
    return await createWorktree(repoPath, branch)
  })

  ipcMain.handle(IpcChannels.WORKTREE_LIST, async (_event, repoPath: string) => {
    return await listWorktrees(repoPath)
  })

  ipcMain.handle(
    IpcChannels.WORKTREE_REMOVE,
    async (_event, repoPath: string, worktree: WorktreeInfo) => {
      await removeWorktree(repoPath, worktree)
    }
  )

  ipcMain.handle(IpcChannels.WORKTREE_CLEANUP_ORPHANS, async (_event, repoPath: string) => {
    return await cleanupOrphanedWorktrees(repoPath)
  })

  // ---------------------------------------------------------------------------
  // Agent Persistence
  // ---------------------------------------------------------------------------

  ipcMain.handle(IpcChannels.AGENT_LIST, () => {
    return agentManager?.listAgents() ?? []
  })

  ipcMain.handle(IpcChannels.AGENT_GET, (_event, agentId: string) => {
    return agentManager?.getAgent(agentId) ?? null
  })

  ipcMain.handle(IpcChannels.AGENT_DISMISS, async (_event, agentId: string) => {
    await removePersistedAgent(agentId)
  })
}
