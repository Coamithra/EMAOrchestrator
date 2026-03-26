import type { StepPromptContext } from '../shared/prompt-generator'

/**
 * Generate a Claude prompt for a single runbook step.
 *
 * The prompt includes positional context (which phase/step), the task
 * instructions from the runbook, and a completion signal request.
 * Card context is included only on the very first step — subsequent
 * steps rely on the long-lived session already having it in memory
 * (per spike #009).
 */
export function generateStepPrompt(context: StepPromptContext): string {
  const {
    step,
    cardName,
    cardDescription,
    branchName,
    worktreePath,
    phaseIndex,
    totalPhases,
    stepIndex,
    totalStepsInPhase
  } = context

  const parts: string[] = []

  // Position header
  const phaseNum = phaseIndex + 1
  const stepNum = stepIndex + 1
  parts.push(
    `## Phase ${phaseNum} of ${totalPhases}: ${step.phase} — Step ${stepNum} of ${totalStepsInPhase}`
  )

  // Card context on first step only
  if (phaseIndex === 0 && stepIndex === 0) {
    parts.push(
      `### Card: ${cardName}`,
      '',
      cardDescription,
      '',
      `**Branch:** \`${branchName}\``,
      `**Worktree:** \`${worktreePath}\``
    )
  }

  // Task instruction
  parts.push('', `### Task: ${step.title}`)
  if (step.description) {
    parts.push('', step.description)
  }

  // Completion signal
  parts.push(
    '',
    '---',
    'When you have completed this step, provide a brief summary of what you accomplished.'
  )

  return parts.join('\n')
}
