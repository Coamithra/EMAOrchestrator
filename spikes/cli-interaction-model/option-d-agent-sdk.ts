/**
 * Option D: Claude Agent SDK (RECOMMENDED)
 *
 * Uses @anthropic-ai/claude-agent-sdk for typed, structured interaction
 * with Claude Code. This is the approach chosen for EMAOrchestrator.
 *
 * The SDK's query() returns an AsyncGenerator that yields SDKMessage objects.
 * Stream events, assistant messages, tool results, and the final result all
 * arrive as messages in the generator. Permission requests are handled via
 * the canUseTool callback in options.
 *
 * Requires: npm install @anthropic-ai/claude-agent-sdk
 * Run: npx tsx spikes/cli-interaction-model/option-d-agent-sdk.ts
 */

async function main(): Promise<void> {
  let sdk: typeof import('@anthropic-ai/claude-agent-sdk')
  try {
    sdk = await import('@anthropic-ai/claude-agent-sdk')
  } catch {
    console.error('@anthropic-ai/claude-agent-sdk not installed.')
    console.error('Run: npm install @anthropic-ai/claude-agent-sdk')
    console.error('')
    console.error('Key findings from research:')
    console.error('  - query() returns an AsyncGenerator yielding SDKMessage objects')
    console.error('  - canUseTool callback for permission handling')
    console.error('  - AskUserQuestion arrives as a tool_use in the message stream')
    console.error('  - Multi-turn via streaming input mode')
    console.error('  - ~12s cold start, ~2-3s warm follow-ups')
    console.error('  - Zero native dependencies')
    process.exit(0)
  }

  const { query } = sdk

  console.log('[starting] Agent SDK query...')
  const startTime = Date.now()

  // query() returns an AsyncGenerator<SDKMessage> — iterate to consume events
  const stream = query({
    prompt: 'Say "Hello from Agent SDK PoC!" and nothing else.',
    options: {
      maxTurns: 3,
      includePartialMessages: true,
      // Permission handling — this is the key advantage over PTY
      canUseTool: async (toolName, input, _options) => {
        console.log(`[permission] Tool: ${toolName}`)
        console.log(`[permission] Input: ${JSON.stringify(input)}`)
        // In the real app, this would IPC to the renderer for user approval
        return { behavior: 'allow' as const }
      },
    },
  })

  // Iterate the AsyncGenerator to receive all messages
  for await (const message of stream) {
    switch (message.type) {
      case 'system':
        console.log(`[system] subtype=${message.subtype}`)
        break

      case 'stream_event': {
        // Token-level streaming (requires includePartialMessages: true)
        const event = message.event as Record<string, unknown>
        if (event?.type === 'content_block_delta') {
          const delta = event.delta as Record<string, unknown>
          if (delta?.type === 'text_delta') {
            // In the real app, this would IPC to xterm.js: terminal.write(delta.text)
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

      case 'result': {
        const elapsed = Date.now() - startTime
        console.log(`\n[result] subtype=${message.subtype}, completed in ${elapsed}ms`)
        console.log(`[result] Cost: $${message.total_cost_usd}`)
        console.log(`[result] Turns: ${message.num_turns}`)
        console.log(`[result] Session: ${message.session_id}`)
        break
      }

      default:
        console.log(`[unknown] type=${message.type}`)
    }
  }
}

main().catch(console.error)
