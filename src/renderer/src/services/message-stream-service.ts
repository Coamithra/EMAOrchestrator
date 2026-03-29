import type { CliEventPayload } from '@shared/ipc'
import type { MessageBlock, TextBlock, ToolBlock, BlockUpdate } from '@shared/message-block'

// ---------------------------------------------------------------------------
// Per-agent block store
// ---------------------------------------------------------------------------

/** Max blocks per agent. When exceeded, the oldest 100 are dropped. */
const MAX_BLOCKS = 500
const DROP_COUNT = 100

const stores = new Map<string, MessageBlock[]>()
const listeners = new Map<string, Set<(update: BlockUpdate) => void>>()

/**
 * Per-agent markdown text accumulator. Text deltas are accumulated here and
 * flushed either after a 30ms timeout or when a non-text event arrives.
 * This mirrors the buffering the old terminal-buffer-service did for
 * streaming markdown detection.
 */
const mdBuffers = new Map<string, string>()
const mdTimers = new Map<string, ReturnType<typeof setTimeout>>()
const FLUSH_DELAY = 30

/** Regex to strip ANSI escape sequences (safety net for legacy events). */
const ANSI_REGEX = /\x1b\[[0-9;]*[A-Za-z]/g

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getStore(agentId: string): MessageBlock[] {
  let store = stores.get(agentId)
  if (!store) {
    store = []
    stores.set(agentId, store)
  }
  return store
}

function notify(agentId: string, update: BlockUpdate): void {
  const agentListeners = listeners.get(agentId)
  if (agentListeners) {
    for (const cb of agentListeners) cb(update)
  }
}

function appendBlock(agentId: string, block: MessageBlock): void {
  const store = getStore(agentId)
  store.push(block)

  if (store.length > MAX_BLOCKS) {
    store.splice(0, DROP_COUNT)
    notify(agentId, { type: 'blocks:reset' })
  } else {
    notify(agentId, { type: 'block:appended', block })
  }
}

function getOpenTextBlock(agentId: string): TextBlock | null {
  const store = getStore(agentId)
  const last = store[store.length - 1]
  if (last?.type === 'text' && last.streaming) return last
  return null
}

function getLastToolBlock(agentId: string): ToolBlock | null {
  const store = getStore(agentId)
  for (let i = store.length - 1; i >= 0; i--) {
    if (store[i].type === 'tool') return store[i] as ToolBlock
  }
  return null
}

function finalizeTextBlock(agentId: string): void {
  const open = getOpenTextBlock(agentId)
  if (open) open.streaming = false
}

function blockId(): string {
  return crypto.randomUUID()
}

// ---------------------------------------------------------------------------
// Markdown text buffering
// ---------------------------------------------------------------------------

function flushMdBuffer(agentId: string): void {
  const buffered = mdBuffers.get(agentId)
  if (!buffered || buffered.length === 0) {
    clearMdTimer(agentId)
    return
  }

  // Strip ANSI as safety net (shouldn't happen with new event types)
  const clean = buffered.replace(ANSI_REGEX, '')
  mdBuffers.set(agentId, '')
  clearMdTimer(agentId)

  if (clean.length === 0) return

  const open = getOpenTextBlock(agentId)
  if (open) {
    open.content += clean
    const store = getStore(agentId)
    notify(agentId, { type: 'block:updated', blockIndex: store.length - 1 })
  } else {
    const block: TextBlock = {
      type: 'text',
      id: blockId(),
      content: clean,
      streaming: true,
      timestamp: Date.now()
    }
    appendBlock(agentId, block)
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

function clearMdTimer(agentId: string): void {
  const timer = mdTimers.get(agentId)
  if (timer) {
    clearTimeout(timer)
    mdTimers.delete(agentId)
  }
}

// ---------------------------------------------------------------------------
// Event handler
// ---------------------------------------------------------------------------

function handleEvent(agentId: string, payload: CliEventPayload): void {
  const { event } = payload

  switch (event.type) {
    case 'stream:text': {
      bufferText(agentId, event.data.text)
      break
    }

    case 'step:banner': {
      flushMdBuffer(agentId)
      finalizeTextBlock(agentId)
      appendBlock(agentId, {
        type: 'banner',
        id: blockId(),
        timestamp: Date.now(),
        ...event.data
      })
      break
    }

    case 'approval:status': {
      flushMdBuffer(agentId)
      appendBlock(agentId, {
        type: 'status',
        id: blockId(),
        timestamp: Date.now(),
        ...event.data
      })
      break
    }

    case 'tool:start': {
      flushMdBuffer(agentId)
      finalizeTextBlock(agentId)
      appendBlock(agentId, {
        type: 'tool',
        id: blockId(),
        toolName: event.data.toolName,
        inputSummary: event.data.inputSummary,
        active: true,
        elapsedSeconds: 0,
        timestamp: Date.now()
      })
      break
    }

    case 'tool:activity': {
      const tool = getLastToolBlock(agentId)
      if (tool && tool.active) {
        tool.elapsedSeconds = event.data.elapsedSeconds
        const store = getStore(agentId)
        const idx = store.lastIndexOf(tool)
        if (idx !== -1) notify(agentId, { type: 'block:updated', blockIndex: idx })
      }
      break
    }

    case 'tool:summary': {
      const tool = getLastToolBlock(agentId)
      if (tool) {
        tool.summary = event.data.summary
        tool.active = false
        const store = getStore(agentId)
        const idx = store.lastIndexOf(tool)
        if (idx !== -1) notify(agentId, { type: 'block:updated', blockIndex: idx })
      }
      break
    }

    case 'session:result': {
      flushMdBuffer(agentId)
      finalizeTextBlock(agentId)
      appendBlock(agentId, {
        type: 'result',
        id: blockId(),
        subtype: event.data.subtype,
        costUsd: event.data.costUsd,
        numTurns: event.data.numTurns,
        durationMs: event.data.durationMs,
        timestamp: Date.now()
      })
      break
    }

    case 'error': {
      flushMdBuffer(agentId)
      finalizeTextBlock(agentId)
      appendBlock(agentId, {
        type: 'error',
        id: blockId(),
        message: event.data.message,
        timestamp: Date.now()
      })
      break
    }

    // assistant:message — redundant with stream:text for display.
    // Finalize the current text block so the next step starts fresh.
    case 'assistant:message': {
      flushMdBuffer(agentId)
      finalizeTextBlock(agentId)
      break
    }

    // state:changed, session:init, permission:request, security:alert,
    // user:question, tool:activity (handled above) — no block rendering needed.
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let initialized = false

/** Start the global event listener. Call once at app startup. Idempotent. */
export function initMessageStream(): void {
  if (initialized) return
  initialized = true
  window.api.onCliEvent((payload: CliEventPayload) => {
    const match = payload.sessionId.match(/^orchestration-(.+)$/)
    if (!match) return
    handleEvent(match[1], payload)
  })
}

/** Get all blocks for an agent (for replay on mount). */
export function getBlocks(agentId: string): MessageBlock[] {
  return stores.get(agentId) ?? []
}

/** Subscribe to block updates for an agent. Returns an unsubscribe function. */
export function subscribe(agentId: string, cb: (update: BlockUpdate) => void): () => void {
  if (!listeners.has(agentId)) listeners.set(agentId, new Set())
  listeners.get(agentId)!.add(cb)
  return () => {
    listeners.get(agentId)?.delete(cb)
    if (listeners.get(agentId)?.size === 0) listeners.delete(agentId)
  }
}

/** Clear an agent's blocks and pending state. Call on agent destroy. */
export function clearBlocks(agentId: string): void {
  stores.delete(agentId)
  listeners.delete(agentId)
  clearMdTimer(agentId)
  mdBuffers.delete(agentId)
}
