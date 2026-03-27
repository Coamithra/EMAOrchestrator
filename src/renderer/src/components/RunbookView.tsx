import { useState, useEffect } from 'react'
import type { Runbook } from '@shared/runbook'
import './RunbookView.css'

interface RunbookViewProps {
  onBack: () => void
}

function RunbookView({ onBack }: RunbookViewProps): React.JSX.Element {
  const [runbook, setRunbook] = useState<Runbook | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api
      .getRunbook()
      .then((r) => {
        setRunbook(r as Runbook | null)
        setLoading(false)
      })
      .catch(() => {
        setError('Failed to load runbook')
        setLoading(false)
      })
  }, [])

  async function handleRefresh(): Promise<void> {
    setRefreshing(true)
    setError(null)
    try {
      const r = (await window.api.refreshRunbook()) as Runbook | null
      setRunbook(r)
      if (!r) setError('Failed to parse runbook — check CONTRIBUTING.md path in Settings')
    } catch {
      setError('Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }

  let stepCounter = 0

  return (
    <div className="runbook-view">
      <div className="runbook-view__header">
        <button className="runbook-view__back" onClick={onBack}>
          &larr; Back
        </button>
        <h1 className="runbook-view__title">Runbook</h1>
        <button
          className="runbook-view__refresh"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? 'Parsing...' : 'Refresh'}
        </button>
      </div>

      {loading && <div className="runbook-view__status">Loading...</div>}
      {error && <div className="runbook-view__error">{error}</div>}

      {!loading && !runbook && !error && (
        <div className="runbook-view__status">
          No runbook parsed yet. Click Refresh to parse CONTRIBUTING.md.
        </div>
      )}

      {runbook && (
        <div className="runbook-view__content">
          {runbook.phases.map((phase, pi) => (
            <section key={pi} className="runbook-view__phase">
              <h2 className="runbook-view__phase-title">
                Phase {pi + 1}: {phase.name}
              </h2>
              <ol className="runbook-view__steps" start={stepCounter + 1}>
                {phase.steps.map((step, si) => {
                  stepCounter++
                  return (
                    <li key={si} className="runbook-view__step">
                      <div className="runbook-view__step-title">{step.title}</div>
                      {step.description && (
                        <div className="runbook-view__step-desc">{step.description}</div>
                      )}
                    </li>
                  )
                })}
              </ol>
            </section>
          ))}
          <div className="runbook-view__summary">
            {runbook.phases.length} phases,{' '}
            {runbook.phases.reduce((sum, p) => sum + p.steps.length, 0)} steps
          </div>
        </div>
      )}
    </div>
  )
}

export default RunbookView
