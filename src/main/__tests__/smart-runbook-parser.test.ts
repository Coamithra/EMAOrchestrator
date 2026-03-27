import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock the Agent SDK query function
const mockQueryIterator = vi.fn()

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(() => mockQueryIterator())
}))

// Import after mocking
import { parseRunbookSmart } from '../smart-runbook-parser'

function makeAssistantMessage(text: string): object {
  return {
    type: 'assistant',
    message: {
      content: [{ type: 'text', text }]
    }
  }
}

function makeAsyncIterable(messages: object[]): AsyncIterable<object> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0
      return {
        async next() {
          if (i < messages.length) return { value: messages[i++], done: false }
          return { value: undefined, done: true }
        }
      }
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('parseRunbookSmart', () => {
  it('parses a valid JSON response into a Runbook', async () => {
    const json = JSON.stringify({
      phases: [
        {
          name: 'Setup',
          steps: [
            { phase: 'Setup', index: 1, title: 'Install deps', description: 'Run npm install' }
          ]
        },
        {
          name: 'Build',
          steps: [
            { phase: 'Build', index: 1, title: 'Compile', description: 'Run npm run build' },
            { phase: 'Build', index: 2, title: 'Test', description: 'Run tests' }
          ]
        }
      ]
    })

    mockQueryIterator.mockReturnValue(makeAsyncIterable([makeAssistantMessage(json)]))

    const runbook = await parseRunbookSmart('## Setup\n1. Install deps\n## Build\n1. Compile\n2. Test')

    expect(runbook.phases).toHaveLength(2)
    expect(runbook.phases[0].name).toBe('Setup')
    expect(runbook.phases[0].steps).toHaveLength(1)
    expect(runbook.phases[0].steps[0].title).toBe('Install deps')
    expect(runbook.phases[1].name).toBe('Build')
    expect(runbook.phases[1].steps).toHaveLength(2)
  })

  it('handles JSON wrapped in markdown fences', async () => {
    const json = '```json\n' + JSON.stringify({
      phases: [{ name: 'Phase', steps: [{ title: 'Step', description: 'Do it' }] }]
    }) + '\n```'

    mockQueryIterator.mockReturnValue(makeAsyncIterable([makeAssistantMessage(json)]))

    const runbook = await parseRunbookSmart('anything')

    expect(runbook.phases).toHaveLength(1)
    expect(runbook.phases[0].steps[0].title).toBe('Step')
  })

  it('normalizes phase and index fields', async () => {
    const json = JSON.stringify({
      phases: [{
        name: 'MyPhase',
        steps: [
          { title: 'First', description: 'desc', phase: 'wrong', index: 99 },
          { title: 'Second', description: '' }
        ]
      }]
    })

    mockQueryIterator.mockReturnValue(makeAsyncIterable([makeAssistantMessage(json)]))

    const runbook = await parseRunbookSmart('anything')

    // phase field should be normalized to the parent phase name
    expect(runbook.phases[0].steps[0].phase).toBe('MyPhase')
    // index should be normalized to sequential 1-based
    expect(runbook.phases[0].steps[0].index).toBe(1)
    expect(runbook.phases[0].steps[1].index).toBe(2)
  })

  it('throws when response has no JSON', async () => {
    mockQueryIterator.mockReturnValue(
      makeAsyncIterable([makeAssistantMessage('Sorry, I cannot parse that.')])
    )

    await expect(parseRunbookSmart('anything')).rejects.toThrow('no JSON found')
  })

  it('throws when phases array is empty', async () => {
    const json = JSON.stringify({ phases: [] })
    mockQueryIterator.mockReturnValue(makeAsyncIterable([makeAssistantMessage(json)]))

    await expect(parseRunbookSmart('anything')).rejects.toThrow('non-empty array')
  })

  it('throws when a phase has no steps', async () => {
    const json = JSON.stringify({ phases: [{ name: 'Empty', steps: [] }] })
    mockQueryIterator.mockReturnValue(makeAsyncIterable([makeAssistantMessage(json)]))

    await expect(parseRunbookSmart('anything')).rejects.toThrow('has no steps')
  })

  it('concatenates text from multiple assistant messages', async () => {
    const half1 = '{"phases":[{"name":"P","step'
    const half2 = 's":[{"title":"S","description":"D"}]}]}'

    mockQueryIterator.mockReturnValue(
      makeAsyncIterable([makeAssistantMessage(half1), makeAssistantMessage(half2)])
    )

    const runbook = await parseRunbookSmart('anything')
    expect(runbook.phases[0].steps[0].title).toBe('S')
  })
})
