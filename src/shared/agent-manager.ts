import type { AgentStateSnapshot, AgentStepProgress } from './agent-state'
import type { StepCompletionRecord, PendingHumanInteraction } from './agent-persistence'
import type { WorktreeInfo } from './worktree'
import type { Runbook } from './runbook'

/** Trello card info needed to create an agent. */
export interface CardInfo {
  id: string
  name: string
  description: string
  /** The Trello list this card was sourced from (used to return it on agent cleanup). */
  sourceListId: string
}

/** Full snapshot of an agent, suitable for rendering in the UI. */
export interface AgentSnapshot {
  id: string
  card: CardInfo
  worktree: WorktreeInfo
  runbook: Runbook
  stateSnapshot: AgentStateSnapshot
  sessionId: string | null
  stepHistory: StepCompletionRecord[]
  pendingHumanInteraction: PendingHumanInteraction | null
  createdAt: string
  interruptedAt: string | null
}

/** Events emitted by the AgentManager. */
export type AgentManagerEvents = {
  'agent:created': (snapshot: AgentSnapshot) => void
  'agent:state-changed': (agentId: string, snapshot: AgentStateSnapshot) => void
  'agent:step-advanced': (agentId: string, progress: AgentStepProgress) => void
  'agent:step-completed': (agentId: string, progress: AgentStepProgress) => void
  'agent:phase-completed': (agentId: string, phaseName: string, phaseIndex: number) => void
  'agent:error': (agentId: string, message: string) => void
  'agent:done': (agentId: string) => void
  'agent:destroyed': (agentId: string) => void
  'agent:step-summary': (agentId: string, phaseIndex: number, stepIndex: number, summary: string) => void
  'agent:interaction-changed': (agentId: string, interaction: PendingHumanInteraction | null) => void
}
