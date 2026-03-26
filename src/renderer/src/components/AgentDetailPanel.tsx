import type { AgentSnapshot } from '@shared/agent-manager'
import './AgentDetailPanel.css'

interface AgentDetailPanelProps {
  agent: AgentSnapshot | null
}

function AgentDetailPanel({ agent }: AgentDetailPanelProps): React.JSX.Element {
  if (!agent) {
    return (
      <div className="agent-detail-panel">
        <div className="agent-detail-panel__empty">Select an agent to view details</div>
      </div>
    )
  }

  const { stateSnapshot } = agent
  const stateLabel =
    stateSnapshot.phaseIndex >= 0
      ? `Phase ${stateSnapshot.phaseIndex + 1} of ${stateSnapshot.totalPhases} — Step ${stateSnapshot.stepIndex + 1} of ${stateSnapshot.totalSteps}`
      : String(stateSnapshot.state)

  return (
    <div className="agent-detail-panel">
      <div className="agent-detail-panel__header">
        <div className="agent-detail-panel__card-name">{agent.card.name}</div>
        <div className="agent-detail-panel__state">{stateLabel}</div>
      </div>
      <div className="agent-detail-panel__body">
        Terminal and progress views will be added by cards #017–#018
      </div>
    </div>
  )
}

export default AgentDetailPanel
