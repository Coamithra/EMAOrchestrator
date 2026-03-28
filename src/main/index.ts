import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpcHandlers } from './ipc-handlers'
import { abortAllSessions } from './session-registry'
import { AgentManager } from './agent-manager'
import { OrchestrationLoop } from './orchestration-loop'
import {
  loadPersistedAgents,
  reconcileAgents,
  savePersistedAgents
} from './agent-persistence-service'
import { loadConfig } from './config-service'
import { cleanupOrphanedWorktrees } from './worktree-manager'
import { moveCardToSourceList } from './trello-service'
import { IpcChannels, type AgentEventPayload } from '../shared/ipc'

const agentManager = new AgentManager()
let orchestrationLoop: OrchestrationLoop | null = null

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Broadcast an agent event to all open renderer windows. */
function broadcastAgentEvent(payload: AgentEventPayload): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IpcChannels.AGENT_EVENT, payload)
    }
  }
}

/** Wire AgentManager events to renderer via IPC push. */
function wireAgentEventForwarding(): void {
  agentManager.on('agent:created', (snapshot) => {
    broadcastAgentEvent({ event: { type: 'agent:created', data: { agent: snapshot } } })
  })
  agentManager.on('agent:state-changed', (agentId, stateSnapshot) => {
    broadcastAgentEvent({
      event: { type: 'agent:state-changed', data: { agentId, stateSnapshot } }
    })
  })
  agentManager.on('agent:step-advanced', (agentId, progress) => {
    broadcastAgentEvent({ event: { type: 'agent:step-advanced', data: { agentId, progress } } })
  })
  agentManager.on('agent:step-completed', (agentId, progress) => {
    broadcastAgentEvent({ event: { type: 'agent:step-completed', data: { agentId, progress } } })
  })
  agentManager.on('agent:phase-completed', (agentId, phaseName, phaseIndex) => {
    broadcastAgentEvent({
      event: { type: 'agent:phase-completed', data: { agentId, phaseName, phaseIndex } }
    })
  })
  agentManager.on('agent:error', (agentId, message) => {
    broadcastAgentEvent({ event: { type: 'agent:error', data: { agentId, message } } })
  })
  agentManager.on('agent:done', (agentId) => {
    broadcastAgentEvent({ event: { type: 'agent:done', data: { agentId } } })
  })
  agentManager.on('agent:destroyed', (agentId) => {
    broadcastAgentEvent({ event: { type: 'agent:destroyed', data: { agentId } } })
  })
  agentManager.on('agent:interaction-changed', (agentId, interaction) => {
    broadcastAgentEvent({
      event: { type: 'agent:interaction-changed', data: { agentId, interaction } }
    })
  })
}

/**
 * Restore persisted agents on startup.
 *
 * Loads the persisted agent store, reconciles with the filesystem,
 * restores valid agents, and cleans up orphaned worktrees.
 */
async function restorePersistedAgents(): Promise<void> {
  const config = await loadConfig()
  if (!config?.targetRepoPath) return

  const store = await loadPersistedAgents()
  if (!store || Object.keys(store.agents).length === 0) {
    // No persisted agents — clean up any orphaned worktrees
    await cleanupOrphanedWorktrees(config.targetRepoPath).catch(() => {})
    return
  }

  const results = await reconcileAgents(store)

  // Build Trello creds for stale-agent card moves (fire-and-forget)
  const trelloCreds =
    config.trelloApiKey && config.trelloApiToken
      ? { apiKey: config.trelloApiKey, apiToken: config.trelloApiToken }
      : null

  // Restore non-stale agents
  const restoredWorktreePaths = new Set<string>()
  for (const result of results) {
    if (result.status === 'stale') {
      // Move the card back to its source list before removing
      const staleAgent = store.agents[result.agentId]
      if (trelloCreds && staleAgent?.card) {
        moveCardToSourceList(
          staleAgent.card.id,
          staleAgent.card.sourceListId,
          config.trelloListIds.backlog,
          trelloCreds
        ).catch(() => {})
      }
      // Remove stale agents from the store
      delete store.agents[result.agentId]
      continue
    }
    const persisted = store.agents[result.agentId]
    try {
      agentManager.restoreAgent(persisted)
      restoredWorktreePaths.add(persisted.worktree.path)
    } catch (err) {
      console.error(`Failed to restore agent ${result.agentId}:`, err)
      delete store.agents[result.agentId]
    }
  }

  // Save reconciled state back (stale agents removed)
  await savePersistedAgents(store).catch(() => {})

  // Clean up worktrees that don't belong to any persisted agent
  await cleanupOrphanedWorktrees(config.targetRepoPath, restoredWorktreePaths).catch(() => {})
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const config = await loadConfig()
  orchestrationLoop = new OrchestrationLoop(
    agentManager,
    config?.maxConcurrentAgents,
    (config?.stuckAgentTimeoutMinutes ?? 10) * 60 * 1000
  )

  registerIpcHandlers(agentManager, orchestrationLoop)
  wireAgentEventForwarding()

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // Restore agents from previous session (after all listeners are registered)
  await restorePersistedAgents()
})

// Abort all CLI sessions and orchestration loops before quitting
app.on('will-quit', () => {
  orchestrationLoop?.abortAll()
  abortAllSessions()
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
