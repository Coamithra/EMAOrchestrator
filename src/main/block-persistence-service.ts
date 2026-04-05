import { app } from 'electron'
import { join } from 'path'
import { appendFile, readFile, mkdir, unlink } from 'fs/promises'
import type { CliEventPayload } from '../shared/ipc'

/** Directory where per-agent block event files are stored. */
function blocksDir(): string {
  return join(app.getPath('userData'), 'blocks')
}

/** Path to a specific agent's block events file. */
function getBlockPath(agentId: string): string {
  return join(blocksDir(), `${agentId}.jsonl`)
}

/** Ensure the blocks directory exists. Called lazily on first write. */
let dirEnsured = false
async function ensureBlocksDir(): Promise<void> {
  if (dirEnsured) return
  await mkdir(blocksDir(), { recursive: true })
  dirEnsured = true
}

/**
 * Event types that produce visible blocks in the renderer.
 * Non-renderable events (state:changed, permission:request, security:alert,
 * user:question, session:init) are skipped to keep files small.
 * tool:activity is also skipped — high-frequency, low-value for replay
 * (elapsed seconds don't matter after the fact).
 */
const PERSISTABLE_EVENTS = new Set([
  'stream:text',
  'step:banner',
  'approval:status',
  'tool:start',
  'tool:summary',
  'tool:result',
  'session:result',
  'error',
  'assistant:message',
  'orchestrator:inject'
])

/**
 * Append a CLI event to an agent's block events file.
 * Fire-and-forget safe — errors are caught and logged to console.
 */
export async function appendBlockEvent(
  agentId: string,
  payload: CliEventPayload
): Promise<void> {
  if (!PERSISTABLE_EVENTS.has(payload.event.type)) return
  try {
    await ensureBlocksDir()
    const line = JSON.stringify(payload) + '\n'
    await appendFile(getBlockPath(agentId), line, 'utf-8')
  } catch (err) {
    console.error('Failed to write block event:', err)
  }
}

/**
 * Read all persisted block events for an agent.
 * Returns an empty array if the file doesn't exist or is unreadable.
 */
export async function readBlockEvents(agentId: string): Promise<CliEventPayload[]> {
  try {
    const raw = await readFile(getBlockPath(agentId), 'utf-8')
    const events: CliEventPayload[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        events.push(JSON.parse(line) as CliEventPayload)
      } catch {
        // Skip corrupt lines (e.g., torn write from crash)
      }
    }
    return events
  } catch {
    return []
  }
}

/**
 * Remove persisted block events for an agent.
 * No-op if the file doesn't exist. Fire-and-forget safe.
 */
export async function removeBlockEvents(agentId: string): Promise<void> {
  try {
    await unlink(getBlockPath(agentId))
  } catch {
    // File doesn't exist — that's fine
  }
}
