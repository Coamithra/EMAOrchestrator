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

  const handleDeny = useCallback(() => {
    onRespond({ requestId: request.requestId, behavior: 'deny' })
  }, [request.requestId, onRespond])

  return (
    <div className="permission-dialog">
      <div className="permission-dialog__card">
        <div className="permission-dialog__header">
          <span className="permission-dialog__icon">&#9888;</span>
          <span className="permission-dialog__title">Permission Request</span>
        </div>

        <div className="permission-dialog__body">
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
            <pre className="permission-dialog__input-json">
              {formatToolInput(request.toolInput)}
            </pre>
          </div>
        </div>

        <div className="permission-dialog__actions">
          <button
            className="permission-dialog__btn permission-dialog__btn--deny"
            onClick={handleDeny}
          >
            Deny
          </button>
          <button
            className="permission-dialog__btn permission-dialog__btn--allow"
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
