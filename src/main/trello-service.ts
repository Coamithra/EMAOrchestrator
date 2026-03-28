import type { TrelloCredentials, TrelloList, TrelloCard } from '../shared/trello'

const TRELLO_API_BASE = 'https://api.trello.com/1'
const REQUEST_TIMEOUT_MS = 10_000
const MAX_RETRIES = 2 // 3 total attempts
const RETRY_BASE_MS = 1_000

function authParams(creds: TrelloCredentials): string {
  return `key=${creds.apiKey}&token=${creds.apiToken}`
}

/** Extract a safe error message (avoids leaking credentials from URLs in error objects). */
function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    // DOMException from AbortSignal.timeout includes no URL — safe to use directly.
    // TypeError from fetch may include the full URL — strip it.
    return err.name === 'TypeError' ? 'Network request failed' : err.message
  }
  return 'Unknown error'
}

/** Fetch all open lists for a board. Returns empty array on failure. */
export async function getListsForBoard(
  boardId: string,
  creds: TrelloCredentials
): Promise<TrelloList[]> {
  try {
    const url = `${TRELLO_API_BASE}/boards/${boardId}/lists?filter=open&${authParams(creds)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (!res.ok) {
      console.error(`Trello getListsForBoard failed: ${res.status}`)
      return []
    }
    const data: Array<{ id: string; name: string }> = await res.json()
    return data.map((l) => ({ id: l.id, name: l.name }))
  } catch (err) {
    console.error(`Trello getListsForBoard error: ${safeErrorMessage(err)}`)
    return []
  }
}

/** Resolve a list name to its ID. Returns null if not found or on failure. */
export async function getListIdByName(
  boardId: string,
  listName: string,
  creds: TrelloCredentials
): Promise<string | null> {
  const lists = await getListsForBoard(boardId, creds)
  const match = lists.find((l) => l.name.toLowerCase() === listName.toLowerCase())
  return match?.id ?? null
}

/** Fetch all open cards from a list. Returns empty array on failure. */
export async function getCardsFromList(
  listId: string,
  creds: TrelloCredentials
): Promise<TrelloCard[]> {
  try {
    const url = `${TRELLO_API_BASE}/lists/${listId}/cards?filter=open&fields=name,desc&${authParams(creds)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (!res.ok) {
      console.error(`Trello getCardsFromList failed: ${res.status}`)
      return []
    }
    const data: Array<{ id: string; name: string; desc: string }> = await res.json()
    return data.map((c) => ({ id: c.id, name: c.name, description: c.desc }))
  } catch (err) {
    console.error(`Trello getCardsFromList error: ${safeErrorMessage(err)}`)
    return []
  }
}

/** Move a card to a different list. Retries with exponential backoff on failure. */
export async function moveCard(
  cardId: string,
  targetListId: string,
  creds: TrelloCredentials
): Promise<boolean> {
  const url = `${TRELLO_API_BASE}/cards/${cardId}?idList=${targetListId}&${authParams(creds)}`
  return mutateWithRetry(url, { method: 'PUT' }, 'moveCard')
}

/** Add a comment to a card. Retries with exponential backoff on failure. */
export async function addComment(
  cardId: string,
  text: string,
  creds: TrelloCredentials
): Promise<boolean> {
  const url = `${TRELLO_API_BASE}/cards/${cardId}/actions/comments?${authParams(creds)}`
  return mutateWithRetry(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `text=${encodeURIComponent(text)}`
    },
    'addComment'
  )
}

/**
 * Move a card back to its source list. Falls back to the first backlog list
 * if sourceListId is missing (backward compat for pre-existing agents).
 * Fire-and-forget safe — swallows errors silently (moveCard already logs).
 */
export async function moveCardToSourceList(
  cardId: string,
  sourceListId: string | undefined,
  backlogListIds: string[],
  creds: TrelloCredentials
): Promise<void> {
  const targetListId = sourceListId || backlogListIds[0]
  if (!targetListId) return
  await moveCard(cardId, targetListId, creds)
}

/**
 * Execute a Trello mutation with retry and exponential backoff.
 * Retries on network errors and 5xx server errors. Does not retry 4xx client errors.
 */
async function mutateWithRetry(
  url: string,
  init: RequestInit,
  label: string
): Promise<boolean> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
      if (res.ok) return true
      if (res.status >= 400 && res.status < 500) {
        // Client error — don't retry
        console.error(`Trello ${label} failed: ${res.status} (not retrying)`)
        return false
      }
      // Server error — retry
      console.error(`Trello ${label} failed: ${res.status} (attempt ${attempt + 1}/${MAX_RETRIES + 1})`)
    } catch (err) {
      console.error(
        `Trello ${label} error: ${safeErrorMessage(err)} (attempt ${attempt + 1}/${MAX_RETRIES + 1})`
      )
    }
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_BASE_MS * Math.pow(2, attempt)))
    }
  }
  return false
}
