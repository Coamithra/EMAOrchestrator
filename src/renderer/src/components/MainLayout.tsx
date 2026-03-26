import { useState, useCallback, useRef, useEffect } from 'react'
import type { AgentSnapshot } from '@shared/agent-manager'
import Sidebar from './Sidebar'
import AgentDetailPanel from './AgentDetailPanel'
import './MainLayout.css'

const DEFAULT_SIDEBAR_WIDTH = 260
const MIN_SIDEBAR_WIDTH = 180
const MAX_SIDEBAR_WIDTH = 480

interface MainLayoutProps {
  agents: AgentSnapshot[]
}

function MainLayout({ agents }: MainLayoutProps): React.JSX.Element {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? null

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setIsDragging(true)
      dragStartX.current = e.clientX
      dragStartWidth.current = sidebarWidth
    },
    [sidebarWidth]
  )

  useEffect(() => {
    if (!isDragging) return

    function onMouseMove(e: MouseEvent): void {
      const delta = e.clientX - dragStartX.current
      const newWidth = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, dragStartWidth.current + delta)
      )
      setSidebarWidth(newWidth)
    }

    function onMouseUp(): void {
      setIsDragging(false)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [isDragging])

  return (
    <div className="main-layout">
      <div className="main-layout__sidebar" style={{ width: sidebarWidth }}>
        <Sidebar
          agents={agents}
          selectedAgentId={selectedAgentId}
          onSelectAgent={setSelectedAgentId}
        />
      </div>
      <div
        className={`main-layout__resize-handle${isDragging ? ' main-layout__resize-handle--dragging' : ''}`}
        onMouseDown={handleMouseDown}
      />
      <div className="main-layout__detail">
        <AgentDetailPanel agent={selectedAgent} />
      </div>
    </div>
  )
}

export default MainLayout
