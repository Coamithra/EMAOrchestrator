import type { AgentSnapshot } from '@shared/agent-manager'
import type { AgentState } from '@shared/agent-state'
import './Sidebar.css'

interface SidebarProps {
  agents: AgentSnapshot[]
  selectedAgentId: string | null
  onSelectAgent: (agentId: string) => void
}

function getStatusClass(state: AgentState): string {
  if (state === 'done') return 'sidebar__status-dot--done'
  if (state === 'error') return 'sidebar__status-dot--error'
  if (state === 'waiting_for_human') return 'sidebar__status-dot--waiting'
  return 'sidebar__status-dot--running'
}

function getStepLabel(agent: AgentSnapshot): string {
  const { stateSnapshot } = agent
  if (stateSnapshot.state === 'idle') return 'Idle'
  if (stateSnapshot.state === 'done') return 'Done'
  if (stateSnapshot.state === 'error') return stateSnapshot.error || 'Error'
  if (stateSnapshot.phaseIndex < 0) return String(stateSnapshot.state)
  return `Phase ${stateSnapshot.phaseIndex + 1} — Step ${stateSnapshot.stepIndex + 1}`
}

function Sidebar({ agents, selectedAgentId, onSelectAgent }: SidebarProps): React.JSX.Element {
  return (
    <nav className="sidebar">
      <div className="sidebar__header">Agents</div>
      {agents.length === 0 ? (
        <div className="sidebar__empty">No agents running</div>
      ) : (
        <ul className="sidebar__list">
          {agents.map((agent) => (
            <li
              key={agent.id}
              className={`sidebar__item${agent.id === selectedAgentId ? ' sidebar__item--selected' : ''}`}
              onClick={() => onSelectAgent(agent.id)}
            >
              <span
                className={`sidebar__status-dot ${getStatusClass(agent.stateSnapshot.state)}`}
              />
              <div className="sidebar__item-info">
                <div className="sidebar__item-name">{agent.card.name}</div>
                <div className="sidebar__item-step">{getStepLabel(agent)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </nav>
  )
}

export default Sidebar
