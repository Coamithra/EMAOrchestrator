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
 * Create a new worktree with a new branch based on the given or auto-detected default branch.
 *
 * By default, the worktree is created as a sibling to the repo directory:
 *   repoPath = C:\Proj\main  →  worktree at C:\Proj\<branch>
 *
 * If `basePath` is provided, the worktree is created under that directory instead:
 *   basePath = D:\worktrees  →  worktree at D:\worktrees\<branch>
 *
 * If the branch already exists (but has no worktree), it reuses the branch
 * instead of creating a new one.
 */
export async function createWorktree(
  repoPath: string,
  branch: string,
  basePath?: string,
  defaultBranch?: string
): Promise<WorktreeInfo> {
  const parentDir = basePath || dirname(repoPath)
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
    // Create new branch from the repo's default branch
    const baseBranch = defaultBranch || (await getDefaultBranch(repoPath))
    await execFileAsync('git', ['worktree', 'add', worktreePath, '-b', branch, baseBranch], {
      cwd: repoPath
    })
  }

  return { path: worktreePath, branch, isMain: false }
}

/**
 * Remove a worktree and delete its branch.
 *
 * Accepts worktree info directly to avoid recomputing paths from branch names,
 * which would break for detached HEAD worktrees (empty branch).
 */
export async function removeWorktree(repoPath: string, worktree: WorktreeInfo): Promise<void> {
  // Try to remove the worktree directory; if it's already gone, prune handles it
  try {
    await execFileAsync('git', ['worktree', 'remove', worktree.path, '--force'], {
      cwd: repoPath
    })
  } catch {
    // Directory may already be deleted (crash cleanup) — prune will clean up metadata
  }

  // Clean up stale worktree references
  await execFileAsync('git', ['worktree', 'prune'], {
    cwd: repoPath
  })

  // Delete the branch (skip if detached HEAD / empty branch)
  if (worktree.branch) {
    try {
      await execFileAsync('git', ['branch', '-D', worktree.branch], {
        cwd: repoPath
      })
    } catch {
      // Branch may already be deleted — ignore
    }
  }
}

/**
 * Get all non-main worktrees that are not in the known set.
 *
 * If `knownWorktreePaths` is provided, worktrees whose paths appear in the
 * set are excluded (they belong to persisted agents and are not orphans).
 */
export async function getOrphanedWorktrees(
  repoPath: string,
  knownWorktreePaths?: Set<string>
): Promise<WorktreeInfo[]> {
  const worktrees = await listWorktrees(repoPath)
  // Normalize paths for case-insensitive + separator-insensitive comparison on Windows.
  // Git returns forward slashes (C:/foo), Node path.join returns backslashes (C:\foo).
  const normalizePath = (p: string): string =>
    process.platform === 'win32' ? p.replace(/\\/g, '/').toLowerCase() : p
  const normalizedKnown = knownWorktreePaths
    ? new Set([...knownWorktreePaths].map(normalizePath))
    : undefined
  return worktrees.filter((wt) => {
    if (wt.isMain) return false
    if (!normalizedKnown) return true
    return !normalizedKnown.has(normalizePath(wt.path))
  })
}

/** Remove all orphaned worktrees and their branches. */
export async function cleanupOrphanedWorktrees(
  repoPath: string,
  knownWorktreePaths?: Set<string>
): Promise<WorktreeInfo[]> {
  const orphans = await getOrphanedWorktrees(repoPath, knownWorktreePaths)

  for (const orphan of orphans) {
    await removeWorktree(repoPath, orphan)
  }

  return orphans
}

/**
 * Detect the default branch of the repo (e.g. main, master).
 * Checks HEAD's symbolic ref first, falls back to 'main'.
 */
async function getDefaultBranch(repoPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['symbolic-ref', '--short', 'HEAD'], {
      cwd: repoPath
    })
    return stdout.trim()
  } catch {
    return 'main'
  }
}

/**
 * List remote branch names from the origin remote.
 * Returns short names (e.g. ['main', 'master', 'develop']).
 */
export async function listRemoteBranches(repoPath: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['ls-remote', '--heads', 'origin'], {
    cwd: repoPath,
    timeout: 15000
  })
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const ref = line.split('\t')[1] ?? ''
      return ref.replace('refs/heads/', '')
    })
    .filter(Boolean)
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
