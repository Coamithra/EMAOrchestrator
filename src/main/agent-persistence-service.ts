import { app } from 'electron'
import { join } from 'path'
import { readFile, writeFile, access } from 'fs/promises'
import type {
  PersistedAgent,
  PersistedAgentStore,
  ReconciliationResult
} from '../shared/agent-persistence'

const CURRENT_VERSION = 1

function agentsPath(): string {
  return join(app.getPath('userData'), 'agents.json')
}

function emptyStore(): PersistedAgentStore {
  return { version: CURRENT_VERSION, agents: {} }
}

export async function loadPersistedAgents(): Promise<PersistedAgentStore | null> {
  try {
    const raw = await readFile(agentsPath(), 'utf-8')
    const parsed = JSON.parse(raw) as PersistedAgentStore
    if (parsed.version !== CURRENT_VERSION) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export async function savePersistedAgents(store: PersistedAgentStore): Promise<void> {
  await writeFile(agentsPath(), JSON.stringify(store, null, 2), 'utf-8')
}

export async function saveAgent(agent: PersistedAgent): Promise<void> {
  const store = (await loadPersistedAgents()) ?? emptyStore()
  store.agents[agent.id] = agent
  await savePersistedAgents(store)
}

export async function removePersistedAgent(agentId: string): Promise<void> {
  const store = await loadPersistedAgents()
  if (!store) return
  delete store.agents[agentId]
  await savePersistedAgents(store)
}

/** Fixed states that mean the agent was NOT actively running when persisted. */
const INACTIVE_STATES = new Set(['idle', 'picking_card', 'done', 'error', 'waiting_for_human'])

/**
 * Reconcile persisted agents with the actual state of the filesystem.
 *
 * For each agent:
 * - If worktree directory is gone → stale
 * - If worktree exists and agent was mid-run (in a phase state) → interrupted
 * - If worktree exists and agent was in an inactive state → restored as-is
 *
 * Mutates the store in place (sets interruptedAt on interrupted agents).
 */
export async function reconcileAgents(
  store: PersistedAgentStore
): Promise<ReconciliationResult[]> {
  const results: ReconciliationResult[] = []

  for (const [agentId, agent] of Object.entries(store.agents)) {
    const worktreeExists = await pathExists(agent.worktree.path)

    if (!worktreeExists) {
      results.push({ agentId, status: 'stale', reason: 'Worktree directory not found' })
      continue
    }

    const wasRunning = !INACTIVE_STATES.has(agent.stateSnapshot.state)
    if (wasRunning) {
      agent.interruptedAt = new Date().toISOString()
      results.push({
        agentId,
        status: 'interrupted',
        reason: `Was in state "${agent.stateSnapshot.state}" when app exited`
      })
    } else {
      results.push({ agentId, status: 'restored' })
    }
  }

  return results
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}
