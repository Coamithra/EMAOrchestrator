import type { AgentSnapshot } from '@shared/agent-manager'
import type { StepCompletionRecord } from '@shared/agent-persistence'
import './StepReportView.css'

interface StepReportViewProps {
  agent: AgentSnapshot
  onBack: () => void
}

type StepStatus = 'completed' | 'in_progress' | 'pending'

function getStepStatus(
  phaseIndex: number,
  stepIndex: number,
  snapshot: AgentSnapshot
): StepStatus {
  const found = snapshot.stepHistory.some(
    (r) => r.phaseIndex === phaseIndex && r.stepIndex === stepIndex
  )
  if (found) return 'completed'

  if (
    phaseIndex === snapshot.stateSnapshot.phaseIndex &&
    stepIndex === snapshot.stateSnapshot.stepIndex
  ) {
    const s = snapshot.stateSnapshot.state
    if (s !== 'idle' && s !== 'done' && s !== 'error') return 'in_progress'
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
  if (status === 'completed') return '\u2713'
  if (status === 'in_progress') return '\u25B6'
  return '\u25CB'
}

function StepReportView({ agent, onBack }: StepReportViewProps): React.JSX.Element {
  const completedCount = agent.stepHistory.length
  const totalSteps = agent.runbook.phases.reduce((sum, p) => sum + p.steps.length, 0)

  return (
    <div className="step-report-view">
      <div className="step-report-view__header">
        <button className="step-report-view__back" onClick={onBack}>
          &larr; Back
        </button>
        <h1 className="step-report-view__title">
          Step Report
          <span className="step-report-view__card-name"> &mdash; {agent.card.name}</span>
        </h1>
      </div>

      {agent.runbook.phases.map((phase, pi) => (
        <section key={pi} className="step-report-view__phase">
          <h2 className="step-report-view__phase-title">
            Phase {pi + 1}: {phase.name}
          </h2>
          <ul className="step-report-view__steps">
            {phase.steps.map((step, si) => {
              const status = getStepStatus(pi, si, agent)
              const summary = getStepSummary(pi, si, agent.stepHistory)

              return (
                <li key={si} className="step-report-view__step">
                  <span className={`step-report-view__step-icon step-report-view__step-icon--${status}`}>
                    {statusIcon(status)}
                  </span>
                  <div className="step-report-view__step-body">
                    <div className="step-report-view__step-title">{step.title}</div>
                    {summary ? (
                      <div className="step-report-view__step-summary">{summary}</div>
                    ) : (
                      status !== 'pending' && (
                        <div className="step-report-view__no-summary">No summary recorded</div>
                      )
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      <div className="step-report-view__stats">
        {completedCount} of {totalSteps} steps completed
      </div>
    </div>
  )
}

export default StepReportView
