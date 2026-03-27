import { query } from '@anthropic-ai/claude-agent-sdk'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { Runbook, RunbookPhase, RunbookStep } from '../shared/runbook'

const SYSTEM_PROMPT = `You are a runbook parser. Your job is to read a markdown document describing a workflow and extract its phases and steps as structured JSON.

Rules:
- A "phase" is a major section of the workflow (e.g. "Pick Up the Card", "Research", "Design", "Implement", "Verify", "Review & Ship").
- A "step" is an individual action within a phase.
- Only extract actionable workflow phases and steps. Ignore non-workflow sections such as reference tables, quick-reference guides, appendices, merge conflict rules, or any section that provides background information rather than a step to execute.
- Each step needs a short title and a description of what to do.
- Steps are numbered sequentially within each phase, starting at 1.
- Each step's "phase" field must match its parent phase name exactly.

Return ONLY valid JSON matching this schema, with no markdown fences or surrounding text:

{
  "phases": [
    {
      "name": "Phase Name",
      "steps": [
        {
          "phase": "Phase Name",
          "index": 1,
          "title": "Short action title",
          "description": "What to do in this step"
        }
      ]
    }
  ]
}`

const SMART_PARSE_TIMEOUT_MS = 60_000

/**
 * Parse a runbook markdown document using Claude CLI (Agent SDK).
 *
 * Sends the raw markdown to Claude with a structured system prompt,
 * then extracts and validates the JSON response as a Runbook.
 * Times out after 60 seconds to prevent indefinite hangs.
 */
export async function parseRunbookSmart(markdown: string): Promise<Runbook> {
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), SMART_PARSE_TIMEOUT_MS)

  try {
    return await doSmartParse(markdown, abortController)
  } finally {
    clearTimeout(timeout)
  }
}

async function doSmartParse(
  markdown: string,
  abortController: AbortController
): Promise<Runbook> {
  const textChunks: string[] = []

  const stream = query({
    prompt: `Parse the following runbook markdown into structured JSON:\n\n${markdown}`,
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

  // Extract JSON — the response might have markdown fences despite instructions
  const jsonStr = extractJson(fullText)
  if (!jsonStr) {
    throw new Error('Smart parser: no JSON found in Claude response')
  }

  const parsed = JSON.parse(jsonStr)
  return validateRunbook(parsed)
}

/** Extract a JSON object from text, stripping markdown fences if present. */
function extractJson(text: string): string | null {
  // Try to find a fenced JSON block first
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (fenced) return fenced[1].trim()

  // Otherwise try to find raw JSON (first { to last })
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) return text.slice(start, end + 1)

  return null
}

/** Validate and normalize the parsed object into a proper Runbook. */
function validateRunbook(data: unknown): Runbook {
  if (!data || typeof data !== 'object' || !('phases' in data)) {
    throw new Error('Smart parser: response missing "phases" array')
  }

  const raw = data as { phases: unknown[] }
  if (!Array.isArray(raw.phases) || raw.phases.length === 0) {
    throw new Error('Smart parser: "phases" must be a non-empty array')
  }

  const phases: RunbookPhase[] = raw.phases.map((p: unknown, pi: number) => {
    if (!p || typeof p !== 'object' || !('name' in p) || !('steps' in p)) {
      throw new Error(`Smart parser: phase ${pi} missing "name" or "steps"`)
    }
    const phase = p as { name: string; steps: unknown[] }
    if (!Array.isArray(phase.steps) || phase.steps.length === 0) {
      throw new Error(`Smart parser: phase "${phase.name}" has no steps`)
    }

    const steps: RunbookStep[] = phase.steps.map((s: unknown, si: number) => {
      if (!s || typeof s !== 'object' || !('title' in s)) {
        throw new Error(`Smart parser: step ${si} in phase "${phase.name}" missing "title"`)
      }
      const step = s as { title: string; description?: string; phase?: string; index?: number }
      return {
        phase: phase.name,
        index: si + 1,
        title: String(step.title),
        description: String(step.description ?? '')
      }
    })

    return { name: String(phase.name), steps }
  })

  return { phases }
}
