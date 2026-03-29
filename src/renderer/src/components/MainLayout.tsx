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
  runningAgentIds: Set<string>
  onResumeAgent: (agentId: string) => void
  onStopAgent: (agentId: string) => void
  onDismissAgent: (agentId: string) => void
}

function MainLayout({ agents, runningAgentIds, onResumeAgent, onStopAgent, onDismissAgent }: MainLayoutProps): React.JSX.Element {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)
  const sidebarWidthRef = useRef(sidebarWidth)
  sidebarWidthRef.current = sidebarWidth

  // Clear stale selection when the selected agent disappears from the list
  useEffect(() => {
    if (selectedAgentId && !agents.some((a) => a.id === selectedAgentId)) {
      setSelectedAgentId(null)
    }
  }, [agents, selectedAgentId])

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? null

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    dragStartX.current = e.clientX
    dragStartWidth.current = sidebarWidthRef.current
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 40 : 10
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      setSidebarWidth((w) => Math.max(MIN_SIDEBAR_WIDTH, w - step))
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      setSidebarWidth((w) => Math.min(MAX_SIDEBAR_WIDTH, w + step))
    }
  }, [])

  // Attach document-level listeners during drag for cursor and text-selection fix
  useEffect(() => {
    if (!isDragging) return

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

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
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isDragging])

  return (
    <div className="main-layout">
      <div className="main-layout__sidebar" style={{ width: sidebarWidth }}>
        <Sidebar
          agents={agents}
          selectedAgentId={selectedAgentId}
          runningAgentIds={runningAgentIds}
          onSelectAgent={setSelectedAgentId}
          onResumeAgent={onResumeAgent}
          onDismissAgent={onDismissAgent}
        />
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={sidebarWidth}
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuemax={MAX_SIDEBAR_WIDTH}
        aria-label="Resize sidebar"
        tabIndex={0}
        className={`main-layout__resize-handle${isDragging ? ' main-layout__resize-handle--dragging' : ''}`}
        onMouseDown={handleMouseDown}
        onKeyDown={handleKeyDown}
      />
      <div className="main-layout__detail">
        <AgentDetailPanel
          agent={selectedAgent}
          isRunning={selectedAgentId ? runningAgentIds.has(selectedAgentId) : false}
          onResume={onResumeAgent}
          onStop={onStopAgent}
        />
      </div>
    </div>
  )
}

export default MainLayout
