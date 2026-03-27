import { writeFile, readFile, unlink, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import type { Runbook } from '../shared/runbook'

/**
 * Derive the tracker doc file path from a worktree path and branch name.
 * File lives at `<worktreePath>/docs/tracker_<branch>.md`.
 */
export function trackerDocPath(worktreePath: string, branch: string): string {
  const safeBranch = branch.replace(/\//g, '_')
  return join(worktreePath, 'docs', `tracker_${safeBranch}.md`)
}

/**
 * Generate tracker doc markdown content from a runbook.
 * Each phase becomes an H2, each step becomes a checkbox item.
 */
export function generateTrackerContent(branch: string, runbook: Runbook): string {
  const lines: string[] = [`# Tracker: ${branch}`, '']

  for (const phase of runbook.phases) {
    lines.push(`## ${phase.name}`)
    for (const step of phase.steps) {
      lines.push(`- [ ] ${step.title}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Create a tracker doc in the agent's worktree.
 * Generates checkboxes for every runbook step. Fire-and-forget safe.
 */
export async function createTrackerDoc(
  worktreePath: string,
  branch: string,
  runbook: Runbook
): Promise<void> {
  const filePath = trackerDocPath(worktreePath, branch)
  const content = generateTrackerContent(branch, runbook)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf-8')
}

/**
 * Check off a completed step in the tracker doc.
 * Finds the step by counting phases and steps, then replaces `- [ ]` with `- [x]`.
 * No-op if the file doesn't exist or the step is already checked.
 */
export async function checkOffStep(
  worktreePath: string,
  branch: string,
  phaseIndex: number,
  stepIndex: number
): Promise<void> {
  const filePath = trackerDocPath(worktreePath, branch)

  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch {
    return // File doesn't exist — no-op
  }

  const lines = content.split('\n')
  let currentPhase = -1
  let currentStep = -1

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      currentPhase++
      currentStep = -1
      continue
    }
    if (lines[i].startsWith('- [ ] ') || lines[i].startsWith('- [x] ')) {
      currentStep++
      if (currentPhase === phaseIndex && currentStep === stepIndex) {
        lines[i] = lines[i].replace('- [ ] ', '- [x] ')
        break
      }
    }
  }

  await writeFile(filePath, lines.join('\n'), 'utf-8')
}

/**
 * Delete the tracker doc from the agent's worktree.
 * No-op if the file doesn't exist. Fire-and-forget safe.
 */
export async function removeTrackerDoc(worktreePath: string, branch: string): Promise<void> {
  const filePath = trackerDocPath(worktreePath, branch)
  try {
    await unlink(filePath)
  } catch {
    // File doesn't exist — no-op
  }
}
