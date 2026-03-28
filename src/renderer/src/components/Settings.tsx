import { useState, useEffect, useRef } from 'react'
import type {
  AppConfig,
  ValidationResult,
  RunbookParserType,
  SingleListRole
} from '@shared/config'
import { DEFAULT_CONFIG, extractBoardId } from '@shared/config'
import type { TrelloList } from '@shared/trello'
import SettingsField from './SettingsField'
import './Settings.css'

interface SettingsProps {
  initialConfig: AppConfig | null
  isFirstRun: boolean
  onSaved: (config: AppConfig) => void
  onCancel?: () => void
}

const SINGLE_ROLES: SingleListRole[] = ['inProgress', 'done']

const SINGLE_ROLE_LABELS: Record<SingleListRole, string> = {
  inProgress: 'In Progress',
  done: 'Done'
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
  const [boardLists, setBoardLists] = useState<TrelloList[]>([])
  const [fetchingLists, setFetchingLists] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [remoteBranches, setRemoteBranches] = useState<string[]>([])
  const [fetchingBranches, setFetchingBranches] = useState(false)
  const [branchError, setBranchError] = useState<string | null>(null)

  const didAutoFetch = useRef(false)
  useEffect(() => {
    if (didAutoFetch.current) return
    if (config.trelloBoardId && config.trelloApiKey && config.trelloApiToken) {
      didAutoFetch.current = true
      handleFetchLists()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function update<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    setConfig((prev) => ({ ...prev, [key]: value }))
    // Clear fetched lists when Trello credentials or board change — prevents saving
    // stale list IDs that belong to a different board
    if (key === 'trelloBoardId' || key === 'trelloApiKey' || key === 'trelloApiToken') {
      setBoardLists([])
      setListError(null)
    }
    if (key === 'targetRepoPath') {
      setRemoteBranches([])
      setBranchError(null)
    }
  }

  function isBacklog(listId: string): boolean {
    return config.trelloListIds.backlog.includes(listId)
  }

  function assignBacklog(listId: string): void {
    setConfig((prev) => {
      const ids = { ...prev.trelloListIds }
      if (!ids.backlog.includes(listId)) {
        ids.backlog = [...ids.backlog, listId]
      }
      // Remove from single roles if it was assigned there
      for (const r of SINGLE_ROLES) {
        if (ids[r] === listId) ids[r] = ''
      }
      return { ...prev, trelloListIds: ids }
    })
  }

  function getSingleRole(listId: string): SingleListRole | null {
    for (const r of SINGLE_ROLES) {
      if (config.trelloListIds[r] === listId) return r
    }
    return null
  }

  function assignSingleRole(listId: string, role: SingleListRole): void {
    setConfig((prev) => {
      const ids = { ...prev.trelloListIds }
      ids[role] = listId
      // Remove from backlog if it was there
      ids.backlog = ids.backlog.filter((id) => id !== listId)
      // Clear other single role if this list had one
      for (const r of SINGLE_ROLES) {
        if (r !== role && ids[r] === listId) ids[r] = ''
      }
      return { ...prev, trelloListIds: ids }
    })
  }

  function clearRoles(listId: string): void {
    setConfig((prev) => {
      const ids = { ...prev.trelloListIds }
      ids.backlog = ids.backlog.filter((id) => id !== listId)
      for (const r of SINGLE_ROLES) {
        if (ids[r] === listId) ids[r] = ''
      }
      return { ...prev, trelloListIds: ids }
    })
  }

  function getEffectiveRole(listId: string): 'backlog' | SingleListRole | null {
    if (isBacklog(listId)) return 'backlog'
    return getSingleRole(listId)
  }

  async function handleFetchLists(): Promise<void> {
    setFetchingLists(true)
    setListError(null)
    try {
      const lists = (await window.api.getTrelloListsForBoard(
        config.trelloBoardId,
        config.trelloApiKey,
        config.trelloApiToken
      )) as TrelloList[]
      if (lists.length === 0) {
        setListError('No lists found — check board ID and credentials')
      }
      setBoardLists(lists)
      // Prune any saved list IDs that no longer exist on the board
      const validIds = new Set(lists.map((l) => l.id))
      setConfig((prev) => {
        const ids = { ...prev.trelloListIds }
        let changed = false
        const prunedBacklog = ids.backlog.filter((id) => validIds.has(id))
        if (prunedBacklog.length !== ids.backlog.length) {
          ids.backlog = prunedBacklog
          changed = true
        }
        for (const r of SINGLE_ROLES) {
          if (ids[r] && !validIds.has(ids[r])) {
            ids[r] = ''
            changed = true
          }
        }
        return changed ? { ...prev, trelloListIds: ids } : prev
      })
    } catch {
      setListError('Failed to fetch lists')
    } finally {
      setFetchingLists(false)
    }
  }

  async function handleBrowseDirectory(
    field: 'targetRepoPath' | 'worktreeBasePath'
  ): Promise<void> {
    const path = await window.api.openDirectory()
    if (path) update(field, path)
  }

  async function handleBrowseFile(field: 'contributingMdPath' | 'claudeCliPath'): Promise<void> {
    const path = await window.api.openFile()
    if (path) update(field, path)
  }

  async function handleFetchBranches(): Promise<void> {
    setFetchingBranches(true)
    setBranchError(null)
    try {
      const branches = await window.api.listRemoteBranches(config.targetRepoPath)
      if (branches.length === 0) {
        setBranchError('No remote branches found')
      }
      setRemoteBranches(branches)
    } catch {
      setBranchError('Failed to fetch branches — check repo path')
    } finally {
      setFetchingBranches(false)
    }
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

  const canFetchLists = !!(config.trelloBoardId && config.trelloApiKey && config.trelloApiToken)

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

          <SettingsField
            label="Worktree Base Path"
            onBrowse={() => handleBrowseDirectory('worktreeBasePath')}
          >
            <input
              type="text"
              value={config.worktreeBasePath}
              onChange={(e) => update('worktreeBasePath', e.target.value)}
              placeholder="Leave empty to use repo parent directory"
            />
          </SettingsField>

          <SettingsField label="Default Branch">
            <div className="settings__branch-row">
              <select
                value={config.defaultBranch}
                onChange={(e) => update('defaultBranch', e.target.value)}
              >
                <option value="">Auto-detect</option>
                {remoteBranches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
                {config.defaultBranch &&
                  !remoteBranches.includes(config.defaultBranch) && (
                    <option value={config.defaultBranch}>{config.defaultBranch}</option>
                  )}
              </select>
              <button
                type="button"
                className="settings__btn settings__btn--small"
                onClick={handleFetchBranches}
                disabled={!config.targetRepoPath || fetchingBranches}
              >
                {fetchingBranches ? 'Fetching...' : 'Fetch Branches'}
              </button>
            </div>
            {branchError && <div className="settings__list-error">{branchError}</div>}
          </SettingsField>

          <SettingsField label="Runbook Parser">
            <select
              value={config.runbookParser ?? 'regex'}
              onChange={(e) => update('runbookParser', e.target.value as RunbookParserType)}
            >
              <option value="regex">Regex (fast, offline)</option>
              <option value="smart">Smart — AI-powered (uses Claude CLI)</option>
            </select>
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

          <SettingsField label="API Token" status={validation?.trelloConnection}>
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

          <SettingsField label="Board ID" status={validation?.trelloConnection}>
            <input
              type="text"
              value={config.trelloBoardId}
              onChange={(e) => update('trelloBoardId', extractBoardId(e.target.value))}
              placeholder="Board ID or full Trello URL"
            />
          </SettingsField>

          <div className="settings__subgroup">
            <div className="settings__subgroup-header">
              <span className="settings__subgroup-label">Board Lists</span>
              <button
                type="button"
                className="settings__btn settings__btn--small"
                onClick={handleFetchLists}
                disabled={!canFetchLists || fetchingLists}
              >
                {fetchingLists ? 'Fetching...' : 'Fetch Lists'}
              </button>
            </div>

            {listError && <div className="settings__list-error">{listError}</div>}

            {boardLists.length > 0 && (
              <table className="settings__list-table">
                <thead>
                  <tr>
                    <th>List</th>
                    <th>Backlog</th>
                    {SINGLE_ROLES.map((r) => (
                      <th key={r}>{SINGLE_ROLE_LABELS[r]}</th>
                    ))}
                    <th>None</th>
                  </tr>
                </thead>
                <tbody>
                  {boardLists.map((list) => {
                    const role = getEffectiveRole(list.id)
                    return (
                      <tr key={list.id}>
                        <td className="settings__list-name">{list.name}</td>
                        <td className="settings__list-radio">
                          <input
                            type="radio"
                            name={`list-single-${list.id}`}
                            checked={role === 'backlog'}
                            onChange={() => assignBacklog(list.id)}
                          />
                        </td>
                        {SINGLE_ROLES.map((r) => (
                          <td key={r} className="settings__list-radio">
                            <input
                              type="radio"
                              name={`list-single-${list.id}`}
                              checked={role === r}
                              onChange={() => assignSingleRole(list.id, r)}
                            />
                          </td>
                        ))}
                        <td className="settings__list-radio">
                          <input
                            type="radio"
                            name={`list-single-${list.id}`}
                            checked={role === null}
                            onChange={() => clearRoles(list.id)}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}

            {boardLists.length === 0 && !listError && (
              <div className="settings__list-hint">
                {canFetchLists
                  ? 'Click "Fetch Lists" to load board lists'
                  : 'Enter board ID, API key, and token first'}
              </div>
            )}
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
              onChange={(e) => {
                const n = parseInt(e.target.value, 10)
                if (!isNaN(n)) update('maxConcurrentAgents', Math.max(1, Math.min(10, n)))
              }}
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
