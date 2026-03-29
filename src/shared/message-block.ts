/** Unique ID for each block, used as React key. */
export type BlockId = string

/** Base fields shared by all block types. */
interface BaseBlock {
  id: BlockId
  timestamp: number
}

/** Streaming or completed markdown text from the assistant. */
export interface TextBlock extends BaseBlock {
  type: 'text'
  /** Accumulated markdown content. Mutated in-place during streaming for efficiency. */
  content: string
  /** True while the SDK is still emitting stream:text deltas for this block. */
  streaming: boolean
}

/** Step banner emitted by the orchestration loop before each step prompt. */
export interface BannerBlock extends BaseBlock {
  type: 'banner'
  phaseIndex: number
  totalPhases: number
  stepIndex: number
  totalSteps: number | string
  phaseName: string
  stepTitle: string
}

/** Tool invocation (start, optional activity updates, optional summary). */
export interface ToolBlock extends BaseBlock {
  type: 'tool'
  toolName: string
  inputSummary: string
  /** Condensed summary from the SDK's tool_use_summary message. */
  summary?: string
  /** Actual tool output from the SDK's user message (tool_use_result). */
  result?: string
  /** True while tool is executing (tool:activity events update elapsed). */
  active: boolean
  elapsedSeconds: number
}

/** Session result stats card. */
export interface ResultBlock extends BaseBlock {
  type: 'result'
  subtype: 'success' | 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd'
  costUsd: number
  numTurns: number
  durationMs: number
}

/** Auto-approve / smart-approve status messages. */
export interface StatusBlock extends BaseBlock {
  type: 'status'
  variant: 'auto-approved' | 'smart-approved'
  toolName: string
  inputSummary: string
}

/** Error message block. */
export interface ErrorBlock extends BaseBlock {
  type: 'error'
  message: string
}

/** Discriminated union of all block types. */
export type MessageBlock =
  | TextBlock
  | BannerBlock
  | ToolBlock
  | ResultBlock
  | StatusBlock
  | ErrorBlock

/** Update notifications sent to subscribers for targeted re-renders. */
export type BlockUpdate =
  | { type: 'block:appended'; block: MessageBlock }
  | { type: 'block:updated'; blockIndex: number }
  | { type: 'blocks:reset' }
