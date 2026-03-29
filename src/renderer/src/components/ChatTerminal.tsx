import { useEffect, useRef, useState, useCallback } from 'react'
import { getBlocks, subscribe } from '../services/message-stream-service'
import BlockRenderer from './blocks/BlockRenderer'
import type { MessageBlock, BlockUpdate } from '@shared/message-block'
import './ChatTerminal.css'
import './blocks/blocks.css'

interface ChatTerminalProps {
  agentId: string
}

function ChatTerminal({ agentId }: ChatTerminalProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const blocksRef = useRef<MessageBlock[]>([])
  const [version, setVersion] = useState(0)
  const autoScrollRef = useRef(true)

  // Track whether the user has scrolled away from the bottom
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30
    autoScrollRef.current = atBottom
  }, [])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
      autoScrollRef.current = true
      // Force re-render to hide the jump button
      setVersion((v) => v + 1)
    }
  }, [])

  useEffect(() => {
    // Load existing blocks for this agent (replay on mount / agent switch)
    blocksRef.current = [...getBlocks(agentId)]
    autoScrollRef.current = true
    setVersion((v) => v + 1)

    // Subscribe for live updates
    const unsubscribe = subscribe(agentId, (update: BlockUpdate) => {
      switch (update.type) {
        case 'block:appended':
          // Clone so blocksRef never holds a live store reference — in-place
          // mutations to the store object would make React.memo comparisons
          // see stale === fresh, skipping re-renders.
          blocksRef.current = [...blocksRef.current, { ...update.block }]
          break
        case 'block:updated': {
          // Clone the FRESH block from the store — blocksRef may hold a stale clone
          // from a previous update, so mutations to the store block won't be reflected.
          const idx = update.blockIndex
          const fresh = getBlocks(agentId)[idx]
          blocksRef.current = blocksRef.current.map((b, i) =>
            i === idx && fresh ? { ...fresh } : b
          )
          break
        }
        case 'blocks:reset':
          blocksRef.current = [...getBlocks(agentId)]
          break
      }
      setVersion((v) => v + 1)
    })

    return () => {
      unsubscribe()
    }
  }, [agentId])

  // Auto-scroll on new content
  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [version])

  const blocks = blocksRef.current

  return (
    <div className="chat-terminal">
      <div className="chat-terminal__scroll-area" ref={scrollRef} onScroll={handleScroll}>
        {blocks.length === 0 ? (
          <div className="chat-terminal__empty">Waiting for agent output...</div>
        ) : (
          blocks.map((block) => <BlockRenderer key={block.id} block={block} />)
        )}
      </div>
      {!autoScrollRef.current && blocks.length > 0 && (
        <button className="chat-terminal__jump-btn" onClick={scrollToBottom}>
          ↓ Jump to bottom
        </button>
      )}
    </div>
  )
}

export default ChatTerminal
