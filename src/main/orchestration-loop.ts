import { BrowserWindow } from 'electron'
import { CliDriver } from './cli-driver'
import { generateStepPrompt } from './prompt-generator'
import { TypedEventEmitter } from './typed-emitter'
import type { AgentManager } from './agent-manager'
import type {
  SessionResult,
  AssistantContent,
  PermissionResponse,
  UserQuestionResponse
} from '../shared/cli-driver'
import type { CliEventPayload } from '../shared/ipc'
import type { OrchestrationLoopEvents, ConcurrencyStatus } from '../shared/orchestration-loop'

interface RunningAgent {
  agentId: string
  driver: CliDriver | null
  /** SDK session ID for session resumption across steps. */
  sdkSessionId: string | null
  /** Last assistant message text (kept for summary extraction). */
  lastAssistantText: string
  /** Set to true when stopAgent is called. */
  stopped: boolean
}

/**
 * Central orchestration loop. Drives agents through runbook steps by
 * creating CLI sessions, listening for events, and advancing the state machine.
 *
 * One async loop per agent runs concurrently. Permissions and questions
 * pause the CliDriver internally (via deferred promises) — the loop's
 * runStep() Promise stays pending until the step completes.
 */
export class OrchestrationLoop extends TypedEventEmitter<OrchestrationLoopEvents> {
  private readonly running = new Map<string, RunningAgent>()
  private readonly queued: string[] = []
  private maxConcurrentAgents: number

  constructor(
    private readonly agentManager: AgentManager,
    maxConcurrentAgents = 3
  ) {
    super()
    this.maxConcurrentAgents = maxConcurrentAgents
  }

  /**
   * Start the orchestration loop for an agent.
   * If the concurrency limit is reached, the agent is queued and will
   * auto-start when a slot opens.
   */
  startAgent(agentId: string): void {
    if (this.running.has(agentId)) {
      throw new Error(`Agent ${agentId} is already running`)
    }
    if (this.queued.includes(agentId)) {
      throw new Error(`Agent ${agentId} is already queued`)
    }
    if (!this.agentManager.getAgent(agentId)) {
      throw new Error(`Unknown agent: ${agentId}`)
    }

    if (this.running.size >= this.maxConcurrentAgents) {
      this.queued.push(agentId)
      this.emit('agent:queued', agentId, this.queued.length)
      return
    }

    this.launchAgent(agentId)
  }

  /** Stop an agent's orchestration loop. Removes from queue or aborts active session. */
  stopAgent(agentId: string): void {
    // Check queue first — agent may not have started yet
    const queueIndex = this.queued.indexOf(agentId)
    if (queueIndex !== -1) {
      this.queued.splice(queueIndex, 1)
      this.emit('agent:stopped', agentId)
      return
    }

    const entry = this.running.get(agentId)
    if (!entry) return

    entry.stopped = true
    entry.driver?.abort()
    this.running.delete(agentId)
    this.agentManager.setSessionId(agentId, null)
    this.agentManager.setPendingHumanInteraction(agentId, null)
    this.emit('agent:stopped', agentId)
    this.tryDequeue()
  }

  /**
   * Respond to a permission request on an agent's active CLI session.
   * No-op if the agent was stopped (race between stop and respond is benign).
   */
  respondToPermission(agentId: string, response: PermissionResponse): void {
    const entry = this.running.get(agentId)
    if (!entry?.driver) return // agent was stopped or has no active session

    entry.driver.respondToPermission(response)

    const sm = this.agentManager.getStateMachine(agentId)
    if (sm?.getState() === 'waiting_for_human') {
      sm.resumeFromWaiting()
    }
    this.agentManager.setPendingHumanInteraction(agentId, null)
  }

  /**
   * Respond to a user question on an agent's active CLI session.
   * No-op if the agent was stopped (race between stop and respond is benign).
   */
  async respondToQuestion(agentId: string, response: UserQuestionResponse): Promise<void> {
    const entry = this.running.get(agentId)
    if (!entry?.driver) return // agent was stopped or has no active session

    await entry.driver.respondToUserQuestion(response)

    const sm = this.agentManager.getStateMachine(agentId)
    if (sm?.getState() === 'waiting_for_human') {
      sm.resumeFromWaiting()
    }
    this.agentManager.setPendingHumanInteraction(agentId, null)
  }

  /** Whether an agent's loop is currently active (running or queued). */
  isRunning(agentId: string): boolean {
    return this.running.has(agentId) || this.queued.includes(agentId)
  }

  /** Whether an agent is waiting in the queue (not yet running). */
  isQueued(agentId: string): boolean {
    return this.queued.includes(agentId)
  }

  /** Get the concurrency status snapshot. */
  getConcurrencyStatus(): ConcurrencyStatus {
    return {
      running: this.running.size,
      queued: this.queued.length,
      max: this.maxConcurrentAgents
    }
  }

  /** Update the max concurrent agents limit. Does not kill running agents. */
  setMaxConcurrentAgents(max: number): void {
    this.maxConcurrentAgents = Math.max(1, Math.floor(max))
    // If the new limit is higher, try to dequeue waiting agents
    this.tryDequeue()
  }

  /** Abort all running agent loops and clear the queue. Called on app quit. */
  abortAll(): void {
    this.queued.length = 0
    for (const [agentId, entry] of this.running) {
      entry.stopped = true
      entry.driver?.abort()
      this.agentManager.setSessionId(agentId, null)
    }
    this.running.clear()
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /** Actually launch an agent's orchestration loop (no concurrency check). */
  private launchAgent(agentId: string): void {
    const entry: RunningAgent = {
      agentId,
      driver: null,
      sdkSessionId: null,
      lastAssistantText: '',
      stopped: false
    }
    this.running.set(agentId, entry)

    this.runAgentLoop(entry)
      .catch((err) => {
        console.error(`Orchestration loop error for agent ${agentId}:`, err)
        this.handleAgentError(agentId, err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        // Ensure the running slot is always freed, even on unexpected throws
        this.running.delete(agentId)
        this.agentManager.setSessionId(agentId, null)
        this.tryDequeue()
      })
  }

  /** Start the next queued agent if a slot is available. */
  private tryDequeue(): void {
    while (this.queued.length > 0 && this.running.size < this.maxConcurrentAgents) {
      const nextId = this.queued.shift()!
      // Agent may have been destroyed while queued — emit stopped so the UI
      // gets a terminal event for the agent it previously received queued for.
      if (!this.agentManager.getAgent(nextId)) {
        this.emit('agent:stopped', nextId)
        continue
      }
      this.emit('agent:dequeued', nextId)
      this.launchAgent(nextId)
    }
  }

  private async runAgentLoop(entry: RunningAgent): Promise<void> {
    const { agentId } = entry
    const sm = this.agentManager.getStateMachine(agentId)
    if (!sm) throw new Error(`Agent ${agentId} has no state machine`)

    // Transition into a phase state from whatever starting state we're in
    this.enterPhaseState(agentId)

    this.emit('agent:running', agentId)

    // Step loop: run steps until done, error, or stopped
    while (!entry.stopped) {
      const state = sm.getState()

      if (state === 'done') {
        this.emit('agent:completed', agentId)
        break
      }
      if (state === 'error') {
        this.emit('agent:errored', agentId, sm.getSnapshot().error ?? 'Unknown error')
        break
      }

      const snapshot = sm.getSnapshot()
      if (snapshot.phaseIndex === -1) break

      const runbook = this.agentManager.getRunbook(agentId)
      if (!runbook) break

      const agent = this.agentManager.getAgent(agentId)
      if (!agent) break

      const phase = runbook.phases[snapshot.phaseIndex]
      const step = phase.steps[snapshot.stepIndex]

      const prompt = generateStepPrompt({
        step,
        cardName: agent.card.name,
        cardDescription: agent.card.description,
        branchName: agent.worktree.branch,
        worktreePath: agent.worktree.path,
        phaseIndex: snapshot.phaseIndex,
        totalPhases: snapshot.totalPhases,
        stepIndex: snapshot.stepIndex,
        totalStepsInPhase: phase.steps.length
      })

      const ok = await this.runStep(entry, prompt)
      if (entry.stopped) break

      if (!ok) break // error already set on state machine

      // Advance — handles phase transitions and done automatically.
      // advanceStep() creates the step history record via step:completed event.
      const completedPhaseIndex = snapshot.phaseIndex
      const completedStepIndex = snapshot.stepIndex
      sm.advanceStep()

      // Set summary after advance (history record now exists)
      const summary = entry.lastAssistantText.slice(-500) || 'Step completed.'
      this.agentManager.setStepSummary(agentId, completedPhaseIndex, completedStepIndex, summary)
    }

    // Normal-path cleanup. The .finally() in launchAgent() is a safety net for
    // unexpected throws — running.delete/tryDequeue are idempotent, so the
    // duplicate call is harmless.
    this.running.delete(agentId)
    this.agentManager.setSessionId(agentId, null)
    this.tryDequeue()
  }

  /**
   * Transition the agent into a runbook phase state from any starting state.
   * Handles idle, picking_card, error, waiting_for_human, and already-in-phase.
   */
  private enterPhaseState(agentId: string): void {
    const sm = this.agentManager.getStateMachine(agentId)
    if (!sm) throw new Error(`Agent ${agentId} has no state machine`)

    const state = sm.getState()
    const phases = sm.getPhaseNames()

    switch (state) {
      case 'idle':
        sm.transition('picking_card')
        sm.transition(phases[0])
        break

      case 'picking_card':
        sm.transition(phases[0])
        break

      case 'waiting_for_human':
        // Restored after crash — clear waiting state and resume
        sm.resumeFromWaiting()
        this.agentManager.setPendingHumanInteraction(agentId, null)
        break

      case 'error': {
        // Retry from where we errored
        const snapshot = sm.getSnapshot()
        if (snapshot.phaseIndex >= 0) {
          sm.transition(phases[snapshot.phaseIndex])
        } else {
          sm.transition('idle')
          sm.transition('picking_card')
          sm.transition(phases[0])
        }
        break
      }

      case 'done':
        throw new Error(`Agent ${agentId} is already done`)

      default:
        // Already in a phase state — continue from current position
        break
    }
  }

  /**
   * Run a single CLI session for one runbook step.
   * Returns true on success, false on error.
   * The Promise stays pending during permission/question pauses.
   */
  private runStep(entry: RunningAgent, prompt: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const { agentId } = entry
      const agent = this.agentManager.getAgent(agentId)
      if (!agent) {
        this.handleAgentError(agentId, 'Agent not found')
        resolve(false)
        return
      }

      let resolved = false
      const safeResolve = (value: boolean): void => {
        if (!resolved) {
          resolved = true
          resolve(value)
        }
      }

      const driver = new CliDriver()
      entry.driver = driver
      entry.lastAssistantText = ''

      this.wireDriverToRenderer(agentId, driver)

      driver.on('session:init', (info) => {
        entry.sdkSessionId = info.sessionId
        this.agentManager.setSessionId(agentId, info.sessionId)
      })

      driver.on('assistant:message', (content: AssistantContent) => {
        if (content.text) {
          entry.lastAssistantText = content.text
        }
      })

      driver.on('permission:request', (request) => {
        const sm = this.agentManager.getStateMachine(agentId)
        if (sm && sm.getState() !== 'waiting_for_human') {
          sm.setWaitingForHuman()
        }
        this.agentManager.setPendingHumanInteraction(agentId, {
          type: 'permission',
          detail: `${request.toolName}: ${request.title ?? request.description ?? ''}`,
          occurredAt: new Date().toISOString()
        })
      })

      driver.on('user:question', (request) => {
        const sm = this.agentManager.getStateMachine(agentId)
        if (sm && sm.getState() !== 'waiting_for_human') {
          sm.setWaitingForHuman()
        }
        this.agentManager.setPendingHumanInteraction(agentId, {
          type: 'question',
          detail: request.question,
          occurredAt: new Date().toISOString()
        })
      })

      driver.on('session:result', (result: SessionResult) => {
        if (result.subtype === 'success') {
          safeResolve(true)
        } else {
          this.handleAgentError(
            agentId,
            `CLI session ended: ${result.subtype}${result.result ? ` — ${result.result}` : ''}`
          )
          safeResolve(false)
        }
      })

      driver.on('error', (err: Error) => {
        if (!entry.stopped) {
          this.handleAgentError(agentId, err.message)
        }
        safeResolve(false)
      })

      driver
        .startSession({
          prompt,
          cwd: agent.worktree.path,
          sessionId: entry.sdkSessionId ?? undefined
        })
        .catch((err) => {
          if (!entry.stopped) {
            this.handleAgentError(agentId, err instanceof Error ? err.message : String(err))
          }
          safeResolve(false)
        })
    })
  }

  private handleAgentError(agentId: string, message: string): void {
    const sm = this.agentManager.getStateMachine(agentId)
    if (sm) {
      const state = sm.getState()
      if (state !== 'error' && state !== 'done' && state !== 'idle') {
        try {
          sm.setError(message)
        } catch {
          // State machine may reject if not in a valid state for setError
        }
      }
    }
    this.emit('agent:errored', agentId, message)
  }

  /** Forward CliDriver events to the renderer for live UI display. */
  private wireDriverToRenderer(agentId: string, driver: CliDriver): void {
    // Use a stable session ID per agent so the renderer can correlate events
    const sessionId = `orchestration-${agentId}`

    // Look up window at push-time so events reach a new window if the
    // original was closed and re-opened (e.g., macOS activate).
    const push = (event: CliEventPayload['event']): void => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win && !win.isDestroyed()) {
        win.webContents.send('cli:event', { sessionId, event } satisfies CliEventPayload)
      }
    }

    driver.on('state:changed', (state, previousState) => {
      push({ type: 'state:changed', data: { state, previousState } })
    })
    driver.on('session:init', (info) => {
      push({ type: 'session:init', data: info })
    })
    driver.on('stream:text', (delta) => {
      push({ type: 'stream:text', data: delta })
    })
    driver.on('assistant:message', (content) => {
      push({ type: 'assistant:message', data: content })
    })
    driver.on('permission:request', (request) => {
      push({ type: 'permission:request', data: request })
    })
    driver.on('user:question', (request) => {
      push({ type: 'user:question', data: request })
    })
    driver.on('session:result', (result) => {
      push({ type: 'session:result', data: result })
    })
    driver.on('error', (err) => {
      push({ type: 'error', data: { message: err.message } })
    })
  }
}
