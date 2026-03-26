import { useState, useEffect, useCallback } from 'react'
import type { AppConfig } from '@shared/config'
import type { AgentSnapshot } from '@shared/agent-manager'
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
