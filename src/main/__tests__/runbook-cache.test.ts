import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Runbook } from '../../shared/runbook'

// Mock electron app
vi.mock('electron', () => ({
  app: { getPath: () => '/mock-user-data' }
}))

// In-memory file system for testing
const files = new Map<string, string>()

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async (path: string) => {
    const content = files.get(path)
    if (content === undefined) throw new Error('ENOENT')
    return content
  }),
  writeFile: vi.fn(async (path: string, data: string) => {
    files.set(path, data)
  }),
  mkdir: vi.fn(async () => undefined)
}))

import { getCachedRunbook, cacheRunbook } from '../runbook-cache'

const sampleRunbook: Runbook = {
  phases: [
    {
      name: 'Setup',
      steps: [{ phase: 'Setup', index: 1, title: 'Install', description: 'npm install' }]
    }
  ]
}

beforeEach(() => {
  files.clear()
})

describe('runbook-cache', () => {
  it('returns null on cache miss', async () => {
    const result = await getCachedRunbook('some markdown', 'regex')
    expect(result).toBeNull()
  })

  it('caches and retrieves a runbook', async () => {
    await cacheRunbook('my runbook', 'regex', sampleRunbook)
    const result = await getCachedRunbook('my runbook', 'regex')
    expect(result).toEqual(sampleRunbook)
  })

  it('returns null for different content (different hash)', async () => {
    await cacheRunbook('content A', 'regex', sampleRunbook)
    const result = await getCachedRunbook('content B', 'regex')
    expect(result).toBeNull()
  })

  it('returns null for same content but different parser type', async () => {
    await cacheRunbook('same content', 'regex', sampleRunbook)
    const result = await getCachedRunbook('same content', 'smart')
    expect(result).toBeNull()
  })

  it('overwrites existing cache for same key', async () => {
    const updated: Runbook = {
      phases: [
        {
          name: 'Updated',
          steps: [{ phase: 'Updated', index: 1, title: 'New', description: 'new' }]
        }
      ]
    }
    await cacheRunbook('content', 'smart', sampleRunbook)
    await cacheRunbook('content', 'smart', updated)
    const result = await getCachedRunbook('content', 'smart')
    expect(result).toEqual(updated)
  })
})
