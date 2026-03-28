import { query } from '@anthropic-ai/claude-agent-sdk'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

const SYSTEM_PROMPT = `You are a safety evaluator for an automated coding agent working in a git worktree. Decide if a tool call is safe to auto-approve.

Rules:
- Read-only operations (Read, Glob, Grep, git status/log/diff, ls) -> yes
- File edits/writes within the worktree -> yes
- Build, test, lint commands (npm run build/test/lint, npx vitest) -> yes
- Git add/commit/push (non-force) on feature branches -> yes
- Destructive operations (force push, rm -rf, reset --hard, clean -fd) -> no
- Operations outside the worktree directory -> no
- Publishing or deploying (npm publish, docker push) -> no
- Uncertain -> maybe

Respond with ONLY a JSON object: {"decision": "yes"}, {"decision": "no"}, or {"decision": "maybe"}`

const EVALUATE_TIMEOUT_MS = 15_000

export interface EvaluationContext {
  toolName: string
  toolInput: Record<string, unknown>
  worktreePath?: string
  currentStepTitle?: string
}

export type ApprovalDecision = 'yes' | 'no' | 'maybe'

/**
 * Evaluate a tool permission request using a lightweight LLM call.
 *
 * Returns 'yes' (safe), 'no' (unsafe), or 'maybe' (uncertain).
 * On timeout or error, returns 'maybe' so the caller falls through to manual approval.
 */
export async function evaluatePermission(ctx: EvaluationContext): Promise<ApprovalDecision> {
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), EVALUATE_TIMEOUT_MS)

  try {
    return await doEvaluation(ctx, abortController)
  } catch {
    return 'maybe'
  } finally {
    clearTimeout(timeout)
  }
}

async function doEvaluation(
  ctx: EvaluationContext,
  abortController: AbortController
): Promise<ApprovalDecision> {
  const inputStr = JSON.stringify(ctx.toolInput, null, 2)
  const parts = [`Tool: ${ctx.toolName}`, `Input: ${inputStr}`]
  if (ctx.worktreePath) parts.push(`Worktree: ${ctx.worktreePath}`)
  if (ctx.currentStepTitle) parts.push(`Current step: ${ctx.currentStepTitle}`)

  const prompt = parts.join('\n')

  const textChunks: string[] = []

  const stream = query({
    prompt,
    options: {
      maxTurns: 1,
      systemPrompt: SYSTEM_PROMPT,
      allowedTools: [],
      canUseTool: async () => ({ behavior: 'deny' as const, message: 'No tools allowed' }),
      abortController
    }
  })

  for await (const message of stream as AsyncIterable<SDKMessage>) {
    if (message.type === 'assistant') {
      const content = (message as { message?: { content?: unknown[] } }).message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            typeof block === 'object' &&
            block !== null &&
            'type' in block &&
            block.type === 'text' &&
            'text' in block
          ) {
            textChunks.push(block.text as string)
          }
        }
      }
    }
  }

  const fullText = textChunks.join('')
  return parseDecision(fullText)
}

/** Extract the decision from the LLM response. Falls back to 'maybe' on parse failure. */
function parseDecision(text: string): ApprovalDecision {
  // Try to parse as JSON first
  const jsonMatch = text.match(/\{[^}]*"decision"\s*:\s*"(yes|no|maybe)"[^}]*\}/)
  if (jsonMatch) return jsonMatch[1] as ApprovalDecision

  // Fallback: look for bare keywords
  const lower = text.toLowerCase().trim()
  if (lower === 'yes' || lower === '"yes"') return 'yes'
  if (lower === 'no' || lower === '"no"') return 'no'

  return 'maybe'
}
