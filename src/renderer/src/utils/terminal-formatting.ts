// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

export const ANSI = {
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
export function markdownToAnsi(text: string): string {
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

export function formatToolStart(toolName: string, inputSummary: string): string {
  // Bash commands render as a green shell prompt: $ command
  if (toolName.toLowerCase() === 'bash') {
    const cmd = inputSummary || 'bash'
    return `\r\n${ANSI.green}${ANSI.bold}$ ${ANSI.boldOff}${cmd}${ANSI.fgDefault}\r\n`
  }
  const summary = inputSummary ? ` ${ANSI.dim}${inputSummary}${ANSI.dimOff}` : ''
  return `\r\n${ANSI.cyan}${ANSI.bold}> ${toolName}${ANSI.boldOff}${ANSI.fgDefault}${summary}\r\n`
}

export function formatToolSummary(summary: string): string {
  return `${ANSI.dim}  ${summary}${ANSI.dimOff}\r\n`
}

export function formatSessionResult(
  costUsd: number,
  numTurns: number,
  durationMs: number
): string {
  const secs = Math.round(durationMs / 1000)
  const mins = Math.floor(secs / 60)
  const time = mins > 0 ? `${mins}m${secs % 60}s` : `${secs}s`
  const cost = costUsd < 0.01 ? '<$0.01' : `$${costUsd.toFixed(2)}`
  return `\r\n${ANSI.yellow}\u2500\u2500 ${cost} \u00b7 ${numTurns} turns \u00b7 ${time} \u2500\u2500${ANSI.reset}\r\n`
}
