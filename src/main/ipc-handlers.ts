import { ipcMain, dialog, BrowserWindow } from 'electron'
import { loadConfig, saveConfig, configExists, validateConfig } from './config-service'
import { createSession, getSession } from './session-registry'
import {
  createWorktree,
  listWorktrees,
  removeWorktree,
  cleanupOrphanedWorktrees,
  listRemoteBranches
} from './worktree-manager'
import { removePersistedAgent } from './agent-persistence-service'
import { parseRunbookContent } from './runbook-parser'
import { parseRunbookSmart } from './smart-runbook-parser'
import { getCachedRunbook, cacheRunbook } from './runbook-cache'
import { getListsForBoard, getCardsFromList, moveCardToSourceList } from './trello-service'
import { readAgentLog } from './logging-service'
import type { AgentManager } from './agent-manager'
import type { CardInfo } from '../shared/agent-manager'
import type { OrchestrationLoop } from './orchestration-loop'
import { DEFAULT_CONFIG, type AppConfig } from '../shared/config'
import type {
  CliSessionOptions,
  PermissionResponse,
  SecurityAlertResponse,
  UserQuestionResponse
} from '../shared/cli-driver'
import type { WorktreeInfo } from '../shared/worktree'
import { IpcChannels } from '../shared/ipc'

import { readFile } from 'node:fs/promises'
import type { Runbook } from '../shared/runbook'

function requireOrchestration(loop: OrchestrationLoop | null): OrchestrationLoop {
  if (!loop) throw new Error('Orchestration not available — app config not loaded')
  return loop
}

/** In-memory runbook, eagerly parsed on startup and config save. */
let activeRunbook: Runbook | null = null

/** Read the runbook file, check the cache, and parse with the configured parser. */
async function resolveRunbook(config: AppConfig): Promise<Runbook> {
  const markdown = await readFile(config.contributingMdPath, 'utf-8')
  const parserType = config.runbookParser ?? 'regex'

  const cached = await getCachedRunbook(markdown, parserType)
  if (cached) return cached

  let runbook: Runbook
  let usedFallback = false
  if (parserType === 'smart') {
    try {
      runbook = await parseRunbookSmart(markdown)
    } catch (err) {
      console.error('Smart parser failed, falling back to regex:', err)
      runbook = parseRunbookContent(markdown)
      usedFallback = true
    }
  } else {
    runbook = parseRunbookContent(markdown)
  }

  // Don't cache regex fallback results under the 'smart' key — that would
  // permanently prevent the smart parser from being retried.
  if (!usedFallback) {
    cacheRunbook(markdown, parserType, runbook).catch((err) =>
      console.error('Cache write failed:', err)
    )
  }
  return runbook
}

export function registerIpcHandlers(
  agentManager: AgentManager,
  orchestrationLoop: OrchestrationLoop | null
): void {
  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------

  ipcMain.handle(IpcChannels.CONFIG_LOAD, async () => {
    const config = await loadConfig()
    // Eagerly parse the runbook on app startup
    if (config?.contributingMdPath && config?.targetRepoPath) {
      resolveRunbook(config)
        .then((r) => {
          activeRunbook = r
        })
        .catch((err) => console.error('Eager runbook parse failed:', err))
    }
    return config
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
      // Live-update orchestration settings
      if (orchestrationLoop) {
        orchestrationLoop.setMaxConcurrentAgents(config.maxConcurrentAgents)
        orchestrationLoop.setApprovalMode(config.approvalMode)
      }
      // Eagerly parse the runbook so it's ready for agent creation
      resolveRunbook(config)
        .then((r) => {
          activeRunbook = r
        })
        .catch((err) => console.error('Eager runbook parse failed:', err))
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
    const knownPaths = new Set(agentManager.listAgents().map((a) => a.worktree.path))
    return await cleanupOrphanedWorktrees(repoPath, knownPaths)
  })

  ipcMain.handle(IpcChannels.WORKTREE_LIST_BRANCHES, async (_event, repoPath: string) => {
    return await listRemoteBranches(repoPath)
  })

  // ---------------------------------------------------------------------------
  // Agent Persistence
  // ---------------------------------------------------------------------------

  ipcMain.handle(IpcChannels.AGENT_LIST, () => {
    return agentManager.listAgents()
  })

  ipcMain.handle(IpcChannels.AGENT_GET, (_event, agentId: string) => {
    return agentManager.getAgent(agentId)
  })

  ipcMain.handle(IpcChannels.AGENT_DISMISS, async (_event, agentId: string) => {
    const agent = agentManager.getAgent(agentId)
    if (agent) {
      // Stop orchestration if running
      if (orchestrationLoop?.isRunning(agentId)) {
        orchestrationLoop.stopAgent(agentId)
      }
      const config = await loadConfig()
      // Move card back to its source list (fire-and-forget)
      if (agent.stateSnapshot.state !== 'done' && config?.trelloApiKey && config?.trelloApiToken) {
        const creds = { apiKey: config.trelloApiKey, apiToken: config.trelloApiToken }
        moveCardToSourceList(
          agent.card.id,
          agent.card.sourceListId,
          config.trelloListIds.backlog,
          creds
        ).catch(() => {})
      }
      if (config?.targetRepoPath) {
        await agentManager.destroyAgent(agentId, config.targetRepoPath)
        return // destroyAgent already calls removePersistedAgent
      }
    }
    // Agent not in memory (stale) — just remove from disk
    await removePersistedAgent(agentId)
  })

  // ---------------------------------------------------------------------------
  // Agent Creation
  // ---------------------------------------------------------------------------

  ipcMain.handle(IpcChannels.AGENT_CREATE, async (_event, card: CardInfo) => {
    const config = await loadConfig()
    if (!config?.targetRepoPath || !config?.contributingMdPath) {
      throw new Error('App not configured — set target repo and CONTRIBUTING.md path first')
    }
    const runbook = activeRunbook ?? (await resolveRunbook(config))
    return await agentManager.createAgent(
      card,
      runbook,
      config.targetRepoPath,
      config.worktreeBasePath || undefined,
      config.defaultBranch || undefined
    )
  })

  // ---------------------------------------------------------------------------
  // Orchestration Loop
  // ---------------------------------------------------------------------------

  ipcMain.handle(IpcChannels.ORCHESTRATION_START, (_event, agentId: string) => {
    requireOrchestration(orchestrationLoop).startAgent(agentId)
  })

  ipcMain.handle(IpcChannels.ORCHESTRATION_STOP, (_event, agentId: string) => {
    requireOrchestration(orchestrationLoop).stopAgent(agentId)
  })

  ipcMain.handle(
    IpcChannels.ORCHESTRATION_RESPOND_PERMISSION,
    (_event, agentId: string, response: PermissionResponse) => {
      requireOrchestration(orchestrationLoop).respondToPermission(agentId, response)
    }
  )

  ipcMain.handle(
    IpcChannels.ORCHESTRATION_RESPOND_QUESTION,
    async (_event, agentId: string, response: UserQuestionResponse) => {
      await requireOrchestration(orchestrationLoop).respondToQuestion(agentId, response)
    }
  )

  ipcMain.handle(
    IpcChannels.ORCHESTRATION_RESPOND_SECURITY_ALERT,
    (_event, agentId: string, response: SecurityAlertResponse) => {
      requireOrchestration(orchestrationLoop).respondToSecurityAlert(agentId, response)
    }
  )

  ipcMain.handle(IpcChannels.ORCHESTRATION_IS_RUNNING, (_event, agentId: string) => {
    return orchestrationLoop?.isRunning(agentId) ?? false
  })

  ipcMain.handle(IpcChannels.ORCHESTRATION_GET_CONCURRENCY_STATUS, () => {
    return (
      orchestrationLoop?.getConcurrencyStatus() ?? {
        running: 0,
        queued: 0,
        max: DEFAULT_CONFIG.maxConcurrentAgents
      }
    )
  })

  ipcMain.handle(
    IpcChannels.ORCHESTRATION_SET_AGENT_APPROVAL,
    (_event, agentId: string, mode: string | null) => {
      if (!orchestrationLoop) return
      const valid = new Set(['always', 'never', 'smart', null])
      if (!valid.has(mode)) return
      orchestrationLoop.setAgentApprovalMode(
        agentId,
        mode as import('../shared/config').ApprovalMode | null
      )
    }
  )

  ipcMain.handle(
    IpcChannels.ORCHESTRATION_GET_AGENT_APPROVAL,
    (_event, agentId: string) => {
      return orchestrationLoop?.getAgentApprovalMode(agentId) ?? 'never'
    }
  )

  ipcMain.handle(
    IpcChannels.ORCHESTRATION_SEND_DIRECT_PROMPT,
    async (_event, agentId: string, prompt: string) => {
      await requireOrchestration(orchestrationLoop).sendDirectPrompt(agentId, prompt)
    }
  )

  // ---------------------------------------------------------------------------
  // Trello
  // ---------------------------------------------------------------------------

  ipcMain.handle(IpcChannels.TRELLO_GET_LISTS, async () => {
    const config = await loadConfig()
    if (!config?.trelloApiKey || !config?.trelloApiToken || !config?.trelloBoardId) return []
    return await getListsForBoard(config.trelloBoardId, {
      apiKey: config.trelloApiKey,
      apiToken: config.trelloApiToken
    })
  })

  ipcMain.handle(
    IpcChannels.TRELLO_GET_LISTS_FOR_BOARD,
    async (_event, boardId: string, apiKey: string, apiToken: string) => {
      if (!boardId || !apiKey || !apiToken) return []
      return await getListsForBoard(boardId, { apiKey, apiToken })
    }
  )

  ipcMain.handle(IpcChannels.TRELLO_GET_BACKLOG_CARDS, async () => {
    const config = await loadConfig()
    if (!config?.trelloApiKey || !config?.trelloApiToken || !config?.trelloBoardId) return []
    const backlogListIds = config.trelloListIds.backlog
    if (!backlogListIds.length) return []
    const creds = { apiKey: config.trelloApiKey, apiToken: config.trelloApiToken }
    const results = await Promise.all(
      backlogListIds.map(async (listId) => {
        const cards = await getCardsFromList(listId, creds)
        return cards.map((c) => ({ ...c, sourceListId: listId }))
      })
    )
    return results.flat()
  })

  // ---------------------------------------------------------------------------
  // Logging
  // ---------------------------------------------------------------------------

  ipcMain.handle(IpcChannels.LOGGING_GET_LOG, async (_event, agentId: string) => {
    return await readAgentLog(agentId)
  })

  // ---------------------------------------------------------------------------
  // Runbook
  // ---------------------------------------------------------------------------

  ipcMain.handle(IpcChannels.RUNBOOK_GET, () => {
    return activeRunbook
  })

  ipcMain.handle(IpcChannels.RUNBOOK_REFRESH, async () => {
    const config = await loadConfig()
    if (!config?.contributingMdPath || !config?.targetRepoPath) return null
    try {
      activeRunbook = await resolveRunbook(config)
      return activeRunbook
    } catch (err) {
      console.error('Runbook refresh failed:', err)
      return null
    }
  })
}
