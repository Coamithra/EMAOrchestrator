import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Runbook } from '../../shared/runbook'
import type { CardInfo } from '../../shared/agent-manager'
import type { WorktreeInfo } from '../../shared/worktree'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock CliDriver to avoid real SDK calls
const mockStartSession = vi.hoisted(() => vi.fn())
const mockAbort = vi.hoisted(() => vi.fn())
const mockRespondToPermission = vi.hoisted(() => vi.fn())
const mockRespondToUserQuestion = vi.hoisted(() => vi.fn())

vi.mock('../cli-driver', async () => {
  const { TypedEventEmitter } = await import('../typed-emitter')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  class MockCliDriver extends TypedEventEmitter<any> {
    startSession = mockStartSession
    abort = mockAbort
    respondToPermission = mockRespondToPermission
    respondToUserQuestion = mockRespondToUserQuestion
    getState = vi.fn().mockReturnValue('idle')
    getSessionId = vi.fn().mockReturnValue(null)
  }

  return { CliDriver: MockCliDriver }
})

// Mock BrowserWindow to prevent Electron errors
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn().mockReturnValue([])
  }
}))

// Mock worktree and persistence (used by AgentManager)
const mockCreateWorktree = vi.hoisted(() => vi.fn())
const mockRemoveWorktree = vi.hoisted(() => vi.fn())
const mockSaveAgent = vi.hoisted(() => vi.fn())
const mockRemovePersistedAgent = vi.hoisted(() => vi.fn())

vi.mock('../worktree-manager', () => ({
  createWorktree: mockCreateWorktree,
  removeWorktree: mockRemoveWorktree
}))

vi.mock('../agent-persistence-service', () => ({
  saveAgent: mockSaveAgent,
  removePersistedAgent: mockRemovePersistedAgent
}))

import { AgentManager } from '../agent-manager'
import { OrchestrationLoop } from '../orchestration-loop'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const twoPhaseRunbook: Runbook = {
  phases: [
    {
      name: 'Research',
      steps: [
        { phase: 'Research', index: 1, title: 'Read the code', description: 'Read files' },
        { phase: 'Research', index: 2, title: 'Trace calls', description: 'Follow the chain' }
      ]
    },
    {
      name: 'Implement',
      steps: [{ phase: 'Implement', index: 1, title: 'Write code', description: 'Make changes' }]
    }
  ]
}

const testCard: CardInfo = {
  id: 'card-123',
  name: '#013 Orchestration loop',
  description: 'The main loop'
}

function fakeWorktree(branch: string): WorktreeInfo {
  return { path: `C:/Proj/${branch}`, branch, isMain: false }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create an AgentManager with an agent ready to go. */
async function setupAgent(): Promise<{ manager: AgentManager; agentId: string }> {
  const manager = new AgentManager()
  mockCreateWorktree.mockResolvedValue(fakeWorktree('feat-orchestration-loop'))
  mockSaveAgent.mockResolvedValue(undefined)
  const agentId = await manager.createAgent(testCard, twoPhaseRunbook, 'C:/Proj/main')
  return { manager, agentId }
}

/**
 * Make mockStartSession simulate a successful session.
 * The mock emits events on the driver instance when startSession is called.
 */
function mockSuccessfulSession(): void {
  mockStartSession.mockImplementation(async function (this: {
    emit: (event: string, ...args: unknown[]) => void
  }) {
    // Simulate session:init
    this.emit('session:init', {
      sessionId: 'sdk-session-1',
      model: 'claude-opus-4-6',
      tools: []
    })
    // Simulate assistant message
    this.emit('assistant:message', {
      text: 'Step completed successfully.',
      toolUses: []
    })
    // Simulate session result
    this.emit('session:result', {
      subtype: 'success',
      sessionId: 'sdk-session-1',
      costUsd: 0.01,
      numTurns: 1,
      durationMs: 1000
    })
  })
}

function mockErrorSession(errorMessage: string): void {
  mockStartSession.mockImplementation(async function (this: {
    emit: (event: string, ...args: unknown[]) => void
  }) {
    this.emit('error', new Error(errorMessage))
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrchestrationLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('startAgent', () => {
    it('throws if agent is unknown', async () => {
      const manager = new AgentManager()
      const loop = new OrchestrationLoop(manager)
      expect(() => loop.startAgent('nonexistent')).toThrow('Unknown agent')
    })

    it('throws if agent is already running', async () => {
      const { manager, agentId } = await setupAgent()
      const loop = new OrchestrationLoop(manager)

      // Make startSession hang so the agent stays "running"
      mockStartSession.mockImplementation(() => new Promise(() => {}))

      loop.startAgent(agentId)
      expect(() => loop.startAgent(agentId)).toThrow('already running')
    })

    it('drives agent through all steps to completion', async () => {
      const { manager, agentId } = await setupAgent()
      const loop = new OrchestrationLoop(manager)

      mockSuccessfulSession()

      const completed = new Promise<string>((resolve) => {
        loop.on('agent:completed', (id) => resolve(id))
      })

      loop.startAgent(agentId)
      const completedId = await completed

      expect(completedId).toBe(agentId)

      // Agent should be in done state
      const agent = manager.getAgent(agentId)
      expect(agent?.stateSnapshot.state).toBe('done')

      // All 3 steps should have been executed (2 Research + 1 Implement)
      expect(mockStartSession).toHaveBeenCalledTimes(3)
    })

    it('transitions from idle through picking_card to first phase', async () => {
      const { manager, agentId } = await setupAgent()
      const loop = new OrchestrationLoop(manager)

      const stateChanges: string[] = []
      manager.on('agent:state-changed', (_id, snapshot) => {
        stateChanges.push(snapshot.state)
      })

      mockSuccessfulSession()

      const completed = new Promise<void>((resolve) => {
        loop.on('agent:completed', () => resolve())
      })

      loop.startAgent(agentId)
      await completed

      // Should have transitioned through: picking_card → Research → Implement → done
      expect(stateChanges).toContain('picking_card')
      expect(stateChanges).toContain('Research')
      expect(stateChanges).toContain('Implement')
      expect(stateChanges).toContain('done')
    })

    it('sets step summaries after each step', async () => {
      const { manager, agentId } = await setupAgent()
      const loop = new OrchestrationLoop(manager)

      mockSuccessfulSession()

      const completed = new Promise<void>((resolve) => {
        loop.on('agent:completed', () => resolve())
      })

      loop.startAgent(agentId)
      await completed

      const agent = manager.getAgent(agentId)
      expect(agent?.stepHistory.length).toBe(3)
      // Each step should have a summary set
      for (const record of agent?.stepHistory ?? []) {
        expect(record.summary).toBeDefined()
      }
    })
  })

  describe('error handling', () => {
    it('sets error state on CLI session failure', async () => {
      const { manager, agentId } = await setupAgent()
      const loop = new OrchestrationLoop(manager)

      mockErrorSession('SDK connection failed')

      const errored = new Promise<string>((resolve) => {
        loop.on('agent:errored', (_id, msg) => resolve(msg))
      })

      loop.startAgent(agentId)
      const errorMsg = await errored

      expect(errorMsg).toBe('SDK connection failed')

      const agent = manager.getAgent(agentId)
      expect(agent?.stateSnapshot.state).toBe('error')
    })

    it('sets error state on non-success session result', async () => {
      const { manager, agentId } = await setupAgent()
      const loop = new OrchestrationLoop(manager)

      mockStartSession.mockImplementation(async function (this: {
        emit: (event: string, ...args: unknown[]) => void
      }) {
        this.emit('session:result', {
          subtype: 'error_max_turns',
          sessionId: 'sdk-1',
          costUsd: 0.5,
          numTurns: 100,
          durationMs: 60000
        })
      })

      const errored = new Promise<void>((resolve) => {
        loop.on('agent:errored', () => resolve())
      })

      loop.startAgent(agentId)
      await errored

      const agent = manager.getAgent(agentId)
      expect(agent?.stateSnapshot.state).toBe('error')
    })
  })

  describe('stopAgent', () => {
    it('aborts the active CLI session', async () => {
      const { manager, agentId } = await setupAgent()
      const loop = new OrchestrationLoop(manager)

      // Make session hang
      mockStartSession.mockImplementation(() => new Promise(() => {}))

      loop.startAgent(agentId)
      expect(loop.isRunning(agentId)).toBe(true)

      const stopped = new Promise<string>((resolve) => {
        loop.on('agent:stopped', (id) => resolve(id))
      })

      loop.stopAgent(agentId)
      const stoppedId = await stopped

      expect(stoppedId).toBe(agentId)
      expect(loop.isRunning(agentId)).toBe(false)
      expect(mockAbort).toHaveBeenCalled()
    })

    it('is a no-op for non-running agents', async () => {
      const { manager, agentId } = await setupAgent()
      const loop = new OrchestrationLoop(manager)
      // Should not throw
      loop.stopAgent(agentId)
    })
  })

  describe('abortAll', () => {
    it('stops all running agents', async () => {
      const { manager, agentId } = await setupAgent()
      const loop = new OrchestrationLoop(manager)

      mockStartSession.mockImplementation(() => new Promise(() => {}))
      loop.startAgent(agentId)

      loop.abortAll()

      expect(loop.isRunning(agentId)).toBe(false)
      expect(mockAbort).toHaveBeenCalled()
    })
  })

  describe('isRunning', () => {
    it('returns false for unknown agents', () => {
      const manager = new AgentManager()
      const loop = new OrchestrationLoop(manager)
      expect(loop.isRunning('nonexistent')).toBe(false)
    })
  })
})
