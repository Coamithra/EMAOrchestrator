import { describe, expect, it } from 'vitest'
import { generateStepPrompt } from '../prompt-generator'
import type { StepPromptContext } from '../../shared/prompt-generator'
import type { RunbookStep } from '../../shared/runbook'

function makeStep(overrides: Partial<RunbookStep> = {}): RunbookStep {
  return {
    phase: 'Research',
    index: 1,
    title: 'Read the referenced code',
    description: 'Every card cites specific files and line numbers.',
    ...overrides
  }
}

function makeContext(overrides: Partial<StepPromptContext> = {}): StepPromptContext {
  return {
    step: makeStep(),
    cardName: '#010 Step prompt generator',
    cardDescription: 'Generate prompts for each runbook step.',
    branchName: 'feat/step-prompt-generator',
    worktreePath: '/work/feat/step-prompt-generator',
    phaseIndex: 0,
    totalPhases: 6,
    stepIndex: 0,
    totalStepsInPhase: 5,
    ...overrides
  }
}

describe('generateStepPrompt', () => {
  it('includes the position header', () => {
    const prompt = generateStepPrompt(makeContext())
    expect(prompt).toContain('Phase 1 of 6: Research — Step 1 of 5')
  })

  it('includes card context on the first step', () => {
    const prompt = generateStepPrompt(makeContext({ phaseIndex: 0, stepIndex: 0 }))
    expect(prompt).toContain('### Card: #010 Step prompt generator')
    expect(prompt).toContain('Generate prompts for each runbook step.')
    expect(prompt).toContain('**Branch:** `feat/step-prompt-generator`')
    expect(prompt).toContain('**Worktree:** `/work/feat/step-prompt-generator`')
  })

  it('omits card context on subsequent steps', () => {
    const prompt = generateStepPrompt(makeContext({ phaseIndex: 0, stepIndex: 1 }))
    expect(prompt).not.toContain('### Card:')
    expect(prompt).not.toContain('**Branch:**')
  })

  it('omits card context on later phases', () => {
    const prompt = generateStepPrompt(makeContext({ phaseIndex: 2, stepIndex: 0 }))
    expect(prompt).not.toContain('### Card:')
  })

  it('includes the task title', () => {
    const prompt = generateStepPrompt(makeContext())
    expect(prompt).toContain('### Task: Read the referenced code')
  })

  it('includes the step description', () => {
    const prompt = generateStepPrompt(makeContext())
    expect(prompt).toContain('Every card cites specific files and line numbers.')
  })

  it('handles empty description gracefully', () => {
    const prompt = generateStepPrompt(makeContext({ step: makeStep({ description: '' }) }))
    expect(prompt).toContain('### Task: Read the referenced code')
    // No blank paragraph between title and completion signal
    expect(prompt).not.toMatch(/### Task: Read the referenced code\n\n\n/)
  })

  it('includes STEP_DONE completion signal for non-final steps', () => {
    const prompt = generateStepPrompt(makeContext())
    expect(prompt).toContain('STEP_DONE: ')
    expect(prompt).toContain('AskUserQuestion')
  })

  it('includes natural completion signal for the last step', () => {
    const prompt = generateStepPrompt(makeContext({ isLastStep: true }))
    expect(prompt).toContain(
      'When you have completed this step, provide a brief summary of what you accomplished.'
    )
    expect(prompt).not.toContain('STEP_DONE')
  })

  it('computes phase and step numbers as 1-based', () => {
    const prompt = generateStepPrompt(
      makeContext({
        phaseIndex: 3,
        totalPhases: 6,
        stepIndex: 2,
        totalStepsInPhase: 4,
        step: makeStep({ phase: 'Implement' })
      })
    )
    expect(prompt).toContain('Phase 4 of 6: Implement — Step 3 of 4')
  })

  it('uses the step phase name, not a hardcoded value', () => {
    const prompt = generateStepPrompt(
      makeContext({
        step: makeStep({ phase: 'Review & Ship' }),
        phaseIndex: 5
      })
    )
    expect(prompt).toContain('Review & Ship')
  })

  it('handles multi-line card descriptions', () => {
    const multiLineDesc = [
      'Generate prompts for each runbook step.',
      '',
      '**Acceptance Criteria:**',
      '- Takes a parsed runbook step',
      '- Prompts include completion signaling'
    ].join('\n')
    const prompt = generateStepPrompt(makeContext({ cardDescription: multiLineDesc }))
    expect(prompt).toContain('**Acceptance Criteria:**')
    expect(prompt).toContain('- Takes a parsed runbook step')
  })

  it('returns a non-empty string', () => {
    const prompt = generateStepPrompt(makeContext())
    expect(prompt.length).toBeGreaterThan(0)
  })

  it('produces a complete prompt for first step with all sections', () => {
    const prompt = generateStepPrompt(makeContext())
    const lines = prompt.split('\n')

    // Position header is first line
    expect(lines[0]).toMatch(/^## Phase \d+ of \d+:/)

    // Card section present
    expect(prompt).toContain('### Card:')

    // Task section present
    expect(prompt).toContain('### Task:')

    // Completion signal present at the end
    expect(prompt).toContain('---')
    expect(prompt).toContain('When you have completed this step')
  })
})
