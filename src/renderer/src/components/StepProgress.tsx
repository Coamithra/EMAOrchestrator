import { useCallback, useState } from 'react'
import type { AgentStateSnapshot } from '@shared/agent-state'
import type { StepCompletionRecord } from '@shared/agent-persistence'
import './StepProgress.css'

interface StepProgressProps {
  stateSnapshot: AgentStateSnapshot
  stepHistory: StepCompletionRecord[]
  /** Parsed runbook phases — needed for step titles since stateSnapshot only has indices. */
  phases: PhaseInfo[]
}

/** Minimal phase info derived from the agent's runbook. */
export interface PhaseInfo {
  name: string
  steps: { title: string }[]
}

type StepStatus = 'completed' | 'in_progress' | 'pending'

function getPhaseStatus(
  phaseIndex: number,
  snapshot: AgentStateSnapshot
): StepStatus {
  if (snapshot.state === 'done') return 'completed'
  if (snapshot.phaseIndex < 0) return 'pending'
  if (phaseIndex < snapshot.phaseIndex) return 'completed'
  if (phaseIndex === snapshot.phaseIndex) return 'in_progress'
  return 'pending'
}

function getStepStatus(
  phaseIndex: number,
  stepIndex: number,
  snapshot: AgentStateSnapshot,
  stepHistory: StepCompletionRecord[]
): StepStatus {
  // Check history first — completed steps have records
  const found = stepHistory.some(
    (r) => r.phaseIndex === phaseIndex && r.stepIndex === stepIndex
  )
  if (found) return 'completed'

  // Current step
  if (phaseIndex === snapshot.phaseIndex && stepIndex === snapshot.stepIndex) {
    const isActive =
      snapshot.state !== 'idle' &&
      snapshot.state !== 'done' &&
      snapshot.state !== 'error'
    return isActive ? 'in_progress' : 'pending'
  }

  return 'pending'
}

function getStepSummary(
  phaseIndex: number,
  stepIndex: number,
  stepHistory: StepCompletionRecord[]
): string | undefined {
  return stepHistory.find(
    (r) => r.phaseIndex === phaseIndex && r.stepIndex === stepIndex
  )?.summary
}

function statusIcon(status: StepStatus): string {
  if (status === 'completed') return '\u2713' // checkmark
  if (status === 'in_progress') return '\u25B6' // play triangle
  return '\u25CB' // circle
}

function StepProgress({
  stateSnapshot,
  stepHistory,
  phases
}: StepProgressProps): React.JSX.Element {
  // Track which phases the user has manually toggled. The current active
  // phase is auto-expanded unless the user explicitly collapses it.
  const [manualToggles, setManualToggles] = useState<Record<number, boolean>>({})

  const isPhaseExpanded = useCallback(
    (phaseIndex: number): boolean => {
      if (phaseIndex in manualToggles) return manualToggles[phaseIndex]
      return phaseIndex === stateSnapshot.phaseIndex
    },
    [manualToggles, stateSnapshot.phaseIndex]
  )

  const togglePhase = useCallback(
    (index: number) => {
      setManualToggles((prev) => {
        const currentlyExpanded = index in prev ? prev[index] : index === stateSnapshot.phaseIndex
        return { ...prev, [index]: !currentlyExpanded }
      })
    },
    [stateSnapshot.phaseIndex]
  )

  return (
    <div className="step-progress">
      {phases.map((phase, pi) => {
        const phaseStatus = getPhaseStatus(pi, stateSnapshot)
        const expanded = isPhaseExpanded(pi)

        return (
          <div key={pi} className="step-progress__phase">
            <button
              className={`step-progress__phase-header step-progress__phase-header--${phaseStatus}`}
              onClick={() => togglePhase(pi)}
              aria-expanded={expanded}
            >
              <span className={`step-progress__icon step-progress__icon--${phaseStatus}`}>
                {statusIcon(phaseStatus)}
              </span>
              <span className="step-progress__phase-name">{phase.name}</span>
              <span className="step-progress__chevron">
                {expanded ? '\u25BC' : '\u25B6'}
              </span>
            </button>
            {expanded && (
              <ul className="step-progress__steps">
                {phase.steps.map((step, si) => {
                  const stepStatus = getStepStatus(pi, si, stateSnapshot, stepHistory)
                  const summary = getStepSummary(pi, si, stepHistory)

                  return (
                    <li
                      key={si}
                      className={`step-progress__step step-progress__step--${stepStatus}`}
                    >
                      <span className={`step-progress__icon step-progress__icon--${stepStatus}`}>
                        {statusIcon(stepStatus)}
                      </span>
                      <div className="step-progress__step-content">
                        <div className="step-progress__step-title">{step.title}</div>
                        {summary && (
                          <div className="step-progress__step-summary">{summary}</div>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default StepProgress
