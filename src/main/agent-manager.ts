import { randomUUID } from 'crypto'
import type { Runbook } from '../shared/runbook'
import type { WorktreeInfo } from '../shared/worktree'
import type { CardInfo, AgentSnapshot, AgentManagerEvents } from '../shared/agent-manager'
import type { AgentState, AgentStepProgress } from '../shared/agent-state'
import { AgentStateMachine } from './agent-state-machine'
import { createWorktree, removeWorktree } from './worktree-manager'
import { TypedEventEmitter } from './typed-emitter'

interface AgentEntry {
  id: string
  card: CardInfo
  worktree: WorktreeInfo
  stateMachine: AgentStateMachine
  sessionId: string | null
}

/**
 * Central registry for all active agents. Manages agent lifecycle:
 * creating (worktree + state machine), tracking, and destroying.
 *
 * Does NOT drive the orchestration loop (#013) — the loop uses
 * getStateMachine() and setSessionId() to interact with agents.
 */
export class AgentManager extends TypedEventEmitter<AgentManagerEvents> {
  private readonly agents = new Map<string, AgentEntry>()

  /**
   * Create a new agent for a Trello card.
   *
   * Creates a git worktree, instantiates a state machine from the runbook,
   * and registers the agent. Returns the agent ID. If the state machine
   * constructor throws (bad runbook), the worktree is cleaned up.
   */
  async createAgent(card: CardInfo, runbook: Runbook, repoPath: string): Promise<string> {
    const branch = this.branchNameFromCard(card.name)
    const worktree = await createWorktree(repoPath, branch)

    let stateMachine: AgentStateMachine
    try {
      stateMachine = new AgentStateMachine(runbook)
    } catch (err) {
      // Rollback: remove the worktree we just created
      try {
        await removeWorktree(repoPath, worktree)
      } catch {
        // Best-effort cleanup
      }
      throw err
    }

    const id = randomUUID()
    const entry: AgentEntry = { id, card, worktree, stateMachine, sessionId: null }
    this.agents.set(id, entry)
    this.wireStateMachineEvents(entry)

    this.emit('agent:created', this.snapshotOf(entry))
    return id
  }

  /**
   * Destroy an agent: clean up its worktree and remove from the registry.
   * Safe to call even if the worktree was already removed externally.
   */
  async destroyAgent(agentId: string, repoPath: string): Promise<void> {
    const entry = this.agents.get(agentId)
    if (!entry) {
      throw new Error(`Unknown agent: ${agentId}`)
    }

    // Disconnect all event forwarding by name. We pass each event explicitly
    // because TypedEventEmitter.removeAllListeners() with no args forwards
    // `undefined` to Node's EventEmitter, which treats it differently from
    // a truly absent argument and may not remove all listeners.
    for (const event of [
      'state:changed',
      'step:advanced',
      'step:completed',
      'phase:completed',
      'error'
    ] as const) {
      entry.stateMachine.removeAllListeners(event)
    }

    try {
      await removeWorktree(repoPath, entry.worktree)
    } catch {
      // Worktree may already be gone — not fatal
    }

    this.agents.delete(agentId)
    this.emit('agent:destroyed', agentId)
  }

  /** Get a snapshot of a single agent, or null if not found. */
  getAgent(agentId: string): AgentSnapshot | null {
    const entry = this.agents.get(agentId)
    return entry ? this.snapshotOf(entry) : null
  }

  /** List all active agents as snapshots. */
  listAgents(): AgentSnapshot[] {
    return Array.from(this.agents.values()).map((e) => this.snapshotOf(e))
  }

  /** Get the state machine for an agent. Used by the orchestration loop. */
  getStateMachine(agentId: string): AgentStateMachine | null {
    return this.agents.get(agentId)?.stateMachine ?? null
  }

  /** Associate a CLI session ID with an agent. Set null to clear. */
  setSessionId(agentId: string, sessionId: string | null): void {
    const entry = this.agents.get(agentId)
    if (!entry) {
      throw new Error(`Unknown agent: ${agentId}`)
    }
    entry.sessionId = sessionId
  }

  /** Number of active agents. */
  get size(): number {
    return this.agents.size
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private snapshotOf(entry: AgentEntry): AgentSnapshot {
    return {
      id: entry.id,
      card: entry.card,
      worktree: entry.worktree,
      stateSnapshot: entry.stateMachine.getSnapshot(),
      sessionId: entry.sessionId
    }
  }

  /** Wire state machine events to re-emit as agent-level events. */
  private wireStateMachineEvents(entry: AgentEntry): void {
    const { id, stateMachine } = entry

    stateMachine.on('state:changed', (newState: AgentState) => {
      this.emit('agent:state-changed', id, stateMachine.getSnapshot())

      if (newState === 'done') {
        this.emit('agent:done', id)
      }
    })

    stateMachine.on('step:advanced', (progress: AgentStepProgress) => {
      this.emit('agent:step-advanced', id, progress)
    })

    stateMachine.on('step:completed', (progress: AgentStepProgress) => {
      this.emit('agent:step-completed', id, progress)
    })

    stateMachine.on('phase:completed', (phaseName: string, phaseIndex: number) => {
      this.emit('agent:phase-completed', id, phaseName, phaseIndex)
    })

    stateMachine.on('error', (message: string) => {
      this.emit('agent:error', id, message)
    })
  }

  /**
   * Derive a branch name from a Trello card name.
   * "#011 Agent manager" → "feat-agent-manager"
   *
   * Uses hyphens instead of slashes so the worktree manager can create
   * a flat sibling directory (e.g., `../feat-agent-manager/`). Slashed
   * branch names like `feat/xxx` would create nested directories.
   */
  private branchNameFromCard(cardName: string): string {
    // Strip the card number prefix (e.g. "#011 ")
    const stripped = cardName.replace(/^#\d+\s*/, '')
    // Lowercase, replace spaces/special chars with hyphens
    const slug = stripped
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    return `feat-${slug}`
  }
}
