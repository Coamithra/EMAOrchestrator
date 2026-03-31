import type { RunbookStep } from '../shared/runbook'
import type { StepPromptContext } from '../shared/prompt-generator'

/**
 * Detects whether a step requires pausing for user interaction based on
 * keywords in the title and description. Returns the instruction to append
 * to the prompt, or null if no interaction is needed.
 */
function getUserInteractionInstruction(step: RunbookStep): string | null {
  const text = `${step.title} ${step.description ?? ''}`.toLowerCase()

  if (text.includes('align with the user') || text.includes('get approval')) {
    return (
      'Before completing this step, you MUST present your plan to the user and get explicit approval. ' +
      'Use the AskUserQuestion tool to present your approach and wait for the user to confirm before proceeding. ' +
      'Do NOT move on until the user approves.'
    )
  }

  if (text.includes('manual testing') || text.includes('needs manual')) {
    return (
      'Use the AskUserQuestion tool to tell the user exactly what needs manual testing ' +
      'and ask them to confirm when they have finished testing.'
    )
  }

  return null
}

/**
 * Generate a Claude prompt for a single runbook step.
 *
 * The prompt includes positional context (which phase/step), the task
 * instructions from the runbook, and a completion signal request.
 * Card context is included only on the very first step — subsequent
 * steps rely on the long-lived session already having it in memory
 * (per spike #009).
 *
 * Steps that require user interaction (detected by keywords like
 * "align with the user" or "manual testing") get explicit instructions
 * to use AskUserQuestion before completing.
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

  // User interaction instruction (if this step requires it)
  const interactionInstruction = getUserInteractionInstruction(step)
  if (interactionInstruction) {
    parts.push('', `**Important:** ${interactionInstruction}`)
  }

  // Completion signal — non-final steps use AskUserQuestion so the session stays
  // alive (spike #010: continuous session, eliminates --resume between steps).
  // The last step ends naturally so the SDK generator completes.
  if (context.isLastStep) {
    parts.push(
      '',
      '---',
      'When you have completed this step, provide a brief summary of what you accomplished.'
    )
  } else {
    parts.push(
      '',
      '---',
      'When you have completed this step, signal completion by calling the AskUserQuestion',
      'tool with your message starting with "STEP_DONE: " followed by a brief summary.',
      'Example: AskUserQuestion("STEP_DONE: Implemented the login form with validation")'
    )
  }

  return parts.join('\n')
}

// Exported for testing
export { getUserInteractionInstruction }
