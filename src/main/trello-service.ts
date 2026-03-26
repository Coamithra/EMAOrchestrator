import type { TrelloCredentials, TrelloList, TrelloCard } from '../shared/trello'

const TRELLO_API_BASE = 'https://api.trello.com/1'
const REQUEST_TIMEOUT_MS = 10_000

function authParams(creds: TrelloCredentials): string {
  return `key=${creds.apiKey}&token=${creds.apiToken}`
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
    console.error('Trello getListsForBoard error:', err)
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
    console.error('Trello getCardsFromList error:', err)
    return []
  }
}

/** Move a card to a different list. Fails silently on error. */
export async function moveCard(
  cardId: string,
  targetListId: string,
  creds: TrelloCredentials
): Promise<boolean> {
  try {
    const url = `${TRELLO_API_BASE}/cards/${cardId}?idList=${targetListId}&${authParams(creds)}`
    const res = await fetch(url, {
      method: 'PUT',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!res.ok) {
      console.error(`Trello moveCard failed: ${res.status}`)
      return false
    }
    return true
  } catch (err) {
    console.error('Trello moveCard error:', err)
    return false
  }
}

/** Add a comment to a card. Fails silently on error. */
export async function addComment(
  cardId: string,
  text: string,
  creds: TrelloCredentials
): Promise<boolean> {
  try {
    const url = `${TRELLO_API_BASE}/cards/${cardId}/actions/comments?text=${encodeURIComponent(text)}&${authParams(creds)}`
    const res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!res.ok) {
      console.error(`Trello addComment failed: ${res.status}`)
      return false
    }
    return true
  } catch (err) {
    console.error('Trello addComment error:', err)
    return false
  }
}
