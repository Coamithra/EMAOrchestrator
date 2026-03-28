import { useCallback } from 'react'
import type { PermissionRequest, PermissionResponse } from '@shared/cli-driver'
import './PermissionDialog.css'

interface PermissionDialogProps {
  request: PermissionRequest
  onRespond: (response: PermissionResponse) => void
}

function formatToolInput(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

function PermissionDialog({ request, onRespond }: PermissionDialogProps): React.JSX.Element {
  const handleAllow = useCallback(() => {
    onRespond({ requestId: request.requestId, behavior: 'allow' })
  }, [request.requestId, onRespond])

  const handleAllowAndRemember = useCallback(() => {
    onRespond({ requestId: request.requestId, behavior: 'allow', rememberChoice: true })
  }, [request.requestId, onRespond])

  const handleDeny = useCallback(() => {
    onRespond({ requestId: request.requestId, behavior: 'deny' })
  }, [request.requestId, onRespond])

  return (
    <div
      className="interaction-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Permission request"
    >
      <div className="interaction-dialog__card" onClick={(e) => e.stopPropagation()}>
        <div className="interaction-dialog__header">
          <span className="interaction-dialog__icon permission-dialog__icon">{'\u26A0'}</span>
          <span className="interaction-dialog__title">Permission Request</span>
        </div>

        <div className="interaction-dialog__body">
          <div className="permission-dialog__field">
            <span className="permission-dialog__label">Tool</span>
            <span className="permission-dialog__value permission-dialog__tool-name">
              {request.toolName}
            </span>
          </div>

          {request.description && (
            <div className="permission-dialog__field">
              <span className="permission-dialog__label">Description</span>
              <span className="permission-dialog__value">{request.description}</span>
            </div>
          )}

          <div className="permission-dialog__field permission-dialog__field--vertical">
            <span className="permission-dialog__label">Input</span>
            <pre className="permission-dialog__input-json">{formatToolInput(request.toolInput)}</pre>
          </div>
        </div>

        <div className="interaction-dialog__actions">
          <button
            className="interaction-dialog__btn interaction-dialog__btn--secondary"
            onClick={handleDeny}
          >
            Deny
          </button>
          <button
            className="interaction-dialog__btn permission-dialog__btn--remember"
            onClick={handleAllowAndRemember}
          >
            Always Allow
          </button>
          <button
            className="interaction-dialog__btn interaction-dialog__btn--primary"
            onClick={handleAllow}
            autoFocus
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  )
}

export default PermissionDialog
