import { BrowserWindow } from 'electron'
import { CliDriver, summarizeToolInput } from './cli-driver'
import { generateStepPrompt } from './prompt-generator'
import { TypedEventEmitter } from './typed-emitter'
import { moveCard, addComment } from './trello-service'
import { loadConfig } from './config-service'
import { generateToolPattern, addAllowedToolPattern } from './permission-settings-service'
import { appendLogEntry } from './logging-service'
import { createTrackerDoc, checkOffStep, removeTrackerDoc } from './tracker-doc-service'
import type { AgentManager } from './agent-manager'
import type {
  SessionResult,
  AssistantContent,
  PermissionResponse,
  SecurityAlertResponse,
  UserQuestionResponse
} from '../shared/cli-driver'
import type { ApprovalMode } from '../shared/config'
import type { CliEventPayload } from '../shared/ipc'
import type { OrchestrationLoopEvents, ConcurrencyStatus } from '../shared/orchestration-loop'
import type { LogEntry } from '../shared/logging'

interface RunningAgent {
  agentId: string
  driver: CliDriver | null
  /** SDK session ID for session resumption across steps. */
  sdkSessionId: string | null
  /** Last assistant message text (kept for summary extraction). */
  lastAssistantText: string
  /** Set to true when stopAgent is called. */
  stopped: boolean
  /** Timestamp (ms) of the last meaningful driver event. Used for stuck detection. */
  lastActivityAt: number
  /** Whether a stuck warning has been emitted since the last activity. */
  stuckNotified: boolean
  /** Interval timer for stuck-agent checks. */
  stuckCheckInterval: ReturnType<typeof setInterval> | null
  /** Timestamp (ms) when the current step started. Used for step timing logs. */
  stepStartedAt: number
  /** Per-agent approval mode override. When set, takes priority over the global default. */
  approvalModeOverride: ApprovalMode | null
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
  private approvalMode: ApprovalMode = 'never'

  constructor(
    private readonly agentManager: AgentManager,
    maxConcurrentAgents = 3,
    private stuckTimeoutMs = 10 * 60 * 1000,
    private stuckCheckIntervalMs = 60_000,
    approvalMode: ApprovalMode = 'never'
  ) {
    super()
    this.maxConcurrentAgents = maxConcurrentAgents
    this.approvalMode = approvalMode
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
    this.stopStuckWatchdog(entry)
    this.running.delete(agentId)
    // Preserve session ID so resume can restore conversation context.
    // Only clear on completion/destruction, not on stop.
    this.agentManager.setPendingHumanInteraction(agentId, null)
    this.log(agentId, { event: 'agent_stopped' })
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

    // "Allow & Remember": persist the tool pattern to settings.local.json so the SDK
    // auto-approves matching calls in future sessions. Fire-and-forget.
    if (response.behavior === 'allow' && response.rememberChoice) {
      const agent = this.agentManager.getAgent(agentId)
      const req = agent?.pendingHumanInteraction?.permissionRequest
      if (req) {
        const pattern = generateToolPattern(req.toolName, req.toolInput)
        loadConfig()
          .then((config) => addAllowedToolPattern(config?.targetRepoPath ?? '', pattern))
          .catch((err) => console.error('Failed to persist permission pattern:', err))
      }
    }

    entry.driver.respondToPermission(response)
    entry.lastActivityAt = Date.now()
    entry.stuckNotified = false

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
    entry.lastActivityAt = Date.now()
    entry.stuckNotified = false

    const sm = this.agentManager.getStateMachine(agentId)
    if (sm?.getState() === 'waiting_for_human') {
      sm.resumeFromWaiting()
    }
    this.agentManager.setPendingHumanInteraction(agentId, null)
  }

  /**
   * Respond to a security alert on an agent's active CLI session.
   * 'override' allows the tool call despite the warning. 'dismiss' stops the agent.
   */
  respondToSecurityAlert(agentId: string, response: SecurityAlertResponse): void {
    const entry = this.running.get(agentId)
    if (!entry?.driver) return

    if (response.behavior === 'dismiss') {
      // Stop the agent entirely — the dangerous operation is denied
      this.stopAgent(agentId)
      return
    }

    // Override: allow the tool call
    entry.driver.respondToSecurityAlert(response)
    entry.lastActivityAt = Date.now()
    entry.stuckNotified = false

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

  /** Update the global approval mode for new permission requests. */
  setApprovalMode(mode: ApprovalMode): void {
    this.approvalMode = mode
  }

  /** Set a per-agent approval mode override. Pass null to revert to the global default. */
  setAgentApprovalMode(agentId: string, mode: ApprovalMode | null): void {
    const entry = this.running.get(agentId)
    if (entry) {
      entry.approvalModeOverride = mode
    }
  }

  /** Get the effective approval mode for an agent (per-agent override or global default). */
  getAgentApprovalMode(agentId: string): ApprovalMode {
    const entry = this.running.get(agentId)
    return entry?.approvalModeOverride ?? this.approvalMode
  }

  /**
   * Send a direct user prompt to an agent, bypassing runbook execution.
   * If the agent is currently running a step (or a previous direct prompt),
   * it is stopped first. After the prompt completes, the agent stays paused —
   * Resume continues the runbook.
   *
   * The driver is registered in `this.running` so that permissions, questions,
   * security alerts, stopAgent(), and abortAll() all work correctly.
   */
  async sendDirectPrompt(agentId: string, prompt: string): Promise<void> {
    if (!prompt.trim()) throw new Error('Prompt cannot be empty')

    // Stop the agent if it's currently running (runbook step or previous direct prompt)
    if (this.running.has(agentId)) {
      this.stopAgent(agentId)
    }

    const agent = this.agentManager.getAgent(agentId)
    if (!agent) throw new Error(`Unknown agent: ${agentId}`)

    const config = await loadConfig()
    const cwd = config?.targetRepoPath || agent.worktree.path

    // Register in the running map so respondToPermission/stopAgent/abortAll work
    const entry: RunningAgent = {
      agentId,
      driver: null,
      sdkSessionId: agent.sessionId ?? null,
      lastAssistantText: '',
      stopped: false,
      lastActivityAt: Date.now(),
      stuckNotified: false,
      stuckCheckInterval: null,
      stepStartedAt: Date.now(),
      approvalModeOverride: null
    }
    this.running.set(agentId, entry)

    const driver = new CliDriver()
    entry.driver = driver
    this.wireDriverToRenderer(agentId, driver)

    const effectiveApproval = entry.approvalModeOverride ?? this.approvalMode

    // Capture new session ID so resume preserves conversation context
    driver.on('session:init', (info) => {
      entry.sdkSessionId = info.sessionId
      this.agentManager.setSessionId(agentId, info.sessionId)
      entry.lastActivityAt = Date.now()
      entry.stuckNotified = false
    })

    driver.on('stream:text', () => {
      entry.lastActivityAt = Date.now()
      entry.stuckNotified = false
    })

    driver.on('assistant:message', (content: AssistantContent) => {
      if (content.text) entry.lastAssistantText = content.text
      entry.lastActivityAt = Date.now()
      entry.stuckNotified = false
    })

    // Wire permission/question/alert handlers so dialogs appear during direct prompts
    driver.on('permission:request', (request) => {
      const sm = this.agentManager.getStateMachine(agentId)
      if (sm && sm.getState() !== 'waiting_for_human') {
        sm.setWaitingForHuman()
      }
      const inputSummary = summarizeToolInput(request.toolName, request.toolInput)
      const detail = `${request.toolName}: ${inputSummary}`
      this.agentManager.setPendingHumanInteraction(agentId, {
        type: 'permission',
        detail,
        occurredAt: new Date().toISOString(),
        permissionRequest: request
      })
    })

    driver.on('security:alert', (request) => {
      const sm = this.agentManager.getStateMachine(agentId)
      if (sm && sm.getState() !== 'waiting_for_human') {
        sm.setWaitingForHuman()
      }
      const inputSummary = summarizeToolInput(request.toolName, request.toolInput)
      const detail = `SECURITY ALERT: ${request.toolName}: ${inputSummary}`
      this.agentManager.setPendingHumanInteraction(agentId, {
        type: 'security_alert',
        detail,
        occurredAt: new Date().toISOString(),
        securityAlertRequest: request
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
        occurredAt: new Date().toISOString(),
        questionRequest: request
      })
    })

    // Emit a banner so the user sees this is a direct prompt, not a runbook step
    const renderSessionId = `orchestration-${agentId}`
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send('cli:event', {
        sessionId: renderSessionId,
        event: {
          type: 'stream:text' as const,
          data: { text: '\n--- Direct prompt ---\n' }
        }
      } satisfies CliEventPayload)
    }

    try {
      await new Promise<void>((resolve, reject) => {
        driver.on('session:result', () => resolve())
        driver.on('error', (err) => {
          if (!entry.stopped) reject(err)
          else resolve()
        })

        driver
          .startSession({
            prompt,
            cwd,
            sessionId: agent.sessionId ?? undefined,
            settingSources: ['user', 'project', 'local'],
            approvalMode: effectiveApproval,
            worktreePath: agent.worktree.path
          })
          .catch((err) => {
            if (!entry.stopped) reject(err)
            else resolve()
          })
      })
    } finally {
      // Only remove if this entry is still the one in the map (not replaced by a new call)
      if (this.running.get(agentId) === entry) {
        this.running.delete(agentId)
      }
      this.agentManager.setPendingHumanInteraction(agentId, null)
    }
  }

  /** Abort all running agent loops and clear the queue. Called on app quit. */
  abortAll(): void {
    this.queued.length = 0
    for (const [agentId, entry] of this.running) {
      entry.stopped = true
      entry.driver?.abort()
      this.stopStuckWatchdog(entry)
      this.agentManager.setSessionId(agentId, null)
    }
    this.running.clear()
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /** Actually launch an agent's orchestration loop (no concurrency check). */
  private launchAgent(agentId: string): void {
    // Seed session ID from the agent snapshot so resume restores conversation context
    const existingAgent = this.agentManager.getAgent(agentId)
    const entry: RunningAgent = {
      agentId,
      driver: null,
      sdkSessionId: existingAgent?.sessionId ?? null,
      lastAssistantText: '',
      stopped: false,
      lastActivityAt: Date.now(),
      stuckNotified: false,
      stuckCheckInterval: null,
      stepStartedAt: Date.now(),
      approvalModeOverride: null
    }
    this.running.set(agentId, entry)

    this.startStuckWatchdog(entry)

    this.runAgentLoop(entry)
      .catch((err) => {
        console.error(`Orchestration loop error for agent ${agentId}:`, err)
        this.handleAgentError(agentId, err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        this.stopStuckWatchdog(entry)
        // Only remove if this entry is still the one in the map — a direct prompt
        // or restart may have replaced it while the old loop was winding down.
        if (this.running.get(agentId) === entry) {
          this.running.delete(agentId)
        }
        // Don't clear session ID here — preserve it for resume.
        // It's cleared in runAgentLoop only on successful completion (done state).
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

  /** Fire-and-forget log helper. Looks up agent card name automatically. */
  private log(
    agentId: string,
    fields: LogEntry extends infer E
      ? E extends LogEntry
        ? Omit<E, 'timestamp' | 'agentId' | 'cardName'>
        : never
      : never
  ): void {
    const agent = this.agentManager.getAgent(agentId)
    const cardName = agent?.card.name ?? 'unknown'
    appendLogEntry({
      timestamp: new Date().toISOString(),
      agentId,
      cardName,
      ...fields
    } as LogEntry)
  }

  private async runAgentLoop(entry: RunningAgent): Promise<void> {
    const { agentId } = entry
    const sm = this.agentManager.getStateMachine(agentId)
    if (!sm) throw new Error(`Agent ${agentId} has no state machine`)

    // Load config once for the entire agent loop — needed for targetRepoPath
    // as cwd so the SDK finds .claude/settings.* in the project root.
    const config = await loadConfig()

    // Capture starting state before entering a phase (used to decide
    // whether this is a fresh start or a restart from error/waiting).
    const startingState = sm.getState()

    // Transition into a phase state from whatever starting state we're in
    this.enterPhaseState(agentId)

    this.emit('agent:running', agentId)

    const agent = this.agentManager.getAgent(agentId)
    if (agent) {
      this.log(agentId, {
        event: 'agent_started',
        branch: agent.worktree.branch,
        worktreePath: agent.worktree.path
      })
    }
    const agentLoopStartedAt = Date.now()

    // Move card to In Progress (fire-and-forget)
    this.trelloMoveToInProgress(agentId).catch(() => {})

    // Create tracker doc only on fresh starts (not restarts from error/waiting)
    if (agent && (startingState === 'idle' || startingState === 'picking_card')) {
      const runbook = this.agentManager.getRunbook(agentId)
      if (runbook) {
        createTrackerDoc(agent.worktree.path, agent.worktree.branch, runbook).catch(() => {})
      }
    }

    // Step loop: run steps until done, error, or stopped
    while (!entry.stopped) {
      const state = sm.getState()

      if (state === 'done') {
        // Clean up tracker doc (fire-and-forget)
        const doneAgent = this.agentManager.getAgent(agentId)
        if (doneAgent) {
          removeTrackerDoc(doneAgent.worktree.path, doneAgent.worktree.branch).catch(() => {})
        }
        // Move card to Done and post summary comment (fire-and-forget)
        this.trelloCompleteCard(agentId).catch(() => {})
        const agentSnapshot = this.agentManager.getAgent(agentId)
        this.log(agentId, {
          event: 'agent_completed',
          totalDurationMs: Date.now() - agentLoopStartedAt,
          stepsCompleted: agentSnapshot?.stepHistory.length ?? 0
        })
        this.emit('agent:completed', agentId)
        break
      }
      if (state === 'error') {
        const snap = sm.getSnapshot()
        this.log(agentId, {
          event: 'agent_error',
          error: snap.error ?? 'Unknown error',
          phaseIndex: snap.phaseIndex,
          stepIndex: snap.stepIndex
        })
        this.emit('agent:errored', agentId, snap.error ?? 'Unknown error')
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

      this.log(agentId, {
        event: 'prompt_sent',
        phaseIndex: snapshot.phaseIndex,
        stepIndex: snapshot.stepIndex,
        phaseName: phase.name,
        stepTitle: step.title,
        prompt
      })

      // Emit a step banner to the terminal before the prompt is sent
      this.emitStepBanner(agentId, snapshot, phase.name, step.title)

      entry.stepStartedAt = Date.now()
      const effectiveApproval = entry.approvalModeOverride ?? this.approvalMode
      const ok = await this.runStep(entry, prompt, effectiveApproval, step.title, config)
      if (entry.stopped) break

      const stepDurationMs = Date.now() - entry.stepStartedAt

      if (!ok) {
        this.log(agentId, {
          event: 'step_error',
          phaseIndex: snapshot.phaseIndex,
          stepIndex: snapshot.stepIndex,
          phaseName: phase.name,
          stepTitle: step.title,
          durationMs: stepDurationMs,
          error: sm.getSnapshot().error ?? 'Unknown error'
        })
        break
      }

      // Advance — handles phase transitions and done automatically.
      // advanceStep() creates the step history record via step:completed event.
      const completedPhaseIndex = snapshot.phaseIndex
      const completedStepIndex = snapshot.stepIndex
      sm.advanceStep()

      // Set summary after advance (history record now exists)
      const summary = extractStepSummary(entry.lastAssistantText)
      this.agentManager.setStepSummary(agentId, completedPhaseIndex, completedStepIndex, summary)

      // Check off the completed step in the tracker doc (fire-and-forget)
      checkOffStep(
        agent.worktree.path,
        agent.worktree.branch,
        completedPhaseIndex,
        completedStepIndex
      ).catch(() => {})

      if (entry.lastAssistantText) {
        this.log(agentId, {
          event: 'response_received',
          phaseIndex: completedPhaseIndex,
          stepIndex: completedStepIndex,
          text: entry.lastAssistantText.slice(-2000)
        })
      }

      this.log(agentId, {
        event: 'step_completed',
        phaseIndex: completedPhaseIndex,
        stepIndex: completedStepIndex,
        phaseName: phase.name,
        stepTitle: step.title,
        durationMs: stepDurationMs,
        summary
      })
    }

    // Normal-path cleanup. The .finally() in launchAgent() is a safety net for
    // unexpected throws — running.delete/tryDequeue are idempotent, so the
    // duplicate call is harmless.
    this.running.delete(agentId)
    // Only clear session ID on completion — preserve it for stop/error resume
    if (sm.getState() === 'done') {
      this.agentManager.setSessionId(agentId, null)
    }
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
        // Retry from the step where we errored (preserves step progress)
        const snapshot = sm.getSnapshot()
        if (snapshot.phaseIndex >= 0) {
          sm.resumeFromError()
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
  private runStep(
    entry: RunningAgent,
    prompt: string,
    approvalMode?: ApprovalMode,
    stepTitle?: string,
    config?: Awaited<ReturnType<typeof loadConfig>>
  ): Promise<boolean> {
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
      entry.lastActivityAt = Date.now()
      entry.stuckNotified = false

      this.wireDriverToRenderer(agentId, driver)

      const resetActivity = (): void => {
        entry.lastActivityAt = Date.now()
        entry.stuckNotified = false
      }

      driver.on('session:init', (info) => {
        entry.sdkSessionId = info.sessionId
        this.agentManager.setSessionId(agentId, info.sessionId)
        resetActivity()
      })

      driver.on('stream:text', resetActivity)

      driver.on('assistant:message', (content: AssistantContent) => {
        if (content.text) {
          entry.lastAssistantText = content.text
        }
        resetActivity()
      })

      driver.on('permission:request', (request) => {
        const sm = this.agentManager.getStateMachine(agentId)
        // Capture snapshot BEFORE transitioning — waiting_for_human resets phaseIndex to -1
        const snap = sm?.getSnapshot()
        if (sm && sm.getState() !== 'waiting_for_human') {
          sm.setWaitingForHuman()
        }
        const inputSummary = summarizeToolInput(request.toolName, request.toolInput)
        const detail = `${request.toolName}: ${inputSummary}`
        this.log(agentId, {
          event: 'permission_requested',
          phaseIndex: snap?.phaseIndex ?? -1,
          stepIndex: snap?.stepIndex ?? -1,
          toolName: request.toolName,
          detail
        })
        this.agentManager.setPendingHumanInteraction(agentId, {
          type: 'permission',
          detail,
          occurredAt: new Date().toISOString(),
          permissionRequest: request
        })
      })

      driver.on('security:alert', (request) => {
        const sm = this.agentManager.getStateMachine(agentId)
        const snap = sm?.getSnapshot()
        if (sm && sm.getState() !== 'waiting_for_human') {
          sm.setWaitingForHuman()
        }
        const inputSummary = summarizeToolInput(request.toolName, request.toolInput)
        const detail = `SECURITY ALERT: ${request.toolName}: ${inputSummary}`
        this.log(agentId, {
          event: 'permission_requested',
          phaseIndex: snap?.phaseIndex ?? -1,
          stepIndex: snap?.stepIndex ?? -1,
          toolName: request.toolName,
          detail
        })
        this.agentManager.setPendingHumanInteraction(agentId, {
          type: 'security_alert',
          detail,
          occurredAt: new Date().toISOString(),
          securityAlertRequest: request
        })
      })

      driver.on('user:question', (request) => {
        const sm = this.agentManager.getStateMachine(agentId)
        // Capture snapshot BEFORE transitioning — waiting_for_human resets phaseIndex to -1
        const snap = sm?.getSnapshot()
        if (sm && sm.getState() !== 'waiting_for_human') {
          sm.setWaitingForHuman()
        }
        this.log(agentId, {
          event: 'question_asked',
          phaseIndex: snap?.phaseIndex ?? -1,
          stepIndex: snap?.stepIndex ?? -1,
          question: request.question
        })
        this.agentManager.setPendingHumanInteraction(agentId, {
          type: 'question',
          detail: request.question,
          occurredAt: new Date().toISOString(),
          questionRequest: request
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

      // Use the target repo root as cwd so the SDK finds .claude/settings.*
      // for permission rules. The prompt already tells the agent the worktree path.
      const cwd = config?.targetRepoPath || agent.worktree.path

      driver
        .startSession({
          prompt,
          cwd,
          sessionId: entry.sdkSessionId ?? undefined,
          settingSources: ['user', 'project', 'local'],
          approvalMode,
          worktreePath: agent.worktree.path,
          currentStepTitle: stepTitle
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

  /** Push a structured step banner to the renderer. */
  private emitStepBanner(
    agentId: string,
    snapshot: { phaseIndex: number; totalPhases: number; stepIndex: number },
    phaseName: string,
    stepTitle: string
  ): void {
    const sessionId = `orchestration-${agentId}`
    const win = BrowserWindow.getAllWindows()[0]
    if (!win || win.isDestroyed()) return

    const totalSteps =
      this.agentManager.getRunbook(agentId)?.phases[snapshot.phaseIndex]?.steps.length ?? '?'

    win.webContents.send('cli:event', {
      sessionId,
      event: {
        type: 'step:banner' as const,
        data: {
          phaseIndex: snapshot.phaseIndex,
          totalPhases: snapshot.totalPhases,
          stepIndex: snapshot.stepIndex,
          totalSteps,
          phaseName,
          stepTitle
        }
      }
    } satisfies CliEventPayload)
  }

  // ---------------------------------------------------------------------------
  // Stuck-agent watchdog
  // ---------------------------------------------------------------------------

  private startStuckWatchdog(entry: RunningAgent): void {
    if (this.stuckTimeoutMs <= 0) return

    entry.stuckCheckInterval = setInterval(() => {
      if (entry.stopped) {
        this.stopStuckWatchdog(entry)
        return
      }

      // Don't flag as stuck if waiting for human input
      const sm = this.agentManager.getStateMachine(entry.agentId)
      if (sm?.getState() === 'waiting_for_human') return

      const elapsed = Date.now() - entry.lastActivityAt
      if (elapsed >= this.stuckTimeoutMs && !entry.stuckNotified) {
        entry.stuckNotified = true
        this.emit('agent:stuck', entry.agentId, elapsed)
      }
    }, this.stuckCheckIntervalMs)
  }

  private stopStuckWatchdog(entry: RunningAgent): void {
    if (entry.stuckCheckInterval) {
      clearInterval(entry.stuckCheckInterval)
      entry.stuckCheckInterval = null
    }
  }

  // ---------------------------------------------------------------------------
  // Trello integration (fire-and-forget, never blocks orchestration)
  // ---------------------------------------------------------------------------

  /** Move an agent's card to the In Progress list. */
  private async trelloMoveToInProgress(agentId: string): Promise<void> {
    const { cardId, creds, config } = await this.getTrelloContext(agentId)
    if (!cardId || !creds || !config) return

    const listId = config.trelloListIds.inProgress
    if (listId) {
      await moveCard(cardId, listId, creds)
    }
  }

  /** Move an agent's card to Done and post a summary comment. */
  private async trelloCompleteCard(agentId: string): Promise<void> {
    const { cardId, creds, config } = await this.getTrelloContext(agentId)
    if (!cardId || !creds || !config) return

    const listId = config.trelloListIds.done
    if (listId) {
      await moveCard(cardId, listId, creds)
    }

    const agent = this.agentManager.getAgent(agentId)
    if (!agent) return

    const summaryLines = agent.stepHistory
      .filter((s) => s.summary)
      .map((s) => `- **Step ${s.phaseIndex + 1}.${s.stepIndex + 1}**: ${s.summary}`)

    const parts = [
      `**Agent completed: ${agent.card.name}**`,
      '',
      `Branch: \`${agent.worktree.branch}\``
    ]
    if (summaryLines.length > 0) {
      parts.push('', '**Step summaries:**', ...summaryLines)
    }
    const comment = parts.join('\n')

    await addComment(cardId, comment, creds)
  }

  /** Load Trello credentials and card ID for an agent. Returns nulls if unavailable. */
  private async getTrelloContext(agentId: string): Promise<{
    cardId: string | null
    creds: { apiKey: string; apiToken: string } | null
    config: Awaited<ReturnType<typeof loadConfig>>
  }> {
    const config = await loadConfig()
    if (!config?.trelloApiKey || !config?.trelloApiToken || !config?.trelloBoardId) {
      return { cardId: null, creds: null, config: null }
    }

    const agent = this.agentManager.getAgent(agentId)
    if (!agent) {
      return { cardId: null, creds: null, config: null }
    }

    return {
      cardId: agent.card.id,
      creds: { apiKey: config.trelloApiKey, apiToken: config.trelloApiToken },
      config
    }
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
    driver.on('tool:start', (event) => {
      push({ type: 'tool:start', data: event })
    })
    driver.on('tool:activity', (event) => {
      push({ type: 'tool:activity', data: event })
    })
    driver.on('tool:summary', (event) => {
      push({ type: 'tool:summary', data: event })
    })
    driver.on('tool:result', (event) => {
      push({ type: 'tool:result', data: event })
    })
    driver.on('approval:status', (event) => {
      push({ type: 'approval:status', data: event })
    })
    driver.on('assistant:message', (content) => {
      push({ type: 'assistant:message', data: content })
    })
    driver.on('permission:request', (request) => {
      push({ type: 'permission:request', data: request })
    })
    driver.on('security:alert', (request) => {
      push({ type: 'security:alert', data: request })
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

/**
 * Extract a step summary from the last assistant message.
 * The step prompt asks Claude to provide a summary after a `---` separator.
 * Falls back to the last complete paragraph, then to a tail slice.
 */
export function extractStepSummary(text: string): string {
  if (!text) return 'Step completed.'

  // Strategy 1: text after the last "---" separator (matches prompt convention)
  const separatorIndex = text.lastIndexOf('\n---')
  if (separatorIndex !== -1) {
    const afterSeparator = text.slice(separatorIndex + 4).trim()
    if (afterSeparator.length > 0) {
      return afterSeparator.slice(0, 500)
    }
  }

  // Strategy 2: last non-empty paragraph (double-newline delimited)
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0)
  if (paragraphs.length > 0) {
    return paragraphs[paragraphs.length - 1].trim().slice(0, 500)
  }

  // Strategy 3: tail slice (original behavior, kept as last resort)
  return text.slice(-500)
}
