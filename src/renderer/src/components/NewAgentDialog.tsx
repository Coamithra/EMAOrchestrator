import { useState, useEffect, useCallback } from 'react'
import type { TrelloCard } from '@shared/trello'
import './NewAgentDialog.css'

interface NewAgentDialogProps {
  onCreated: (agentId: string) => void
  onClose: () => void
}

function NewAgentDialog({ onCreated, onClose }: NewAgentDialogProps): React.JSX.Element {
  const [cards, setCards] = useState<TrelloCard[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api
      .getTrelloBacklogCards()
      .then((result) => {
        setCards(result as TrelloCard[])
        setLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to fetch backlog cards')
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape' && !creating) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, creating])

  const handleStart = useCallback(async () => {
    const card = cards.find((c) => c.id === selectedCardId)
    if (!card) return

    setCreating(true)
    setError(null)
    try {
      const agentId = await window.api.createAgent({
        id: card.id,
        name: card.name,
        description: card.description
      })
      onCreated(agentId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent')
      setCreating(false)
    }
  }, [cards, selectedCardId, onCreated])

  const selectedCard = cards.find((c) => c.id === selectedCardId)

  return (
    <div
      className="new-agent-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="New Agent"
      onClick={creating ? undefined : onClose}
    >
      <div className="new-agent-dialog__card" onClick={(e) => e.stopPropagation()}>
        <div className="new-agent-dialog__header">
          <span className="new-agent-dialog__title">New Agent</span>
        </div>

        <div className="new-agent-dialog__body">
          <div>
            <div className="new-agent-dialog__label">Select a card from Backlog</div>
            {loading ? (
              <div className="new-agent-dialog__empty">Loading cards...</div>
            ) : cards.length === 0 ? (
              <div className="new-agent-dialog__empty">No cards in Backlog</div>
            ) : (
              <ul className="new-agent-dialog__card-list">
                {cards.map((card) => (
                  <li
                    key={card.id}
                    className={`new-agent-dialog__card-item${
                      card.id === selectedCardId ? ' new-agent-dialog__card-item--selected' : ''
                    }`}
                    onClick={() => setSelectedCardId(card.id)}
                  >
                    <div>{card.name}</div>
                    {card.description && (
                      <div className="new-agent-dialog__card-desc">
                        {card.description.slice(0, 120)}
                        {card.description.length > 120 ? '...' : ''}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {selectedCard && (
            <div>
              <div className="new-agent-dialog__label">Branch (auto-generated)</div>
              <div style={{ fontSize: 13, fontFamily: 'monospace', color: 'var(--ev-c-text-2)' }}>
                {branchPreview(selectedCard.name)}
              </div>
            </div>
          )}

          {error && <div className="new-agent-dialog__error">{error}</div>}
        </div>

        <div className="new-agent-dialog__actions">
          <button
            className="new-agent-dialog__btn new-agent-dialog__btn--cancel"
            onClick={onClose}
            disabled={creating}
          >
            Cancel
          </button>
          <button
            className="new-agent-dialog__btn new-agent-dialog__btn--start"
            onClick={handleStart}
            disabled={!selectedCardId || creating}
          >
            {creating ? 'Creating...' : 'Start'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Mirror the branch name derivation from AgentManager.branchNameFromCard */
function branchPreview(cardName: string): string {
  const stripped = cardName.replace(/^#\d+\s*/, '')
  const slug = stripped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `feat-${slug}`
}

export default NewAgentDialog
