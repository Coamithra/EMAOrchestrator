import { useState, useEffect, useCallback, useRef } from 'react'
import type { AgentSnapshot } from '@shared/agent-manager'
import type { AgentState } from '@shared/agent-state'
import type { ApprovalMode } from '@shared/config'
import './Sidebar.css'

interface ContextMenuState {
  agentId: string
  x: number
  y: number
  approvalSubmenuOpen: boolean
}

interface SidebarProps {
  agents: AgentSnapshot[]
  selectedAgentId: string | null
  runningAgentIds: Set<string>
  onSelectAgent: (agentId: string) => void
  onResumeAgent: (agentId: string) => void
  onDismissAgent: (agentId: string) => void
}

function getStatusClass(state: AgentState): string {
  if (state === 'done') return 'sidebar__status-dot--done'
  if (state === 'error') return 'sidebar__status-dot--error'
  if (state === 'waiting_for_human') return 'sidebar__status-dot--waiting'
  if (state === 'idle' || state === 'picking_card') return 'sidebar__status-dot--idle'
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

const APPROVAL_LABELS: { mode: ApprovalMode; label: string }[] = [
  { mode: 'never', label: 'Manual' },
  { mode: 'smart', label: 'Smart' },
  { mode: 'always', label: 'Auto-approve' }
]

function Sidebar({
  agents,
  selectedAgentId,
  runningAgentIds,
  onSelectAgent,
  onResumeAgent,
  onDismissAgent
}: SidebarProps): React.JSX.Element {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [agentApprovalModes, setAgentApprovalModes] = useState<Record<string, ApprovalMode>>({})
  const [confirmDismiss, setConfirmDismiss] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return

    function handleClick(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
        setConfirmDismiss(false)
      }
    }
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        setContextMenu(null)
        setConfirmDismiss(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [contextMenu])

  // Fetch the effective approval mode when opening the context menu
  useEffect(() => {
    if (!contextMenu) return
    window.api
      .getAgentApprovalMode(contextMenu.agentId)
      .then((mode) => {
        setAgentApprovalModes((prev) => ({ ...prev, [contextMenu.agentId]: mode as ApprovalMode }))
      })
      .catch(() => {
        // Ignore — will show no checkmark
      })
  }, [contextMenu?.agentId])

  const handleContextMenu = useCallback((e: React.MouseEvent, agentId: string) => {
    e.preventDefault()
    setConfirmDismiss(false)
    setContextMenu({ agentId, x: e.clientX, y: e.clientY, approvalSubmenuOpen: false })
  }, [])

  const handleResume = useCallback(() => {
    if (!contextMenu) return
    onResumeAgent(contextMenu.agentId)
    setContextMenu(null)
  }, [contextMenu, onResumeAgent])

  const handleSetApproval = useCallback(
    (mode: ApprovalMode) => {
      if (!contextMenu) return
      window.api.setAgentApprovalMode(contextMenu.agentId, mode)
      setAgentApprovalModes((prev) => ({ ...prev, [contextMenu.agentId]: mode }))
      setContextMenu(null)
    },
    [contextMenu]
  )

  const handleDismiss = useCallback(() => {
    if (!contextMenu) return
    if (!confirmDismiss) {
      setConfirmDismiss(true)
      return
    }
    onDismissAgent(contextMenu.agentId)
    setContextMenu(null)
    setConfirmDismiss(false)
  }, [contextMenu, confirmDismiss, onDismissAgent])

  const toggleApprovalSubmenu = useCallback(() => {
    setContextMenu((prev) =>
      prev ? { ...prev, approvalSubmenuOpen: !prev.approvalSubmenuOpen } : null
    )
  }, [])

  // Determine which actions are available for the context-menu agent
  const contextAgent = contextMenu
    ? agents.find((a) => a.id === contextMenu.agentId)
    : null
  const isRunning = contextMenu ? runningAgentIds.has(contextMenu.agentId) : false
  const canResume = contextAgent && !isRunning && contextAgent.stateSnapshot.state !== 'done'
  const currentApproval = contextMenu ? agentApprovalModes[contextMenu.agentId] : undefined

  return (
    <nav className="sidebar">
      <div className="sidebar__header">Agents</div>
      {agents.length === 0 ? (
        <div className="sidebar__empty">No agents running</div>
      ) : (
        <ul className="sidebar__list" role="listbox">
          {agents.map((agent) => (
            <li
              key={agent.id}
              role="option"
              aria-selected={agent.id === selectedAgentId}
              tabIndex={0}
              className={`sidebar__item${agent.id === selectedAgentId ? ' sidebar__item--selected' : ''}`}
              onClick={() => onSelectAgent(agent.id)}
              onContextMenu={(e) => handleContextMenu(e, agent.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelectAgent(agent.id)
                }
              }}
            >
              <span
                className={`sidebar__status-dot ${getStatusClass(agent.stateSnapshot.state)}`}
              />
              <div className="sidebar__item-info">
                <div className="sidebar__item-name">{agent.card.name}</div>
                <div className="sidebar__item-step">{getStepLabel(agent)}</div>
              </div>
              {agent.stateSnapshot.state === 'waiting_for_human' && (
                <span className="sidebar__notification-badge" title="Waiting for input">!</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {contextMenu && (
        <div
          ref={menuRef}
          className="sidebar__context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          {canResume && (
            <button className="sidebar__context-menu-item" onClick={handleResume}>
              Resume
            </button>
          )}
          <button
            className="sidebar__context-menu-item sidebar__context-menu-item--submenu"
            onClick={toggleApprovalSubmenu}
          >
            Approval
            <span className="sidebar__context-menu-chevron">
              {contextMenu.approvalSubmenuOpen ? '\u25BC' : '\u25B6'}
            </span>
          </button>
          {contextMenu.approvalSubmenuOpen && (
            <div className="sidebar__context-submenu">
              {APPROVAL_LABELS.map(({ mode, label }) => (
                <button
                  key={mode}
                  className={`sidebar__context-menu-item${currentApproval === mode ? ' sidebar__context-menu-item--active' : ''}`}
                  onClick={() => handleSetApproval(mode)}
                >
                  {currentApproval === mode && (
                    <span className="sidebar__context-menu-check">{'\u2713'}</span>
                  )}
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="sidebar__context-menu-divider" />
          <button
            className={`sidebar__context-menu-item sidebar__context-menu-item--danger${confirmDismiss ? ' sidebar__context-menu-item--confirm' : ''}`}
            onClick={handleDismiss}
          >
            {confirmDismiss ? 'Click again to confirm' : 'Dismiss'}
          </button>
        </div>
      )}
    </nav>
  )
}

export default Sidebar
