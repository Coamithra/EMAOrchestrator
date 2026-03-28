import type { CliEventPayload } from '@shared/ipc'
import {
  markdownToAnsi,
  formatToolStart,
  formatToolSummary,
  formatSessionResult
} from '../utils/terminal-formatting'

// ---------------------------------------------------------------------------
// Per-agent output buffer
// ---------------------------------------------------------------------------

/** Max buffer size per agent in characters (~512KB assuming ~1 byte/char). */
const MAX_BUFFER_SIZE = 512 * 1024

/** Accumulated formatted ANSI output per agent. */
const buffers = new Map<string, string>()

/** Live-update subscribers per agent. */
const listeners = new Map<string, Set<(text: string) => void>>()

/**
 * Per-agent markdown text accumulator. Text deltas are accumulated here and
 * flushed through markdownToAnsi either after a 30ms timeout or when a
 * non-text event arrives (which triggers an immediate flush). This mirrors
 * the buffering TerminalView originally did for streaming markdown detection.
 */
const mdBuffers = new Map<string, string>()
const mdTimers = new Map<string, ReturnType<typeof setTimeout>>()
const FLUSH_DELAY = 30

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function append(agentId: string, text: string): void {
  const current = buffers.get(agentId) ?? ''
  let updated = current + text
  if (updated.length > MAX_BUFFER_SIZE) {
    // Trim from front, keeping the most recent output
    updated = updated.slice(updated.length - MAX_BUFFER_SIZE)
  }
  buffers.set(agentId, updated)

  const agentListeners = listeners.get(agentId)
  if (agentListeners) {
    for (const cb of agentListeners) cb(text)
  }
}

function flushMdBuffer(agentId: string): void {
  const buffered = mdBuffers.get(agentId)
  if (buffered && buffered.length > 0) {
    append(agentId, markdownToAnsi(buffered))
    mdBuffers.set(agentId, '')
  }
  const timer = mdTimers.get(agentId)
  if (timer) {
    clearTimeout(timer)
    mdTimers.delete(agentId)
  }
}

function bufferText(agentId: string, text: string): void {
  mdBuffers.set(agentId, (mdBuffers.get(agentId) ?? '') + text)
  if (!mdTimers.has(agentId)) {
    mdTimers.set(
      agentId,
      setTimeout(() => {
        mdTimers.delete(agentId)
        flushMdBuffer(agentId)
      }, FLUSH_DELAY)
    )
  }
}

function handleEvent(agentId: string, payload: CliEventPayload): void {
  const { event } = payload

  switch (event.type) {
    case 'stream:text':
      // Text already containing ANSI escapes bypasses the markdown converter
      if (event.data.text.includes('\x1b[')) {
        flushMdBuffer(agentId)
        append(agentId, event.data.text)
      } else {
        bufferText(agentId, event.data.text)
      }
      break

    case 'tool:start':
      flushMdBuffer(agentId)
      append(agentId, formatToolStart(event.data.toolName, event.data.inputSummary))
      break

    case 'tool:summary':
      flushMdBuffer(agentId)
      if (event.data.summary) {
        append(agentId, formatToolSummary(event.data.summary))
      }
      break

    case 'session:result':
      flushMdBuffer(agentId)
      append(
        agentId,
        formatSessionResult(event.data.costUsd, event.data.numTurns, event.data.durationMs)
      )
      break

    // tool:activity intentionally not buffered (same as TerminalView)
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let initialized = false

/** Start the global event listener. Call once at app startup. Idempotent. */
export function initTerminalBuffer(): void {
  if (initialized) return
  initialized = true
  window.api.onCliEvent((payload: CliEventPayload) => {
    const match = payload.sessionId.match(/^orchestration-(.+)$/)
    if (!match) return
    handleEvent(match[1], payload)
  })
}

/** Get all buffered output for an agent (for replay on mount). */
export function getBuffer(agentId: string): string {
  return buffers.get(agentId) ?? ''
}

/** Subscribe to new formatted output for an agent. Returns an unsubscribe function. */
export function subscribe(agentId: string, cb: (text: string) => void): () => void {
  if (!listeners.has(agentId)) listeners.set(agentId, new Set())
  listeners.get(agentId)!.add(cb)
  return () => {
    listeners.get(agentId)?.delete(cb)
    if (listeners.get(agentId)?.size === 0) listeners.delete(agentId)
  }
}

/** Clear an agent's buffer and pending markdown state. Call on agent destroy. */
export function clearBuffer(agentId: string): void {
  buffers.delete(agentId)
  listeners.delete(agentId)
  const timer = mdTimers.get(agentId)
  if (timer) clearTimeout(timer)
  mdTimers.delete(agentId)
  mdBuffers.delete(agentId)
}
