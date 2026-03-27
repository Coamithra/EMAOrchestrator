import { randomUUID } from 'crypto'
import type { UUID } from 'crypto'
import { execFileSync } from 'child_process'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Query, PermissionResult, SDKMessage } from '@anthropic-ai/claude-agent-sdk'

/** Resolve the system-installed claude CLI path once at module load. */
let resolvedClaudePath: string | undefined
function getClaudePath(): string | undefined {
  if (resolvedClaudePath !== undefined) return resolvedClaudePath || undefined
  try {
    resolvedClaudePath = execFileSync(
      process.platform === 'win32' ? 'where' : 'which',
      ['claude'],
      { encoding: 'utf-8' }
    )
      .split('\n')[0]
      .trim()
  } catch {
    resolvedClaudePath = ''
  }
  return resolvedClaudePath || undefined
}
import { TypedEventEmitter } from './typed-emitter'
import type {
  CliDriverState,
  CliDriverEvents,
  CliSessionOptions,
  PermissionRequest,
  PermissionResponse,
  UserQuestionRequest,
  UserQuestionResponse,
  SessionResult,
  AssistantContent
} from '../shared/cli-driver'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/**
 * Wraps the Claude Agent SDK to manage a single CLI session.
 *
 * Emits typed events for message processing, permission requests,
 * user questions, and session lifecycle. The orchestrator (or IPC layer)
 * listens to these events and calls respondToPermission/respondToUserQuestion
 * to unblock the session.
 */
export class CliDriver extends TypedEventEmitter<CliDriverEvents> {
  private state: CliDriverState = 'idle'
  private sessionId: string | null = null
  private abortController: AbortController | null = null
  private queryHandle: Query | null = null

  private pendingPermissions = new Map<string, Deferred<PermissionResult>>()

  /** Start a new CLI session. Resolves when the session completes or errors. */
  async startSession(options: CliSessionOptions): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error(`Cannot start session in state: ${this.state}`)
    }

    this.abortController = new AbortController()
    this.setState('running')

    this.queryHandle = query({
      prompt: options.prompt,
      options: {
        cwd: options.cwd,
        allowedTools: options.allowedTools,
        canUseTool: this.createCanUseToolCallback(),
        abortController: this.abortController,
        resume: options.sessionId,
        model: options.model,
        maxTurns: options.maxTurns,
        systemPrompt: options.systemPrompt,
        includePartialMessages: true,
        pathToClaudeCodeExecutable: getClaudePath()
      }
    })

    try {
      await this.processMessages(this.queryHandle)
    } catch (err) {
      // State may have been set to 'aborted' by abort() during the await.
      // TS narrows this.state to 'idle' from the guard above, but async
      // mutations (abort(), processMessages) can change it — cast to bypass.
      if ((this.state as CliDriverState) !== 'aborted') {
        this.setState('error')
        this.emit('error', err instanceof Error ? err : new Error(String(err)))
      }
    } finally {
      this.queryHandle = null
      this.abortController = null
      // Clean up any pending permissions that were orphaned (e.g., by abort)
      this.pendingPermissions.clear()
    }
  }

  /** Resolve a pending permission request, unblocking the SDK. */
  respondToPermission(response: PermissionResponse): void {
    const pending = this.pendingPermissions.get(response.requestId)
    if (!pending) {
      throw new Error(`No pending permission request: ${response.requestId}`)
    }

    if (response.behavior === 'allow') {
      pending.resolve({ behavior: 'allow', updatedInput: response.updatedInput })
    } else {
      pending.resolve({ behavior: 'deny', message: response.message ?? 'Denied by user' })
    }
  }

  /** Respond to an AskUserQuestion by sending a user message via streamInput. */
  async respondToUserQuestion(response: UserQuestionResponse): Promise<void> {
    if ((this.state as CliDriverState) !== 'waiting_user_input') {
      throw new Error(`Cannot respond to user question in state: ${this.state}`)
    }
    if (!this.queryHandle) {
      throw new Error('No active session')
    }

    const userMessage = {
      type: 'user' as const,
      uuid: randomUUID() as UUID,
      message: {
        role: 'user' as const,
        content: response.answer
      },
      session_id: this.sessionId ?? '',
      parent_tool_use_id: null
    }

    await this.queryHandle.streamInput(
      (async function* () {
        yield userMessage
      })()
    )
    this.setState('running')
  }

  /** Abort the running session. */
  abort(): void {
    if (this.abortController) {
      this.setState('aborted')
      this.abortController.abort()
    }
  }

  getState(): CliDriverState {
    return this.state
  }

  getSessionId(): string | null {
    return this.sessionId
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private setState(newState: CliDriverState): void {
    const prev = this.state
    if (prev === newState) return
    this.state = newState
    this.emit('state:changed', newState, prev)
  }

  private async processMessages(gen: AsyncGenerator<SDKMessage, void>): Promise<void> {
    for await (const message of gen) {
      switch (message.type) {
        case 'system':
          if (message.subtype === 'init') {
            this.sessionId = message.session_id
            this.emit('session:init', {
              sessionId: message.session_id,
              model: message.model,
              tools: message.tools
            })
          }
          break

        case 'stream_event':
          this.handleStreamEvent(message)
          break

        case 'assistant':
          this.handleAssistantMessage(message)
          break

        case 'result': {
          const result: SessionResult = {
            subtype: message.subtype as SessionResult['subtype'],
            sessionId: message.session_id,
            result: 'result' in message ? (message.result as string) : undefined,
            costUsd: message.total_cost_usd,
            numTurns: message.num_turns,
            durationMs: message.duration_ms
          }
          this.setState('completed')
          this.emit('session:result', result)
          break
        }

        // user, status, tool_progress, etc. — silently consumed for now
      }
    }

    // If we finished iterating without a result message (shouldn't happen, but be safe)
    if (this.state === 'running') {
      this.setState('completed')
    }
  }

  private handleStreamEvent(message: SDKMessage & { type: 'stream_event' }): void {
    const event = message.event as Record<string, unknown> | undefined
    if (!event) return

    // Insert a newline before new content blocks so successive text segments
    // (separated by tool calls) don't run together in the terminal.
    if (event.type === 'content_block_start') {
      const contentBlock = event.content_block as Record<string, unknown> | undefined
      if (contentBlock?.type === 'text') {
        this.emit('stream:text', { text: '\n' })
      }
    }

    if (event.type === 'content_block_delta') {
      const delta = event.delta as Record<string, unknown> | undefined
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        this.emit('stream:text', { text: delta.text })
      }
    }
  }

  private handleAssistantMessage(message: SDKMessage & { type: 'assistant' }): void {
    const content = message.message?.content
    if (!Array.isArray(content)) return

    // Check for AskUserQuestion tool use
    const askBlock = content.find(
      (block: { type: string; name?: string }) =>
        block.type === 'tool_use' && block.name === 'AskUserQuestion'
    )

    if (askBlock && askBlock.type === 'tool_use') {
      const input = (askBlock as { input?: Record<string, unknown> }).input ?? {}
      const request: UserQuestionRequest = {
        requestId: randomUUID(),
        question: typeof input.question === 'string' ? input.question : JSON.stringify(input),
        toolUseId: (askBlock as { id: string }).id
      }
      this.setState('waiting_user_input')
      this.emit('user:question', request)
      return
    }

    // Normal assistant message — extract text and tool uses
    const text = content
      .filter((block: { type: string }) => block.type === 'text')
      .map((block: { text?: string }) => block.text ?? '')
      .join('')

    const toolUses = content
      .filter((block: { type: string }) => block.type === 'tool_use')
      .map((block: { name?: string; input?: Record<string, unknown> }) => ({
        toolName: block.name ?? 'unknown',
        input: block.input ?? {}
      }))

    const parsed: AssistantContent = { text, toolUses }
    this.emit('assistant:message', parsed)
  }

  private createCanUseToolCallback() {
    return async (
      toolName: string,
      input: Record<string, unknown>,
      options: { signal: AbortSignal; toolUseID: string; title?: string; description?: string }
    ): Promise<PermissionResult> => {
      const requestId = randomUUID()
      const deferred = createDeferred<PermissionResult>()
      this.pendingPermissions.set(requestId, deferred)

      this.setState('waiting_permission')

      const request: PermissionRequest = {
        requestId,
        toolName,
        toolInput: input,
        toolUseId: options.toolUseID,
        title: options.title,
        description: options.description
      }
      this.emit('permission:request', request)

      // If the SDK aborts this tool call, auto-deny and clean up
      const onAbort = (): void => {
        if (this.pendingPermissions.has(requestId)) {
          deferred.resolve({ behavior: 'deny', message: 'Aborted' })
        }
      }
      options.signal.addEventListener('abort', onAbort, { once: true })

      // Block until respondToPermission() is called or signal aborts
      const result = await deferred.promise

      options.signal.removeEventListener('abort', onAbort)
      this.pendingPermissions.delete(requestId)
      if ((this.state as CliDriverState) === 'waiting_permission') {
        this.setState('running')
      }

      return result
    }
  }
}
