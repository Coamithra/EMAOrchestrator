/**
 * Option A: Raw stream-json via child_process
 *
 * Spawns Claude Code with --output-format stream-json and communicates
 * via NDJSON over stdin/stdout.
 *
 * Run: npx tsx spikes/cli-interaction-model/option-a-stream-json.ts
 */

import { spawn } from 'child_process'
import * as readline from 'readline'

// Spawn Claude in print mode with stream-json output
const claude = spawn(
  'claude',
  [
    '--print',
    '--output-format',
    'stream-json',
    '--input-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-prompt-tool',
    'stdio',
  ],
  {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  }
)

// Parse NDJSON from stdout
const rl = readline.createInterface({ input: claude.stdout })

rl.on('line', (line) => {
  try {
    const event = JSON.parse(line)
    handleEvent(event)
  } catch {
    console.error('[parse error]', line)
  }
})

claude.stderr.on('data', (data) => {
  console.error('[stderr]', data.toString())
})

claude.on('close', (code) => {
  console.log(`[exit] code=${code}`)
})

function handleEvent(event: Record<string, unknown>): void {
  switch (event.type) {
    case 'system':
      console.log(`[system] subtype=${event.subtype}`)
      if (event.subtype === 'init') {
        console.log(`  session_id=${event.session_id}`)
        console.log(`  model=${event.model}`)
      }
      break

    case 'stream_event': {
      const inner = event.event as Record<string, unknown>
      if (inner?.type === 'content_block_delta') {
        const delta = inner.delta as Record<string, unknown>
        if (delta?.type === 'text_delta') {
          process.stdout.write(delta.text as string)
        }
      }
      break
    }

    case 'assistant':
      console.log('\n[assistant] complete message received')
      break

    case 'user':
      console.log('[user] tool result received')
      break

    case 'control_request': {
      console.log(`[permission] tool=${(event.request as Record<string, unknown>)?.tool_name}`)
      // Auto-allow for PoC
      const response = {
        type: 'control_response',
        request_id: event.request_id,
        response: {
          subtype: 'success',
          response: { behavior: 'allow' },
        },
      }
      claude.stdin.write(JSON.stringify(response) + '\n')
      console.log('[permission] auto-allowed')
      break
    }

    case 'result':
      console.log(`\n[result] subtype=${event.subtype}, cost=$${event.total_cost_usd}`)
      break

    default:
      console.log(`[unknown] type=${event.type}`)
  }
}

// Send initial prompt
const userMessage = {
  type: 'user',
  message: {
    role: 'user',
    content: 'Say "Hello from stream-json PoC!" and nothing else.',
  },
}

claude.stdin.write(JSON.stringify(userMessage) + '\n')
console.log('[sent] initial prompt')

// Clean exit after 30s timeout
setTimeout(() => {
  console.log('[timeout] killing process')
  claude.kill()
}, 30_000)
