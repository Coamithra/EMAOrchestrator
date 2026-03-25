import { ipcMain, dialog, BrowserWindow } from 'electron'
import { loadConfig, saveConfig, configExists, validateConfig } from './config-service'
import type { AppConfig } from '../shared/config'

export function registerIpcHandlers(): void {
  ipcMain.handle('config:load', async () => {
    return await loadConfig()
  })

  ipcMain.handle('config:save', async (_event, config: AppConfig) => {
    await saveConfig(config)
    return await validateConfig(config)
  })

  ipcMain.handle('config:validate', async (_event, config: AppConfig) => {
    return await validateConfig(config)
  })

  ipcMain.handle('config:exists', async () => {
    return await configExists()
  })

  ipcMain.handle('dialog:openDirectory', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:openFile', async (_event, filters?: Electron.FileFilter[]) => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: filters ?? []
    })
    return result.canceled ? null : result.filePaths[0]
  })
}
