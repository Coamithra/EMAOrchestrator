export type RunbookParserType = 'regex' | 'smart'

/** Role that a Trello list can be assigned in the orchestrator. */
export type TrelloListRole = 'backlog' | 'inProgress' | 'done'

/** Roles that allow only one list assignment. */
export type SingleListRole = 'inProgress' | 'done'

export interface AppConfig {
  targetRepoPath: string
  contributingMdPath: string
  worktreeBasePath: string
  runbookParser: RunbookParserType
  trelloApiKey: string
  trelloApiToken: string
  trelloBoardId: string
  trelloListIds: {
    backlog: string[]
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
  runbookParser: 'regex',
  trelloApiKey: '',
  trelloApiToken: '',
  trelloBoardId: '',
  trelloListIds: {
    backlog: [],
    inProgress: '',
    done: ''
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
