/**
 * Persists tool permission patterns to .claude/settings.local.json in the target repo.
 * Follows the config-service pattern: stateless exported functions, async, fire-and-forget safe.
 */

import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SettingsLocalJson {
  permissions?: {
    allow?: string[]
    deny?: string[]
  }
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Tool pattern generation
// ---------------------------------------------------------------------------

/**
 * Generate a Claude CLI-compatible tool pattern from a permission request.
 *
 * Non-Bash tools → just the tool name (e.g., "Write", "Edit", "Read").
 * Bash tools → "Bash(prefix:*)" where prefix is the command verb/subcommand.
 *
 * Examples:
 *   ("Write", {})                          → "Write"
 *   ("Bash", { command: "git add foo.ts"}) → "Bash(git add:*)"
 *   ("Bash", { command: "npm run build" }) → "Bash(npm run:*)"
 *   ("Bash", { command: "ls -la /tmp" })   → "Bash(ls:*)"
 */
export function generateToolPattern(toolName: string, toolInput: Record<string, unknown>): string {
  if (toolName === 'Bash' && typeof toolInput.command === 'string') {
    const prefix = extractCommandPrefix(toolInput.command)
    if (prefix) {
      return `Bash(${prefix}:*)`
    }
  }
  return toolName
}

/**
 * Extract a meaningful command prefix for Bash pattern matching.
 * Takes words from the start that look like command verbs (not arguments or paths).
 * Max 2 words to keep patterns at the right granularity.
 */
function extractCommandPrefix(command: string): string {
  // Strip everything after shell operators so chained commands don't leak into the prefix
  const sanitized = command.trim().split(/\s*(?:&&|\|\||[;|])\s*/)[0]
  const words = sanitized.split(/\s+/)
  const prefixWords: string[] = []

  for (const word of words) {
    if (prefixWords.length >= 2) break
    // Stop at words that look like arguments or paths
    if (word.startsWith('-') || word.startsWith('/') || word.startsWith('\\')) break
    if (word.startsWith('.') && word !== '.') break
    if (word.startsWith('"') || word.startsWith("'")) break
    // Stop at words that contain path separators (likely file paths)
    if (prefixWords.length > 0 && (word.includes('/') || word.includes('\\'))) break
    prefixWords.push(word)
  }

  return prefixWords.join(' ')
}

// ---------------------------------------------------------------------------
// Settings file operations
// ---------------------------------------------------------------------------

function settingsLocalPath(repoPath: string): string {
  return join(repoPath, '.claude', 'settings.local.json')
}

async function readSettingsLocal(repoPath: string): Promise<SettingsLocalJson> {
  let raw: string
  try {
    raw = await readFile(settingsLocalPath(repoPath), 'utf-8')
  } catch {
    // File doesn't exist yet — start fresh
    return {}
  }
  // Parse errors propagate so we don't silently overwrite a corrupt file
  return JSON.parse(raw) as SettingsLocalJson
}

async function writeSettingsLocal(repoPath: string, settings: SettingsLocalJson): Promise<void> {
  const filePath = settingsLocalPath(repoPath)
  await mkdir(join(repoPath, '.claude'), { recursive: true })
  await writeFile(filePath, JSON.stringify(settings, null, 2), 'utf-8')
}

/**
 * Add a tool pattern to the permissions.allow array in .claude/settings.local.json.
 * Creates the file and directory if they don't exist. No-op if the pattern is already present.
 */
export async function addAllowedToolPattern(repoPath: string, pattern: string): Promise<void> {
  if (!repoPath) {
    console.warn('permission-settings-service: no repoPath, skipping remember')
    return
  }

  const settings = await readSettingsLocal(repoPath)

  if (!settings.permissions) {
    settings.permissions = {}
  }
  if (!settings.permissions.allow) {
    settings.permissions.allow = []
  }

  // Skip if already present
  if (settings.permissions.allow.includes(pattern)) return

  settings.permissions.allow.push(pattern)
  await writeSettingsLocal(repoPath, settings)
}
