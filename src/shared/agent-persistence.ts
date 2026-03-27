import type { AgentStateSnapshot, StateMachineRestoreData } from './agent-state'
import type { CardInfo } from './agent-manager'
import type { WorktreeInfo } from './worktree'
import type { Runbook } from './runbook'
import type { PermissionRequest, UserQuestionRequest } from './cli-driver'

/** Record of a completed step, for history tracking. */
export interface StepCompletionRecord {
  phaseIndex: number
  stepIndex: number
  phaseName: string
  stepTitle: string
  completedAt: string // ISO 8601
  summary?: string
}

/** Pending human interaction saved at the time of persistence. */
export interface PendingHumanInteraction {
  type: 'permission' | 'question'
  detail: string
  occurredAt: string // ISO 8601
  permissionRequest?: PermissionRequest
  questionRequest?: UserQuestionRequest
}

/** The full persisted state for a single agent. */
export interface PersistedAgent {
  id: string
  card: CardInfo
  worktree: WorktreeInfo
  runbook: Runbook
  stateSnapshot: AgentStateSnapshot
  restoreData: StateMachineRestoreData
  sessionId: string | null
  stepHistory: StepCompletionRecord[]
  pendingHumanInteraction: PendingHumanInteraction | null
  createdAt: string // ISO 8601
  persistedAt: string // ISO 8601
  interruptedAt: string | null // ISO 8601, set during reconciliation
}

/** Top-level structure of the agents.json file. */
export interface PersistedAgentStore {
  version: 1
  agents: Record<string, PersistedAgent>
}

/** Result of reconciliation for a single agent. */
export interface ReconciliationResult {
  agentId: string
  status: 'restored' | 'interrupted' | 'stale'
  reason?: string
}
