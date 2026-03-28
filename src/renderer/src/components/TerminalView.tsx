import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { CliEventPayload } from '@shared/ipc'
import '@xterm/xterm/css/xterm.css'
import './TerminalView.css'

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  boldOff: '\x1b[22m',
  dimOff: '\x1b[22m',
  italicOff: '\x1b[23m',
  underlineOff: '\x1b[24m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  green: '\x1b[32m',
  fgDefault: '\x1b[39m'
}

// ---------------------------------------------------------------------------
// Lightweight streaming markdown-to-ANSI converter
// ---------------------------------------------------------------------------

/**
 * Converts common inline markdown patterns to ANSI escape codes.
 * Operates on buffered text (not single chars) so it can detect boundaries.
 *
 * Handles: **bold**, `inline code`, # headings (at line start)
 * Leaves everything else as-is (lists, indentation, etc. look fine in mono).
 */
function markdownToAnsi(text: string): string {
  let result = ''
  let i = 0

  while (i < text.length) {
    // Heading at start of line: # through ####
    if ((i === 0 || text[i - 1] === '\n') && text[i] === '#') {
      let level = 0
      let j = i
      while (j < text.length && text[j] === '#' && level < 4) {
        level++
        j++
      }
      if (j < text.length && text[j] === ' ') {
        // Find end of line
        const eol = text.indexOf('\n', j)
        const end = eol === -1 ? text.length : eol
        const heading = text.slice(j + 1, end)
        result += `${ANSI.bold}${ANSI.yellow}${heading}${ANSI.reset}`
        i = end
        continue
      }
    }

    // Bold: **text**
    if (text[i] === '*' && text[i + 1] === '*') {
      const close = text.indexOf('**', i + 2)
      if (close !== -1 && close - i < 200) {
        result += ANSI.bold + text.slice(i + 2, close) + ANSI.boldOff
        i = close + 2
        continue
      }
    }

    // Inline code: `text`
    if (text[i] === '`' && text[i + 1] !== '`') {
      const close = text.indexOf('`', i + 1)
      if (close !== -1 && close - i < 200 && !text.slice(i + 1, close).includes('\n')) {
        result += ANSI.cyan + text.slice(i + 1, close) + ANSI.fgDefault
        i = close + 1
        continue
      }
    }

    result += text[i]
    i++
  }

  return result
}

// ---------------------------------------------------------------------------
// Terminal output formatting
// ---------------------------------------------------------------------------

function formatToolStart(toolName: string, inputSummary: string): string {
  const summary = inputSummary ? ` ${ANSI.dim}${inputSummary}${ANSI.dimOff}` : ''
  return `\r\n${ANSI.cyan}${ANSI.bold}> ${toolName}${ANSI.boldOff}${ANSI.fgDefault}${summary}\r\n`
}

function formatToolSummary(summary: string): string {
  return `${ANSI.dim}  ${summary}${ANSI.dimOff}\r\n`
}

function formatSessionResult(
  costUsd: number,
  numTurns: number,
  durationMs: number
): string {
  const secs = Math.round(durationMs / 1000)
  const mins = Math.floor(secs / 60)
  const time = mins > 0 ? `${mins}m${secs % 60}s` : `${secs}s`
  const cost = costUsd < 0.01 ? '<$0.01' : `$${costUsd.toFixed(2)}`
  return `\r\n${ANSI.yellow}── ${cost} · ${numTurns} turns · ${time} ──${ANSI.reset}\r\n`
}

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

    // Markdown buffer: accumulate text deltas and flush with markdown conversion
    let mdBuffer = ''
    let flushTimer: ReturnType<typeof setTimeout> | null = null
    const FLUSH_DELAY = 30 // ms — fast enough to feel real-time

    function flushBuffer(): void {
      if (mdBuffer.length > 0) {
        terminal.write(markdownToAnsi(mdBuffer))
        mdBuffer = ''
      }
      flushTimer = null
    }

    function bufferText(text: string): void {
      mdBuffer += text
      if (flushTimer === null) {
        flushTimer = setTimeout(flushBuffer, FLUSH_DELAY)
      }
    }

    // Subscribe to CLI events for this agent's orchestration session
    const expectedSessionId = `orchestration-${agentId}`

    const unsubscribe = window.api.onCliEvent((payload: CliEventPayload) => {
      if (payload.sessionId !== expectedSessionId) return

      const { event } = payload

      switch (event.type) {
        case 'stream:text':
          bufferText(event.data.text)
          break

        case 'tool:start':
          flushBuffer()
          terminal.write(formatToolStart(event.data.toolName, event.data.inputSummary))
          break

        case 'tool:summary':
          flushBuffer()
          if (event.data.summary) {
            terminal.write(formatToolSummary(event.data.summary))
          }
          break

        case 'session:result':
          flushBuffer()
          terminal.write(
            formatSessionResult(
              event.data.costUsd,
              event.data.numTurns,
              event.data.durationMs
            )
          )
          break

        // tool:activity intentionally not rendered — it would be noisy.
        // The tool:start + tool:summary pair is sufficient visual feedback.
      }
    })

    return () => {
      unsubscribe()
      if (flushTimer !== null) clearTimeout(flushTimer)
      flushBuffer()
      clearTimeout(resizeTimer)
      observer.disconnect()
      terminal.dispose()
    }
  }, [agentId])

  return <div ref={containerRef} className="terminal-view" />
}

export default TerminalView
