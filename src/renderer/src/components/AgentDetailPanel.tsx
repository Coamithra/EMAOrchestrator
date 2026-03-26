import { useState, useEffect, useCallback, useRef } from 'react'
import type { AgentSnapshot } from '@shared/agent-manager'
import type { PermissionRequest, PermissionResponse, UserQuestionRequest, UserQuestionResponse } from '@shared/cli-driver'
import type { CliEventPayload } from '@shared/ipc'
import TerminalView from './TerminalView'
import StepProgress from './StepProgress'
import PermissionDialog from './PermissionDialog'
import QuestionDialog from './QuestionDialog'
import type { PhaseInfo } from './StepProgress'
import './AgentDetailPanel.css'

interface AgentDetailPanelProps {
  agent: AgentSnapshot | null
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

function AgentDetailPanel({ agent }: AgentDetailPanelProps): React.JSX.Element {
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null)
  const [pendingQuestion, setPendingQuestion] = useState<UserQuestionRequest | null>(null)
  const respondedRef = useRef(false)

  const agentId = agent?.id ?? null

  // Subscribe to cli:event and clear state on agent switch (single effect)
  useEffect(() => {
    setPendingPermission(null)
    setPendingQuestion(null)
    respondedRef.current = false

    if (!agentId) return

    const sessionId = `orchestration-${agentId}`
    const unsubscribe = window.api.onCliEvent((payload: CliEventPayload) => {
      if (payload.sessionId !== sessionId) return

      if (payload.event.type === 'permission:request') {
        respondedRef.current = false
        setPendingPermission(payload.event.data)
        setPendingQuestion(null)
      } else if (payload.event.type === 'user:question') {
        respondedRef.current = false
        setPendingQuestion(payload.event.data)
        setPendingPermission(null)
      }
    })

    return unsubscribe
  }, [agentId])

  // Clear dialogs when agent exits waiting_for_human
  useEffect(() => {
    if (agent && agent.stateSnapshot.state !== 'waiting_for_human') {
      setPendingPermission(null)
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
        {agent.pendingHumanInteraction && (
          <div className="agent-detail-panel__waiting-badge">
            {agent.pendingHumanInteraction.type === 'permission'
              ? 'Permission required'
              : 'Question pending'}
          </div>
        )}
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
          <TerminalView agentId={agent.id} />
          {pendingPermission && (
            <PermissionDialog
              key={pendingPermission.requestId}
              request={pendingPermission}
              onRespond={handlePermissionResponse}
            />
          )}
          {pendingQuestion && (
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
