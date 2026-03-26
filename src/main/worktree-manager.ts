import { execFile } from 'child_process'
import { promisify } from 'util'
import { join, dirname, resolve } from 'path'
import { access } from 'fs/promises'
import type { WorktreeInfo } from '../shared/worktree'

const execFileAsync = promisify(execFile)

/**
 * Parse the porcelain output of `git worktree list --porcelain` into WorktreeInfo[].
 *
 * Porcelain format (one block per worktree, separated by blank lines):
 *   worktree /absolute/path
 *   HEAD <sha>
 *   branch refs/heads/branch-name
 *
 * The main worktree has no "branch" line if HEAD is detached, but typically does.
 * We mark the first entry as isMain (git always lists the main worktree first).
 */
export function parseWorktreeList(output: string): WorktreeInfo[] {
  const entries: WorktreeInfo[] = []
  const blocks = output.trim().split(/\n\n/)

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].trim()
    if (!block) continue

    const lines = block.split('\n')
    let path = ''
    let branch = ''

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        path = line.slice('worktree '.length)
      } else if (line.startsWith('branch refs/heads/')) {
        branch = line.slice('branch refs/heads/'.length)
      }
    }

    if (path) {
      entries.push({ path, branch, isMain: i === 0 })
    }
  }

  return entries
}

/** List all worktrees for the given repo. */
export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
    cwd: repoPath
  })
  return parseWorktreeList(stdout)
}

/**
 * Create a new worktree with a new branch based on main.
 *
 * Worktree is created as a sibling to the repo directory:
 *   repoPath = C:\Proj\main  →  worktree at C:\Proj\<branch>
 *
 * If the branch already exists (but has no worktree), it reuses the branch
 * instead of creating a new one.
 */
export async function createWorktree(repoPath: string, branch: string): Promise<WorktreeInfo> {
  const parentDir = dirname(repoPath)
  const worktreePath = resolve(join(parentDir, branch))

  // Check if worktree directory already exists
  try {
    await access(worktreePath)
    throw new Error(`Worktree directory already exists: ${worktreePath}`)
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Worktree directory already exists')) {
      throw err
    }
    // Directory doesn't exist — good, proceed
  }

  // Check if branch already exists
  const branchExists = await doesBranchExist(repoPath, branch)

  if (branchExists) {
    // Branch exists — check out the existing branch in a new worktree
    await execFileAsync('git', ['worktree', 'add', worktreePath, branch], {
      cwd: repoPath
    })
  } else {
    // Create new branch from main
    await execFileAsync('git', ['worktree', 'add', worktreePath, '-b', branch, 'main'], {
      cwd: repoPath
    })
  }

  return { path: worktreePath, branch, isMain: false }
}

/** Remove a worktree and delete its branch. */
export async function removeWorktree(repoPath: string, branch: string): Promise<void> {
  const parentDir = dirname(repoPath)
  const worktreePath = resolve(join(parentDir, branch))

  // Remove the worktree (--force in case of uncommitted changes from a crash)
  await execFileAsync('git', ['worktree', 'remove', worktreePath, '--force'], {
    cwd: repoPath
  })

  // Clean up stale worktree references
  await execFileAsync('git', ['worktree', 'prune'], {
    cwd: repoPath
  })

  // Delete the branch
  try {
    await execFileAsync('git', ['branch', '-D', branch], {
      cwd: repoPath
    })
  } catch {
    // Branch may already be deleted or may be the current branch — ignore
  }
}

/**
 * Get all non-main worktrees. On app startup, these are considered orphaned
 * since no agent session state persists across restarts.
 */
export async function getOrphanedWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  const worktrees = await listWorktrees(repoPath)
  return worktrees.filter((wt) => !wt.isMain)
}

/** Remove all orphaned worktrees and their branches. */
export async function cleanupOrphanedWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  const orphans = await getOrphanedWorktrees(repoPath)

  for (const orphan of orphans) {
    await removeWorktree(repoPath, orphan.branch)
  }

  return orphans
}

async function doesBranchExist(repoPath: string, branch: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['rev-parse', '--verify', `refs/heads/${branch}`], {
      cwd: repoPath
    })
    return true
  } catch {
    return false
  }
}
