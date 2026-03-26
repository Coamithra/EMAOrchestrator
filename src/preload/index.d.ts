import { ElectronAPI } from '@electron-toolkit/preload'
import type { AppConfig, ValidationResult } from '../shared/config'
import type { AgentAPI, PersistenceAPI } from '../shared/ipc'

interface ConfigAPI {
  loadConfig(): Promise<AppConfig | null>
  saveConfig(config: AppConfig): Promise<ValidationResult>
  validateConfig(config: AppConfig): Promise<ValidationResult>
  configExists(): Promise<boolean>
  openDirectory(): Promise<string | null>
  openFile(filters?: { name: string; extensions: string[] }[]): Promise<string | null>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: ConfigAPI & AgentAPI & PersistenceAPI
  }
}
