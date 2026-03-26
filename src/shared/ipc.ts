import type {
  CliDriverState,
  CliSessionOptions,
  PermissionRequest,
  PermissionResponse,
  UserQuestionRequest,
  UserQuestionResponse,
  SessionInfo,
  SessionResult,
  StreamTextDelta,
  AssistantContent
} from './cli-driver'
import type { WorktreeInfo } from './worktree'

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
  WORKTREE_CLEANUP_ORPHANS: 'worktree:cleanupOrphans'
} as const

// ---------------------------------------------------------------------------
// CLI Event Streaming (main → renderer)
// ---------------------------------------------------------------------------

/** Discriminated union of all CLI events pushed from main to renderer. */
export type CliEvent =
  | { event: 'state:changed'; data: { state: CliDriverState; previousState: CliDriverState } }
  | { event: 'session:init'; data: SessionInfo }
  | { event: 'stream:text'; data: StreamTextDelta }
  | { event: 'assistant:message'; data: AssistantContent }
  | { event: 'permission:request'; data: PermissionRequest }
  | { event: 'user:question'; data: UserQuestionRequest }
  | { event: 'session:result'; data: SessionResult }
  | { event: 'error'; data: { message: string } }

/** Payload shape for the cli:event channel. */
export interface CliEventPayload {
  sessionId: string
  event: CliEvent
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
  onCliEvent(callback: (payload: CliEventPayload) => void): void
  offCliEvent(): void

  // Worktrees
  createWorktree(repoPath: string, branch: string): Promise<WorktreeInfo>
  listWorktrees(repoPath: string): Promise<WorktreeInfo[]>
  removeWorktree(repoPath: string, worktree: WorktreeInfo): Promise<void>
  cleanupOrphanedWorktrees(repoPath: string): Promise<WorktreeInfo[]>
}
