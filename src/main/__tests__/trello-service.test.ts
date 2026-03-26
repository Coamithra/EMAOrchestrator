import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import {
  getListsForBoard,
  getListIdByName,
  getCardsFromList,
  moveCard,
  addComment
} from '../trello-service'

const creds = { apiKey: 'key123', apiToken: 'tok456' }

beforeEach(() => {
  vi.clearAllMocks()
})

// ── getListsForBoard ──────────────────────────────────────────────────────

describe('getListsForBoard', () => {
  it('returns parsed lists on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 'list1', name: 'Backlog', extra: true },
        { id: 'list2', name: 'Done', extra: true }
      ]
    })

    const result = await getListsForBoard('board1', creds)
    expect(result).toEqual([
      { id: 'list1', name: 'Backlog' },
      { id: 'list2', name: 'Done' }
    ])
    expect(mockFetch).toHaveBeenCalledOnce()
    expect(mockFetch.mock.calls[0][0]).toContain('/boards/board1/lists')
    expect(mockFetch.mock.calls[0][0]).toContain('key=key123')
    expect(mockFetch.mock.calls[0][0]).toContain('token=tok456')
  })

  it('returns empty array on HTTP error', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 })
    const result = await getListsForBoard('board1', creds)
    expect(result).toEqual([])
  })

  it('returns empty array on network error', async () => {
    mockFetch.mockRejectedValue(new Error('timeout'))
    const result = await getListsForBoard('board1', creds)
    expect(result).toEqual([])
  })
})

// ── getListIdByName ───────────────────────────────────────────────────────

describe('getListIdByName', () => {
  it('resolves list name to ID (case-insensitive)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 'list1', name: 'Backlog' },
        { id: 'list2', name: 'In Progress' }
      ]
    })

    expect(await getListIdByName('board1', 'in progress', creds)).toBe('list2')
    expect(await getListIdByName('board1', 'BACKLOG', creds)).toBe('list1')
  })

  it('returns null when list not found', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'list1', name: 'Backlog' }]
    })

    expect(await getListIdByName('board1', 'Nonexistent', creds)).toBeNull()
  })
})

// ── getCardsFromList ──────────────────────────────────────────────────────

describe('getCardsFromList', () => {
  it('returns parsed cards with desc mapped to description', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 'card1', name: 'Fix bug', desc: 'Bug details' },
        { id: 'card2', name: 'Add feature', desc: '' }
      ]
    })

    const result = await getCardsFromList('list1', creds)
    expect(result).toEqual([
      { id: 'card1', name: 'Fix bug', description: 'Bug details' },
      { id: 'card2', name: 'Add feature', description: '' }
    ])
  })

  it('returns empty array on HTTP error', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 })
    expect(await getCardsFromList('list1', creds)).toEqual([])
  })

  it('returns empty array on network error', async () => {
    mockFetch.mockRejectedValue(new Error('timeout'))
    expect(await getCardsFromList('list1', creds)).toEqual([])
  })
})

// ── moveCard ──────────────────────────────────────────────────────────────

describe('moveCard', () => {
  it('sends PUT and returns true on success', async () => {
    mockFetch.mockResolvedValue({ ok: true })

    const result = await moveCard('card1', 'list2', creds)
    expect(result).toBe(true)
    expect(mockFetch).toHaveBeenCalledOnce()

    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toContain('/cards/card1')
    expect(url).toContain('idList=list2')
    expect(options.method).toBe('PUT')
  })

  it('returns false on 4xx client error without retrying', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400 })
    expect(await moveCard('card1', 'list2', creds)).toBe(false)
    expect(mockFetch).toHaveBeenCalledOnce() // no retry
  })

  it('retries on 5xx server error and succeeds on second attempt', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true })

    const result = await moveCard('card1', 'list2', creds)
    expect(result).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('retries on network error up to 3 times total', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))

    const result = await moveCard('card1', 'list2', creds)
    expect(result).toBe(false)
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('returns true if a retry succeeds after initial failure', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ ok: true })

    const result = await moveCard('card1', 'list2', creds)
    expect(result).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})

// ── addComment ────────────────────────────────────────────────────────────

describe('addComment', () => {
  it('sends POST with URL-encoded text and returns true on success', async () => {
    mockFetch.mockResolvedValue({ ok: true })

    const result = await addComment('card1', 'Hello & world', creds)
    expect(result).toBe(true)

    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toContain('/cards/card1/actions/comments')
    expect(url).not.toContain('text=')
    expect(options.method).toBe('POST')
    expect(options.body).toBe('text=Hello%20%26%20world')
    expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
  })

  it('returns false on 4xx client error without retrying', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 422 })
    expect(await addComment('card1', 'test', creds)).toBe(false)
    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it('retries on 5xx and returns false after all attempts fail', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: false, status: 503 })

    expect(await addComment('card1', 'test', creds)).toBe(false)
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('retries on network error and succeeds on third attempt', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ ok: true })

    expect(await addComment('card1', 'test', creds)).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })
})
