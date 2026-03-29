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
import { evaluatePermission } from './smart-approval-service'
import type {
  CliDriverState,
  CliDriverEvents,
  CliSessionOptions,
  PermissionRequest,
  PermissionResponse,
  SecurityAlertRequest,
  SecurityAlertResponse,
  UserQuestionRequest,
  UserQuestionResponse,
  SessionResult,
  AssistantContent,
  ToolStartEvent
} from '../shared/cli-driver'

/** Produce a short human-readable summary of a tool's input for terminal display. */
export function summarizeToolInput(toolName: string, input: Record<string, unknown>): string {
  const name = toolName.toLowerCase()

  // File-oriented tools — show the path
  if (input.file_path && typeof input.file_path === 'string') {
    return input.file_path
  }
  if (input.path && typeof input.path === 'string') {
    return input.path
  }

  // Search tools — show the pattern
  if (input.pattern && typeof input.pattern === 'string') {
    return input.pattern
  }

  // Bash — show first 80 chars of the command
  if (name === 'bash' && input.command && typeof input.command === 'string') {
    const cmd = input.command.length > 80 ? input.command.slice(0, 77) + '...' : input.command
    return cmd
  }

  // Agent tool — show the description or prompt start
  if (name === 'agent') {
    if (input.description && typeof input.description === 'string') return input.description
    if (input.prompt && typeof input.prompt === 'string') {
      return input.prompt.length > 60 ? input.prompt.slice(0, 57) + '...' : input.prompt
    }
  }

  // Generic fallback — first string value, truncated
  for (const val of Object.values(input)) {
    if (typeof val === 'string' && val.length > 0) {
      return val.length > 60 ? val.slice(0, 57) + '...' : val
    }
  }
  return ''
}

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
  private pendingSecurityAlerts = new Map<string, Deferred<PermissionResult>>()

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
        settingSources: options.settingSources,
        canUseTool: this.createCanUseToolCallback(options),
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
      // Clean up any pending permissions/alerts that were orphaned (e.g., by abort)
      this.pendingPermissions.clear()
      this.pendingSecurityAlerts.clear()
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

  /** Resolve a pending security alert, unblocking the SDK. */
  respondToSecurityAlert(response: SecurityAlertResponse): void {
    const pending = this.pendingSecurityAlerts.get(response.requestId)
    if (!pending) {
      throw new Error(`No pending security alert: ${response.requestId}`)
    }

    if (response.behavior === 'override') {
      pending.resolve({ behavior: 'allow' })
    } else {
      pending.resolve({ behavior: 'deny', message: 'Dismissed by user (security alert)' })
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

        case 'tool_progress':
          this.emit('tool:activity', {
            toolName: (message as { tool_name?: string }).tool_name ?? 'unknown',
            elapsedSeconds: (message as { elapsed_time_seconds?: number }).elapsed_time_seconds ?? 0
          })
          break

        case 'tool_use_summary':
          this.emit('tool:summary', {
            summary: (message as { summary?: string }).summary ?? ''
          })
          break

        case 'user':
          this.handleUserMessage(message)
          break

        // status, etc. — silently consumed for now
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

    // Emit tool:start for each tool use so the renderer can show what's happening
    for (const tu of toolUses) {
      const startEvent: ToolStartEvent = {
        toolName: tu.toolName,
        inputSummary: summarizeToolInput(tu.toolName, tu.input)
      }
      this.emit('tool:start', startEvent)
    }

    const parsed: AssistantContent = { text, toolUses }
    this.emit('assistant:message', parsed)
  }

  private handleUserMessage(message: SDKMessage & { type: 'user' }): void {
    // Extract tool result text from the user message (contains actual tool output)
    const result = (message as { tool_use_result?: unknown }).tool_use_result
    if (result == null) return

    // The message.message.content may contain tool_result blocks with tool_use_id
    const content = (message as { message?: { content?: unknown[] } }).message?.content
    const contentArr = Array.isArray(content) ? (content as Record<string, unknown>[]) : []
    const toolResultBlock = contentArr.find((block) => block.type === 'tool_result')
    const toolUseId = (toolResultBlock?.tool_use_id as string) ?? ''

    // Flatten the result to a string
    let text: string
    if (typeof result === 'string') {
      text = result
    } else if (Array.isArray(result)) {
      const resultArr = result as Record<string, unknown>[]
      text = resultArr
        .filter((block) => block.type === 'text')
        .map((block) => (typeof block.text === 'string' ? block.text : ''))
        .join('\n')
    } else {
      text = JSON.stringify(result, null, 2)
    }

    if (text.length > 0) {
      this.emit('tool:result', { toolUseId, result: text })
    }
  }

  private createCanUseToolCallback(sessionOptions: CliSessionOptions) {
    return async (
      toolName: string,
      input: Record<string, unknown>,
      options: { signal: AbortSignal; toolUseID: string; title?: string; displayName?: string; description?: string }
    ): Promise<PermissionResult> => {
      const mode = sessionOptions.approvalMode ?? 'never'
      const inputSummary = summarizeToolInput(toolName, input)

      // Auto-approve everything
      if (mode === 'always') {
        this.emit('approval:status', {
          variant: 'auto-approved',
          toolName,
          inputSummary
        })
        return { behavior: 'allow' }
      }

      // Smart LLM-based evaluation
      if (mode === 'smart') {
        try {
          const result = await evaluatePermission({
            toolName,
            toolInput: input,
            worktreePath: sessionOptions.worktreePath,
            currentStepTitle: sessionOptions.currentStepTitle
          })
          if (result.decision === 'yes') {
            this.emit('approval:status', {
              variant: 'smart-approved',
              toolName,
              inputSummary
            })
            return { behavior: 'allow' }
          }
          if (result.decision === 'no') {
            // Genuinely dangerous — halt and show security alert
            const alertRequestId = randomUUID()
            const alertDeferred = createDeferred<PermissionResult>()
            this.pendingSecurityAlerts.set(alertRequestId, alertDeferred)

            this.setState('waiting_permission')

            const alertRequest: SecurityAlertRequest = {
              requestId: alertRequestId,
              toolName,
              toolInput: input,
              toolUseId: options.toolUseID,
              explanation: result.explanation ?? 'This operation was flagged as dangerous.',
              title: options.title,
              description: options.description
            }
            this.emit('security:alert', alertRequest)

            const onAbort = (): void => {
              if (this.pendingSecurityAlerts.has(alertRequestId)) {
                alertDeferred.resolve({ behavior: 'deny', message: 'Aborted' })
              }
            }
            options.signal.addEventListener('abort', onAbort, { once: true })

            const alertResult = await alertDeferred.promise

            options.signal.removeEventListener('abort', onAbort)
            this.pendingSecurityAlerts.delete(alertRequestId)
            if ((this.state as CliDriverState) === 'waiting_permission') {
              this.setState('running')
            }

            return alertResult
          }
          // 'maybe' — fall through to manual approval
        } catch {
          // Defense-in-depth: evaluatePermission catches internally, but guard anyway
        }
      }

      // Manual approval (existing flow)
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
        displayName: options.displayName,
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
