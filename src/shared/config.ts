export interface AppConfig {
  targetRepoPath: string
  contributingMdPath: string
  trelloApiKey: string
  trelloApiToken: string
  trelloBoardId: string
  trelloListNames: {
    todo: string
    inProgress: string
    done: string
  }
  claudeCliPath: string
  maxConcurrentAgents: number
  stuckAgentTimeoutMinutes: number
}

export const DEFAULT_CONFIG: AppConfig = {
  targetRepoPath: '',
  contributingMdPath: 'CONTRIBUTING.md',
  trelloApiKey: '',
  trelloApiToken: '',
  trelloBoardId: '',
  trelloListNames: {
    todo: 'Backlog',
    inProgress: 'In Progress',
    done: 'Done'
  },
  claudeCliPath: '',
  maxConcurrentAgents: 3,
  stuckAgentTimeoutMinutes: 10
}

export type FieldStatus = { ok: true } | { ok: false; error: string } | null

export interface ValidationResult {
  targetRepoPath: FieldStatus
  contributingMdPath: FieldStatus
  trelloConnection: FieldStatus
  claudeCliPath: FieldStatus
}
