import { describe, it, expect } from 'vitest'
import { extractBoardId } from '../../shared/config'

describe('extractBoardId', () => {
  it('returns raw board ID as-is', () => {
    expect(extractBoardId('MibMpIB8')).toBe('MibMpIB8')
  })

  it('extracts ID from full Trello URL with board slug', () => {
    expect(extractBoardId('https://trello.com/b/MibMpIB8/emaorchestrator')).toBe('MibMpIB8')
  })

  it('extracts ID from Trello URL without board slug', () => {
    expect(extractBoardId('https://trello.com/b/MibMpIB8')).toBe('MibMpIB8')
  })

  it('handles URL with trailing slash', () => {
    expect(extractBoardId('https://trello.com/b/MibMpIB8/')).toBe('MibMpIB8')
  })

  it('trims whitespace', () => {
    expect(extractBoardId('  MibMpIB8  ')).toBe('MibMpIB8')
    expect(extractBoardId('  https://trello.com/b/MibMpIB8/foo  ')).toBe('MibMpIB8')
  })

  it('returns empty string for empty input', () => {
    expect(extractBoardId('')).toBe('')
  })

  it('returns non-URL input unchanged', () => {
    expect(extractBoardId('some-random-text')).toBe('some-random-text')
  })

  it('handles http (non-https) URLs', () => {
    expect(extractBoardId('http://trello.com/b/AbC12345/my-board')).toBe('AbC12345')
  })
})
