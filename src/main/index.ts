import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpcHandlers } from './ipc-handlers'
import { abortAllSessions } from './session-registry'
import { AgentManager } from './agent-manager'
import {
  loadPersistedAgents,
  reconcileAgents,
  savePersistedAgents
} from './agent-persistence-service'
import { loadConfig } from './config-service'
import { cleanupOrphanedWorktrees } from './worktree-manager'

const agentManager = new AgentManager()

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

  // Restore non-stale agents
  const restoredWorktreePaths = new Set<string>()
  for (const result of results) {
    if (result.status === 'stale') {
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

  registerIpcHandlers(agentManager)

  createWindow()

  // Restore agents from previous session (async, non-blocking for window display)
  await restorePersistedAgents()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Abort all CLI sessions before quitting
app.on('will-quit', () => {
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
