import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import { CliDriver } from './cli-driver'
import type { CliSessionOptions } from '../shared/cli-driver'
import type { CliEventPayload } from '../shared/ipc'
import { IpcChannels } from '../shared/ipc'

const sessions = new Map<string, CliDriver>()

/**
 * Get the main BrowserWindow for pushing events. Uses getAllWindows()[0] which
 * is correct for our single-window app. If multi-window support is added later,
 * this should accept a webContents reference from the IPC event sender instead.
 */
function getWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows()
  return windows[0] ?? null
}

/** Send a CLI event to the renderer process. */
function pushEvent(payload: CliEventPayload): void {
  const win = getWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send(IpcChannels.CLI_EVENT, payload)
  }
}

/** Wire up all CliDriver events to forward to the renderer. */
function wireEvents(sessionId: string, driver: CliDriver): void {
  driver.on('state:changed', (state, previousState) => {
    pushEvent({ sessionId, event: { type: 'state:changed', data: { state, previousState } } })
  })

  driver.on('session:init', (info) => {
    pushEvent({ sessionId, event: { type: 'session:init', data: info } })
  })

  driver.on('stream:text', (delta) => {
    pushEvent({ sessionId, event: { type: 'stream:text', data: delta } })
  })

  driver.on('tool:start', (event) => {
    pushEvent({ sessionId, event: { type: 'tool:start', data: event } })
  })

  driver.on('tool:activity', (event) => {
    pushEvent({ sessionId, event: { type: 'tool:activity', data: event } })
  })

  driver.on('tool:summary', (event) => {
    pushEvent({ sessionId, event: { type: 'tool:summary', data: event } })
  })

  driver.on('assistant:message', (content) => {
    pushEvent({ sessionId, event: { type: 'assistant:message', data: content } })
  })

  driver.on('permission:request', (request) => {
    pushEvent({ sessionId, event: { type: 'permission:request', data: request } })
  })

  driver.on('user:question', (request) => {
    pushEvent({ sessionId, event: { type: 'user:question', data: request } })
  })

  driver.on('session:result', (result) => {
    pushEvent({ sessionId, event: { type: 'session:result', data: result } })
    // Auto-remove session after completion
    sessions.delete(sessionId)
  })

  driver.on('error', (error) => {
    pushEvent({ sessionId, event: { type: 'error', data: { message: error.message } } })
    // Auto-remove session after error
    sessions.delete(sessionId)
  })
}

/**
 * Create a new CLI session. Returns the session ID immediately;
 * the session runs in the background, pushing events to the renderer.
 *
 * Note: Events may begin firing before the session ID is returned to the
 * renderer via IPC. This is safe because Electron serializes IPC messages
 * through the same pipe, so the invoke response arrives before any
 * webContents.send payloads.
 */
export function createSession(options: CliSessionOptions): string {
  const sessionId = randomUUID()
  const driver = new CliDriver()

  sessions.set(sessionId, driver)
  wireEvents(sessionId, driver)

  // Fire and forget — session runs async, events stream to renderer
  driver.startSession(options).catch(() => {
    // Errors are already emitted via the 'error' event and handled in wireEvents
  })

  return sessionId
}

/** Get a session's CliDriver, or null if not found. */
export function getSession(sessionId: string): CliDriver | null {
  return sessions.get(sessionId) ?? null
}

/** Abort all active sessions. Cleanup is best-effort on quit — async finally blocks may not complete. */
export function abortAllSessions(): void {
  for (const driver of sessions.values()) {
    driver.abort()
  }
  sessions.clear()
}
