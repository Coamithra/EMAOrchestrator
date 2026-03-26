import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Runbook } from '../../shared/runbook'
import type { CardInfo, AgentSnapshot } from '../../shared/agent-manager'
import type { AgentStepProgress, AgentStateSnapshot } from '../../shared/agent-state'
import type { WorktreeInfo } from '../../shared/worktree'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCreateWorktree = vi.hoisted(() => vi.fn())
const mockRemoveWorktree = vi.hoisted(() => vi.fn())

vi.mock('../worktree-manager', () => ({
  createWorktree: mockCreateWorktree,
  removeWorktree: mockRemoveWorktree
}))

import { AgentManager } from '../agent-manager'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const twoPhaseRunbook: Runbook = {
  phases: [
    {
      name: 'Research',
      steps: [
        { phase: 'Research', index: 1, title: 'Read the code', description: '' },
        { phase: 'Research', index: 2, title: 'Trace the call chain', description: '' }
      ]
    },
    {
      name: 'Implement',
      steps: [{ phase: 'Implement', index: 1, title: 'Write the code', description: '' }]
    }
  ]
}

const testCard: CardInfo = {
  id: 'card-123',
  name: '#011 Agent manager',
  description: 'Central registry for agents'
}

const repoPath = 'C:/Proj/main'

function fakeWorktree(branch: string): WorktreeInfo {
  return { path: `C:/Proj/${branch}`, branch, isMain: false }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockCreateWorktree.mockImplementation((_repo: string, branch: string) =>
    Promise.resolve(fakeWorktree(branch))
  )
  mockRemoveWorktree.mockResolvedValue(undefined)
})

describe('AgentManager', () => {
  describe('createAgent', () => {
    it('creates an agent and returns an id', async () => {
      const mgr = new AgentManager()
      const id = await mgr.createAgent(testCard, twoPhaseRunbook, repoPath)

      expect(id).toBeTruthy()
      expect(typeof id).toBe('string')
      expect(mgr.size).toBe(1)
    })

    it('creates a worktree with a branch name derived from the card', async () => {
      const mgr = new AgentManager()
      await mgr.createAgent(testCard, twoPhaseRunbook, repoPath)

      expect(mockCreateWorktree).toHaveBeenCalledWith(repoPath, 'feat-agent-manager')
    })

    it('emits agent:created with a snapshot', async () => {
      const mgr = new AgentManager()
      const handler = vi.fn()
      mgr.on('agent:created', handler)

      const id = await mgr.createAgent(testCard, twoPhaseRunbook, repoPath)

      expect(handler).toHaveBeenCalledOnce()
      const snapshot: AgentSnapshot = handler.mock.calls[0][0]
      expect(snapshot.id).toBe(id)
      expect(snapshot.card).toEqual(testCard)
      expect(snapshot.worktree.branch).toBe('feat-agent-manager')
      expect(snapshot.stateSnapshot.state).toBe('idle')
      expect(snapshot.sessionId).toBeNull()
    })

    it('can create multiple agents', async () => {
      const mgr = new AgentManager()
      const card2: CardInfo = { id: 'card-456', name: '#012 State persistence', description: '' }

      const id1 = await mgr.createAgent(testCard, twoPhaseRunbook, repoPath)
      const id2 = await mgr.createAgent(card2, twoPhaseRunbook, repoPath)

      expect(id1).not.toBe(id2)
      expect(mgr.size).toBe(2)
    })

    it('derives branch name from various card name formats', async () => {
      const mgr = new AgentManager()

      await mgr.createAgent(
        { id: '1', name: '#005 CLI driver', description: '' },
        twoPhaseRunbook,
        repoPath
      )
      expect(mockCreateWorktree).toHaveBeenCalledWith(repoPath, 'feat-cli-driver')

      mockCreateWorktree.mockClear()
      await mgr.createAgent(
        { id: '2', name: '#021 Error handling & recovery', description: '' },
        twoPhaseRunbook,
        repoPath
      )
      expect(mockCreateWorktree).toHaveBeenCalledWith(repoPath, 'feat-error-handling-recovery')
    })

    it('handles card names without a number prefix', async () => {
      const mgr = new AgentManager()
      await mgr.createAgent(
        { id: '1', name: 'Agent manager', description: '' },
        twoPhaseRunbook,
        repoPath
      )
      expect(mockCreateWorktree).toHaveBeenCalledWith(repoPath, 'feat-agent-manager')
    })

    it('does not register agent if worktree creation fails', async () => {
      mockCreateWorktree.mockRejectedValueOnce(new Error('directory exists'))
      const mgr = new AgentManager()

      await expect(mgr.createAgent(testCard, twoPhaseRunbook, repoPath)).rejects.toThrow(
        'directory exists'
      )
      expect(mgr.size).toBe(0)
    })

    it('rolls back worktree if state machine constructor throws', async () => {
      const badRunbook: Runbook = { phases: [] }
      const mgr = new AgentManager()

      await expect(mgr.createAgent(testCard, badRunbook, repoPath)).rejects.toThrow(
        'at least one phase'
      )
      expect(mgr.size).toBe(0)
      expect(mockRemoveWorktree).toHaveBeenCalledOnce()
    })
  })

  describe('getAgent', () => {
    it('returns a snapshot for an existing agent', async () => {
      const mgr = new AgentManager()
      const id = await mgr.createAgent(testCard, twoPhaseRunbook, repoPath)

      const snapshot = mgr.getAgent(id)
      expect(snapshot).not.toBeNull()
      expect(snapshot!.id).toBe(id)
      expect(snapshot!.card.name).toBe('#011 Agent manager')
    })

    it('returns null for an unknown agent', () => {
      const mgr = new AgentManager()
      expect(mgr.getAgent('nonexistent')).toBeNull()
    })
  })

  describe('listAgents', () => {
    it('returns empty array when no agents exist', () => {
      const mgr = new AgentManager()
      expect(mgr.listAgents()).toEqual([])
    })

    it('returns snapshots of all agents', async () => {
      const mgr = new AgentManager()
      await mgr.createAgent(testCard, twoPhaseRunbook, repoPath)
      await mgr.createAgent(
        { id: 'c2', name: '#012 State persistence', description: '' },
        twoPhaseRunbook,
        repoPath
      )

      const list = mgr.listAgents()
      expect(list).toHaveLength(2)
      expect(list.map((s) => s.card.name)).toContain('#011 Agent manager')
      expect(list.map((s) => s.card.name)).toContain('#012 State persistence')
    })
  })

  describe('destroyAgent', () => {
    it('removes the agent and cleans up the worktree', async () => {
      const mgr = new AgentManager()
      const id = await mgr.createAgent(testCard, twoPhaseRunbook, repoPath)
      expect(mgr.size).toBe(1)

      await mgr.destroyAgent(id, repoPath)

      expect(mgr.size).toBe(0)
      expect(mgr.getAgent(id)).toBeNull()
      expect(mockRemoveWorktree).toHaveBeenCalledOnce()
    })

    it('emits agent:destroyed', async () => {
      const mgr = new AgentManager()
      const handler = vi.fn()
      mgr.on('agent:destroyed', handler)

      const id = await mgr.createAgent(testCard, twoPhaseRunbook, repoPath)
      await mgr.destroyAgent(id, repoPath)

      expect(handler).toHaveBeenCalledWith(id)
    })

    it('throws for unknown agent', async () => {
      const mgr = new AgentManager()
      await expect(mgr.destroyAgent('nonexistent', repoPath)).rejects.toThrow('Unknown agent')
    })

    it('succeeds even if worktree removal fails', async () => {
      mockRemoveWorktree.mockRejectedValueOnce(new Error('already gone'))
      const mgr = new AgentManager()
      const id = await mgr.createAgent(testCard, twoPhaseRunbook, repoPath)

      await mgr.destroyAgent(id, repoPath)
      expect(mgr.size).toBe(0)
    })

    it('stops forwarding state machine events after destroy', async () => {
      const mgr = new AgentManager()
      const id = await mgr.createAgent(testCard, twoPhaseRunbook, repoPath)
      const sm = mgr.getStateMachine(id)!

      await mgr.destroyAgent(id, repoPath)

      const stateHandler = vi.fn()
      mgr.on('agent:state-changed', stateHandler)

      // Manually drive the orphaned state machine — events should NOT bubble
      sm.transition('picking_card')
      expect(stateHandler).not.toHaveBeenCalled()
    })
  })

  describe('getStateMachine', () => {
    it('returns the state machine for an existing agent', async () => {
      const mgr = new AgentManager()
      const id = await mgr.createAgent(testCard, twoPhaseRunbook, repoPath)

      const sm = mgr.getStateMachine(id)
      expect(sm).not.toBeNull()
      expect(sm!.getState()).toBe('idle')
    })

    it('returns null for unknown agent', () => {
      const mgr = new AgentManager()
      expect(mgr.getStateMachine('nope')).toBeNull()
    })
  })

  describe('setSessionId', () => {
    it('sets and reflects in the snapshot', async () => {
      const mgr = new AgentManager()
      const id = await mgr.createAgent(testCard, twoPhaseRunbook, repoPath)

      mgr.setSessionId(id, 'session-abc')
      expect(mgr.getAgent(id)!.sessionId).toBe('session-abc')

      mgr.setSessionId(id, null)
      expect(mgr.getAgent(id)!.sessionId).toBeNull()
    })

    it('throws for unknown agent', () => {
      const mgr = new AgentManager()
      expect(() => mgr.setSessionId('nope', 'x')).toThrow('Unknown agent')
    })
  })

  describe('event forwarding from state machine', () => {
    it('emits agent:state-changed when state machine transitions', async () => {
      const mgr = new AgentManager()
      const id = await mgr.createAgent(testCard, twoPhaseRunbook, repoPath)
      const sm = mgr.getStateMachine(id)!

      const handler = vi.fn()
      mgr.on('agent:state-changed', handler)

      sm.transition('picking_card')

      expect(handler).toHaveBeenCalledOnce()
      expect(handler.mock.calls[0][0]).toBe(id)
      const snapshot: AgentStateSnapshot = handler.mock.calls[0][1]
      expect(snapshot.state).toBe('picking_card')
    })

    it('emits agent:done when state machine reaches done', async () => {
      const mgr = new AgentManager()
      const id = await mgr.createAgent(testCard, twoPhaseRunbook, repoPath)
      const sm = mgr.getStateMachine(id)!

      const doneHandler = vi.fn()
      mgr.on('agent:done', doneHandler)

      // Walk through: idle → picking_card → Research → advance steps → Implement → advance → done
      sm.transition('picking_card')
      sm.transition('Research')
      sm.advanceStep() // Research step 1
      sm.advanceStep() // Research step 2 → auto-transitions to Implement
      sm.advanceStep() // Implement step 1 → auto-transitions to done

      expect(doneHandler).toHaveBeenCalledWith(id)
    })

    it('emits agent:step-advanced when step advances', async () => {
      const mgr = new AgentManager()
      const id = await mgr.createAgent(testCard, twoPhaseRunbook, repoPath)
      const sm = mgr.getStateMachine(id)!

      const advancedHandler = vi.fn()
      mgr.on('agent:step-advanced', advancedHandler)

      sm.transition('picking_card')
      sm.transition('Research')
      sm.advanceStep() // completes step 0, advances to step 1

      expect(advancedHandler).toHaveBeenCalledOnce()
      expect(advancedHandler.mock.calls[0][0]).toBe(id)
      const progress: AgentStepProgress = advancedHandler.mock.calls[0][1]
      expect(progress.stepIndex).toBe(1)
      expect(progress.status).toBe('in_progress')
    })

    it('emits agent:step-completed on each step completion', async () => {
      const mgr = new AgentManager()
      const id = await mgr.createAgent(testCard, twoPhaseRunbook, repoPath)
      const sm = mgr.getStateMachine(id)!

      const completedHandler = vi.fn()
      mgr.on('agent:step-completed', completedHandler)

      sm.transition('picking_card')
      sm.transition('Research')
      sm.advanceStep()

      expect(completedHandler).toHaveBeenCalledOnce()
      expect(completedHandler.mock.calls[0][0]).toBe(id)
      const progress: AgentStepProgress = completedHandler.mock.calls[0][1]
      expect(progress.stepIndex).toBe(0)
      expect(progress.status).toBe('completed')
    })

    it('emits agent:phase-completed when a phase finishes', async () => {
      const mgr = new AgentManager()
      const id = await mgr.createAgent(testCard, twoPhaseRunbook, repoPath)
      const sm = mgr.getStateMachine(id)!

      const phaseHandler = vi.fn()
      mgr.on('agent:phase-completed', phaseHandler)

      sm.transition('picking_card')
      sm.transition('Research')
      sm.advanceStep() // step 1 done
      sm.advanceStep() // step 2 done → Research complete

      expect(phaseHandler).toHaveBeenCalledWith(id, 'Research', 0)
    })

    it('emits agent:error when state machine errors', async () => {
      const mgr = new AgentManager()
      const id = await mgr.createAgent(testCard, twoPhaseRunbook, repoPath)
      const sm = mgr.getStateMachine(id)!

      const errorHandler = vi.fn()
      mgr.on('agent:error', errorHandler)

      sm.transition('picking_card')
      sm.transition('Research')
      sm.setError('something broke')

      expect(errorHandler).toHaveBeenCalledWith(id, 'something broke')
    })
  })

  describe('snapshot isolation', () => {
    it('returns a new snapshot object each time', async () => {
      const mgr = new AgentManager()
      const id = await mgr.createAgent(testCard, twoPhaseRunbook, repoPath)

      const snap1 = mgr.getAgent(id)
      const snap2 = mgr.getAgent(id)
      expect(snap1).not.toBe(snap2)
      expect(snap1).toEqual(snap2)
    })

    it('snapshot reflects current state after transitions', async () => {
      const mgr = new AgentManager()
      const id = await mgr.createAgent(testCard, twoPhaseRunbook, repoPath)
      const sm = mgr.getStateMachine(id)!

      expect(mgr.getAgent(id)!.stateSnapshot.state).toBe('idle')

      sm.transition('picking_card')
      expect(mgr.getAgent(id)!.stateSnapshot.state).toBe('picking_card')

      sm.transition('Research')
      expect(mgr.getAgent(id)!.stateSnapshot.state).toBe('Research')
    })
  })
})
