import { useEffect, useRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { CliEventPayload } from '@shared/ipc'
import 'xterm/css/xterm.css'
import './TerminalView.css'

interface TerminalViewProps {
  agentId: string
}

function TerminalView({ agentId }: TerminalViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

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

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    // Refit on container resize
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        fitAddon.fit()
      })
    })
    observer.observe(container)

    // Subscribe to CLI events for this agent's orchestration session
    const expectedSessionId = `orchestration-${agentId}`

    const unsubscribe = window.api.onCliEvent((payload: CliEventPayload) => {
      if (payload.sessionId !== expectedSessionId) return

      if (payload.event.type === 'stream:text') {
        terminal.write(payload.event.data.text)
      }
    })

    return () => {
      unsubscribe()
      observer.disconnect()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [agentId])

  return <div ref={containerRef} className="terminal-view" />
}

export default TerminalView
