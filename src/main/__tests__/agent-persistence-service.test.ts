import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PersistedAgent, PersistedAgentStore } from '../../shared/agent-persistence'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockReadFile = vi.hoisted(() => vi.fn())
const mockWriteFile = vi.hoisted(() => vi.fn())
const mockAccess = vi.hoisted(() => vi.fn())

vi.mock('fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  access: mockAccess
}))

vi.mock('electron', () => ({
  app: {
    getPath: (_name: string) => '/mock/userData'
  }
}))

import {
  loadPersistedAgents,
  savePersistedAgents,
  saveAgent,
  removePersistedAgent,
  reconcileAgents
} from '../agent-persistence-service'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePersistedAgent(overrides?: Partial<PersistedAgent>): PersistedAgent {
  return {
    id: 'agent-1',
    card: { id: 'card-1', name: '#012 Test', description: 'A test card' },
    worktree: { path: 'C:/Proj/feat-test', branch: 'feat-test', isMain: false },
    runbook: {
      phases: [
        {
          name: 'Research',
          steps: [{ phase: 'Research', index: 1, title: 'Read code', description: '' }]
        }
      ]
    },
    stateSnapshot: {
      state: 'Research',
      phaseIndex: 0,
      stepIndex: 0,
      totalPhases: 1,
      totalSteps: 1,
      completedSteps: 0
    },
    restoreData: {
      state: 'Research',
      phaseIndex: 0,
      stepIndex: 0,
      completedSteps: 0,
      completedStepCounts: [0]
    },
    sessionId: 'session-abc',
    stepHistory: [],
    pendingHumanInteraction: null,
    createdAt: '2026-03-25T10:00:00.000Z',
    persistedAt: '2026-03-25T10:00:00.000Z',
    interruptedAt: null,
    ...overrides
  }
}

function makeStore(agents: PersistedAgent[] = []): PersistedAgentStore {
  const record: Record<string, PersistedAgent> = {}
  for (const a of agents) {
    record[a.id] = a
  }
  return { version: 1, agents: record }
}

beforeEach(() => {
  vi.resetAllMocks()
  mockWriteFile.mockResolvedValue(undefined)
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loadPersistedAgents', () => {
  it('returns parsed store on valid JSON', async () => {
    const store = makeStore([makePersistedAgent()])
    mockReadFile.mockResolvedValue(JSON.stringify(store))

    const result = await loadPersistedAgents()
    expect(result).toEqual(store)
  })

  it('returns null when file does not exist', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'))

    const result = await loadPersistedAgents()
    expect(result).toBeNull()
  })

  it('returns null on malformed JSON', async () => {
    mockReadFile.mockResolvedValue('not valid json {{{')

    const result = await loadPersistedAgents()
    expect(result).toBeNull()
  })

  it('returns null on version mismatch', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ version: 999, agents: {} }))

    const result = await loadPersistedAgents()
    expect(result).toBeNull()
  })
})

describe('savePersistedAgents', () => {
  it('writes pretty-printed JSON', async () => {
    const store = makeStore([makePersistedAgent()])
    await savePersistedAgents(store)

    expect(mockWriteFile).toHaveBeenCalledOnce()
    const [path, content, encoding] = mockWriteFile.mock.calls[0]
    expect(path).toContain('agents.json')
    expect(encoding).toBe('utf-8')
    expect(JSON.parse(content)).toEqual(store)
    // Verify pretty-printed (has newlines)
    expect(content).toContain('\n')
  })
})

describe('saveAgent', () => {
  it('upserts an agent into an existing store', async () => {
    const existing = makePersistedAgent({ id: 'agent-1' })
    mockReadFile.mockResolvedValue(JSON.stringify(makeStore([existing])))

    const newAgent = makePersistedAgent({ id: 'agent-2' })
    await saveAgent(newAgent)

    const written = JSON.parse(mockWriteFile.mock.calls[0][1]) as PersistedAgentStore
    expect(Object.keys(written.agents)).toEqual(['agent-1', 'agent-2'])
  })

  it('creates a new store if none exists', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'))

    const agent = makePersistedAgent()
    await saveAgent(agent)

    const written = JSON.parse(mockWriteFile.mock.calls[0][1]) as PersistedAgentStore
    expect(written.version).toBe(1)
    expect(written.agents['agent-1']).toBeDefined()
  })

  it('overwrites an existing agent entry', async () => {
    const original = makePersistedAgent({ id: 'agent-1', sessionId: 'old' })
    mockReadFile.mockResolvedValue(JSON.stringify(makeStore([original])))

    const updated = makePersistedAgent({ id: 'agent-1', sessionId: 'new' })
    await saveAgent(updated)

    const written = JSON.parse(mockWriteFile.mock.calls[0][1]) as PersistedAgentStore
    expect(written.agents['agent-1'].sessionId).toBe('new')
  })
})

describe('removePersistedAgent', () => {
  it('removes an agent from the store', async () => {
    const store = makeStore([
      makePersistedAgent({ id: 'agent-1' }),
      makePersistedAgent({ id: 'agent-2' })
    ])
    mockReadFile.mockResolvedValue(JSON.stringify(store))

    await removePersistedAgent('agent-1')

    const written = JSON.parse(mockWriteFile.mock.calls[0][1]) as PersistedAgentStore
    expect(Object.keys(written.agents)).toEqual(['agent-2'])
  })

  it('no-ops if store does not exist', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'))

    await removePersistedAgent('agent-1')

    expect(mockWriteFile).not.toHaveBeenCalled()
  })
})

describe('reconcileAgents', () => {
  it('marks agents with missing worktrees as stale', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'))

    const store = makeStore([makePersistedAgent()])
    const results = await reconcileAgents(store)

    expect(results).toEqual([
      { agentId: 'agent-1', status: 'stale', reason: 'Worktree directory not found' }
    ])
  })

  it('marks running agents as interrupted when worktree exists', async () => {
    mockAccess.mockResolvedValue(undefined)

    // Agent was in a phase state (running)
    const agent = makePersistedAgent({ stateSnapshot: { ...makePersistedAgent().stateSnapshot, state: 'Research' } })
    const store = makeStore([agent])
    const results = await reconcileAgents(store)

    expect(results).toEqual([
      {
        agentId: 'agent-1',
        status: 'interrupted',
        reason: 'Was in state "Research" when app exited'
      }
    ])
    expect(store.agents['agent-1'].interruptedAt).toBeTruthy()
  })

  it('restores agents in inactive states when worktree exists', async () => {
    mockAccess.mockResolvedValue(undefined)

    const agent = makePersistedAgent({
      stateSnapshot: { ...makePersistedAgent().stateSnapshot, state: 'waiting_for_human' }
    })
    const store = makeStore([agent])
    const results = await reconcileAgents(store)

    expect(results).toEqual([{ agentId: 'agent-1', status: 'restored' }])
    expect(store.agents['agent-1'].interruptedAt).toBeNull()
  })

  it('restores agents in done state', async () => {
    mockAccess.mockResolvedValue(undefined)

    const agent = makePersistedAgent({
      stateSnapshot: { ...makePersistedAgent().stateSnapshot, state: 'done' }
    })
    const store = makeStore([agent])
    const results = await reconcileAgents(store)

    expect(results).toEqual([{ agentId: 'agent-1', status: 'restored' }])
  })

  it('handles multiple agents with mixed statuses', async () => {
    // agent-1 worktree exists and was running
    // agent-2 worktree is gone
    // agent-3 worktree exists and was idle
    mockAccess
      .mockResolvedValueOnce(undefined) // agent-1 exists
      .mockRejectedValueOnce(new Error('ENOENT')) // agent-2 gone
      .mockResolvedValueOnce(undefined) // agent-3 exists

    const store = makeStore([
      makePersistedAgent({ id: 'agent-1', stateSnapshot: { ...makePersistedAgent().stateSnapshot, state: 'Research' } }),
      makePersistedAgent({ id: 'agent-2' }),
      makePersistedAgent({ id: 'agent-3', stateSnapshot: { ...makePersistedAgent().stateSnapshot, state: 'idle' } })
    ])

    const results = await reconcileAgents(store)

    expect(results).toHaveLength(3)
    expect(results[0]).toMatchObject({ agentId: 'agent-1', status: 'interrupted' })
    expect(results[1]).toMatchObject({ agentId: 'agent-2', status: 'stale' })
    expect(results[2]).toMatchObject({ agentId: 'agent-3', status: 'restored' })
  })
})
