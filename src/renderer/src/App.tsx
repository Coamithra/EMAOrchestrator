import { useState, useEffect, useCallback } from 'react'
import type { AppConfig } from '@shared/config'
import type { AgentSnapshot } from '@shared/agent-manager'
import type { AgentEventPayload } from '@shared/ipc'
import TopBar from './components/TopBar'
import Settings from './components/Settings'
import MainLayout from './components/MainLayout'

type View = 'loading' | 'settings' | 'main'

function App(): React.JSX.Element {
  const [view, setView] = useState<View>('loading')
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [agents, setAgents] = useState<AgentSnapshot[]>([])

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
        case 'agent:state-changed':
          setAgents((prev) =>
            prev.map((a) =>
              a.id === event.data.agentId ? { ...a, stateSnapshot: event.data.stateSnapshot } : a
            )
          )
          break

        case 'agent:destroyed':
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
                (r) =>
                  r.phaseIndex === progress.phaseIndex && r.stepIndex === progress.stepIndex
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
      .then(setAgents)
      .catch(() => setAgents([]))

    return unsubscribe
  }, [view])

  function handleConfigSaved(cfg: AppConfig): void {
    setConfig(cfg)
    setView('main')
  }

  const handleNewAgentClick = useCallback(() => {
    // Will be wired to the new-agent launcher dialog (#020)
  }, [])

  const handleSettingsClick = useCallback(() => setView('settings'), [])

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <TopBar onNewAgentClick={handleNewAgentClick} onSettingsClick={handleSettingsClick} />
      <MainLayout agents={agents} />
    </div>
  )
}

export default App
