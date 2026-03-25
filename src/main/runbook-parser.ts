import { readFile } from 'node:fs/promises'
import type { Runbook, RunbookPhase, RunbookStep } from '../shared/runbook'

/**
 * Parse a CONTRIBUTING.md runbook into structured phases and steps.
 *
 * Expected format:
 * - H2 (`##`) headers delimit phases
 * - Numbered lists (`1.`, `2.`, ...) define steps within each phase
 * - Bold text (`**...**`) at the start of a step is the step title;
 *   remaining text (and continuation lines) form the description
 */
export function parseRunbookContent(markdown: string): Runbook {
  const lines = markdown.split(/\r?\n/)
  const phases: RunbookPhase[] = []
  let currentPhase: RunbookPhase | null = null
  let currentStep: RunbookStep | null = null

  const flushStep = (): void => {
    if (currentStep && currentPhase) {
      currentStep.description = currentStep.description.trim()
      currentPhase.steps.push(currentStep)
      currentStep = null
    }
  }

  const flushPhase = (): void => {
    flushStep()
    if (currentPhase) {
      phases.push(currentPhase)
      currentPhase = null
    }
  }

  for (const line of lines) {
    // H2 header → new phase
    const h2Match = line.match(/^##(?!#)\s+(.+)/)
    if (h2Match) {
      flushPhase()
      currentPhase = { name: h2Match[1].trim(), steps: [] }
      continue
    }

    // Skip if we're not inside a phase
    if (!currentPhase) continue

    // Numbered list item → new step
    const stepMatch = line.match(/^\d+\.\s+(.+)/)
    if (stepMatch) {
      flushStep()
      const content = stepMatch[1]

      // Extract bold title if present
      const boldMatch = content.match(/^\*\*(.+?)\*\*\s*(.*)/)
      if (boldMatch) {
        currentStep = {
          phase: currentPhase.name,
          index: currentPhase.steps.length + 1,
          title: boldMatch[1].trim(),
          description: boldMatch[2].replace(/^—\s*/, '').trim()
        }
      } else {
        // No bold title — use entire content as title
        currentStep = {
          phase: currentPhase.name,
          index: currentPhase.steps.length + 1,
          title: content.trim(),
          description: ''
        }
      }
      continue
    }

    // Continuation line for the current step (indented or any non-blank text)
    if (currentStep && line.trim().length > 0) {
      currentStep.description += (currentStep.description ? ' ' : '') + line.trim()
    }
  }

  // Flush remaining
  flushPhase()

  return { phases }
}

/** Read a CONTRIBUTING.md file from disk and parse it. */
export async function parseRunbookFile(filePath: string): Promise<Runbook> {
  const content = await readFile(filePath, 'utf-8')
  return parseRunbookContent(content)
}
