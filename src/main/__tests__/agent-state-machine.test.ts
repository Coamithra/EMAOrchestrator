import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AgentStateMachine } from '../agent-state-machine'
import { parseRunbookContent } from '../runbook-parser'
import type { Runbook } from '../../shared/runbook'

const fixture = (name: string): string =>
  readFileSync(resolve(__dirname, 'fixtures', name), 'utf-8')

/** 3 phases: Planning (2 steps), Implementation (3 steps), Review (2 steps) */
const simpleRunbook = parseRunbookContent(fixture('simple-runbook.md'))

/** 1 phase with 1 step — minimal valid runbook */
const minimalRunbook: Runbook = {
  phases: [
    {
      name: 'Only Phase',
      steps: [{ phase: 'Only Phase', index: 1, title: 'Do it', description: 'The one step' }]
    }
  ]
}

describe('AgentStateMachine', () => {
  describe('construction', () => {
    it('constructs from a valid runbook', () => {
      const sm = new AgentStateMachine(simpleRunbook)
      expect(sm.getState()).toBe('idle')
    })

    it('throws on empty runbook', () => {
      expect(() => new AgentStateMachine({ phases: [] })).toThrow('at least one phase')
    })

    it('throws if a phase name collides with a fixed state', () => {
      const bad: Runbook = {
        phases: [
          { name: 'error', steps: [{ phase: 'error', index: 1, title: 'x', description: '' }] }
        ]
      }
      expect(() => new AgentStateMachine(bad)).toThrow('collides with a fixed state')
    })

    it('throws on duplicate phase names', () => {
      const bad: Runbook = {
        phases: [
          { name: 'Build', steps: [{ phase: 'Build', index: 1, title: 'a', description: '' }] },
          { name: 'Build', steps: [{ phase: 'Build', index: 1, title: 'b', description: '' }] }
        ]
      }
      expect(() => new AgentStateMachine(bad)).toThrow('duplicate phase name')
    })

    it('exposes phase names', () => {
      const sm = new AgentStateMachine(simpleRunbook)
      expect(sm.getPhaseNames()).toEqual(['Planning', 'Implementation', 'Review'])
    })
  })

  describe('initial snapshot', () => {
    it('starts in idle with correct counts', () => {
      const sm = new AgentStateMachine(simpleRunbook)
      const snap = sm.getSnapshot()
      expect(snap).toEqual({
        state: 'idle',
        phaseIndex: -1,
        stepIndex: -1,
        totalPhases: 3,
        totalSteps: 7,
        completedSteps: 0
      })
    })
  })

  describe('happy path transitions', () => {
    it('walks through the full lifecycle', () => {
      const sm = new AgentStateMachine(simpleRunbook)
      const stateChanges: [string, string][] = []
      sm.on('state:changed', (n, p) => stateChanges.push([p, n]))

      // idle → picking_card → Planning
      sm.transition('picking_card')
      expect(sm.getState()).toBe('picking_card')
      sm.transition('Planning')
      expect(sm.getState()).toBe('Planning')
      expect(sm.getSnapshot().phaseIndex).toBe(0)
      expect(sm.getSnapshot().stepIndex).toBe(0)

      // Advance through Planning (2 steps)
      sm.advanceStep() // step 0 completed, advance to step 1
      sm.advanceStep() // step 1 completed, phase complete → Implementation

      expect(sm.getState()).toBe('Implementation')
      expect(sm.getSnapshot().phaseIndex).toBe(1)
      expect(sm.getSnapshot().stepIndex).toBe(0)
      expect(sm.getSnapshot().completedSteps).toBe(2)

      // Advance through Implementation (3 steps)
      sm.advanceStep()
      sm.advanceStep()
      sm.advanceStep() // → Review

      expect(sm.getState()).toBe('Review')
      expect(sm.getSnapshot().completedSteps).toBe(5)

      // Advance through Review (2 steps)
      sm.advanceStep()
      sm.advanceStep() // → done

      expect(sm.getState()).toBe('done')
      expect(sm.getSnapshot().completedSteps).toBe(7)

      // Verify state change history
      expect(stateChanges).toEqual([
        ['idle', 'picking_card'],
        ['picking_card', 'Planning'],
        ['Planning', 'Implementation'],
        ['Implementation', 'Review'],
        ['Review', 'done']
      ])
    })
  })

  describe('minimal runbook (1 phase, 1 step)', () => {
    it('goes idle → picking_card → phase → done', () => {
      const sm = new AgentStateMachine(minimalRunbook)
      sm.transition('picking_card')
      sm.transition('Only Phase')
      sm.advanceStep()
      expect(sm.getState()).toBe('done')
      expect(sm.getSnapshot().completedSteps).toBe(1)
    })
  })

  describe('invalid transitions', () => {
    it('rejects idle → done', () => {
      const sm = new AgentStateMachine(simpleRunbook)
      expect(() => sm.transition('done')).toThrow('Invalid transition')
    })

    it('rejects idle → a phase directly', () => {
      const sm = new AgentStateMachine(simpleRunbook)
      expect(() => sm.transition('Planning')).toThrow('Invalid transition')
    })

    it('rejects skipping a phase', () => {
      const sm = new AgentStateMachine(simpleRunbook)
      sm.transition('picking_card')
      sm.transition('Planning')
      expect(() => sm.transition('Review')).toThrow('Invalid transition')
    })

    it('rejects transitioning to a nonexistent state', () => {
      const sm = new AgentStateMachine(simpleRunbook)
      expect(() => sm.transition('nonexistent')).toThrow('Invalid transition')
    })

    it('rejects advanceStep when not in a phase', () => {
      const sm = new AgentStateMachine(simpleRunbook)
      expect(() => sm.advanceStep()).toThrow('not in a phase state')
    })
  })

  describe('waiting_for_human', () => {
    it('pauses and resumes to the same phase and step', () => {
      const sm = new AgentStateMachine(simpleRunbook)
      sm.transition('picking_card')
      sm.transition('Planning')
      sm.advanceStep() // complete step 0, now on step 1

      sm.setWaitingForHuman()
      expect(sm.getState()).toBe('waiting_for_human')
      expect(sm.getSnapshot().phaseIndex).toBe(-1)

      sm.resumeFromWaiting()
      expect(sm.getState()).toBe('Planning')
      expect(sm.getSnapshot().phaseIndex).toBe(0)
      expect(sm.getSnapshot().stepIndex).toBe(1)
    })

    it('can advanceStep after resuming and complete the phase', () => {
      const sm = new AgentStateMachine(simpleRunbook)
      sm.transition('picking_card')
      sm.transition('Planning')
      sm.advanceStep() // complete step 0, now on step 1

      sm.setWaitingForHuman()
      sm.resumeFromWaiting()

      // Should be able to advance step 1 and complete Planning
      sm.advanceStep() // step 1 done → Implementation
      expect(sm.getState()).toBe('Implementation')
      expect(sm.getSnapshot().completedSteps).toBe(2)
    })

    it('rejects setWaitingForHuman when not in a phase', () => {
      const sm = new AgentStateMachine(simpleRunbook)
      expect(() => sm.setWaitingForHuman()).toThrow('not in a phase state')
    })

    it('rejects resumeFromWaiting when not waiting', () => {
      const sm = new AgentStateMachine(simpleRunbook)
      sm.transition('picking_card')
      sm.transition('Planning')
      expect(() => sm.resumeFromWaiting()).toThrow('not in waiting_for_human')
    })
  })

  describe('error handling', () => {
    it('transitions to error from a phase', () => {
      const sm = new AgentStateMachine(simpleRunbook)
      sm.on('error', () => {}) // prevent Node unhandled error throw
      sm.transition('picking_card')
      sm.transition('Planning')

      sm.setError('something broke')
      expect(sm.getState()).toBe('error')
      expect(sm.getSnapshot().error).toBe('something broke')
    })

    it('transitions to error from waiting_for_human', () => {
      const sm = new AgentStateMachine(simpleRunbook)
      sm.on('error', () => {})
      sm.transition('picking_card')
      sm.transition('Planning')
      sm.setWaitingForHuman()

      sm.setError('timeout')
      expect(sm.getState()).toBe('error')
      expect(sm.getSnapshot().error).toBe('timeout')
    })

    it('rejects setError from idle', () => {
      const sm = new AgentStateMachine(simpleRunbook)
      expect(() => sm.setError('nope')).toThrow('not in a phase or waiting state')
    })

    it('can recover from error to idle', () => {
      const sm = new AgentStateMachine(simpleRunbook)
      sm.on('error', () => {})
      sm.transition('picking_card')
      sm.transition('Planning')
      sm.setError('oops')

      sm.transition('idle')
      expect(sm.getState()).toBe('idle')
      expect(sm.getSnapshot().completedSteps).toBe(0)
      expect(sm.getSnapshot().error).toBeUndefined()
    })

    it('can retry from error back into a phase and complete it correctly', () => {
      const sm = new AgentStateMachine(simpleRunbook)
      sm.on('error', () => {})
      sm.transition('picking_card')
      sm.transition('Planning')
      sm.advanceStep() // 1 step done
      expect(sm.getSnapshot().completedSteps).toBe(1)

      sm.setError('oops')
      sm.transition('Planning')
      expect(sm.getState()).toBe('Planning')
      expect(sm.getSnapshot().stepIndex).toBe(0)
      expect(sm.getSnapshot().completedSteps).toBe(0) // reset for this phase

      // Must advance through ALL steps in the phase (not complete early)
      sm.advanceStep() // step 0 done, advance to step 1
      expect(sm.getState()).toBe('Planning') // still in Planning
      sm.advanceStep() // step 1 done, phase complete → Implementation
      expect(sm.getState()).toBe('Implementation')
      expect(sm.getSnapshot().completedSteps).toBe(2)
    })

    it('rejects setError from picking_card', () => {
      const sm = new AgentStateMachine(simpleRunbook)
      sm.transition('picking_card')
      expect(() => sm.setError('nope')).toThrow('not in a phase or waiting state')
    })
  })

  describe('done state', () => {
    it('resets phaseIndex to -1 on done', () => {
      const sm = new AgentStateMachine(minimalRunbook)
      sm.transition('picking_card')
      sm.transition('Only Phase')
      sm.advanceStep()
      expect(sm.getState()).toBe('done')
      expect(sm.getSnapshot().phaseIndex).toBe(-1)
    })

    it('can go from done back to idle', () => {
      const sm = new AgentStateMachine(minimalRunbook)
      sm.transition('picking_card')
      sm.transition('Only Phase')
      sm.advanceStep()
      expect(sm.getState()).toBe('done')

      sm.transition('idle')
      expect(sm.getState()).toBe('idle')
      expect(sm.getSnapshot().completedSteps).toBe(0)
    })

    it('rejects done → picking_card directly', () => {
      const sm = new AgentStateMachine(minimalRunbook)
      sm.transition('picking_card')
      sm.transition('Only Phase')
      sm.advanceStep()
      expect(() => sm.transition('picking_card')).toThrow('Invalid transition')
    })
  })

  describe('events', () => {
    it('emits step:completed and step:advanced', () => {
      const sm = new AgentStateMachine(simpleRunbook)
      const completed: string[] = []
      const advanced: string[] = []

      sm.on('step:completed', (p) => completed.push(p.stepTitle))
      sm.on('step:advanced', (p) => advanced.push(p.stepTitle))

      sm.transition('picking_card')
      sm.transition('Planning')

      sm.advanceStep() // completes "Gather requirements", advances to "Create branch"
      expect(completed).toEqual(['Gather requirements'])
      expect(advanced).toEqual(['Create branch'])
    })

    it('emits phase:completed', () => {
      const sm = new AgentStateMachine(simpleRunbook)
      const phases: string[] = []
      sm.on('phase:completed', (name) => phases.push(name))

      sm.transition('picking_card')
      sm.transition('Planning')
      sm.advanceStep()
      sm.advanceStep() // completes Planning

      expect(phases).toEqual(['Planning'])
    })

    it('emits error event on setError', () => {
      const sm = new AgentStateMachine(simpleRunbook)
      const errors: string[] = []
      sm.on('error', (msg) => errors.push(msg))

      sm.transition('picking_card')
      sm.transition('Planning')
      sm.setError('boom')

      expect(errors).toEqual(['boom'])
    })
  })

  describe('getRestoreData', () => {
    it('captures full machine state including completedStepCounts', () => {
      const sm = new AgentStateMachine(simpleRunbook)
      sm.transition('picking_card')
      sm.transition('Planning')
      sm.advanceStep() // complete step 0, on step 1

      const data = sm.getRestoreData()
      expect(data.state).toBe('Planning')
      expect(data.phaseIndex).toBe(0)
      expect(data.stepIndex).toBe(1)
      expect(data.completedSteps).toBe(1)
      expect(data.completedStepCounts).toEqual([1, 0, 0])
    })

    it('captures waiting-for-human save slots', () => {
      const sm = new AgentStateMachine(simpleRunbook)
      sm.transition('picking_card')
      sm.transition('Planning')
      sm.advanceStep()
      sm.setWaitingForHuman()

      const data = sm.getRestoreData()
      expect(data.state).toBe('waiting_for_human')
      expect(data.stateBeforeWaiting).toBe('Planning')
      expect(data.phaseIndexBeforeWaiting).toBe(0)
      expect(data.stepIndexBeforeWaiting).toBe(1)
    })

    it('captures error state', () => {
      const sm = new AgentStateMachine(simpleRunbook)
      sm.on('error', () => {})
      sm.transition('picking_card')
      sm.transition('Planning')
      sm.setError('test error')

      const data = sm.getRestoreData()
      expect(data.state).toBe('error')
      expect(data.error).toBe('test error')
    })
  })

  describe('restore', () => {
    it('restores a machine mid-phase', () => {
      // Advance a machine partway, capture data, restore into a new machine
      const original = new AgentStateMachine(simpleRunbook)
      original.transition('picking_card')
      original.transition('Planning')
      original.advanceStep() // complete step 0

      const data = original.getRestoreData()
      const restored = AgentStateMachine.restore(simpleRunbook, data)

      expect(restored.getState()).toBe('Planning')
      expect(restored.getSnapshot()).toEqual(original.getSnapshot())
      expect(restored.getRestoreData()).toEqual(data)
    })

    it('restores a machine in waiting_for_human', () => {
      const original = new AgentStateMachine(simpleRunbook)
      original.transition('picking_card')
      original.transition('Planning')
      original.advanceStep()
      original.setWaitingForHuman()

      const data = original.getRestoreData()
      const restored = AgentStateMachine.restore(simpleRunbook, data)

      // Should be able to resume from waiting
      restored.resumeFromWaiting()
      expect(restored.getState()).toBe('Planning')
      expect(restored.getSnapshot().phaseIndex).toBe(0)
      expect(restored.getSnapshot().stepIndex).toBe(1)
    })

    it('restores a machine in error state', () => {
      const original = new AgentStateMachine(simpleRunbook)
      original.on('error', () => {})
      original.transition('picking_card')
      original.transition('Planning')
      original.setError('test error')

      const data = original.getRestoreData()
      const restored = AgentStateMachine.restore(simpleRunbook, data)

      expect(restored.getState()).toBe('error')
      expect(restored.getSnapshot().error).toBe('test error')
    })

    it('restored machine can continue advancing', () => {
      const original = new AgentStateMachine(simpleRunbook)
      original.transition('picking_card')
      original.transition('Planning')
      original.advanceStep() // complete step 0, on step 1

      const data = original.getRestoreData()
      const restored = AgentStateMachine.restore(simpleRunbook, data)

      // Continue from step 1 in Planning
      restored.advanceStep() // complete step 1, phase complete → Implementation
      expect(restored.getState()).toBe('Implementation')
      expect(restored.getSnapshot().completedSteps).toBe(2)
    })

    it('does not emit events during restoration', () => {
      const original = new AgentStateMachine(simpleRunbook)
      original.transition('picking_card')
      original.transition('Planning')
      original.advanceStep()

      const data = original.getRestoreData()

      const events: string[] = []
      const restored = AgentStateMachine.restore(simpleRunbook, data)
      restored.on('state:changed', () => events.push('state:changed'))
      restored.on('step:advanced', () => events.push('step:advanced'))
      restored.on('step:completed', () => events.push('step:completed'))

      // No events should have been captured (restore happened before listeners)
      expect(events).toEqual([])
    })

    it('throws on invalid state name', () => {
      const data = {
        state: 'nonexistent-state',
        phaseIndex: -1,
        stepIndex: -1,
        completedSteps: 0,
        completedStepCounts: [0, 0, 0]
      }
      expect(() => AgentStateMachine.restore(simpleRunbook, data)).toThrow('not a valid state')
    })

    it('throws on out-of-bounds phaseIndex', () => {
      const data = {
        state: 'Planning',
        phaseIndex: 99,
        stepIndex: 0,
        completedSteps: 0,
        completedStepCounts: [0, 0, 0]
      }
      expect(() => AgentStateMachine.restore(simpleRunbook, data)).toThrow('out of bounds')
    })

    it('throws on mismatched completedStepCounts length', () => {
      const data = {
        state: 'Planning',
        phaseIndex: 0,
        stepIndex: 0,
        completedSteps: 0,
        completedStepCounts: [0] // wrong length
      }
      expect(() => AgentStateMachine.restore(simpleRunbook, data)).toThrow(
        'does not match phases'
      )
    })

    it('throws on out-of-bounds stepIndex', () => {
      const data = {
        state: 'Planning',
        phaseIndex: 0,
        stepIndex: 99,
        completedSteps: 0,
        completedStepCounts: [0, 0, 0]
      }
      expect(() => AgentStateMachine.restore(simpleRunbook, data)).toThrow('out of bounds')
    })
  })

  describe('getValidTransitions', () => {
    it('returns valid targets from idle', () => {
      const sm = new AgentStateMachine(simpleRunbook)
      expect(sm.getValidTransitions()).toEqual(['picking_card'])
    })

    it('returns valid targets from a phase', () => {
      const sm = new AgentStateMachine(simpleRunbook)
      sm.transition('picking_card')
      sm.transition('Planning')

      const valid = sm.getValidTransitions()
      expect(valid).toContain('waiting_for_human')
      expect(valid).toContain('error')
      expect(valid).toContain('Implementation')
      expect(valid).not.toContain('done')
    })

    it('returns valid targets from the last phase', () => {
      const sm = new AgentStateMachine(simpleRunbook)
      sm.transition('picking_card')
      sm.transition('Planning')
      sm.advanceStep()
      sm.advanceStep()
      sm.advanceStep()
      sm.advanceStep()
      sm.advanceStep()
      // Now in Review
      expect(sm.getState()).toBe('Review')

      const valid = sm.getValidTransitions()
      expect(valid).toContain('done')
      expect(valid).not.toContain('Planning')
    })
  })
})
