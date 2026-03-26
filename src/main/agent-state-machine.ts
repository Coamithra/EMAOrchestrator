import type { Runbook } from '../shared/runbook'
import type {
  AgentState,
  AgentStateMachineEvents,
  AgentStateSnapshot,
  AgentStepProgress,
  StateMachineRestoreData
} from '../shared/agent-state'
import { TypedEventEmitter } from './typed-emitter'

const FIXED_STATES = new Set(['idle', 'picking_card', 'error', 'waiting_for_human', 'done'])

/**
 * Manages the lifecycle of a single agent working through a parsed runbook.
 *
 * States are dynamically derived from the runbook phases. Fixed states
 * (idle, picking_card, error, waiting_for_human, done) are always present.
 * Transition rules are enforced — invalid transitions throw.
 */
export class AgentStateMachine extends TypedEventEmitter<AgentStateMachineEvents> {
  private state: AgentState = 'idle'
  private readonly phaseNames: string[]
  private readonly validTransitions: Map<string, Set<string>>
  private phaseIndex = -1
  private stepIndex = -1
  private completedSteps = 0
  private readonly totalSteps: number
  private errorMessage?: string

  /** State we were in before entering waiting_for_human, so we can resume. */
  private stateBeforeWaiting?: AgentState
  private phaseIndexBeforeWaiting?: number
  private stepIndexBeforeWaiting?: number

  /** Step completion tracking per phase: completedStepCounts[phaseIndex] = count. */
  private readonly completedStepCounts: number[]

  /**
   * Restore a state machine from persisted data. Constructs the machine
   * from the runbook, then sets internal fields to match the restore data
   * without emitting any events.
   */
  static restore(runbook: Runbook, data: StateMachineRestoreData): AgentStateMachine {
    const machine = new AgentStateMachine(runbook)

    // Validate restore data against runbook
    const allValidStates = new Set([...FIXED_STATES, ...machine.phaseNames])
    if (!allValidStates.has(data.state)) {
      throw new Error(`Restore state "${data.state}" is not a valid state`)
    }
    if (data.phaseIndex >= runbook.phases.length) {
      throw new Error(
        `Restore phaseIndex ${data.phaseIndex} out of bounds (${runbook.phases.length} phases)`
      )
    }
    if (data.completedStepCounts.length !== runbook.phases.length) {
      throw new Error(
        `Restore completedStepCounts length ${data.completedStepCounts.length} does not match phases (${runbook.phases.length})`
      )
    }
    if (
      data.phaseIndex >= 0 &&
      data.stepIndex >= runbook.phases[data.phaseIndex].steps.length
    ) {
      throw new Error(
        `Restore stepIndex ${data.stepIndex} out of bounds for phase "${runbook.phases[data.phaseIndex].name}" (${runbook.phases[data.phaseIndex].steps.length} steps)`
      )
    }

    // Set internal fields directly — no events emitted
    machine.state = data.state
    machine.phaseIndex = data.phaseIndex
    machine.stepIndex = data.stepIndex
    machine.completedSteps = data.completedSteps
    for (let i = 0; i < data.completedStepCounts.length; i++) {
      machine.completedStepCounts[i] = data.completedStepCounts[i]
    }
    machine.errorMessage = data.error

    // Restore waiting-for-human save slots
    machine.stateBeforeWaiting = data.stateBeforeWaiting
    machine.phaseIndexBeforeWaiting = data.phaseIndexBeforeWaiting
    machine.stepIndexBeforeWaiting = data.stepIndexBeforeWaiting

    return machine
  }

  constructor(private readonly runbook: Runbook) {
    super()

    if (runbook.phases.length === 0) {
      throw new Error('Runbook must have at least one phase')
    }

    this.phaseNames = runbook.phases.map((p) => p.name)
    this.totalSteps = runbook.phases.reduce((sum, p) => sum + p.steps.length, 0)
    this.completedStepCounts = new Array(runbook.phases.length).fill(0)

    // Validate phase names
    const seen = new Set<string>()
    for (const name of this.phaseNames) {
      if (FIXED_STATES.has(name)) {
        throw new Error(`Runbook phase name "${name}" collides with a fixed state`)
      }
      if (seen.has(name)) {
        throw new Error(`Runbook contains duplicate phase name "${name}"`)
      }
      seen.add(name)
    }

    this.validTransitions = this.buildTransitionMap()
  }

  /** Build the full map of valid state transitions. */
  private buildTransitionMap(): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>()
    const firstPhase = this.phaseNames[0]

    // idle → picking_card
    map.set('idle', new Set(['picking_card']))

    // picking_card → first phase
    map.set('picking_card', new Set([firstPhase]))

    // Each phase can go to: next phase, waiting_for_human, error
    for (let i = 0; i < this.phaseNames.length; i++) {
      const targets = new Set<string>()
      targets.add('waiting_for_human')
      targets.add('error')

      if (i < this.phaseNames.length - 1) {
        targets.add(this.phaseNames[i + 1])
      } else {
        // Last phase → done
        targets.add('done')
      }
      map.set(this.phaseNames[i], targets)
    }

    // waiting_for_human → back to any phase (enforced more specifically in resumeFromWaiting)
    const allPhases = new Set(this.phaseNames)
    map.set('waiting_for_human', allPhases)

    // error → idle (restart) or any phase (retry)
    const errorTargets = new Set<string>(['idle', ...this.phaseNames])
    map.set('error', errorTargets)

    // done → idle (start over)
    map.set('done', new Set(['idle']))

    return map
  }

  // ---------------------------------------------------------------------------
  // Query
  // ---------------------------------------------------------------------------

  getState(): AgentState {
    return this.state
  }

  getSnapshot(): AgentStateSnapshot {
    return {
      state: this.state,
      phaseIndex: this.phaseIndex,
      stepIndex: this.stepIndex,
      totalPhases: this.phaseNames.length,
      totalSteps: this.totalSteps,
      completedSteps: this.completedSteps,
      ...(this.errorMessage ? { error: this.errorMessage } : {})
    }
  }

  getValidTransitions(): string[] {
    return Array.from(this.validTransitions.get(this.state) ?? [])
  }

  getPhaseNames(): string[] {
    return [...this.phaseNames]
  }

  /** Return all data needed to persist and later restore this state machine. */
  getRestoreData(): StateMachineRestoreData {
    return {
      state: this.state,
      phaseIndex: this.phaseIndex,
      stepIndex: this.stepIndex,
      completedSteps: this.completedSteps,
      completedStepCounts: [...this.completedStepCounts],
      ...(this.errorMessage ? { error: this.errorMessage } : {}),
      ...(this.stateBeforeWaiting !== undefined
        ? { stateBeforeWaiting: this.stateBeforeWaiting }
        : {}),
      ...(this.phaseIndexBeforeWaiting !== undefined
        ? { phaseIndexBeforeWaiting: this.phaseIndexBeforeWaiting }
        : {}),
      ...(this.stepIndexBeforeWaiting !== undefined
        ? { stepIndexBeforeWaiting: this.stepIndexBeforeWaiting }
        : {})
    }
  }

  // ---------------------------------------------------------------------------
  // Transitions
  // ---------------------------------------------------------------------------

  /**
   * Transition to a new state. Throws if the transition is not valid.
   * For phase states, resets step tracking to the first step of that phase.
   */
  transition(to: AgentState): void {
    const allowed = this.validTransitions.get(this.state)
    if (!allowed || !allowed.has(to)) {
      throw new Error(`Invalid transition: "${this.state}" → "${to}"`)
    }

    const previous = this.state
    this.state = to

    // Update phase/step tracking
    const phaseIdx = this.phaseNames.indexOf(to)
    if (phaseIdx !== -1) {
      // Reset per-phase counter and adjust global count (handles error retry correctly)
      this.completedSteps -= this.completedStepCounts[phaseIdx]
      this.completedStepCounts[phaseIdx] = 0
      this.phaseIndex = phaseIdx
      this.stepIndex = 0
      this.errorMessage = undefined
    } else if (to === 'idle') {
      this.phaseIndex = -1
      this.stepIndex = -1
      this.completedSteps = 0
      this.completedStepCounts.fill(0)
      this.errorMessage = undefined
      this.stateBeforeWaiting = undefined
    } else if (to === 'done') {
      this.phaseIndex = -1
      this.stepIndex = -1
      this.errorMessage = undefined
    } else {
      // picking_card or other fixed states
      this.phaseIndex = -1
      this.stepIndex = -1
    }

    this.emit('state:changed', to, previous)
  }

  /**
   * Mark the current step as completed and advance to the next step.
   * If the current phase is complete, transitions to the next phase (or done).
   * Throws if not currently in a phase state.
   */
  advanceStep(): void {
    if (this.phaseIndex === -1) {
      throw new Error(`Cannot advance step: not in a phase state (current: "${this.state}")`)
    }

    const phase = this.runbook.phases[this.phaseIndex]

    // Mark current step completed
    const completedProgress: AgentStepProgress = {
      phaseIndex: this.phaseIndex,
      stepIndex: this.stepIndex,
      phaseName: phase.name,
      stepTitle: phase.steps[this.stepIndex].title,
      status: 'completed'
    }
    this.completedSteps++
    this.completedStepCounts[this.phaseIndex]++
    this.emit('step:completed', completedProgress)

    // Check if phase is complete
    if (this.completedStepCounts[this.phaseIndex] >= phase.steps.length) {
      this.emit('phase:completed', phase.name, this.phaseIndex)

      // Transition to next phase or done
      if (this.phaseIndex < this.phaseNames.length - 1) {
        this.transition(this.phaseNames[this.phaseIndex + 1])
      } else {
        this.transition('done')
      }
      return
    }

    // Advance within the current phase
    this.stepIndex++
    const advancedProgress: AgentStepProgress = {
      phaseIndex: this.phaseIndex,
      stepIndex: this.stepIndex,
      phaseName: phase.name,
      stepTitle: phase.steps[this.stepIndex].title,
      status: 'in_progress'
    }
    this.emit('step:advanced', advancedProgress)
  }

  /**
   * Transition to error state from any phase. Records the error message.
   * Throws if not currently in a phase state.
   */
  setError(message: string): void {
    if (this.phaseIndex === -1 && this.state !== 'waiting_for_human') {
      throw new Error(
        `Cannot set error: not in a phase or waiting state (current: "${this.state}")`
      )
    }

    // If we're waiting_for_human, restore the phase context first
    if (this.state === 'waiting_for_human') {
      this.phaseIndex = this.phaseIndexBeforeWaiting ?? -1
      this.stepIndex = this.stepIndexBeforeWaiting ?? -1
      this.stateBeforeWaiting = undefined
      this.phaseIndexBeforeWaiting = undefined
      this.stepIndexBeforeWaiting = undefined
    }

    this.errorMessage = message
    const previous = this.state
    this.state = 'error'
    this.emit('state:changed', 'error', previous)
    this.emit('error', message)
  }

  /**
   * Pause the current phase to wait for human input.
   * Remembers the current phase so resumeFromWaiting can return to it.
   * Throws if not currently in a phase state.
   */
  setWaitingForHuman(): void {
    if (this.phaseIndex === -1) {
      throw new Error(`Cannot wait for human: not in a phase state (current: "${this.state}")`)
    }

    this.stateBeforeWaiting = this.state
    this.phaseIndexBeforeWaiting = this.phaseIndex
    this.stepIndexBeforeWaiting = this.stepIndex
    const previous = this.state
    this.state = 'waiting_for_human'
    this.phaseIndex = -1
    this.stepIndex = -1
    this.emit('state:changed', 'waiting_for_human', previous)
  }

  /**
   * Resume from error state back to the phase where the error occurred,
   * without resetting step tracking. Resumes at the step that was in
   * progress when the error occurred.
   * Throws if not currently in error state or if there's no phase to resume to.
   */
  resumeFromError(): void {
    if (this.state !== 'error') {
      throw new Error(`Cannot resume from error: not in error state (current: "${this.state}")`)
    }
    if (this.phaseIndex === -1) {
      throw new Error('Cannot resume from error: no phase context to resume to')
    }

    const previous = this.state
    this.state = this.phaseNames[this.phaseIndex]
    this.errorMessage = undefined
    // Defensively clear stale waiting save slots
    this.stateBeforeWaiting = undefined
    this.phaseIndexBeforeWaiting = undefined
    this.stepIndexBeforeWaiting = undefined
    this.emit('state:changed', this.state, previous)
  }

  /**
   * Resume from waiting_for_human back to the phase we were in.
   * Throws if not currently in waiting_for_human.
   */
  resumeFromWaiting(): void {
    if (this.state !== 'waiting_for_human') {
      throw new Error(`Cannot resume: not in waiting_for_human state (current: "${this.state}")`)
    }
    if (!this.stateBeforeWaiting) {
      throw new Error('Cannot resume: no saved state to return to')
    }

    const resumeTo = this.stateBeforeWaiting
    this.phaseIndex = this.phaseIndexBeforeWaiting ?? -1
    this.stepIndex = this.stepIndexBeforeWaiting ?? -1
    this.stateBeforeWaiting = undefined
    this.phaseIndexBeforeWaiting = undefined
    this.stepIndexBeforeWaiting = undefined

    const previous = this.state
    this.state = resumeTo
    this.emit('state:changed', resumeTo, previous)
  }
}
