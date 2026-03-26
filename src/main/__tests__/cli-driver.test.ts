import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type {
  CliDriverState,
  PermissionRequest,
  SessionInfo,
  SessionResult,
  StreamTextDelta,
  AssistantContent,
  UserQuestionRequest
} from '../../shared/cli-driver'

let mockMessages: SDKMessage[] = []

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(() => {
    // Return an AsyncGenerator that yields mockMessages
    const messages = [...mockMessages]
    const gen = (async function* () {
      for (const msg of messages) {
        yield msg
      }
    })()
    // Add Query interface methods
    return Object.assign(gen, {
      interrupt: vi.fn(),
      close: vi.fn(),
      streamInput: vi.fn(),
      setPermissionMode: vi.fn(),
      setModel: vi.fn(),
      setMaxThinkingTokens: vi.fn(),
      initializationResult: vi.fn(),
      supportedCommands: vi.fn(),
      supportedModels: vi.fn(),
      supportedAgents: vi.fn(),
      mcpServerStatus: vi.fn(),
      accountInfo: vi.fn(),
      rewindFiles: vi.fn(),
      seedReadState: vi.fn(),
      reconnectMcpServer: vi.fn(),
      toggleMcpServer: vi.fn(),
      setMcpServers: vi.fn(),
      stopTask: vi.fn(),
      applyFlagSettings: vi.fn()
    })
  })
}))

// Import after mocking
import { CliDriver } from '../cli-driver'

// Helper to build SDK messages
function systemInitMessage(overrides?: Partial<SDKMessage>): SDKMessage {
  return {
    type: 'system',
    subtype: 'init',
    session_id: 'test-session-123',
    model: 'claude-sonnet-4-6',
    tools: ['Read', 'Edit', 'Bash'],
    mcp_servers: [],
    apiKeySource: 'user',
    claude_code_version: '1.0.0',
    cwd: '/test',
    permissionMode: 'default',
    slash_commands: [],
    output_style: 'concise',
    skills: [],
    plugins: [],
    uuid: '00000000-0000-0000-0000-000000000001' as `${string}-${string}-${string}-${string}-${string}`,
    ...overrides
  } as SDKMessage
}

function resultMessage(subtype: 'success' | 'error_during_execution' = 'success'): SDKMessage {
  return {
    type: 'result',
    subtype,
    session_id: 'test-session-123',
    result: 'Done.',
    is_error: subtype !== 'success',
    duration_ms: 5000,
    duration_api_ms: 4000,
    num_turns: 2,
    total_cost_usd: 0.05,
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      server_tool_use_input_tokens: 0
    },
    modelUsage: {},
    permission_denials: [],
    uuid: '00000000-0000-0000-0000-000000000002' as `${string}-${string}-${string}-${string}-${string}`
  } as unknown as SDKMessage
}

function streamEventMessage(text: string): SDKMessage {
  return {
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text }
    },
    parent_tool_use_id: null,
    uuid: '00000000-0000-0000-0000-000000000003' as `${string}-${string}-${string}-${string}-${string}`,
    session_id: 'test-session-123'
  } as unknown as SDKMessage
}

function assistantMessage(textContent: string): SDKMessage {
  return {
    type: 'assistant',
    message: {
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: textContent }],
      model: 'claude-sonnet-4-6',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 }
    },
    parent_tool_use_id: null,
    uuid: '00000000-0000-0000-0000-000000000004' as `${string}-${string}-${string}-${string}-${string}`,
    session_id: 'test-session-123'
  } as unknown as SDKMessage
}

function askUserQuestionMessage(): SDKMessage {
  return {
    type: 'assistant',
    message: {
      id: 'msg_456',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_ask_1',
          name: 'AskUserQuestion',
          input: { question: 'Which approach do you prefer?' }
        }
      ],
      model: 'claude-sonnet-4-6',
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 20 }
    },
    parent_tool_use_id: null,
    uuid: '00000000-0000-0000-0000-000000000005' as `${string}-${string}-${string}-${string}-${string}`,
    session_id: 'test-session-123'
  } as unknown as SDKMessage
}

describe('CliDriver', () => {
  let driver: CliDriver

  beforeEach(() => {
    driver = new CliDriver()
    mockMessages = []
  })

  describe('startSession', () => {
    it('transitions idle → running → completed on success', async () => {
      const states: CliDriverState[] = []
      driver.on('state:changed', (s) => states.push(s))

      mockMessages = [systemInitMessage(), resultMessage()]

      await driver.startSession({ prompt: 'Hello', cwd: '/test' })

      expect(states).toEqual(['running', 'completed'])
      expect(driver.getState()).toBe('completed')
    })

    it('throws if not idle', async () => {
      mockMessages = [systemInitMessage(), resultMessage()]

      // Start a session so state changes from idle
      const p = driver.startSession({ prompt: 'Hello', cwd: '/test' })

      await expect(driver.startSession({ prompt: 'Again', cwd: '/test' })).rejects.toThrow(
        'Cannot start session in state'
      )

      await p
    })

    it('emits session:init with session metadata', async () => {
      const inits: SessionInfo[] = []
      driver.on('session:init', (info) => inits.push(info))

      mockMessages = [systemInitMessage(), resultMessage()]

      await driver.startSession({ prompt: 'Hello', cwd: '/test' })

      expect(inits).toHaveLength(1)
      expect(inits[0]).toEqual({
        sessionId: 'test-session-123',
        model: 'claude-sonnet-4-6',
        tools: ['Read', 'Edit', 'Bash']
      })
    })

    it('stores session ID', async () => {
      mockMessages = [systemInitMessage(), resultMessage()]

      await driver.startSession({ prompt: 'Hello', cwd: '/test' })

      expect(driver.getSessionId()).toBe('test-session-123')
    })

    it('emits session:result on completion', async () => {
      const results: SessionResult[] = []
      driver.on('session:result', (r) => results.push(r))

      mockMessages = [systemInitMessage(), resultMessage()]

      await driver.startSession({ prompt: 'Hello', cwd: '/test' })

      expect(results).toHaveLength(1)
      expect(results[0].subtype).toBe('success')
      expect(results[0].costUsd).toBe(0.05)
      expect(results[0].numTurns).toBe(2)
    })

    it('transitions to error state on generator throw', async () => {
      const errors: Error[] = []
      driver.on('error', (e) => errors.push(e))

      // Override mock to throw
      const { query: mockQuery } = await import('@anthropic-ai/claude-agent-sdk')
      vi.mocked(mockQuery).mockImplementationOnce(() => {
        // eslint-disable-next-line require-yield
        const gen = (async function* () {
          throw new Error('SDK crash')
        })()
        return Object.assign(gen, {
          interrupt: vi.fn(),
          close: vi.fn(),
          streamInput: vi.fn(),
          setPermissionMode: vi.fn(),
          setModel: vi.fn(),
          setMaxThinkingTokens: vi.fn(),
          initializationResult: vi.fn(),
          supportedCommands: vi.fn(),
          supportedModels: vi.fn(),
          supportedAgents: vi.fn(),
          mcpServerStatus: vi.fn(),
          accountInfo: vi.fn(),
          rewindFiles: vi.fn(),
          seedReadState: vi.fn(),
          reconnectMcpServer: vi.fn(),
          toggleMcpServer: vi.fn(),
          setMcpServers: vi.fn(),
          stopTask: vi.fn(),
          applyFlagSettings: vi.fn()
        })
      })

      await driver.startSession({ prompt: 'Fail', cwd: '/test' })

      expect(driver.getState()).toBe('error')
      expect(errors).toHaveLength(1)
      expect(errors[0].message).toBe('SDK crash')
    })
  })

  describe('stream events', () => {
    it('emits stream:text for text deltas', async () => {
      const deltas: StreamTextDelta[] = []
      driver.on('stream:text', (d) => deltas.push(d))

      mockMessages = [
        systemInitMessage(),
        streamEventMessage('Hello '),
        streamEventMessage('world'),
        resultMessage()
      ]

      await driver.startSession({ prompt: 'Hello', cwd: '/test' })

      expect(deltas).toHaveLength(2)
      expect(deltas[0].text).toBe('Hello ')
      expect(deltas[1].text).toBe('world')
    })
  })

  describe('assistant messages', () => {
    it('emits assistant:message with parsed content', async () => {
      const messages: AssistantContent[] = []
      driver.on('assistant:message', (m) => messages.push(m))

      mockMessages = [systemInitMessage(), assistantMessage('Hello from Claude'), resultMessage()]

      await driver.startSession({ prompt: 'Hello', cwd: '/test' })

      expect(messages).toHaveLength(1)
      expect(messages[0].text).toBe('Hello from Claude')
      expect(messages[0].toolUses).toEqual([])
    })
  })

  describe('permission handling', () => {
    it('pauses on canUseTool and resumes on allow', async () => {
      const states: CliDriverState[] = []
      const permRequests: PermissionRequest[] = []

      driver.on('state:changed', (s) => states.push(s))
      driver.on('permission:request', (r) => {
        permRequests.push(r)
        // Respond immediately with allow
        driver.respondToPermission({ requestId: r.requestId, behavior: 'allow' })
      })

      // Need a mock that calls canUseTool during iteration
      const { query: mockQuery } = await import('@anthropic-ai/claude-agent-sdk')
      vi.mocked(mockQuery).mockImplementationOnce(({ options }) => {
        const canUseTool = options?.canUseTool
        const gen = (async function* () {
          yield systemInitMessage()
          // Simulate SDK calling canUseTool
          if (canUseTool) {
            await canUseTool(
              'Bash',
              { command: 'ls' },
              {
                signal: new AbortController().signal,
                toolUseID: 'tool_1'
              }
            )
          }
          yield resultMessage()
        })()
        return Object.assign(gen, {
          interrupt: vi.fn(),
          close: vi.fn(),
          streamInput: vi.fn(),
          setPermissionMode: vi.fn(),
          setModel: vi.fn(),
          setMaxThinkingTokens: vi.fn(),
          initializationResult: vi.fn(),
          supportedCommands: vi.fn(),
          supportedModels: vi.fn(),
          supportedAgents: vi.fn(),
          mcpServerStatus: vi.fn(),
          accountInfo: vi.fn(),
          rewindFiles: vi.fn(),
          seedReadState: vi.fn(),
          reconnectMcpServer: vi.fn(),
          toggleMcpServer: vi.fn(),
          setMcpServers: vi.fn(),
          stopTask: vi.fn(),
          applyFlagSettings: vi.fn()
        })
      })

      await driver.startSession({ prompt: 'Run ls', cwd: '/test' })

      expect(permRequests).toHaveLength(1)
      expect(permRequests[0].toolName).toBe('Bash')
      expect(permRequests[0].toolInput).toEqual({ command: 'ls' })
      // Should have gone through: running → waiting_permission → running → completed
      expect(states).toContain('waiting_permission')
      expect(driver.getState()).toBe('completed')
    })

    it('passes deny result back to SDK', async () => {
      let sdkResult: { behavior: string; message?: string } | null = null

      driver.on('permission:request', (r) => {
        driver.respondToPermission({
          requestId: r.requestId,
          behavior: 'deny',
          message: 'Not allowed'
        })
      })

      const { query: mockQuery } = await import('@anthropic-ai/claude-agent-sdk')
      vi.mocked(mockQuery).mockImplementationOnce(({ options }) => {
        const canUseTool = options?.canUseTool
        const gen = (async function* () {
          yield systemInitMessage()
          if (canUseTool) {
            sdkResult = await canUseTool(
              'Bash',
              { command: 'rm -rf /' },
              {
                signal: new AbortController().signal,
                toolUseID: 'tool_2'
              }
            )
          }
          yield resultMessage()
        })()
        return Object.assign(gen, {
          interrupt: vi.fn(),
          close: vi.fn(),
          streamInput: vi.fn(),
          setPermissionMode: vi.fn(),
          setModel: vi.fn(),
          setMaxThinkingTokens: vi.fn(),
          initializationResult: vi.fn(),
          supportedCommands: vi.fn(),
          supportedModels: vi.fn(),
          supportedAgents: vi.fn(),
          mcpServerStatus: vi.fn(),
          accountInfo: vi.fn(),
          rewindFiles: vi.fn(),
          seedReadState: vi.fn(),
          reconnectMcpServer: vi.fn(),
          toggleMcpServer: vi.fn(),
          setMcpServers: vi.fn(),
          stopTask: vi.fn(),
          applyFlagSettings: vi.fn()
        })
      })

      await driver.startSession({ prompt: 'Danger', cwd: '/test' })

      expect(sdkResult).toEqual({ behavior: 'deny', message: 'Not allowed' })
    })

    it('throws for unknown requestId', () => {
      expect(() =>
        driver.respondToPermission({ requestId: 'nonexistent', behavior: 'allow' })
      ).toThrow('No pending permission request')
    })
  })

  describe('AskUserQuestion', () => {
    it('detects AskUserQuestion and emits user:question', async () => {
      const questions: UserQuestionRequest[] = []
      driver.on('user:question', (q) => questions.push(q))

      mockMessages = [systemInitMessage(), askUserQuestionMessage(), resultMessage()]

      await driver.startSession({ prompt: 'Decide', cwd: '/test' })

      expect(questions).toHaveLength(1)
      expect(questions[0].question).toBe('Which approach do you prefer?')
      expect(questions[0].toolUseId).toBe('toolu_ask_1')
      expect(driver.getState()).toBe('completed')
    })

    it('transitions to waiting_user_input state', async () => {
      const states: CliDriverState[] = []
      driver.on('state:changed', (s) => states.push(s))

      mockMessages = [systemInitMessage(), askUserQuestionMessage(), resultMessage()]

      await driver.startSession({ prompt: 'Decide', cwd: '/test' })

      expect(states).toContain('waiting_user_input')
    })
  })

  describe('abort', () => {
    it('transitions to aborted state', async () => {
      const states: CliDriverState[] = []
      driver.on('state:changed', (s) => states.push(s))

      const { query: mockQuery } = await import('@anthropic-ai/claude-agent-sdk')
      vi.mocked(mockQuery).mockImplementationOnce(({ options }) => {
        const gen = (async function* () {
          yield systemInitMessage()
          // Simulate long-running — abort will fire during this
          await new Promise((resolve) => setTimeout(resolve, 100))
          // Check if aborted
          options?.abortController?.signal.throwIfAborted()
          yield resultMessage()
        })()
        return Object.assign(gen, {
          interrupt: vi.fn(),
          close: vi.fn(),
          streamInput: vi.fn(),
          setPermissionMode: vi.fn(),
          setModel: vi.fn(),
          setMaxThinkingTokens: vi.fn(),
          initializationResult: vi.fn(),
          supportedCommands: vi.fn(),
          supportedModels: vi.fn(),
          supportedAgents: vi.fn(),
          mcpServerStatus: vi.fn(),
          accountInfo: vi.fn(),
          rewindFiles: vi.fn(),
          seedReadState: vi.fn(),
          reconnectMcpServer: vi.fn(),
          toggleMcpServer: vi.fn(),
          setMcpServers: vi.fn(),
          stopTask: vi.fn(),
          applyFlagSettings: vi.fn()
        })
      })

      const sessionPromise = driver.startSession({ prompt: 'Long task', cwd: '/test' })

      // Abort after a tick
      await new Promise((resolve) => setTimeout(resolve, 10))
      driver.abort()

      await sessionPromise

      expect(driver.getState()).toBe('aborted')
      expect(states).toContain('aborted')
    })

    it('does not emit error event when aborted', async () => {
      const errors: Error[] = []
      driver.on('error', (e) => errors.push(e))

      const { query: mockQuery } = await import('@anthropic-ai/claude-agent-sdk')
      vi.mocked(mockQuery).mockImplementationOnce(({ options }) => {
        const gen = (async function* () {
          yield systemInitMessage()
          await new Promise((resolve) => setTimeout(resolve, 100))
          options?.abortController?.signal.throwIfAborted()
          yield resultMessage()
        })()
        return Object.assign(gen, {
          interrupt: vi.fn(),
          close: vi.fn(),
          streamInput: vi.fn(),
          setPermissionMode: vi.fn(),
          setModel: vi.fn(),
          setMaxThinkingTokens: vi.fn(),
          initializationResult: vi.fn(),
          supportedCommands: vi.fn(),
          supportedModels: vi.fn(),
          supportedAgents: vi.fn(),
          mcpServerStatus: vi.fn(),
          accountInfo: vi.fn(),
          rewindFiles: vi.fn(),
          seedReadState: vi.fn(),
          reconnectMcpServer: vi.fn(),
          toggleMcpServer: vi.fn(),
          setMcpServers: vi.fn(),
          stopTask: vi.fn(),
          applyFlagSettings: vi.fn()
        })
      })

      const sessionPromise = driver.startSession({ prompt: 'Long task', cwd: '/test' })
      await new Promise((resolve) => setTimeout(resolve, 10))
      driver.abort()
      await sessionPromise

      expect(errors).toHaveLength(0)
    })
  })
})
