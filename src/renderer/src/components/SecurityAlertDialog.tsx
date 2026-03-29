import { useState, useCallback } from 'react'
import type { SecurityAlertRequest, SecurityAlertResponse } from '@shared/cli-driver'
import './SecurityAlertDialog.css'

interface SecurityAlertDialogProps {
  request: SecurityAlertRequest
  onRespond: (response: SecurityAlertResponse) => void
}

function formatToolInput(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

function SecurityAlertDialog({
  request,
  onRespond
}: SecurityAlertDialogProps): React.JSX.Element {
  const [confirming, setConfirming] = useState(false)

  const handleDismiss = useCallback(() => {
    onRespond({ requestId: request.requestId, behavior: 'dismiss' })
  }, [request.requestId, onRespond])

  const handleOverrideClick = useCallback(() => {
    if (!confirming) {
      setConfirming(true)
      return
    }
    onRespond({ requestId: request.requestId, behavior: 'override' })
  }, [confirming, request.requestId, onRespond])

  const handleCancelOverride = useCallback(() => {
    setConfirming(false)
  }, [])

  return (
    <div
      className="interaction-dialog security-alert-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-label="Security alert"
    >
      <div className="interaction-dialog__card security-alert-dialog__card">
        <div className="interaction-dialog__header security-alert-dialog__header">
          <span className="interaction-dialog__icon security-alert-dialog__icon">{'\u26D4'}</span>
          <span className="interaction-dialog__title security-alert-dialog__title">
            Security Alert
          </span>
        </div>

        <div className="interaction-dialog__body">
          <div className="security-alert-dialog__explanation">{request.explanation}</div>

          <div className="permission-dialog__field">
            <span className="permission-dialog__label">Tool</span>
            <span className="permission-dialog__value permission-dialog__tool-name">
              {request.toolName}
            </span>
          </div>

          <div className="permission-dialog__field permission-dialog__field--vertical">
            <span className="permission-dialog__label">Input</span>
            <pre className="permission-dialog__input-json">
              {formatToolInput(request.toolInput)}
            </pre>
          </div>
        </div>

        <div className="interaction-dialog__actions">
          {confirming ? (
            <>
              <span className="security-alert-dialog__confirm-label">Are you sure?</span>
              <button
                className="interaction-dialog__btn interaction-dialog__btn--secondary"
                onClick={handleCancelOverride}
              >
                Cancel
              </button>
              <button
                className="interaction-dialog__btn security-alert-dialog__btn--confirm-override"
                onClick={handleOverrideClick}
              >
                Yes, Override
              </button>
            </>
          ) : (
            <>
              <button
                className="interaction-dialog__btn security-alert-dialog__btn--override"
                onClick={handleOverrideClick}
              >
                Override and Allow
              </button>
              <button
                className="interaction-dialog__btn security-alert-dialog__btn--dismiss"
                onClick={handleDismiss}
                autoFocus
              >
                Dismiss Agent
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default SecurityAlertDialog
