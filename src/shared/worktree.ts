export interface WorktreeInfo {
  /** Branch name, e.g. "feat/worktree-manager" */
  branch: string
  /** Absolute path to the worktree directory */
  path: string
  /** True for the main checkout (not a linked worktree) */
  isMain: boolean
}
