import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseRunbookContent } from '../runbook-parser'

const fixture = (name: string): string =>
  readFileSync(resolve(__dirname, 'fixtures', name), 'utf-8')

describe('parseRunbookContent', () => {
  describe('simple runbook (3 phases, 7 steps)', () => {
    const runbook = parseRunbookContent(fixture('simple-runbook.md'))

    it('extracts all phases', () => {
      expect(runbook.phases).toHaveLength(3)
      expect(runbook.phases.map((p) => p.name)).toEqual([
        'Planning',
        'Implementation',
        'Review'
      ])
    })

    it('extracts steps per phase', () => {
      expect(runbook.phases[0].steps).toHaveLength(2)
      expect(runbook.phases[1].steps).toHaveLength(3)
      expect(runbook.phases[2].steps).toHaveLength(2)
    })

    it('parses bold titles and descriptions', () => {
      const step = runbook.phases[0].steps[0]
      expect(step.title).toBe('Gather requirements')
      expect(step.description).toBe(
        'Review the ticket and collect all acceptance criteria.'
      )
    })

    it('assigns correct phase name to each step', () => {
      for (const phase of runbook.phases) {
        for (const step of phase.steps) {
          expect(step.phase).toBe(phase.name)
        }
      }
    })

    it('assigns sequential 1-based indices within each phase', () => {
      for (const phase of runbook.phases) {
        phase.steps.forEach((step, i) => {
          expect(step.index).toBe(i + 1)
        })
      }
    })

    it('captures continuation lines in description', () => {
      const step = runbook.phases[1].steps[0]
      expect(step.title).toBe('Write the code')
      expect(step.description).toContain('Make sure to follow coding conventions')
    })
  })

  describe('minimal runbook (2 phases, 3 steps)', () => {
    const runbook = parseRunbookContent(fixture('minimal-runbook.md'))

    it('extracts both phases', () => {
      expect(runbook.phases).toHaveLength(2)
      expect(runbook.phases.map((p) => p.name)).toEqual(['Setup', 'Deploy'])
    })

    it('handles step without bold title', () => {
      const step = runbook.phases[1].steps[0]
      expect(step.title).toBe('Push to main branch.')
      expect(step.description).toBe('')
    })

    it('handles step with bold title', () => {
      const step = runbook.phases[1].steps[1]
      expect(step.title).toBe('Verify deployment')
      expect(step.description).toBe(
        'Check the production URL responds with 200.'
      )
    })
  })

  describe('edge cases', () => {
    it('returns empty phases for content with no H2 headers', () => {
      const runbook = parseRunbookContent('# Just a title\nSome text\n')
      expect(runbook.phases).toEqual([])
    })

    it('returns empty steps for a phase with no numbered items', () => {
      const runbook = parseRunbookContent('## Phase One\nJust some prose.\n')
      expect(runbook.phases).toHaveLength(1)
      expect(runbook.phases[0].steps).toEqual([])
    })

    it('handles empty input', () => {
      const runbook = parseRunbookContent('')
      expect(runbook.phases).toEqual([])
    })

    it('handles Windows-style line endings', () => {
      const md = '## Phase\r\n1. **Step one** Do the thing.\r\n'
      const runbook = parseRunbookContent(md)
      expect(runbook.phases[0].steps[0].title).toBe('Step one')
    })

    it('does not treat H3 headers as phases', () => {
      const md = '## Real Phase\n### Sub-heading\n1. **Step** Do it.\n'
      const runbook = parseRunbookContent(md)
      expect(runbook.phases).toHaveLength(1)
      expect(runbook.phases[0].name).toBe('Real Phase')
    })

    it('strips leading em-dash from descriptions', () => {
      const md = '## Phase\n1. **Pull latest main** — `git pull origin main` to stay current\n'
      const runbook = parseRunbookContent(md)
      expect(runbook.phases[0].steps[0].description).toBe(
        '`git pull origin main` to stay current'
      )
    })

    it('captures unindented continuation lines', () => {
      const md = '## Phase\n1. **Step** First line.\nSecond line here.\n'
      const runbook = parseRunbookContent(md)
      expect(runbook.phases[0].steps[0].description).toContain('Second line here.')
    })
  })
})
