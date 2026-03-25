import { useState } from 'react'
import type { AppConfig, ValidationResult } from '@shared/config'
import { DEFAULT_CONFIG } from '@shared/config'
import SettingsField from './SettingsField'
import './Settings.css'

interface SettingsProps {
  initialConfig: AppConfig | null
  isFirstRun: boolean
  onSaved: (config: AppConfig) => void
  onCancel?: () => void
}

function Settings({
  initialConfig,
  isFirstRun,
  onSaved,
  onCancel
}: SettingsProps): React.JSX.Element {
  const [config, setConfig] = useState<AppConfig>(initialConfig ?? DEFAULT_CONFIG)
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [saving, setSaving] = useState(false)
  const [showToken, setShowToken] = useState(false)

  function update<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  function updateListName(key: keyof AppConfig['trelloListNames'], value: string): void {
    setConfig((prev) => ({
      ...prev,
      trelloListNames: { ...prev.trelloListNames, [key]: value }
    }))
  }

  async function handleBrowseDirectory(field: 'targetRepoPath'): Promise<void> {
    const path = await window.api.openDirectory()
    if (path) update(field, path)
  }

  async function handleBrowseFile(field: 'contributingMdPath' | 'claudeCliPath'): Promise<void> {
    const path = await window.api.openFile()
    if (path) update(field, path)
  }

  async function handleValidate(): Promise<void> {
    setSaving(true)
    try {
      const result = await window.api.validateConfig(config)
      setValidation(result)
    } finally {
      setSaving(false)
    }
  }

  async function handleSave(): Promise<void> {
    setSaving(true)
    try {
      const result = await window.api.saveConfig(config)
      setValidation(result)

      const allOk =
        result.targetRepoPath?.ok &&
        result.contributingMdPath?.ok &&
        result.trelloConnection?.ok &&
        result.claudeCliPath?.ok

      if (allOk) {
        onSaved(config)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="settings">
      <div className="settings__card">
        <h1 className="settings__title">
          {isFirstRun ? 'Welcome to EMAOrchestrator' : 'Settings'}
        </h1>
        {isFirstRun && (
          <p className="settings__subtitle">Configure your settings to get started.</p>
        )}

        <section className="settings__section">
          <h2 className="settings__section-title">Repository</h2>
          <SettingsField
            label="Target Repo Path"
            status={validation?.targetRepoPath}
            onBrowse={() => handleBrowseDirectory('targetRepoPath')}
          >
            <input
              type="text"
              value={config.targetRepoPath}
              onChange={(e) => update('targetRepoPath', e.target.value)}
              placeholder="C:\path\to\your\repo"
            />
          </SettingsField>

          <SettingsField
            label="CONTRIBUTING.md Path"
            status={validation?.contributingMdPath}
            onBrowse={() => handleBrowseFile('contributingMdPath')}
          >
            <input
              type="text"
              value={config.contributingMdPath}
              onChange={(e) => update('contributingMdPath', e.target.value)}
              placeholder="CONTRIBUTING.md"
            />
          </SettingsField>
        </section>

        <section className="settings__section">
          <h2 className="settings__section-title">Trello</h2>
          <SettingsField label="API Key" status={validation?.trelloConnection}>
            <input
              type="text"
              value={config.trelloApiKey}
              onChange={(e) => update('trelloApiKey', e.target.value)}
              placeholder="Your Trello API key"
            />
          </SettingsField>

          <SettingsField label="API Token">
            <div className="settings__token-row">
              <input
                type={showToken ? 'text' : 'password'}
                value={config.trelloApiToken}
                onChange={(e) => update('trelloApiToken', e.target.value)}
                placeholder="Your Trello API token"
              />
              <button
                type="button"
                className="settings__token-toggle"
                onClick={() => setShowToken(!showToken)}
              >
                {showToken ? 'Hide' : 'Show'}
              </button>
            </div>
          </SettingsField>

          <SettingsField label="Board ID">
            <input
              type="text"
              value={config.trelloBoardId}
              onChange={(e) => update('trelloBoardId', e.target.value)}
              placeholder="Trello board ID"
            />
          </SettingsField>

          <div className="settings__subgroup">
            <span className="settings__subgroup-label">List Names</span>
            <SettingsField label="To Do">
              <input
                type="text"
                value={config.trelloListNames.todo}
                onChange={(e) => updateListName('todo', e.target.value)}
              />
            </SettingsField>
            <SettingsField label="In Progress">
              <input
                type="text"
                value={config.trelloListNames.inProgress}
                onChange={(e) => updateListName('inProgress', e.target.value)}
              />
            </SettingsField>
            <SettingsField label="Done">
              <input
                type="text"
                value={config.trelloListNames.done}
                onChange={(e) => updateListName('done', e.target.value)}
              />
            </SettingsField>
          </div>
        </section>

        <section className="settings__section">
          <h2 className="settings__section-title">Claude CLI</h2>
          <SettingsField
            label="Claude CLI Path"
            status={validation?.claudeCliPath}
            onBrowse={() => handleBrowseFile('claudeCliPath')}
          >
            <input
              type="text"
              value={config.claudeCliPath}
              onChange={(e) => update('claudeCliPath', e.target.value)}
              placeholder="Leave empty to use PATH"
            />
          </SettingsField>
        </section>

        <section className="settings__section">
          <h2 className="settings__section-title">Performance</h2>
          <SettingsField label="Max Concurrent Agents">
            <input
              type="number"
              min={1}
              max={10}
              value={config.maxConcurrentAgents}
              onChange={(e) => update('maxConcurrentAgents', Number(e.target.value))}
            />
          </SettingsField>
        </section>

        <div className="settings__actions">
          <button
            className="settings__btn settings__btn--secondary"
            onClick={handleValidate}
            disabled={saving}
          >
            Validate
          </button>
          <button
            className="settings__btn settings__btn--primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          {onCancel && (
            <button className="settings__btn settings__btn--secondary" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default Settings
