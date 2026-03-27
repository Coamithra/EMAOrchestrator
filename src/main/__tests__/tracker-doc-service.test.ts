import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Runbook } from '../../shared/runbook'
import {
  trackerDocPath,
  generateTrackerContent,
  createTrackerDoc,
  checkOffStep,
  removeTrackerDoc
} from '../tracker-doc-service'

const testRunbook: Runbook = {
  phases: [
    {
      name: 'Pick Up the Card',
      steps: [
        { phase: 'Pick Up the Card', index: 1, title: 'Pull latest main', description: '' },
        { phase: 'Pick Up the Card', index: 2, title: 'Read the card', description: '' }
      ]
    },
    {
      name: 'Research',
      steps: [
        { phase: 'Research', index: 1, title: 'Read the referenced code', description: '' },
        { phase: 'Research', index: 2, title: 'Trace the call chain', description: '' },
        { phase: 'Research', index: 3, title: 'Identify the blast radius', description: '' }
      ]
    }
  ]
}

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'tracker-test-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('trackerDocPath', () => {
  it('returns path under docs/ with branch name', () => {
    const result = trackerDocPath('/some/worktree', 'feat-my-feature')
    expect(result).toBe(join('/some/worktree', 'docs', 'tracker_feat-my-feature.md'))
  })

  it('replaces slashes in branch name with underscores', () => {
    const result = trackerDocPath('/some/worktree', 'feat/my-feature')
    expect(result).toBe(join('/some/worktree', 'docs', 'tracker_feat_my-feature.md'))
  })
})

describe('generateTrackerContent', () => {
  it('generates markdown with all phases and steps as unchecked boxes', () => {
    const content = generateTrackerContent('feat-test', testRunbook)

    expect(content).toContain('# Tracker: feat-test')
    expect(content).toContain('## Pick Up the Card')
    expect(content).toContain('- [ ] Pull latest main')
    expect(content).toContain('- [ ] Read the card')
    expect(content).toContain('## Research')
    expect(content).toContain('- [ ] Read the referenced code')
    expect(content).toContain('- [ ] Trace the call chain')
    expect(content).toContain('- [ ] Identify the blast radius')
  })

  it('has no checked boxes initially', () => {
    const content = generateTrackerContent('feat-test', testRunbook)
    expect(content).not.toContain('- [x]')
  })

  it('handles an empty runbook', () => {
    const content = generateTrackerContent('feat-test', { phases: [] })
    expect(content).toContain('# Tracker: feat-test')
    expect(content).not.toContain('- [ ]')
  })

  it('preserves branch names with slashes in the header', () => {
    const content = generateTrackerContent('feat/org/my-feature', testRunbook)
    expect(content).toContain('# Tracker: feat/org/my-feature')
  })
})

describe('createTrackerDoc', () => {
  it('writes the tracker file to the worktree docs directory', async () => {
    await createTrackerDoc(tempDir, 'feat-test', testRunbook)

    const filePath = trackerDocPath(tempDir, 'feat-test')
    const content = await readFile(filePath, 'utf-8')

    expect(content).toContain('# Tracker: feat-test')
    expect(content).toContain('- [ ] Pull latest main')
  })

  it('creates the docs directory if it does not exist', async () => {
    await createTrackerDoc(tempDir, 'feat-test', testRunbook)

    const filePath = trackerDocPath(tempDir, 'feat-test')
    const content = await readFile(filePath, 'utf-8')
    expect(content.length).toBeGreaterThan(0)
  })
})

describe('checkOffStep', () => {
  it('checks off the specified step', async () => {
    await createTrackerDoc(tempDir, 'feat-test', testRunbook)

    // Check off "Read the card" (phase 0, step 1)
    await checkOffStep(tempDir, 'feat-test', 0, 1)

    const content = await readFile(trackerDocPath(tempDir, 'feat-test'), 'utf-8')
    expect(content).toContain('- [ ] Pull latest main')
    expect(content).toContain('- [x] Read the card')
    expect(content).toContain('- [ ] Read the referenced code')
  })

  it('checks off steps in the second phase', async () => {
    await createTrackerDoc(tempDir, 'feat-test', testRunbook)

    // Check off "Trace the call chain" (phase 1, step 1)
    await checkOffStep(tempDir, 'feat-test', 1, 1)

    const content = await readFile(trackerDocPath(tempDir, 'feat-test'), 'utf-8')
    expect(content).toContain('- [ ] Read the referenced code')
    expect(content).toContain('- [x] Trace the call chain')
    expect(content).toContain('- [ ] Identify the blast radius')
  })

  it('can check off multiple steps', async () => {
    await createTrackerDoc(tempDir, 'feat-test', testRunbook)

    await checkOffStep(tempDir, 'feat-test', 0, 0)
    await checkOffStep(tempDir, 'feat-test', 0, 1)
    await checkOffStep(tempDir, 'feat-test', 1, 0)

    const content = await readFile(trackerDocPath(tempDir, 'feat-test'), 'utf-8')
    expect(content).toContain('- [x] Pull latest main')
    expect(content).toContain('- [x] Read the card')
    expect(content).toContain('- [x] Read the referenced code')
    expect(content).toContain('- [ ] Trace the call chain')
  })

  it('is a no-op if the file does not exist', async () => {
    // Should not throw
    await checkOffStep(tempDir, 'nonexistent-branch', 0, 0)
  })

  it('is idempotent — checking off an already-checked step is safe', async () => {
    await createTrackerDoc(tempDir, 'feat-test', testRunbook)

    await checkOffStep(tempDir, 'feat-test', 0, 0)
    await checkOffStep(tempDir, 'feat-test', 0, 0) // second time

    const content = await readFile(trackerDocPath(tempDir, 'feat-test'), 'utf-8')
    expect(content).toContain('- [x] Pull latest main')
  })

  it('is a no-op for out-of-bounds phase index', async () => {
    await createTrackerDoc(tempDir, 'feat-test', testRunbook)
    const before = await readFile(trackerDocPath(tempDir, 'feat-test'), 'utf-8')

    await checkOffStep(tempDir, 'feat-test', 99, 0)

    const after = await readFile(trackerDocPath(tempDir, 'feat-test'), 'utf-8')
    expect(after).toBe(before)
  })

  it('is a no-op for out-of-bounds step index', async () => {
    await createTrackerDoc(tempDir, 'feat-test', testRunbook)
    const before = await readFile(trackerDocPath(tempDir, 'feat-test'), 'utf-8')

    await checkOffStep(tempDir, 'feat-test', 0, 99)

    const after = await readFile(trackerDocPath(tempDir, 'feat-test'), 'utf-8')
    expect(after).toBe(before)
  })
})

describe('removeTrackerDoc', () => {
  it('deletes the tracker file', async () => {
    await createTrackerDoc(tempDir, 'feat-test', testRunbook)

    const filePath = trackerDocPath(tempDir, 'feat-test')
    // Verify it exists
    const before = await readFile(filePath, 'utf-8')
    expect(before.length).toBeGreaterThan(0)

    await removeTrackerDoc(tempDir, 'feat-test')

    // Verify it's gone
    await expect(readFile(filePath, 'utf-8')).rejects.toThrow()
  })

  it('is a no-op if the file does not exist', async () => {
    // Should not throw
    await removeTrackerDoc(tempDir, 'nonexistent-branch')
  })
})
