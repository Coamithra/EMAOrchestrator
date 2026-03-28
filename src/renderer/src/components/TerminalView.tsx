import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { getBuffer, subscribe } from '../services/terminal-buffer-service'
import '@xterm/xterm/css/xterm.css'
import './TerminalView.css'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TerminalViewProps {
  agentId: string
}

function TerminalView({ agentId }: TerminalViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const terminal = new Terminal({
      theme: {
        background: '#1b1b1f',
        foreground: 'rgba(255, 255, 245, 0.86)',
        cursor: 'rgba(255, 255, 245, 0.6)',
        selectionBackground: 'rgba(255, 255, 245, 0.15)'
      },
      fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: false,
      cursorStyle: 'underline',
      scrollback: 10000,
      convertEol: true
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(container)

    // Initial fit after open
    requestAnimationFrame(() => {
      fitAddon.fit()
    })

    // Debounced refit on container resize
    let resizeTimer: ReturnType<typeof setTimeout>
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => fitAddon.fit(), 50)
    })
    observer.observe(container)

    // Clipboard: Ctrl+C copies selection (safe — this is a display-only terminal)
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.ctrlKey && event.key === 'c' && terminal.hasSelection()) {
        navigator.clipboard.writeText(terminal.getSelection())
        return false
      }
      return true
    })

    // Right-click copies selection to clipboard
    container.addEventListener('contextmenu', (e) => {
      const selection = terminal.getSelection()
      if (selection) {
        e.preventDefault()
        navigator.clipboard.writeText(selection)
      }
    })

    // Replay buffered output from previous sessions / before this mount
    const buffered = getBuffer(agentId)
    if (buffered) {
      terminal.write(buffered)
    }

    // Subscribe for live updates (new output that arrives while mounted)
    const unsubscribe = subscribe(agentId, (text) => {
      terminal.write(text)
    })

    return () => {
      unsubscribe()
      clearTimeout(resizeTimer)
      observer.disconnect()
      terminal.dispose()
    }
  }, [agentId])

  return <div ref={containerRef} className="terminal-view" />
}

export default TerminalView
