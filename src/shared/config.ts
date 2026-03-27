export interface AppConfig {
  targetRepoPath: string
  contributingMdPath: string
  worktreeBasePath: string
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
  worktreeBasePath: '',
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

/**
 * Extract a Trello board ID from a full URL or return the raw input as-is.
 * Accepts URLs like https://trello.com/b/MibMpIB8/board-name — the board ID
 * is the segment immediately after /b/.
 */
export function extractBoardId(input: string): string {
  const trimmed = input.trim()
  const match = trimmed.match(/trello\.com\/b\/([a-zA-Z0-9]+)/)
  return match ? match[1] : trimmed
}

export type FieldStatus = { ok: true } | { ok: false; error: string } | null

export interface ValidationResult {
  targetRepoPath: FieldStatus
  contributingMdPath: FieldStatus
  trelloConnection: FieldStatus
  claudeCliPath: FieldStatus
}
