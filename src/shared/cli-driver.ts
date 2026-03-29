import type { ApprovalMode } from './config'

/** State of a CliDriver instance. */
export type CliDriverState =
  | 'idle'
  | 'running'
  | 'waiting_permission'
  | 'waiting_user_input'
  | 'completed'
  | 'error'
  | 'aborted'

/** Configuration for starting a CLI session. */
export interface CliSessionOptions {
  prompt: string
  cwd: string
  allowedTools?: string[]
  /** Which filesystem settings files to load for permission rules and project instructions.
   *  When omitted, no filesystem settings are loaded (SDK default). */
  settingSources?: Array<'user' | 'project' | 'local'>
  systemPrompt?: string
  model?: string
  maxTurns?: number
  /** Pass a previous session ID to resume a conversation. */
  sessionId?: string
  /** Permission approval mode: 'always' auto-approves, 'smart' uses LLM evaluation, 'never' asks user. */
  approvalMode?: ApprovalMode
  /** Worktree path — used by smart approval to determine in-bounds operations. */
  worktreePath?: string
  /** Current runbook step title — used by smart approval for intent context. */
  currentStepTitle?: string
}

/** Emitted when the SDK's canUseTool callback fires. */
export interface PermissionRequest {
  requestId: string
  toolName: string
  toolInput: Record<string, unknown>
  toolUseId: string
  title?: string
  description?: string
}

/** Caller response to a PermissionRequest. */
export interface PermissionResponse {
  requestId: string
  behavior: 'allow' | 'deny'
  message?: string
  updatedInput?: Record<string, unknown>
  /** When true, persist this allow decision to .claude/settings.local.json so the SDK
   *  auto-approves matching tool calls in future sessions. */
  rememberChoice?: boolean
}

/** Emitted when the smart auto-approver returns 'no' (genuinely dangerous operation). */
export interface SecurityAlertRequest {
  requestId: string
  toolName: string
  toolInput: Record<string, unknown>
  toolUseId: string
  explanation: string
  title?: string
  description?: string
}

/** Caller response to a SecurityAlertRequest. */
export interface SecurityAlertResponse {
  requestId: string
  /** 'override' allows the tool call despite the warning. 'dismiss' stops the agent. */
  behavior: 'override' | 'dismiss'
}

/** Emitted when Claude calls the AskUserQuestion tool. */
export interface UserQuestionRequest {
  requestId: string
  question: string
  toolUseId: string
}

/** Caller response to a UserQuestionRequest. */
export interface UserQuestionResponse {
  requestId: string
  answer: string
}

/** Session metadata from the SDK system/init message. */
export interface SessionInfo {
  sessionId: string
  model: string
  tools: string[]
}

/** Final result when a session completes. */
export interface SessionResult {
  subtype: 'success' | 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd'
  sessionId: string
  result?: string
  costUsd: number
  numTurns: number
  durationMs: number
}

/** A chunk of streaming text for display. */
export interface StreamTextDelta {
  text: string
}

/** Parsed content from a complete assistant message. */
export interface AssistantContent {
  text: string
  toolUses: Array<{ toolName: string; input: Record<string, unknown> }>
}

/** Emitted when a tool call is detected in an assistant message. */
export interface ToolStartEvent {
  toolName: string
  inputSummary: string
}

/** Emitted periodically while a tool is executing. */
export interface ToolActivityEvent {
  toolName: string
  elapsedSeconds: number
}

/** Emitted when the SDK provides a tool use summary. */
export interface ToolSummaryEvent {
  summary: string
}

/** Emitted by the orchestration loop before each step prompt. */
export interface StepBannerEvent {
  phaseIndex: number
  totalPhases: number
  stepIndex: number
  totalSteps: number | string
  phaseName: string
  stepTitle: string
}

/** Emitted when a tool call is auto-approved or smart-approved. */
export interface ApprovalStatusEvent {
  variant: 'auto-approved' | 'smart-approved'
  toolName: string
  inputSummary: string
}

/** Typed event map for the CliDriver. */
export type CliDriverEvents = {
  'state:changed': (state: CliDriverState, previousState: CliDriverState) => void
  'session:init': (info: SessionInfo) => void
  'stream:text': (delta: StreamTextDelta) => void
  'assistant:message': (content: AssistantContent) => void
  'tool:start': (event: ToolStartEvent) => void
  'tool:activity': (event: ToolActivityEvent) => void
  'tool:summary': (event: ToolSummaryEvent) => void
  'approval:status': (event: ApprovalStatusEvent) => void
  'permission:request': (request: PermissionRequest) => void
  'security:alert': (request: SecurityAlertRequest) => void
  'user:question': (request: UserQuestionRequest) => void
  'session:result': (result: SessionResult) => void
  error: (error: Error) => void
}
