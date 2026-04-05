import { useState, useCallback, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
  UserQuestionRequest,
  UserQuestionResponse,
  StructuredQuestion
} from '@shared/cli-driver'
import './QuestionDialog.css'

interface QuestionDialogProps {
  request: UserQuestionRequest
  onRespond: (response: UserQuestionResponse) => void
}

/** Renders a single structured question with option buttons. */
function StructuredQuestionView({
  sq,
  selected,
  onSelect
}: {
  sq: StructuredQuestion
  selected: Set<string>
  onSelect: (label: string) => void
}): React.JSX.Element {
  const [otherText, setOtherText] = useState('')
  const [showOther, setShowOther] = useState(false)

  const handleOtherToggle = useCallback(() => {
    setShowOther((prev) => {
      if (prev) {
        // Deselect when hiding
        if (selected.has('__other__')) onSelect('__other__')
      } else {
        // Select when showing
        onSelect('__other__')
      }
      return !prev
    })
  }, [selected, onSelect])

  return (
    <div className="question-dialog__structured-question">
      <div className="question-dialog__sq-header">{sq.header}</div>
      <div className="question-dialog__sq-text">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{sq.question}</ReactMarkdown>
      </div>
      <div className="question-dialog__options">
        {sq.options.map((opt) => {
          const isSelected = selected.has(opt.label)
          return (
            <button
              key={opt.label}
              type="button"
              className={`question-dialog__option${isSelected ? ' question-dialog__option--selected' : ''}`}
              onClick={() => onSelect(opt.label)}
              aria-pressed={isSelected}
            >
              <span className="question-dialog__option-indicator">
                {sq.multiSelect ? (isSelected ? '\u2611' : '\u2610') : (isSelected ? '\u25C9' : '\u25CB')}
              </span>
              <span className="question-dialog__option-content">
                <span className="question-dialog__option-label">{opt.label}</span>
                <span className="question-dialog__option-desc">{opt.description}</span>
              </span>
            </button>
          )
        })}
        {/* Other / free-text option */}
        <button
          type="button"
          className={`question-dialog__option question-dialog__option--other${showOther ? ' question-dialog__option--selected' : ''}`}
          onClick={handleOtherToggle}
          aria-pressed={showOther}
        >
          <span className="question-dialog__option-indicator">
            {sq.multiSelect ? (showOther ? '\u2611' : '\u2610') : (showOther ? '\u25C9' : '\u25CB')}
          </span>
          <span className="question-dialog__option-content">
            <span className="question-dialog__option-label">Other</span>
            <span className="question-dialog__option-desc">Type your own answer</span>
          </span>
        </button>
      </div>
      {showOther && (
        <input
          type="text"
          className="question-dialog__other-input"
          value={otherText}
          onChange={(e) => setOtherText(e.target.value)}
          placeholder="Type your answer..."
          autoFocus
        />
      )}
    </div>
  )
}

function QuestionDialog({ request, onRespond }: QuestionDialogProps): React.JSX.Element {
  const questions = request.questions
  const isStructured = questions && questions.length > 0

  // --- Structured question state ---
  // Map of question text → Set of selected labels
  const [selections, setSelections] = useState<Record<string, Set<string>>>(() => {
    if (!isStructured) return {}
    const init: Record<string, Set<string>> = {}
    for (const sq of questions) {
      init[sq.question] = new Set()
    }
    return init
  })
  // Map of question text → other free-text value
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({})

  // --- Simple question state ---
  const [simpleAnswer, setSimpleAnswer] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!isStructured) inputRef.current?.focus()
  }, [isStructured])

  const handleSelect = useCallback(
    (questionText: string, multiSelect: boolean) => (label: string) => {
      setSelections((prev) => {
        const current = new Set(prev[questionText])
        if (label === '__other__') {
          // Toggle other — never clears regular options
          if (current.has(label)) {
            current.delete(label)
          } else {
            current.add(label)
          }
        } else if (current.has(label)) {
          current.delete(label)
        } else {
          if (!multiSelect) {
            // Clear other regular options but preserve __other__
            const hadOther = current.has('__other__')
            current.clear()
            if (hadOther) current.add('__other__')
          }
          current.add(label)
        }
        return { ...prev, [questionText]: current }
      })
    },
    []
  )

  // Track "Other" text per question via the StructuredQuestionView's input
  // We use a ref-based approach to read the input value on submit
  const otherInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const canSubmitStructured = isStructured
    ? questions.every((sq) => {
        const sel = selections[sq.question]
        return sel && sel.size > 0
      })
    : false

  const handleSubmitStructured = useCallback(() => {
    if (!isStructured) return
    const answers: Record<string, string> = {}
    for (const sq of questions) {
      const sel = selections[sq.question]
      if (!sel || sel.size === 0) return

      const regularLabels = Array.from(sel).filter((l) => l !== '__other__')

      if (sel.has('__other__')) {
        // Use the Other text input value
        const otherInput = document.querySelector(
          `[data-question="${CSS.escape(sq.question)}"] .question-dialog__other-input`
        ) as HTMLInputElement | null
        const otherVal = otherInput?.value?.trim() || otherTexts[sq.question]?.trim() || ''
        if (otherVal) {
          answers[sq.question] = regularLabels.concat(otherVal).join(', ')
        } else if (regularLabels.length > 0) {
          // Other is open but empty — just use the selected options
          answers[sq.question] = regularLabels.join(', ')
        } else {
          // Only Other selected with no text — can't submit
          return
        }
      } else {
        answers[sq.question] = regularLabels.join(', ')
      }
    }
    onRespond({
      requestId: request.requestId,
      answer: Object.values(answers).join('; '),
      answers
    })
  }, [isStructured, questions, selections, otherTexts, request.requestId, onRespond])

  const handleSubmitSimple = useCallback(() => {
    const trimmed = simpleAnswer.trim()
    if (!trimmed) return
    onRespond({ requestId: request.requestId, answer: trimmed })
  }, [simpleAnswer, request.requestId, onRespond])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (isStructured) handleSubmitStructured()
        else handleSubmitSimple()
      }
    },
    [isStructured, handleSubmitStructured, handleSubmitSimple]
  )

  return (
    <div
      className="interaction-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Question from agent"
    >
      <div className="interaction-dialog__card question-dialog__card">
        <div className="interaction-dialog__header">
          <span className="interaction-dialog__icon question-dialog__icon">?</span>
          <span className="interaction-dialog__title">Question from Agent</span>
        </div>

        <div className="interaction-dialog__body" onKeyDown={handleKeyDown}>
          {isStructured ? (
            questions.map((sq) => (
              <div key={sq.question} data-question={sq.question}>
                <StructuredQuestionView
                  sq={sq}
                  selected={selections[sq.question] ?? new Set()}
                  onSelect={handleSelect(sq.question, sq.multiSelect)}
                />
              </div>
            ))
          ) : (
            <>
              <div className="question-dialog__question">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{request.question}</ReactMarkdown>
              </div>
              <textarea
                ref={inputRef}
                className="question-dialog__input"
                value={simpleAnswer}
                onChange={(e) => setSimpleAnswer(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your answer..."
                rows={3}
              />
            </>
          )}
        </div>

        <div className="interaction-dialog__actions">
          <button
            className="interaction-dialog__btn interaction-dialog__btn--submit"
            onClick={isStructured ? handleSubmitStructured : handleSubmitSimple}
            disabled={isStructured ? !canSubmitStructured : !simpleAnswer.trim()}
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  )
}

export default QuestionDialog
