/**
 * Option B: PTY via node-pty
 *
 * Spawns Claude Code in a pseudo-terminal. Output can be piped to xterm.js.
 * Permission detection relies on fragile ANSI output parsing.
 *
 * Requires: npm install node-pty
 * Run: npx tsx spikes/cli-interaction-model/option-b-pty.ts
 *
 * NOTE: This PoC demonstrates the approach but highlights the fundamental
 * limitation — parsing structured events from terminal output is unreliable.
 */

// node-pty is a native module — this import will fail without npm install
import type { IPty } from 'node-pty'

async function main(): Promise<void> {
  // Dynamic import since node-pty may not be installed
  let pty: typeof import('node-pty')
  try {
    pty = await import('node-pty')
  } catch {
    console.error('node-pty not installed. Run: npm install node-pty')
    console.error('This PoC demonstrates the approach conceptually.')
    console.error('')
    console.error('Key findings from research:')
    console.error('  - node-pty works on Windows 11 via ConPTY')
    console.error('  - xterm.js can render PTY output faithfully')
    console.error('  - stdin works via ptyProcess.write()')
    console.error('  - BUT: detecting permissions from ANSI output is fragile')
    console.error('  - Claude Code uses Ink/React TUI — no machine-readable markers')
    process.exit(0)
  }

  const ptyProcess: IPty = pty.spawn('claude', [], {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: process.cwd(),
    env: process.env as Record<string, string>,
  })

  // Capture raw terminal output
  ptyProcess.onData((data: string) => {
    // In a real app, this would go to xterm.js via: terminal.write(data)
    process.stdout.write(data)

    // Attempt to detect permission prompts — this is the fragile part
    const stripped = stripAnsi(data)
    if (stripped.includes('Allow') && stripped.includes('Deny')) {
      console.error('\n[DETECTED] Possible permission prompt (fragile heuristic)')
    }
  })

  ptyProcess.onExit(({ exitCode }) => {
    console.log(`\n[exit] code=${exitCode}`)
  })

  // Send a prompt after a delay (waiting for Claude to initialize)
  setTimeout(() => {
    ptyProcess.write('Say "Hello from PTY PoC!" and nothing else.\r')
  }, 2000)

  // Clean exit
  setTimeout(() => {
    ptyProcess.kill()
  }, 30_000)
}

/** Strip ANSI escape sequences — lossy, cannot reliably reconstruct structure */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
}

main()
