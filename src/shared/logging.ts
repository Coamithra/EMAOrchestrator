/** Event types for structured log entries. */
export type LogEventType =
  | 'agent_started'
  | 'prompt_sent'
  | 'response_received'
  | 'step_completed'
  | 'step_error'
  | 'permission_requested'
  | 'question_asked'
  | 'agent_completed'
  | 'agent_error'
  | 'agent_stopped'

/** Base fields present on every log entry. */
export interface LogEntryBase {
  timestamp: string // ISO 8601
  agentId: string
  cardName: string
  event: LogEventType
}

export interface AgentStartedEntry extends LogEntryBase {
  event: 'agent_started'
  branch: string
  worktreePath: string
}

export interface PromptSentEntry extends LogEntryBase {
  event: 'prompt_sent'
  phaseIndex: number
  stepIndex: number
  phaseName: string
  stepTitle: string
  prompt: string
}

export interface ResponseReceivedEntry extends LogEntryBase {
  event: 'response_received'
  phaseIndex: number
  stepIndex: number
  /** Last 2000 chars of assistant text (truncated for log size). */
  text: string
}

export interface StepCompletedEntry extends LogEntryBase {
  event: 'step_completed'
  phaseIndex: number
  stepIndex: number
  phaseName: string
  stepTitle: string
  durationMs: number
  summary: string
}

export interface StepErrorEntry extends LogEntryBase {
  event: 'step_error'
  phaseIndex: number
  stepIndex: number
  phaseName: string
  stepTitle: string
  durationMs: number
  error: string
}

export interface PermissionRequestedEntry extends LogEntryBase {
  event: 'permission_requested'
  phaseIndex: number
  stepIndex: number
  toolName: string
  detail: string
}

export interface QuestionAskedEntry extends LogEntryBase {
  event: 'question_asked'
  phaseIndex: number
  stepIndex: number
  question: string
}

export interface AgentCompletedEntry extends LogEntryBase {
  event: 'agent_completed'
  totalDurationMs: number
  stepsCompleted: number
}

export interface AgentErrorEntry extends LogEntryBase {
  event: 'agent_error'
  error: string
  phaseIndex: number
  stepIndex: number
}

export interface AgentStoppedEntry extends LogEntryBase {
  event: 'agent_stopped'
}

/** Discriminated union of all log entry types. */
export type LogEntry =
  | AgentStartedEntry
  | PromptSentEntry
  | ResponseReceivedEntry
  | StepCompletedEntry
  | StepErrorEntry
  | PermissionRequestedEntry
  | QuestionAskedEntry
  | AgentCompletedEntry
  | AgentErrorEntry
  | AgentStoppedEntry
