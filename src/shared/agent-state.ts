/** Fixed states that exist regardless of the runbook content. */
export type FixedAgentState = 'idle' | 'picking_card' | 'error' | 'waiting_for_human' | 'done'

/**
 * Agent state is either a fixed state or a dynamic phase name derived from the runbook.
 * Represented as a string since dynamic phases are only known at runtime.
 */
export type AgentState = string

/** Progress tracker for an individual step within a phase. */
export interface AgentStepProgress {
  phaseIndex: number
  stepIndex: number
  phaseName: string
  stepTitle: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** Point-in-time snapshot of the full agent state, suitable for UI rendering. */
export interface AgentStateSnapshot {
  state: AgentState
  phaseIndex: number // -1 when in a fixed state
  stepIndex: number // -1 when not actively in a step
  totalPhases: number
  totalSteps: number
  completedSteps: number
  error?: string
}

/** Events emitted by the agent state machine. */
export type AgentStateMachineEvents = {
  'state:changed': (newState: AgentState, previousState: AgentState) => void
  'step:advanced': (progress: AgentStepProgress) => void
  'step:completed': (progress: AgentStepProgress) => void
  'phase:completed': (phaseName: string, phaseIndex: number) => void
  error: (message: string) => void
}
