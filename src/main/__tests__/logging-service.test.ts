import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import type { LogEntry } from '../../shared/logging'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAppendFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockReadFile = vi.hoisted(() => vi.fn())
const mockMkdir = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('fs/promises', () => ({
  appendFile: mockAppendFile,
  readFile: mockReadFile,
  mkdir: mockMkdir
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/fake/userData')
  }
}))

import { appendLogEntry, readAgentLog, getLogPath } from '../logging-service'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('logging-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getLogPath', () => {
    it('returns path under userData/logs/<agentId>.jsonl', () => {
      const result = getLogPath('agent-123')
      expect(result).toBe(join('/fake/userData', 'logs', 'agent-123.jsonl'))
    })
  })

  describe('appendLogEntry', () => {
    const entry: LogEntry = {
      timestamp: '2026-03-27T12:00:00.000Z',
      agentId: 'agent-1',
      cardName: 'Test Card',
      event: 'agent_started',
      branch: 'feat/test',
      worktreePath: '/fake/worktree'
    }

    it('creates logs directory on first write', async () => {
      await appendLogEntry(entry)
      expect(mockMkdir).toHaveBeenCalledWith(join('/fake/userData', 'logs'), { recursive: true })
    })

    it('appends a JSON line to the agent log file', async () => {
      await appendLogEntry(entry)
      expect(mockAppendFile).toHaveBeenCalledWith(
        join('/fake/userData', 'logs', 'agent-1.jsonl'),
        JSON.stringify(entry) + '\n',
        'utf-8'
      )
    })

    it('does not throw on write errors (fire-and-forget)', async () => {
      mockAppendFile.mockRejectedValueOnce(new Error('disk full'))
      // Should not throw
      await expect(appendLogEntry(entry)).resolves.toBeUndefined()
    })
  })

  describe('readAgentLog', () => {
    it('parses JSONL file into log entries', async () => {
      const entries: LogEntry[] = [
        {
          timestamp: '2026-03-27T12:00:00.000Z',
          agentId: 'agent-1',
          cardName: 'Test Card',
          event: 'agent_started',
          branch: 'feat/test',
          worktreePath: '/fake/worktree'
        },
        {
          timestamp: '2026-03-27T12:01:00.000Z',
          agentId: 'agent-1',
          cardName: 'Test Card',
          event: 'prompt_sent',
          phaseIndex: 0,
          stepIndex: 0,
          phaseName: 'Setup',
          stepTitle: 'Pull latest',
          prompt: 'Do the thing'
        }
      ]
      mockReadFile.mockResolvedValue(entries.map((e) => JSON.stringify(e)).join('\n') + '\n')

      const result = await readAgentLog('agent-1')
      expect(result).toHaveLength(2)
      expect(result[0].event).toBe('agent_started')
      expect(result[1].event).toBe('prompt_sent')
    })

    it('returns empty array if file does not exist', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'))
      const result = await readAgentLog('nonexistent')
      expect(result).toEqual([])
    })

    it('handles empty lines in JSONL', async () => {
      mockReadFile.mockResolvedValue(
        '{"event":"agent_started","timestamp":"","agentId":"a","cardName":"c","branch":"b","worktreePath":"w"}\n\n'
      )
      const result = await readAgentLog('agent-1')
      expect(result).toHaveLength(1)
    })

    it('skips corrupt lines without discarding valid entries', async () => {
      const valid =
        '{"event":"agent_started","timestamp":"","agentId":"a","cardName":"c","branch":"b","worktreePath":"w"}'
      mockReadFile.mockResolvedValue(`${valid}\nNOT_JSON\n${valid}\n`)
      const result = await readAgentLog('agent-1')
      expect(result).toHaveLength(2)
      expect(result[0].event).toBe('agent_started')
      expect(result[1].event).toBe('agent_started')
    })
  })
})
