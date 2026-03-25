export interface RunbookStep {
  phase: string
  index: number
  title: string
  description: string
}

export interface RunbookPhase {
  name: string
  steps: RunbookStep[]
}

export interface Runbook {
  phases: RunbookPhase[]
}
