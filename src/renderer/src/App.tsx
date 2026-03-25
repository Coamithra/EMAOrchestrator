import { useState, useEffect } from 'react'
import type { AppConfig } from '@shared/config'
import TopBar from './components/TopBar'
import Settings from './components/Settings'

type View = 'loading' | 'settings' | 'main'

function App(): React.JSX.Element {
  const [view, setView] = useState<View>('loading')
  const [config, setConfig] = useState<AppConfig | null>(null)

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

  function handleConfigSaved(cfg: AppConfig): void {
    setConfig(cfg)
    setView('main')
  }

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
      <TopBar onSettingsClick={() => setView('settings')} />
      <div style={{ padding: '2rem' }}>
        <h1>EMAOrchestrator</h1>
        <p style={{ color: 'var(--ev-c-text-2)' }}>
          Target repo: {config?.targetRepoPath || '(not set)'}
        </p>
      </div>
    </div>
  )
}

export default App
