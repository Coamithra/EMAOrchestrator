import { useState, useEffect, useCallback, useRef } from 'react'
import type { AgentSnapshot } from '@shared/agent-manager'
import type { PermissionRequest, PermissionResponse, SecurityAlertRequest, SecurityAlertResponse, UserQuestionRequest, UserQuestionResponse } from '@shared/cli-driver'
import type { CliEventPayload } from '@shared/ipc'
import ChatTerminal from './ChatTerminal'
import StepProgress from './StepProgress'
import PermissionDialog from './PermissionDialog'
import SecurityAlertDialog from './SecurityAlertDialog'
import QuestionDialog from './QuestionDialog'
import ConsoleInput from './ConsoleInput'
import type { PhaseInfo } from './StepProgress'
import './AgentDetailPanel.css'

interface AgentDetailPanelProps {
  agent: AgentSnapshot | null
  isRunning?: boolean
  showOrchestratorBlocks?: boolean
  onResume?: (agentId: string) => void
  onStop?: (agentId: string) => void
}

function toPhaseInfos(agent: AgentSnapshot): PhaseInfo[] {
  return agent.runbook.phases.map((phase) => ({
    name: phase.name,
    steps: phase.steps.map((step) => ({ title: step.title }))
  }))
}

function getStateLabel(agent: AgentSnapshot): string {
  const { stateSnapshot } = agent
  if (stateSnapshot.state === 'done') return 'Done'
  if (stateSnapshot.state === 'error') return stateSnapshot.error || 'Error'
  if (stateSnapshot.state === 'idle') return 'Idle'
  if (stateSnapshot.state === 'picking_card') return 'Picking card\u2026'
  if (stateSnapshot.state === 'waiting_for_human') return 'Waiting for input'
  if (stateSnapshot.phaseIndex >= 0) {
    return `Phase ${stateSnapshot.phaseIndex + 1} of ${stateSnapshot.totalPhases} \u2014 Step ${stateSnapshot.stepIndex + 1} of ${stateSnapshot.totalSteps}`
  }
  return String(stateSnapshot.state)
}

/** States where the agent can be resumed (not actively running, not finished). */
function canResume(agent: AgentSnapshot, isRunning: boolean): boolean {
  if (isRunning) return false
  const s = agent.stateSnapshot.state
  return s !== 'done'
}

function canStop(isRunning: boolean): boolean {
  return isRunning
}

function AgentDetailPanel({ agent, isRunning = false, showOrchestratorBlocks, onResume, onStop }: AgentDetailPanelProps): React.JSX.Element {
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null)
  const [pendingSecurityAlert, setPendingSecurityAlert] = useState<SecurityAlertRequest | null>(null)
  const [pendingQuestion, setPendingQuestion] = useState<UserQuestionRequest | null>(null)
  const respondedRef = useRef(false)

  const agentId = agent?.id ?? null

  // Subscribe to cli:event and seed dialog state from snapshot on agent switch
  useEffect(() => {
    setPendingPermission(null)
    setPendingSecurityAlert(null)
    setPendingQuestion(null)
    respondedRef.current = false

    if (!agentId) return

    // Seed dialog from snapshot if the agent is already waiting for input.
    // Uses the full request object when available (stored since the interaction
    // was created). Falls back to a minimal reconstruction from the detail string
    // for backwards compatibility with older persisted data.
    if (agent?.pendingHumanInteraction) {
      const { type, detail, permissionRequest, questionRequest, securityAlertRequest } =
        agent.pendingHumanInteraction
      if (type === 'permission') {
        setPendingPermission(
          permissionRequest ?? {
            requestId: `restored-${agentId}`,
            toolName: detail.split(':')[0] || 'Unknown tool',
            toolInput: {},
            toolUseId: '',
            description: detail
          }
        )
      } else if (type === 'security_alert') {
        setPendingSecurityAlert(
          securityAlertRequest ?? {
            requestId: `restored-${agentId}`,
            toolName: detail.split(':')[1]?.trim() || 'Unknown tool',
            toolInput: {},
            toolUseId: '',
            explanation: detail
          }
        )
      } else if (type === 'question') {
        setPendingQuestion(
          questionRequest ?? {
            requestId: `restored-${agentId}`,
            question: detail,
            toolUseId: ''
          }
        )
      }
    }

    const sessionId = `orchestration-${agentId}`
    const unsubscribe = window.api.onCliEvent((payload: CliEventPayload) => {
      if (payload.sessionId !== sessionId) return

      if (payload.event.type === 'permission:request') {
        respondedRef.current = false
        setPendingPermission(payload.event.data)
        setPendingSecurityAlert(null)
        setPendingQuestion(null)
      } else if (payload.event.type === 'security:alert') {
        respondedRef.current = false
        setPendingSecurityAlert(payload.event.data)
        setPendingPermission(null)
        setPendingQuestion(null)
      } else if (payload.event.type === 'user:question') {
        respondedRef.current = false
        setPendingQuestion(payload.event.data)
        setPendingPermission(null)
        setPendingSecurityAlert(null)
      }
    })

    return unsubscribe
  }, [agentId])

  // Clear dialogs when agent exits waiting_for_human
  useEffect(() => {
    if (agent && agent.stateSnapshot.state !== 'waiting_for_human') {
      setPendingPermission(null)
      setPendingSecurityAlert(null)
      setPendingQuestion(null)
    }
  }, [agent?.stateSnapshot.state])

  const handlePermissionResponse = useCallback(
    (response: PermissionResponse) => {
      if (!agentId || respondedRef.current) return
      respondedRef.current = true
      window.api.respondToOrchestrationPermission(agentId, response)
      setPendingPermission(null)
    },
    [agentId]
  )

  const handleSecurityAlertResponse = useCallback(
    (response: SecurityAlertResponse) => {
      if (!agentId || respondedRef.current) return
      respondedRef.current = true
      window.api.respondToOrchestrationSecurityAlert(agentId, response)
      setPendingSecurityAlert(null)
    },
    [agentId]
  )

  const handleQuestionResponse = useCallback(
    (response: UserQuestionResponse) => {
      if (!agentId || respondedRef.current) return
      respondedRef.current = true
      window.api.respondToOrchestrationQuestion(agentId, response)
      setPendingQuestion(null)
    },
    [agentId]
  )

  if (!agent) {
    return (
      <div className="agent-detail-panel">
        <div className="agent-detail-panel__empty">Select an agent to view details</div>
      </div>
    )
  }

  const phases = toPhaseInfos(agent)

  return (
    <div className="agent-detail-panel">
      <div className="agent-detail-panel__header">
        <div className="agent-detail-panel__header-left">
          <div className="agent-detail-panel__card-name">{agent.card.name}</div>
          <div className="agent-detail-panel__state">{getStateLabel(agent)}</div>
        </div>
        <div className="agent-detail-panel__header-right">
          {agent.pendingHumanInteraction && (
            <div className={
              'agent-detail-panel__waiting-badge' +
              (agent.pendingHumanInteraction.type === 'security_alert'
                ? ' agent-detail-panel__waiting-badge--alert'
                : '')
            }>
              {agent.pendingHumanInteraction.type === 'permission'
                ? 'Permission required'
                : agent.pendingHumanInteraction.type === 'security_alert'
                  ? 'Security alert'
                  : 'Question pending'}
            </div>
          )}
          {canResume(agent, isRunning) && (
            <button
              className="agent-detail-panel__resume-btn"
              onClick={() => onResume?.(agent.id)}
            >
              Resume
            </button>
          )}
          {canStop(isRunning) && (
            <button
              className="agent-detail-panel__stop-btn"
              onClick={() => onStop?.(agent.id)}
            >
              Stop
            </button>
          )}
        </div>
      </div>
      <div className="agent-detail-panel__body">
        <div className="agent-detail-panel__progress">
          <StepProgress
            key={agent.id}
            stateSnapshot={agent.stateSnapshot}
            stepHistory={agent.stepHistory}
            phases={phases}
          />
        </div>
        <div className="agent-detail-panel__terminal">
          <ChatTerminal agentId={agent.id} showOrchestratorBlocks={showOrchestratorBlocks} />
          <ConsoleInput
            key={agent.id}
            agentId={agent.id}
            disabled={
              agent.stateSnapshot.state === 'done' ||
              agent.stateSnapshot.state === 'waiting_for_human'
            }
          />
          {isRunning && pendingPermission && (
            <PermissionDialog
              key={pendingPermission.requestId}
              request={pendingPermission}
              onRespond={handlePermissionResponse}
            />
          )}
          {isRunning && pendingSecurityAlert && (
            <SecurityAlertDialog
              key={pendingSecurityAlert.requestId}
              request={pendingSecurityAlert}
              onRespond={handleSecurityAlertResponse}
            />
          )}
          {isRunning && pendingQuestion && (
            <QuestionDialog
              key={pendingQuestion.requestId}
              request={pendingQuestion}
              onRespond={handleQuestionResponse}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default AgentDetailPanel
