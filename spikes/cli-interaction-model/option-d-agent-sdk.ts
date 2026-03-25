/**
 * Option D: Claude Agent SDK (RECOMMENDED)
 *
 * Uses @anthropic-ai/claude-agent-sdk for typed, structured interaction
 * with Claude Code. This is the approach chosen for EMAOrchestrator.
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
    console.error('  - SDK provides typed StreamEvent objects')
    console.error('  - canUseTool callback for permission handling')
    console.error('  - AskUserQuestion callback for clarifying questions')
    console.error('  - Multi-turn via streaming input mode')
    console.error('  - ~12s cold start, ~2-3s warm follow-ups')
    console.error('  - Zero native dependencies')
    process.exit(0)
  }

  const { query } = sdk

  console.log('[starting] Agent SDK query...')
  const startTime = Date.now()

  const result = await query({
    prompt: 'Say "Hello from Agent SDK PoC!" and nothing else.',
    options: {
      maxTurns: 3,
      // Permission handling — this is the key advantage over PTY
      canUseTool: async (toolName, input) => {
        console.log(`[permission] Tool: ${toolName}`)
        console.log(`[permission] Input: ${JSON.stringify(input)}`)
        // In the real app, this would IPC to the renderer for user approval
        return { behavior: 'allow' as const }
      },
    },
    // Stream events for real-time display
    onStreamEvent: (event) => {
      if (event.type === 'content_block_delta') {
        const delta = event.delta as Record<string, unknown>
        if (delta?.type === 'text_delta') {
          // In the real app, this would IPC to xterm.js: terminal.write(delta.text)
          process.stdout.write(delta.text as string)
        }
      }
    },
  })

  const elapsed = Date.now() - startTime
  console.log(`\n\n[result] Completed in ${elapsed}ms`)
  console.log(`[result] Cost: $${result.cost_usd}`)
  console.log(`[result] Turns: ${result.num_turns}`)
  console.log(`[result] Session: ${result.session_id}`)
}

main().catch(console.error)
