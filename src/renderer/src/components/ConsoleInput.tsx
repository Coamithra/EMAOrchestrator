import { useState, useCallback, useRef, useEffect } from 'react'
import './ConsoleInput.css'

interface ConsoleInputProps {
  agentId: string
  disabled?: boolean
}

function ConsoleInput({ agentId, disabled = false }: ConsoleInputProps): React.JSX.Element {
  const [value, setValue] = useState('')
  const [sending, setSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea to content
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [value])

  const handleSubmit = useCallback(async () => {
    const trimmed = value.trim()
    if (!trimmed || sending || disabled) return

    setSending(true)
    setValue('')
    try {
      await window.api.sendDirectPrompt(agentId, trimmed)
    } catch (err) {
      console.error('Direct prompt failed:', err)
    } finally {
      setSending(false)
    }
  }, [agentId, value, sending, disabled])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit]
  )

  const isDisabled = disabled || sending

  return (
    <div className="console-input">
      <textarea
        ref={textareaRef}
        className="console-input__textarea"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Interact with this agent directly"
        disabled={isDisabled}
        rows={1}
      />
      <button
        className="console-input__send-btn"
        onClick={handleSubmit}
        disabled={isDisabled || !value.trim()}
        title="Send (Enter)"
      >
        {sending ? '...' : '\u2191'}
      </button>
    </div>
  )
}

export default ConsoleInput
