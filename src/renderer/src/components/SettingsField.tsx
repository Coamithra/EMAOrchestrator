import type { FieldStatus } from '@shared/config'

interface SettingsFieldProps {
  label: string
  children: React.ReactNode
  status?: FieldStatus
  onBrowse?: () => void
}

function SettingsField({
  label,
  children,
  status,
  onBrowse
}: SettingsFieldProps): React.JSX.Element {
  return (
    <div className="settings-field">
      <label className="settings-field__label">{label}</label>
      <div className="settings-field__input-row">
        <div className="settings-field__input">{children}</div>
        {onBrowse && (
          <button type="button" className="settings-field__browse" onClick={onBrowse}>
            Browse
          </button>
        )}
        {status !== undefined && status !== null && (
          <span
            className={`settings-field__status ${status.ok ? 'settings-field__status--ok' : 'settings-field__status--error'}`}
            title={status.ok ? 'Valid' : status.error}
          >
            {status.ok ? '\u2713' : '\u2717'}
          </span>
        )}
      </div>
      {status && !status.ok && <div className="settings-field__error">{status.error}</div>}
    </div>
  )
}

export default SettingsField
