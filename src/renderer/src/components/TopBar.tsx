import './TopBar.css'

interface TopBarProps {
  onNewAgentClick: () => void
  onSettingsClick: () => void
}

function TopBar({ onNewAgentClick, onSettingsClick }: TopBarProps): React.JSX.Element {
  return (
    <header className="topbar">
      <div className="topbar__left">
        <span className="topbar__title">EMAOrchestrator</span>
      </div>
      <div className="topbar__right">
        <button className="topbar__button" onClick={onNewAgentClick} title="New Agent">
          + New Agent
        </button>
        <button
          className="topbar__button topbar__button--icon"
          onClick={onSettingsClick}
          title="Settings"
        >
          {'\u2699'}
        </button>
      </div>
    </header>
  )
}

export default TopBar
