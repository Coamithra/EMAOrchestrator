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

  // Load agents when entering main view
  useEffect(() => {
    if (view !== 'main') return
    window.api
      .listAgents()
      .then(setAgents)
      .catch(() => setAgents([]))
  }, [view])

  // Subscribe to real-time agent events from the main process
  useEffect(() => {
    if (view !== 'main') return

    const unsubscribe = window.api.onAgentEvent((payload: AgentEventPayload) => {
      const { event } = payload

      switch (event.type) {
        case 'agent:created':
          setAgents((prev) => [...prev, event.data.agent])
          break

        case 'agent:state-changed':
          setAgents((prev) =>
            prev.map((a) =>
              a.id === event.data.agentId ? { ...a, stateSnapshot: event.data.stateSnapshot } : a
            )
          )
          break

        case 'agent:step-advanced':
        case 'agent:step-completed':
          setAgents((prev) =>
            prev.map((a) =>
              a.id === event.data.agentId
                ? {
                    ...a,
                    stateSnapshot: {
                      ...a.stateSnapshot,
                      phaseIndex: event.data.progress.phaseIndex,
                      stepIndex: event.data.progress.stepIndex
                    }
                  }
                : a
            )
          )
          break

        case 'agent:error':
          setAgents((prev) =>
            prev.map((a) =>
              a.id === event.data.agentId
                ? {
                    ...a,
                    stateSnapshot: {
                      ...a.stateSnapshot,
                      state: 'error',
                      error: event.data.message
                    }
                  }
                : a
            )
          )
          break

        case 'agent:done':
          setAgents((prev) =>
            prev.map((a) =>
              a.id === event.data.agentId
                ? { ...a, stateSnapshot: { ...a.stateSnapshot, state: 'done' } }
                : a
            )
          )
          break

        case 'agent:destroyed':
          setAgents((prev) => prev.filter((a) => a.id !== event.data.agentId))
          break
      }
    })

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
