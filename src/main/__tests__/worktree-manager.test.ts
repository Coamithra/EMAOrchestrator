import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockExecFile, mockAccess } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockAccess: vi.fn()
}))

vi.mock('child_process', () => ({
  execFile: vi.fn()
}))

vi.mock('util', () => ({
  promisify: () => mockExecFile
}))

vi.mock('fs/promises', () => ({
  access: mockAccess
}))

import {
  parseWorktreeList,
  listWorktrees,
  createWorktree,
  removeWorktree,
  getOrphanedWorktrees,
  cleanupOrphanedWorktrees
} from '../worktree-manager'

beforeEach(() => {
  vi.clearAllMocks()
})

// ── parseWorktreeList (pure function, no mocks needed) ──────────────────

describe('parseWorktreeList', () => {
  it('parses a single main worktree', () => {
    const output = ['worktree C:/Proj/main', 'HEAD abc1234', 'branch refs/heads/main', ''].join(
      '\n'
    )

    const result = parseWorktreeList(output)
    expect(result).toEqual([{ path: 'C:/Proj/main', branch: 'main', isMain: true }])
  })

  it('parses multiple worktrees', () => {
    const output = [
      'worktree C:/Proj/main',
      'HEAD abc1234',
      'branch refs/heads/main',
      '',
      'worktree C:/Proj/feat/step-detection',
      'HEAD def5678',
      'branch refs/heads/feat/step-detection',
      '',
      'worktree C:/Proj/fix/terminal-race',
      'HEAD 9ab0123',
      'branch refs/heads/fix/terminal-race',
      ''
    ].join('\n')

    const result = parseWorktreeList(output)
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ path: 'C:/Proj/main', branch: 'main', isMain: true })
    expect(result[1]).toEqual({
      path: 'C:/Proj/feat/step-detection',
      branch: 'feat/step-detection',
      isMain: false
    })
    expect(result[2]).toEqual({
      path: 'C:/Proj/fix/terminal-race',
      branch: 'fix/terminal-race',
      isMain: false
    })
  })

  it('handles detached HEAD (no branch line)', () => {
    const output = [
      'worktree C:/Proj/main',
      'HEAD abc1234',
      'branch refs/heads/main',
      '',
      'worktree C:/Proj/detached',
      'HEAD def5678',
      'detached',
      ''
    ].join('\n')

    const result = parseWorktreeList(output)
    expect(result).toHaveLength(2)
    expect(result[1]).toEqual({ path: 'C:/Proj/detached', branch: '', isMain: false })
  })

  it('returns empty array for empty output', () => {
    expect(parseWorktreeList('')).toEqual([])
  })
})

// ── listWorktrees ───────────────────────────────────────────────────────

describe('listWorktrees', () => {
  it('calls git worktree list --porcelain and parses output', async () => {
    const porcelain = ['worktree C:/Proj/main', 'HEAD abc1234', 'branch refs/heads/main', ''].join(
      '\n'
    )

    mockExecFile.mockResolvedValueOnce({ stdout: porcelain, stderr: '' })

    const result = await listWorktrees('C:/Proj/main')
    expect(mockExecFile).toHaveBeenCalledWith('git', ['worktree', 'list', '--porcelain'], {
      cwd: 'C:/Proj/main'
    })
    expect(result).toHaveLength(1)
    expect(result[0].branch).toBe('main')
  })
})

// ── createWorktree ──────────────────────────────────────────────────────

describe('createWorktree', () => {
  it('creates a new worktree with a new branch', async () => {
    // access() throws → directory doesn't exist (good)
    mockAccess.mockRejectedValueOnce(new Error('ENOENT'))
    // Branch doesn't exist
    mockExecFile.mockRejectedValueOnce(new Error('not a valid ref'))
    // git worktree add succeeds
    mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' })

    const result = await createWorktree('C:/Proj/main', 'feat/new-thing')

    expect(result.branch).toBe('feat/new-thing')
    expect(result.isMain).toBe(false)
    // Second call is the git worktree add with -b flag
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['worktree', 'add', expect.stringContaining('feat'), '-b', 'feat/new-thing', 'main'],
      { cwd: 'C:/Proj/main' }
    )
  })

  it('reuses existing branch if it already exists', async () => {
    mockAccess.mockRejectedValueOnce(new Error('ENOENT'))
    // Branch exists
    mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' })
    // git worktree add succeeds
    mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' })

    await createWorktree('C:/Proj/main', 'feat/existing')

    // Second call is the git worktree add without -b flag
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['worktree', 'add', expect.stringContaining('feat'), 'feat/existing'],
      { cwd: 'C:/Proj/main' }
    )
  })

  it('throws if worktree directory already exists', async () => {
    // access() succeeds → directory exists
    mockAccess.mockResolvedValueOnce(undefined)

    await expect(createWorktree('C:/Proj/main', 'feat/dupe')).rejects.toThrow(
      'Worktree directory already exists'
    )
  })
})

// ── removeWorktree ──────────────────────────────────────────────────────

describe('removeWorktree', () => {
  const worktree = { path: 'C:/Proj/feat/old', branch: 'feat/old', isMain: false }

  it('removes worktree, prunes, and deletes branch', async () => {
    mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' }) // worktree remove
    mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' }) // worktree prune
    mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' }) // branch -D

    await removeWorktree('C:/Proj/main', worktree)

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['worktree', 'remove', 'C:/Proj/feat/old', '--force'],
      { cwd: 'C:/Proj/main' }
    )
    expect(mockExecFile).toHaveBeenCalledWith('git', ['worktree', 'prune'], { cwd: 'C:/Proj/main' })
    expect(mockExecFile).toHaveBeenCalledWith('git', ['branch', '-D', 'feat/old'], {
      cwd: 'C:/Proj/main'
    })
  })

  it('does not throw if worktree remove fails (directory already gone)', async () => {
    mockExecFile.mockRejectedValueOnce(new Error('not a working tree')) // worktree remove fails
    mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' }) // worktree prune
    mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' }) // branch -D

    // Should not throw — prune cleans up metadata
    await removeWorktree('C:/Proj/main', worktree)
    expect(mockExecFile).toHaveBeenCalledWith('git', ['worktree', 'prune'], { cwd: 'C:/Proj/main' })
  })

  it('does not throw if branch deletion fails', async () => {
    mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' }) // worktree remove
    mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' }) // worktree prune
    mockExecFile.mockRejectedValueOnce(new Error('branch not found')) // branch -D fails

    await removeWorktree('C:/Proj/main', worktree)
  })

  it('skips branch deletion for detached HEAD worktrees', async () => {
    const detached = { path: 'C:/Proj/detached', branch: '', isMain: false }
    mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' }) // worktree remove
    mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' }) // worktree prune

    await removeWorktree('C:/Proj/main', detached)

    // Only 2 calls: worktree remove + prune. No branch -D call.
    expect(mockExecFile).toHaveBeenCalledTimes(2)
  })
})

// ── getOrphanedWorktrees ────────────────────────────────────────────────

describe('getOrphanedWorktrees', () => {
  it('returns all non-main worktrees', async () => {
    const porcelain = [
      'worktree C:/Proj/main',
      'HEAD abc1234',
      'branch refs/heads/main',
      '',
      'worktree C:/Proj/feat/orphan-1',
      'HEAD def5678',
      'branch refs/heads/feat/orphan-1',
      '',
      'worktree C:/Proj/fix/orphan-2',
      'HEAD 9ab0123',
      'branch refs/heads/fix/orphan-2',
      ''
    ].join('\n')

    mockExecFile.mockResolvedValueOnce({ stdout: porcelain, stderr: '' })

    const orphans = await getOrphanedWorktrees('C:/Proj/main')
    expect(orphans).toHaveLength(2)
    expect(orphans.every((o) => !o.isMain)).toBe(true)
  })

  it('excludes worktrees in the knownWorktreePaths set', async () => {
    const porcelain = [
      'worktree C:/Proj/main',
      'HEAD abc1234',
      'branch refs/heads/main',
      '',
      'worktree C:/Proj/feat/orphan-1',
      'HEAD def5678',
      'branch refs/heads/feat/orphan-1',
      '',
      'worktree C:/Proj/feat/known-agent',
      'HEAD 9ab0123',
      'branch refs/heads/feat/known-agent',
      ''
    ].join('\n')

    mockExecFile.mockResolvedValueOnce({ stdout: porcelain, stderr: '' })

    const known = new Set(['C:/Proj/feat/known-agent'])
    const orphans = await getOrphanedWorktrees('C:/Proj/main', known)
    expect(orphans).toHaveLength(1)
    expect(orphans[0].branch).toBe('feat/orphan-1')
  })

  it('returns empty array when only main exists', async () => {
    const porcelain = ['worktree C:/Proj/main', 'HEAD abc1234', 'branch refs/heads/main', ''].join(
      '\n'
    )

    mockExecFile.mockResolvedValueOnce({ stdout: porcelain, stderr: '' })

    const orphans = await getOrphanedWorktrees('C:/Proj/main')
    expect(orphans).toHaveLength(0)
  })
})

// ── cleanupOrphanedWorktrees ────────────────────────────────────────────

describe('cleanupOrphanedWorktrees', () => {
  it('removes each orphaned worktree and returns them', async () => {
    const porcelain = [
      'worktree C:/Proj/main',
      'HEAD abc1234',
      'branch refs/heads/main',
      '',
      'worktree C:/Proj/feat/stale',
      'HEAD def5678',
      'branch refs/heads/feat/stale',
      ''
    ].join('\n')

    // listWorktrees call
    mockExecFile.mockResolvedValueOnce({ stdout: porcelain, stderr: '' })
    // removeWorktree: worktree remove, prune, branch -D
    mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' })
    mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' })
    mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' })

    const removed = await cleanupOrphanedWorktrees('C:/Proj/main')
    expect(removed).toHaveLength(1)
    expect(removed[0].branch).toBe('feat/stale')
  })

  it('returns empty array when nothing to clean', async () => {
    const porcelain = ['worktree C:/Proj/main', 'HEAD abc1234', 'branch refs/heads/main', ''].join(
      '\n'
    )

    mockExecFile.mockResolvedValueOnce({ stdout: porcelain, stderr: '' })

    const removed = await cleanupOrphanedWorktrees('C:/Proj/main')
    expect(removed).toHaveLength(0)
  })
})
