import { useState, useEffect, useCallback } from 'react'
import type { TrelloCard } from '@shared/trello'
import { branchNameFromCard } from '@shared/branch-name'
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

  const handleCardKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLLIElement>, cardId: string) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setSelectedCardId(cardId)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        const next = e.currentTarget.nextElementSibling as HTMLElement | null
        next?.focus()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const prev = e.currentTarget.previousElementSibling as HTMLElement | null
        prev?.focus()
      }
    },
    []
  )

  const selectedCard = cards.find((c) => c.id === selectedCardId)

  return (
    <div
      className="interaction-dialog new-agent-dialog--overlay"
      role="dialog"
      aria-modal="true"
      aria-label="New Agent"
      onClick={creating ? undefined : onClose}
    >
      <div
        className="interaction-dialog__card new-agent-dialog--wider"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="interaction-dialog__header">
          <span className="interaction-dialog__title">New Agent</span>
        </div>

        <div className="interaction-dialog__body">
          <div>
            <div className="new-agent-dialog__label">Select a card from Backlog</div>
            {loading ? (
              <div className="new-agent-dialog__empty">Loading cards...</div>
            ) : cards.length === 0 ? (
              <div className="new-agent-dialog__empty">No cards in Backlog</div>
            ) : (
              <ul className="new-agent-dialog__card-list" role="listbox">
                {cards.map((card) => (
                  <li
                    key={card.id}
                    role="option"
                    aria-selected={card.id === selectedCardId}
                    tabIndex={0}
                    className={`new-agent-dialog__card-item${
                      card.id === selectedCardId ? ' new-agent-dialog__card-item--selected' : ''
                    }`}
                    onClick={() => setSelectedCardId(card.id)}
                    onKeyDown={(e) => handleCardKeyDown(e, card.id)}
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
              <div className="new-agent-dialog__branch-preview">
                {branchNameFromCard(selectedCard.name)}
              </div>
            </div>
          )}

          {error && <div className="new-agent-dialog__error">{error}</div>}
        </div>

        <div className="interaction-dialog__actions">
          <button
            className="interaction-dialog__btn interaction-dialog__btn--secondary"
            onClick={onClose}
            disabled={creating}
          >
            Cancel
          </button>
          <button
            className="interaction-dialog__btn interaction-dialog__btn--submit"
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

export default NewAgentDialog
