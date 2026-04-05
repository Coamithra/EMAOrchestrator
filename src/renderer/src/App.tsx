import { useState, useEffect, useCallback } from 'react'
import type { AppConfig } from '@shared/config'
import type { AgentSnapshot } from '@shared/agent-manager'
import type { AgentEventPayload } from '@shared/ipc'
import TopBar from './components/TopBar'
import Settings from './components/Settings'
import MainLayout from './components/MainLayout'
import NewAgentDialog from './components/NewAgentDialog'
import RunbookView from './components/RunbookView'
import StepReportView from './components/StepReportView'
import { initMessageStream, clearBlocks, replayEvents } from './services/message-stream-service'

type View = 'loading' | 'settings' | 'main' | 'runbook' | 'step-report'

function App(): React.JSX.Element {
  const [view, setView] = useState<View>('loading')
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [agents, setAgents] = useState<AgentSnapshot[]>([])
  const [runningAgentIds, setRunningAgentIds] = useState<Set<string>>(new Set())
  const [showNewAgentDialog, setShowNewAgentDialog] = useState(false)
  const [pendingSelectAgentId, setPendingSelectAgentId] = useState<string | null>(null)
  const [reportAgentId, setReportAgentId] = useState<string | null>(null)

  // Initialize message stream early so it captures events for all agents,
  // even before any ChatTerminal is mounted. Runs once on app startup.
  useEffect(() => {
    initMessageStream()
  }, [])

  useEffect(() => {
    window.api
      .configExists()
      .then(async (exists) => {
        if (!exists) {
          setView('settings')
          return
        }
        const cfg = await window.api.loadConfig()
        setConfig(cfg)
        setView('main')
      })
      .catch(() => {
        // Config read failed — fall back to first-run settings
        setView('settings')
      })
  }, [])

  // Load agents and subscribe to real-time events in a single effect to avoid
  // race conditions between the initial fetch and event listener setup.
  useEffect(() => {
    if (view !== 'main') return

    // Subscribe first so no events are missed while the initial fetch is in-flight.
    const unsubscribe = window.api.onAgentEvent((payload: AgentEventPayload) => {
      const { event } = payload

      switch (event.type) {
        case 'agent:created':
          setAgents((prev) =>
            prev.some((a) => a.id === event.data.agent.id) ? prev : [...prev, event.data.agent]
          )
          break

        // state-changed delivers the full AgentStateSnapshot, covering phase
        // transitions, step progress, errors, and done — making separate
        // handlers for step-advanced/step-completed/error/done unnecessary.
        case 'agent:state-changed': {
          const newState = event.data.stateSnapshot.state
          const agentId = event.data.agentId
          setAgents((prev) =>
            prev.map((a) => {
              if (a.id !== agentId) return a
              const updated: AgentSnapshot = { ...a, stateSnapshot: event.data.stateSnapshot }
              // Clear pendingHumanInteraction when agent exits waiting state
              if (newState !== 'waiting_for_human') {
                updated.pendingHumanInteraction = null
              }
              return updated
            })
          )
          // Update running status based on state
          const terminalStates = new Set(['idle', 'done', 'error'])
          if (terminalStates.has(newState)) {
            setRunningAgentIds((prev) => {
              if (!prev.has(agentId)) return prev
              const next = new Set(prev)
              next.delete(agentId)
              return next
            })
          } else if (newState !== 'waiting_for_human') {
            setRunningAgentIds((prev) => {
              if (prev.has(agentId)) return prev
              const next = new Set(prev)
              next.add(agentId)
              return next
            })
          }
          break
        }

        case 'agent:destroyed':
          clearBlocks(event.data.agentId)
          setAgents((prev) => prev.filter((a) => a.id !== event.data.agentId))
          break

        // Append a step completion record so the progress panel updates immediately.
        case 'agent:step-completed': {
          const { agentId, progress } = event.data
          setAgents((prev) =>
            prev.map((a) => {
              if (a.id !== agentId) return a
              // Avoid duplicates (idempotency for replayed events)
              const exists = a.stepHistory.some(
                (r) => r.phaseIndex === progress.phaseIndex && r.stepIndex === progress.stepIndex
              )
              if (exists) return a
              return {
                ...a,
                stepHistory: [
                  ...a.stepHistory,
                  {
                    phaseIndex: progress.phaseIndex,
                    stepIndex: progress.stepIndex,
                    phaseName: progress.phaseName,
                    stepTitle: progress.stepTitle,
                    completedAt: new Date().toISOString()
                  }
                ]
              }
            })
          )
          break
        }

        case 'agent:step-summary': {
          const { agentId: summaryAgentId, phaseIndex, stepIndex, summary } = event.data
          setAgents((prev) =>
            prev.map((a) => {
              if (a.id !== summaryAgentId) return a
              const record = a.stepHistory.find(
                (r) => r.phaseIndex === phaseIndex && r.stepIndex === stepIndex
              )
              if (!record || record.summary === summary) return a
              return {
                ...a,
                stepHistory: a.stepHistory.map((r) =>
                  r.phaseIndex === phaseIndex && r.stepIndex === stepIndex
                    ? { ...r, summary }
                    : r
                )
              }
            })
          )
          break
        }

        case 'agent:interaction-changed': {
          const { agentId: interactionAgentId, interaction } = event.data
          setAgents((prev) =>
            prev.map((a) =>
              a.id === interactionAgentId
                ? { ...a, pendingHumanInteraction: interaction }
                : a
            )
          )
          break
        }

        // step-advanced, phase-completed, error, and done are already covered
        // by the state-changed event which carries the full snapshot.
        case 'agent:step-advanced':
        case 'agent:phase-completed':
        case 'agent:error':
        case 'agent:done':
          break
      }
    })

    // Fetch initial agent list after subscribing. Any events that arrived
    // between subscribe and fetch resolve are handled via dedup in agent:created.
    window.api
      .listAgents()
      .then(async (loadedAgents) => {
        // Replay persisted block events for restored agents so terminal output
        // is visible immediately, even after an app restart.
        await Promise.all(
          loadedAgents.map(async (a) => {
            try {
              const events = await window.api.getBlockEvents(a.id)
              if (events.length > 0) replayEvents(a.id, events)
            } catch {
              // No persisted events — that's fine
            }
          })
        )
        setAgents(loadedAgents)
        // Check which agents are currently running
        const running = new Set<string>()
        for (const a of loadedAgents) {
          try {
            if (await window.api.isOrchestrationRunning(a.id)) {
              running.add(a.id)
            }
          } catch {
            // ignore
          }
        }
        setRunningAgentIds(running)
      })
      .catch(() => setAgents([]))

    return unsubscribe
  }, [view])

  function handleConfigSaved(cfg: AppConfig): void {
    setConfig(cfg)
    setView('main')
  }

  const handleNewAgentClick = useCallback(() => {
    setShowNewAgentDialog(true)
  }, [])

  const handleAgentCreated = useCallback(async (agentId: string) => {
    setShowNewAgentDialog(false)
    setPendingSelectAgentId(agentId)
    try {
      await window.api.startOrchestration(agentId)
    } catch {
      // Agent was created but start failed — it'll show as idle in the sidebar
    }
  }, [])

  const handleResumeAgent = useCallback(async (agentId: string) => {
    try {
      await window.api.startOrchestration(agentId)
      setRunningAgentIds((prev) => new Set(prev).add(agentId))
    } catch {
      // Start failed — agent stays in current state
    }
  }, [])

  const handleStopAgent = useCallback(async (agentId: string) => {
    try {
      await window.api.stopOrchestration(agentId)
      setRunningAgentIds((prev) => {
        const next = new Set(prev)
        next.delete(agentId)
        return next
      })
    } catch {
      // Stop failed
    }
  }, [])

  const handleDismissAgent = useCallback(async (agentId: string) => {
    try {
      await window.api.dismissAgent(agentId)
      // Agent removal is handled by the agent:destroyed event
    } catch {
      // Dismiss failed
    }
  }, [])

  const handleSettingsClick = useCallback(() => setView('settings'), [])
  const handleRunbookClick = useCallback(() => setView('runbook'), [])
  const handleViewStepReport = useCallback((agentId: string) => {
    setReportAgentId(agentId)
    setView('step-report')
  }, [])

  if (view === 'loading') {
    return <div style={{ padding: '2rem', color: 'var(--ev-c-text-2)' }}>Loading...</div>
  }

  if (view === 'settings') {
    return (
      <Settings
        initialConfig={config}
        isFirstRun={config === null}
        onSaved={handleConfigSaved}
        onCancel={config ? () => setView('main') : undefined}
      />
    )
  }

  if (view === 'runbook') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <TopBar
          onNewAgentClick={handleNewAgentClick}
          onSettingsClick={handleSettingsClick}
          onRunbookClick={handleRunbookClick}
        />
        <RunbookView onBack={() => setView('main')} />
      </div>
    )
  }

  if (view === 'step-report') {
    const reportAgent = agents.find((a) => a.id === reportAgentId)
    if (!reportAgent) {
      setView('main')
      return null
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <TopBar
          onNewAgentClick={handleNewAgentClick}
          onSettingsClick={handleSettingsClick}
          onRunbookClick={handleRunbookClick}
        />
        <StepReportView agent={reportAgent} onBack={() => setView('main')} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <TopBar
        onNewAgentClick={handleNewAgentClick}
        onSettingsClick={handleSettingsClick}
        onRunbookClick={handleRunbookClick}
      />
      <MainLayout
        agents={agents}
        runningAgentIds={runningAgentIds}
        pendingSelectAgentId={pendingSelectAgentId}
        onResumeAgent={handleResumeAgent}
        onStopAgent={handleStopAgent}
        onDismissAgent={handleDismissAgent}
        onViewStepReport={handleViewStepReport}
      />
      {showNewAgentDialog && (
        <NewAgentDialog
          onCreated={handleAgentCreated}
          onClose={() => setShowNewAgentDialog(false)}
        />
      )}
    </div>
  )
}

export default App
