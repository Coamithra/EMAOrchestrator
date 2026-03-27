import { app } from 'electron'
import { join, isAbsolute } from 'path'
import { readFile, writeFile, access } from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { AppConfig, ValidationResult, FieldStatus } from '../shared/config'
import { DEFAULT_CONFIG } from '../shared/config'

const execFileAsync = promisify(execFile)

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

export async function configExists(): Promise<boolean> {
  try {
    await access(configPath())
    return true
  } catch {
    return false
  }
}

export async function loadConfig(): Promise<AppConfig | null> {
  try {
    const raw = await readFile(configPath(), 'utf-8')
    const parsed = JSON.parse(raw)
    // Deep-merge nested objects so partial saved configs don't lose default sub-keys
    const mergedIds = { ...DEFAULT_CONFIG.trelloListIds, ...parsed.trelloListIds }
    // Migrate backlog from single string to array
    if (typeof mergedIds.backlog === 'string') {
      mergedIds.backlog = mergedIds.backlog ? [mergedIds.backlog] : []
    }
    const config = {
      ...DEFAULT_CONFIG,
      ...parsed,
      trelloListIds: mergedIds
    }
    // Drop legacy trelloListNames if present
    delete (config as Record<string, unknown>).trelloListNames
    return config
  } catch {
    return null
  }
}

// TODO: encrypt trelloApiKey/trelloApiToken at rest using Electron safeStorage
export async function saveConfig(config: AppConfig): Promise<void> {
  await writeFile(configPath(), JSON.stringify(config, null, 2), 'utf-8')
}

export async function validateConfig(config: AppConfig): Promise<ValidationResult> {
  const [targetRepoPath, contributingMdPath, trelloConnection, claudeCliPath] = await Promise.all([
    validateRepoPath(config.targetRepoPath),
    validateContributingMd(config.contributingMdPath, config.targetRepoPath),
    validateTrelloConnection(config.trelloApiKey, config.trelloApiToken, config.trelloBoardId),
    validateClaudeCli(config.claudeCliPath)
  ])

  return { targetRepoPath, contributingMdPath, trelloConnection, claudeCliPath }
}

async function validateRepoPath(repoPath: string): Promise<FieldStatus> {
  if (!repoPath) return { ok: false, error: 'Required' }
  try {
    await access(repoPath)
  } catch {
    return { ok: false, error: 'Directory does not exist' }
  }
  try {
    await access(join(repoPath, '.git'))
  } catch {
    return { ok: false, error: 'Not a git repository' }
  }
  return { ok: true }
}

async function validateContributingMd(
  contributingPath: string,
  repoPath: string
): Promise<FieldStatus> {
  if (!contributingPath) return { ok: false, error: 'Required' }
  if (!repoPath) return { ok: false, error: 'Set target repo path first' }

  const resolved = isAbsolute(contributingPath)
    ? contributingPath
    : join(repoPath, contributingPath)

  try {
    await access(resolved)
    return { ok: true }
  } catch {
    return { ok: false, error: 'File not found' }
  }
}

async function validateTrelloConnection(
  apiKey: string,
  token: string,
  boardId: string
): Promise<FieldStatus> {
  if (!apiKey || !token || !boardId) {
    return { ok: false, error: 'API key, token, and board ID are all required' }
  }

  try {
    const url = `https://api.trello.com/1/boards/${boardId}?key=${apiKey}&token=${token}`
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })

    if (res.ok) return { ok: true }
    if (res.status === 401) return { ok: false, error: 'Invalid API key or token' }
    if (res.status === 404) return { ok: false, error: 'Board not found' }
    return { ok: false, error: `Trello returned status ${res.status}` }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { ok: false, error: `Connection failed: ${message}` }
  }
}

async function validateClaudeCli(cliPath: string): Promise<FieldStatus> {
  const cmd = cliPath || 'claude'
  try {
    await execFileAsync(cmd, ['--version'], { timeout: 5000 })
    return { ok: true }
  } catch {
    const label = cliPath ? `Not found at: ${cliPath}` : 'Not found on PATH'
    return { ok: false, error: label }
  }
}
