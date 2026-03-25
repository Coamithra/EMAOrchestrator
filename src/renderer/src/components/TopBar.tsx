import './TopBar.css'

interface TopBarProps {
  onSettingsClick: () => void
}

function TopBar({ onSettingsClick }: TopBarProps): React.JSX.Element {
  return (
    <header className="topbar">
      <span className="topbar__title">EMAOrchestrator</span>
      <button className="topbar__settings" onClick={onSettingsClick} title="Settings">
        {'\u2699'}
      </button>
    </header>
  )
}

export default TopBar
