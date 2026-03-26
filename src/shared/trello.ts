/** Credentials needed for Trello REST API calls. */
export interface TrelloCredentials {
  apiKey: string
  apiToken: string
}

/** Minimal Trello list representation. */
export interface TrelloList {
  id: string
  name: string
}

/** Minimal Trello card representation (matches what the UI needs for card selection). */
export interface TrelloCard {
  id: string
  name: string
  description: string
}
