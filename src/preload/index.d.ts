import { ElectronAPI } from '@electron-toolkit/preload'
import type { AppConfig, ValidationResult } from '../shared/config'
import type {
  AgentAPI,
  AgentCreateAPI,
  PersistenceAPI,
  OrchestrationAPI,
  TrelloAPI
} from '../shared/ipc'

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
    api: ConfigAPI & AgentAPI & AgentCreateAPI & PersistenceAPI & OrchestrationAPI & TrelloAPI
  }
}
