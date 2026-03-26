/**
 * Derive a branch name from a Trello card name.
 * "#011 Agent manager" → "feat-agent-manager"
 *
 * Uses hyphens instead of slashes so the worktree manager can create
 * a flat sibling directory (e.g., `../feat-agent-manager/`). Slashed
 * branch names like `feat/xxx` would create nested directories.
 *
 * Shared between AgentManager (main) and NewAgentDialog (renderer).
 */
export function branchNameFromCard(cardName: string): string {
  const stripped = cardName.replace(/^#\d+\s*/, '')
  const slug = stripped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `feat-${slug}`
}
