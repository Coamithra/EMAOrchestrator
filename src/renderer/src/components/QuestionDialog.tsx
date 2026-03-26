import { useState, useCallback, useRef, useEffect } from 'react'
import type { UserQuestionRequest, UserQuestionResponse } from '@shared/cli-driver'
import './QuestionDialog.css'

interface QuestionDialogProps {
  request: UserQuestionRequest
  onRespond: (response: UserQuestionResponse) => void
}

function QuestionDialog({ request, onRespond }: QuestionDialogProps): React.JSX.Element {
  const [answer, setAnswer] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = useCallback(() => {
    const trimmed = answer.trim()
    if (!trimmed) return
    onRespond({ requestId: request.requestId, answer: trimmed })
  }, [answer, request.requestId, onRespond])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit]
  )

  return (
    <div className="question-dialog">
      <div className="question-dialog__card">
        <div className="question-dialog__header">
          <span className="question-dialog__icon">&#10067;</span>
          <span className="question-dialog__title">Question from Agent</span>
        </div>

        <div className="question-dialog__body">
          <div className="question-dialog__question">{request.question}</div>
          <textarea
            ref={inputRef}
            className="question-dialog__input"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your answer..."
            rows={3}
          />
        </div>

        <div className="question-dialog__actions">
          <button
            className="question-dialog__btn"
            onClick={handleSubmit}
            disabled={!answer.trim()}
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  )
}

export default QuestionDialog
