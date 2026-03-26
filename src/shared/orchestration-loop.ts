/** Events emitted by the OrchestrationLoop. */
export type OrchestrationLoopEvents = {
  /** An agent's orchestration loop started running. */
  'agent:running': (agentId: string) => void
  /** An agent was queued because the concurrency limit was reached. */
  'agent:queued': (agentId: string, position: number) => void
  /** A queued agent was dequeued and is about to start running. */
  'agent:dequeued': (agentId: string) => void
  /** An agent completed all runbook steps. */
  'agent:completed': (agentId: string) => void
  /** An agent encountered an error during orchestration. */
  'agent:errored': (agentId: string, message: string) => void
  /** An agent's orchestration loop was stopped (aborted). */
  'agent:stopped': (agentId: string) => void
  /** An agent appears stuck (no activity for the configured timeout). */
  'agent:stuck': (agentId: string, elapsedMs: number) => void
}

/** Concurrency status snapshot for the UI. */
export interface ConcurrencyStatus {
  running: number
  queued: number
  max: number
}
