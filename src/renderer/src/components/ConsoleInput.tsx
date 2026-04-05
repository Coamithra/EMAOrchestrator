import { useState, useCallback, useRef, useEffect } from 'react'
import './ConsoleInput.css'

// Global pause-on-send state — survives component remounts across agent switches
let globalPauseOnSend = true

interface ConsoleInputProps {
  agentId: string
  disabled?: boolean
}

function ConsoleInput({ agentId, disabled = false }: ConsoleInputProps): React.JSX.Element {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pauseOnSend, setPauseOnSend] = useState(globalPauseOnSend)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // -- Command queue --
  const [queue, setQueue] = useState<string[]>([])
  const processingRef = useRef(false)
  const queueRef = useRef<string[]>([])
  queueRef.current = queue

  // -- Command history --
  const historyRef = useRef<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1) // -1 = current draft
  const draftRef = useRef('')

  // -- Resize state --
  const [inputMaxHeight, setInputMaxHeight] = useState(120)
  const isDraggingRef = useRef(false)
  const dragStartYRef = useRef(0)
  const dragStartHeightRef = useRef(0)

  // Sync global pause state
  useEffect(() => {
    globalPauseOnSend = pauseOnSend
  }, [pauseOnSend])

  // Auto-resize textarea to content (respecting user-set max)
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, inputMaxHeight) + 'px'
  }, [value, inputMaxHeight])

  // -- Queue processor --
  // Reads from queueRef so it always sees items added mid-flight by handleSubmit.
  const processQueue = useCallback(async () => {
    if (processingRef.current) return
    processingRef.current = true
    setError(null)

    while (queueRef.current.length > 0) {
      const prompt = queueRef.current[0]
      const remaining = queueRef.current.slice(1)
      queueRef.current = remaining
      setQueue(remaining)
      try {
        await window.api.sendDirectPrompt(agentId, prompt)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        break
      }
    }

    processingRef.current = false
    setQueue([])

    // Auto-resume orchestration if pause-on-send is off
    if (!globalPauseOnSend) {
      try {
        await window.api.startOrchestration(agentId)
      } catch {
        // Agent may already be running or done — ignore
      }
    }
  }, [agentId])

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return

    // Add to command history
    historyRef.current = [trimmed, ...historyRef.current.slice(0, 99)]
    setHistoryIndex(-1)
    draftRef.current = ''
    setValue('')

    // Always append to the ref-backed queue
    const updated = [...queueRef.current, trimmed]
    queueRef.current = updated
    setQueue(updated)

    if (!processingRef.current) {
      processQueue()
    }
  }, [value, disabled, processQueue])

  // -- History navigation --
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
        return
      }

      const history = historyRef.current
      if (e.key === 'ArrowUp') {
        // Only navigate history when cursor is on the first line
        const el = textareaRef.current
        if (el) {
          const textBefore = el.value.substring(0, el.selectionStart)
          if (textBefore.includes('\n')) return // not on first line
        }
        if (history.length === 0) return
        e.preventDefault()
        const newIndex = historyIndex + 1
        if (newIndex >= history.length) return
        // Save current value as draft when leaving index -1
        if (historyIndex === -1) {
          draftRef.current = value
        }
        setHistoryIndex(newIndex)
        setValue(history[newIndex])
      } else if (e.key === 'ArrowDown') {
        // Only navigate history when cursor is on the last line
        const el = textareaRef.current
        if (el) {
          const textAfter = el.value.substring(el.selectionEnd)
          if (textAfter.includes('\n')) return // not on last line
        }
        if (historyIndex < 0) return
        e.preventDefault()
        const newIndex = historyIndex - 1
        setHistoryIndex(newIndex)
        if (newIndex < 0) {
          // Back to draft
          setValue(draftRef.current)
        } else {
          setValue(history[newIndex])
        }
      }
    },
    [handleSubmit, historyIndex, value]
  )

  // -- Resize drag handlers --
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDraggingRef.current = true
    dragStartYRef.current = e.clientY
    dragStartHeightRef.current = inputMaxHeight
  }, [inputMaxHeight])

  useEffect(() => {
    function onMouseMove(e: MouseEvent): void {
      if (!isDraggingRef.current) return
      // Dragging up → larger input (negative delta = more height)
      const delta = dragStartYRef.current - e.clientY
      const newHeight = Math.max(60, Math.min(400, dragStartHeightRef.current + delta))
      setInputMaxHeight(newHeight)
    }
    function onMouseUp(): void {
      if (isDraggingRef.current) {
        isDraggingRef.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
    function onMouseDown(): void {
      if (isDraggingRef.current) {
        document.body.style.cursor = 'row-resize'
        document.body.style.userSelect = 'none'
      }
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [])

  const isProcessing = processingRef.current || queue.length > 0

  return (
    <div className="console-input">
      {/* Resize handle */}
      <div
        className="console-input__resize-handle"
        onMouseDown={handleResizeMouseDown}
        title="Drag to resize"
      />
      {error && (
        <div className="console-input__error" onClick={() => setError(null)}>
          {error}
        </div>
      )}
      {queue.length > 0 && (
        <div className="console-input__queue-badge">
          {queue.length} queued
        </div>
      )}
      <div className="console-input__row">
        <textarea
          ref={textareaRef}
          className="console-input__textarea"
          style={{ maxHeight: inputMaxHeight }}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            // Reset history browsing when user types
            if (historyIndex >= 0) {
              setHistoryIndex(-1)
              draftRef.current = e.target.value
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={isProcessing ? 'Type to queue another command...' : 'Interact with this agent directly'}
          disabled={disabled}
          rows={1}
        />
        <div className="console-input__controls">
          <button
            className="console-input__send-btn"
            onClick={handleSubmit}
            disabled={disabled || !value.trim()}
            title="Send (Enter)"
          >
            {isProcessing ? `${queue.length + 1}` : '\u2191'}
          </button>
          <label className="console-input__pause-label" title="Pause orchestration while direct prompt runs">
            <input
              type="checkbox"
              className="console-input__pause-checkbox"
              checked={pauseOnSend}
              onChange={(e) => setPauseOnSend(e.target.checked)}
            />
            <span className="console-input__pause-icon">{pauseOnSend ? '\u23F8' : '\u25B6'}</span>
          </label>
        </div>
      </div>
    </div>
  )
}

export default ConsoleInput
