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

function findToolBlock(agentId: string, toolUseId: string): ToolBlock | null {
  if (!toolUseId) return getLastToolBlock(agentId)
  const store = getStore(agentId)
  for (let i = store.length - 1; i >= 0; i--) {
    const block = store[i]
    if (block.type === 'tool' && (block as ToolBlock).toolUseId === toolUseId) {
      return block as ToolBlock
    }
  }
  return null
}

/** Mark the last tool block as inactive if it's still running. Safety net for missing tool:summary. */
function finalizeToolBlock(agentId: string): void {
  const tool = getLastToolBlock(agentId)
  if (tool && tool.active) {
    tool.active = false
    const store = getStore(agentId)
    const idx = store.lastIndexOf(tool)
    if (idx !== -1) notify(agentId, { type: 'block:updated', blockIndex: idx })
  }
}

function finalizeTextBlock(agentId: string): void {
  const open = getOpenTextBlock(agentId)
  if (open) {
    open.streaming = false
    const store = getStore(agentId)
    const idx = store.lastIndexOf(open)
    if (idx !== -1) notify(agentId, { type: 'block:updated', blockIndex: idx })
  }
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
      finalizeToolBlock(agentId)
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
      finalizeTextBlock(agentId)
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
      // If tool:activity already created a block (SDK yields tool_progress before
      // the assistant message), backfill the inputSummary instead of creating a
      // duplicate block.
      const existingTool = findToolBlock(agentId, event.data.toolUseId)
      if (existingTool && !existingTool.inputSummary) {
        existingTool.inputSummary = event.data.inputSummary
        const store = getStore(agentId)
        const idx = store.lastIndexOf(existingTool)
        if (idx !== -1) notify(agentId, { type: 'block:updated', blockIndex: idx })
      } else {
        finalizeToolBlock(agentId)
        appendBlock(agentId, {
          type: 'tool',
          id: blockId(),
          toolUseId: event.data.toolUseId,
          toolName: event.data.toolName,
          inputSummary: event.data.inputSummary,
          active: true,
          elapsedSeconds: 0,
          timestamp: Date.now()
        })
      }
      break
    }

    case 'tool:activity': {
      let tool = findToolBlock(agentId, event.data.toolUseId)
      if (tool && tool.active) {
        tool.elapsedSeconds = event.data.elapsedSeconds
        const store = getStore(agentId)
        const idx = store.lastIndexOf(tool)
        if (idx !== -1) notify(agentId, { type: 'block:updated', blockIndex: idx })
      } else {
        // tool_progress arrived before the assistant message — create the
        // tool block now so the pulse indicator is visible during execution.
        flushMdBuffer(agentId)
        finalizeTextBlock(agentId)
        finalizeToolBlock(agentId)
        appendBlock(agentId, {
          type: 'tool',
          id: blockId(),
          toolUseId: event.data.toolUseId,
          toolName: event.data.toolName,
          inputSummary: '',
          active: true,
          elapsedSeconds: event.data.elapsedSeconds,
          timestamp: Date.now()
        })
      }
      break
    }

    case 'tool:summary': {
      // tool_use_summary may cover multiple tool calls
      const ids = event.data.toolUseIds
      if (ids.length > 0) {
        const store = getStore(agentId)
        for (const tuId of ids) {
          const tool = findToolBlock(agentId, tuId)
          if (tool) {
            tool.summary = event.data.summary
            tool.active = false
            const idx = store.lastIndexOf(tool)
            if (idx !== -1) notify(agentId, { type: 'block:updated', blockIndex: idx })
          }
        }
      } else {
        // Fallback: no IDs available, use last tool block
        const tool = getLastToolBlock(agentId)
        if (tool) {
          tool.summary = event.data.summary
          tool.active = false
          const store = getStore(agentId)
          const idx = store.lastIndexOf(tool)
          if (idx !== -1) notify(agentId, { type: 'block:updated', blockIndex: idx })
        }
      }
      break
    }

    case 'tool:result': {
      const tool = findToolBlock(agentId, event.data.toolUseId)
      if (tool) {
        tool.result = event.data.result
        const store = getStore(agentId)
        const idx = store.lastIndexOf(tool)
        if (idx !== -1) notify(agentId, { type: 'block:updated', blockIndex: idx })
      }
      break
    }

    case 'session:result': {
      flushMdBuffer(agentId)
      finalizeTextBlock(agentId)
      finalizeToolBlock(agentId)
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
      // Do NOT finalizeToolBlock here — the tool is still running when the
      // assistant message arrives. The tool block is finalized by tool:summary,
      // tool:result, or the next stream:text / tool:start event.
      break
    }

    case 'orchestrator:inject': {
      flushMdBuffer(agentId)
      finalizeTextBlock(agentId)
      finalizeToolBlock(agentId)
      appendBlock(agentId, {
        type: 'orchestrator',
        id: blockId(),
        timestamp: Date.now(),
        variant: event.data.variant,
        content: event.data.content
      })
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
