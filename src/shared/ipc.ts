import type {
  CliDriverState,
  CliSessionOptions,
  PermissionRequest,
  PermissionResponse,
  SecurityAlertRequest,
  SecurityAlertResponse,
  UserQuestionRequest,
  UserQuestionResponse,
  SessionInfo,
  SessionResult,
  StreamTextDelta,
  AssistantContent,
  ToolStartEvent,
  ToolActivityEvent,
  ToolSummaryEvent,
  StepBannerEvent,
  ApprovalStatusEvent
} from './cli-driver'
import type { WorktreeInfo } from './worktree'
import type { AgentSnapshot } from './agent-manager'
import type { PendingHumanInteraction } from './agent-persistence'
import type { ConcurrencyStatus } from './orchestration-loop'
import type { TrelloCard, TrelloList } from './trello'
import type { AgentStateSnapshot, AgentStepProgress } from './agent-state'
import type { LogEntry } from './logging'
import type { Runbook } from './runbook'

// ---------------------------------------------------------------------------
// IPC Channel Constants
// ---------------------------------------------------------------------------

export const IpcChannels = {
  // Config (existing)
  CONFIG_LOAD: 'config:load',
  CONFIG_SAVE: 'config:save',
  CONFIG_VALIDATE: 'config:validate',
  CONFIG_EXISTS: 'config:exists',

  // Dialogs (existing)
  DIALOG_OPEN_DIRECTORY: 'dialog:openDirectory',
  DIALOG_OPEN_FILE: 'dialog:openFile',

  // CLI sessions (new)
  CLI_START: 'cli:start',
  CLI_ABORT: 'cli:abort',
  CLI_GET_STATE: 'cli:getState',
  CLI_RESPOND_PERMISSION: 'cli:respondPermission',
  CLI_RESPOND_QUESTION: 'cli:respondQuestion',
  CLI_EVENT: 'cli:event',

  // Worktrees (new)
  WORKTREE_CREATE: 'worktree:create',
  WORKTREE_LIST: 'worktree:list',
  WORKTREE_REMOVE: 'worktree:remove',
  WORKTREE_CLEANUP_ORPHANS: 'worktree:cleanupOrphans',
  WORKTREE_LIST_BRANCHES: 'worktree:listBranches',

  // Agent persistence
  AGENT_LIST: 'agent:list',
  AGENT_GET: 'agent:get',
  AGENT_DISMISS: 'agent:dismiss',

  // Orchestration loop
  ORCHESTRATION_START: 'orchestration:start',
  ORCHESTRATION_STOP: 'orchestration:stop',
  ORCHESTRATION_RESPOND_PERMISSION: 'orchestration:respondPermission',
  ORCHESTRATION_RESPOND_QUESTION: 'orchestration:respondQuestion',
  ORCHESTRATION_RESPOND_SECURITY_ALERT: 'orchestration:respondSecurityAlert',
  ORCHESTRATION_IS_RUNNING: 'orchestration:isRunning',
  ORCHESTRATION_GET_CONCURRENCY_STATUS: 'orchestration:getConcurrencyStatus',

  // Agent events (main → renderer push)
  AGENT_EVENT: 'agent:event',

  // Agent creation
  AGENT_CREATE: 'agent:create',

  // Trello
  TRELLO_GET_LISTS: 'trello:getLists',
  TRELLO_GET_LISTS_FOR_BOARD: 'trello:getListsForBoard',
  TRELLO_GET_BACKLOG_CARDS: 'trello:getBacklogCards',

  // Logging
  LOGGING_GET_LOG: 'logging:getLog',

  // Runbook
  RUNBOOK_GET: 'runbook:get',
  RUNBOOK_REFRESH: 'runbook:refresh'
} as const

// ---------------------------------------------------------------------------
// CLI Event Streaming (main → renderer)
// ---------------------------------------------------------------------------

/** Discriminated union of all CLI events pushed from main to renderer. */
export type CliEvent =
  | { type: 'state:changed'; data: { state: CliDriverState; previousState: CliDriverState } }
  | { type: 'session:init'; data: SessionInfo }
  | { type: 'stream:text'; data: StreamTextDelta }
  | { type: 'assistant:message'; data: AssistantContent }
  | { type: 'tool:start'; data: ToolStartEvent }
  | { type: 'tool:activity'; data: ToolActivityEvent }
  | { type: 'tool:summary'; data: ToolSummaryEvent }
  | { type: 'permission:request'; data: PermissionRequest }
  | { type: 'security:alert'; data: SecurityAlertRequest }
  | { type: 'user:question'; data: UserQuestionRequest }
  | { type: 'session:result'; data: SessionResult }
  | { type: 'step:banner'; data: StepBannerEvent }
  | { type: 'approval:status'; data: ApprovalStatusEvent }
  | { type: 'error'; data: { message: string } }

/** Payload shape for the cli:event channel. */
export interface CliEventPayload {
  sessionId: string
  event: CliEvent
}

// ---------------------------------------------------------------------------
// Agent Event Streaming (main → renderer)
// ---------------------------------------------------------------------------

/** Discriminated union of agent lifecycle events pushed from main to renderer. */
export type AgentEvent =
  | { type: 'agent:created'; data: { agent: AgentSnapshot } }
  | { type: 'agent:state-changed'; data: { agentId: string; stateSnapshot: AgentStateSnapshot } }
  | { type: 'agent:step-advanced'; data: { agentId: string; progress: AgentStepProgress } }
  | { type: 'agent:step-completed'; data: { agentId: string; progress: AgentStepProgress } }
  | {
      type: 'agent:phase-completed'
      data: { agentId: string; phaseName: string; phaseIndex: number }
    }
  | { type: 'agent:error'; data: { agentId: string; message: string } }
  | { type: 'agent:done'; data: { agentId: string } }
  | { type: 'agent:destroyed'; data: { agentId: string } }
  | {
      type: 'agent:interaction-changed'
      data: { agentId: string; interaction: PendingHumanInteraction | null }
    }

/** Payload shape for the agent:event channel. */
export interface AgentEventPayload {
  event: AgentEvent
}

// ---------------------------------------------------------------------------
// Renderer API Types
// ---------------------------------------------------------------------------

/** The full typed API exposed to the renderer via contextBridge. */
export interface AgentAPI {
  // CLI sessions
  startSession(options: CliSessionOptions): Promise<string>
  abortSession(sessionId: string): Promise<void>
  getSessionState(sessionId: string): Promise<CliDriverState | null>
  respondToPermission(sessionId: string, response: PermissionResponse): Promise<void>
  respondToQuestion(sessionId: string, response: UserQuestionResponse): Promise<void>
  onCliEvent(callback: (payload: CliEventPayload) => void): () => void

  // Worktrees
  createWorktree(repoPath: string, branch: string): Promise<WorktreeInfo>
  listWorktrees(repoPath: string): Promise<WorktreeInfo[]>
  removeWorktree(repoPath: string, worktree: WorktreeInfo): Promise<void>
  cleanupOrphanedWorktrees(repoPath: string): Promise<WorktreeInfo[]>
  listRemoteBranches(repoPath: string): Promise<string[]>
}

/** Agent persistence API exposed to the renderer. */
export interface PersistenceAPI {
  listAgents(): Promise<AgentSnapshot[]>
  getAgent(agentId: string): Promise<AgentSnapshot | null>
  dismissAgent(agentId: string): Promise<void>
  onAgentEvent(callback: (payload: AgentEventPayload) => void): () => void
}

/** Orchestration loop API exposed to the renderer. */
export interface OrchestrationAPI {
  startOrchestration(agentId: string): Promise<void>
  stopOrchestration(agentId: string): Promise<void>
  respondToOrchestrationPermission(agentId: string, response: PermissionResponse): Promise<void>
  respondToOrchestrationQuestion(agentId: string, response: UserQuestionResponse): Promise<void>
  respondToOrchestrationSecurityAlert(agentId: string, response: SecurityAlertResponse): Promise<void>
  isOrchestrationRunning(agentId: string): Promise<boolean>
  getConcurrencyStatus(): Promise<ConcurrencyStatus>
}

/** Agent creation API exposed to the renderer. */
export interface AgentCreateAPI {
  createAgent(card: {
    id: string
    name: string
    description: string
    sourceListId: string
  }): Promise<string>
}

/** Trello API exposed to the renderer. */
export interface TrelloAPI {
  getTrelloLists(): Promise<TrelloList[]>
  getTrelloListsForBoard(boardId: string, apiKey: string, apiToken: string): Promise<TrelloList[]>
  getTrelloBacklogCards(): Promise<TrelloCard[]>
}

/** Logging API exposed to the renderer. */
export interface LoggingAPI {
  getAgentLog(agentId: string): Promise<LogEntry[]>
}

/** Runbook API exposed to the renderer. */
export interface RunbookAPI {
  getRunbook(): Promise<Runbook | null>
  refreshRunbook(): Promise<Runbook | null>
}
