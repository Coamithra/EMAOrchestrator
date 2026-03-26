import type { RunbookStep } from './runbook'

/** Context needed to generate a prompt for a single runbook step. */
export interface StepPromptContext {
  /** The current step from the parsed runbook. */
  step: RunbookStep
  /** Trello card name (e.g. "#010 Step prompt generator"). */
  cardName: string
  /** Full Trello card description. */
  cardDescription: string
  /** Git branch name (e.g. "feat/step-prompt-generator"). */
  branchName: string
  /** Absolute path to the agent's worktree. */
  worktreePath: string
  /** 0-based index of the current phase in the runbook. */
  phaseIndex: number
  /** Total number of phases in the runbook. */
  totalPhases: number
  /** 0-based index of the current step within its phase. */
  stepIndex: number
  /** Total number of steps in the current phase. */
  totalStepsInPhase: number
}
