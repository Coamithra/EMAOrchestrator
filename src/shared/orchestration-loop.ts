/** Events emitted by the OrchestrationLoop. */
export type OrchestrationLoopEvents = {
  /** An agent's orchestration loop started running. */
  'agent:running': (agentId: string) => void
  /** An agent completed all runbook steps. */
  'agent:completed': (agentId: string) => void
  /** An agent encountered an error during orchestration. */
  'agent:errored': (agentId: string, message: string) => void
  /** An agent's orchestration loop was stopped (aborted). */
  'agent:stopped': (agentId: string) => void
}
