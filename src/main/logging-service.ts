import { app } from 'electron'
import { join } from 'path'
import { appendFile, readFile, mkdir } from 'fs/promises'
import type { LogEntry } from '../shared/logging'

/** Directory where per-agent log files are stored. */
function logsDir(): string {
  return join(app.getPath('userData'), 'logs')
}

/** Path to a specific agent's log file. */
export function getLogPath(agentId: string): string {
  return join(logsDir(), `${agentId}.jsonl`)
}

/** Ensure the logs directory exists. Called lazily on first write. */
let dirEnsured = false
async function ensureLogsDir(): Promise<void> {
  if (dirEnsured) return
  await mkdir(logsDir(), { recursive: true })
  dirEnsured = true
}

/**
 * Append a structured log entry to an agent's log file.
 * Creates the file and directory if they don't exist.
 * Fire-and-forget safe — errors are caught and logged to console.
 */
export async function appendLogEntry(entry: LogEntry): Promise<void> {
  try {
    await ensureLogsDir()
    const line = JSON.stringify(entry) + '\n'
    await appendFile(getLogPath(entry.agentId), line, 'utf-8')
  } catch (err) {
    console.error('Failed to write log entry:', err)
  }
}

/**
 * Read all log entries for an agent.
 * Returns an empty array if the file doesn't exist or is unreadable.
 */
export async function readAgentLog(agentId: string): Promise<LogEntry[]> {
  try {
    const raw = await readFile(getLogPath(agentId), 'utf-8')
    const entries: LogEntry[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        entries.push(JSON.parse(line) as LogEntry)
      } catch {
        // Skip corrupt lines (e.g., torn write from crash)
      }
    }
    return entries
  } catch {
    return []
  }
}
