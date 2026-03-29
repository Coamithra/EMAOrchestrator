/**
 * Standalone integration test runner that generates a detailed Markdown report.
 *
 * Run with:
 *   npx tsx src/main/__tests__/integration-run-report.ts
 *
 * Outputs: docs/integration-report-<timestamp>.md
 *
 * SAFETY: These tests NEVER execute any commands. They only call
 * evaluatePermission(), which sends a text prompt to the LLM and parses
 * the JSON response. Zero execution risk.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import {
  SYSTEM_PROMPT,
  EVALUATE_TIMEOUT_MS,
  SAFE_TOOLS,
  parseEvaluationResult
} from '../smart-approval-service'
import { TEST_VECTORS } from './integration-test-vectors'
import type { TestVector } from './integration-test-vectors'

interface TestResult {
  vector: TestVector
  decision: 'yes' | 'no' | 'maybe'
  rawResponse: string
  elapsedMs: number
  costUsd: number
  passed: boolean
  error?: string
}

async function evaluateWithDetails(vector: TestVector): Promise<TestResult> {
  const { ctx } = vector

  // Fast-path for safe tools
  if (SAFE_TOOLS.has(ctx.toolName.toLowerCase())) {
    return {
      vector,
      decision: 'yes',
      rawResponse: '(SAFE_TOOLS fast-path — no LLM call)',
      elapsedMs: 0,
      costUsd: 0,
      passed: vector.expectation === 'safe'
    }
  }

  const inputStr = JSON.stringify(ctx.toolInput, null, 2)
  const parts = [`Tool: ${ctx.toolName}`, `Input: ${inputStr}`]
  if (ctx.worktreePath) parts.push(`Worktree: ${ctx.worktreePath}`)
  if (ctx.currentStepTitle) parts.push(`Current step: ${ctx.currentStepTitle}`)
  const prompt = parts.join('\n')

  const startTime = Date.now()
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), EVALUATE_TIMEOUT_MS)

  try {
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

    const textChunks: string[] = []
    let costUsd = 0

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
      if (message.type === 'result') {
        const result = message as { total_cost_usd?: number }
        costUsd = result.total_cost_usd ?? 0
      }
    }

    const elapsedMs = Date.now() - startTime
    const rawResponse = textChunks.join('').trim()
    const { decision } = parseEvaluationResult(rawResponse)

    const passed =
      vector.expectation === 'safe' ? decision === 'yes' : decision !== 'yes'

    return { vector, decision, rawResponse, elapsedMs, costUsd, passed }
  } catch (err) {
    const elapsedMs = Date.now() - startTime
    return {
      vector,
      decision: 'maybe',
      rawResponse: '',
      elapsedMs,
      costUsd: 0,
      passed: vector.expectation === 'dangerous', // 'maybe' is safe for dangerous vectors
      error: err instanceof Error ? err.message : String(err)
    }
  } finally {
    clearTimeout(timeout)
  }
}

function escapeMarkdown(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function generateReport(results: TestResult[], totalElapsedMs: number): string {
  const lines: string[] = []
  const timestamp = new Date().toISOString()

  // Header
  lines.push('# Smart Approval Integration Test Report')
  lines.push('')
  lines.push(`**Date:** ${timestamp}`)
  lines.push(`**Total vectors:** ${results.length}`)
  lines.push(`**Duration:** ${(totalElapsedMs / 1000).toFixed(1)}s`)
  lines.push(
    `**Total cost:** $${results.reduce((sum, r) => sum + r.costUsd, 0).toFixed(4)}`
  )
  lines.push('')

  // Overall result
  const passed = results.filter((r) => r.passed).length
  const failed = results.filter((r) => !r.passed).length
  const passRate = ((passed / results.length) * 100).toFixed(1)

  if (failed === 0) {
    lines.push(`## Result: ALL ${passed} TESTS PASSED`)
  } else {
    lines.push(`## Result: ${failed} FAILURES out of ${results.length} tests`)
  }
  lines.push('')
  lines.push(`| Metric | Value |`)
  lines.push(`|--------|-------|`)
  lines.push(`| Passed | ${passed} |`)
  lines.push(`| Failed | ${failed} |`)
  lines.push(`| Pass rate | ${passRate}% |`)
  lines.push('')

  // Summary by category
  lines.push('## Results by Category')
  lines.push('')

  const categories = [...new Set(results.map((r) => r.vector.category))]
  lines.push('| Category | Total | Passed | Failed |')
  lines.push('|----------|-------|--------|--------|')
  for (const cat of categories) {
    const catResults = results.filter((r) => r.vector.category === cat)
    const catPassed = catResults.filter((r) => r.passed).length
    const catFailed = catResults.filter((r) => !r.passed).length
    const indicator = catFailed > 0 ? ' **FAILURES**' : ''
    lines.push(`| ${cat} | ${catResults.length} | ${catPassed} | ${catFailed}${indicator} |`)
  }
  lines.push('')

  // Failures detail (if any)
  const failures = results.filter((r) => !r.passed)
  if (failures.length > 0) {
    lines.push('## FAILURES (requires investigation)')
    lines.push('')
    for (const f of failures) {
      const input = JSON.stringify(f.vector.ctx.toolInput)
      lines.push(`### ${f.vector.name}`)
      lines.push('')
      lines.push(`- **Category:** ${f.vector.category}`)
      lines.push(`- **Expected:** ${f.vector.expectation === 'safe' ? 'approved (yes)' : 'denied (no/maybe)'}`)
      lines.push(`- **Got:** ${f.decision}`)
      lines.push(`- **Tool:** ${f.vector.ctx.toolName}`)
      lines.push(`- **Input:** \`${escapeMarkdown(input)}\``)
      lines.push('')
      lines.push('**LLM Response:**')
      lines.push('```')
      lines.push(f.rawResponse || '(empty)')
      lines.push('```')
      lines.push('')
    }
  }

  // Full detailed results
  lines.push('## Detailed Results')
  lines.push('')

  for (const cat of categories) {
    const catResults = results.filter((r) => r.vector.category === cat)
    lines.push(`### ${cat}`)
    lines.push('')

    for (const r of catResults) {
      const status = r.passed ? 'PASS' : '**FAIL**'
      const input =
        r.vector.ctx.toolName === 'Bash'
          ? (r.vector.ctx.toolInput as { command: string }).command
          : JSON.stringify(r.vector.ctx.toolInput)

      lines.push(`#### ${status}: ${r.vector.name}`)
      lines.push('')
      lines.push(`- **Tool:** ${r.vector.ctx.toolName}`)
      lines.push(`- **Input:** \`${escapeMarkdown(input)}\``)
      lines.push(`- **Decision:** \`${r.decision}\``)
      lines.push(`- **Expected:** ${r.vector.expectation === 'safe' ? 'yes' : 'not yes'}`)
      lines.push(`- **Time:** ${(r.elapsedMs / 1000).toFixed(1)}s`)
      lines.push(`- **Cost:** $${r.costUsd.toFixed(4)}`)
      if (r.error) {
        lines.push(`- **Error:** ${r.error}`)
      }
      lines.push('')
      lines.push('<details>')
      lines.push('<summary>LLM Response</summary>')
      lines.push('')
      lines.push('```')
      lines.push(r.rawResponse || '(empty)')
      lines.push('```')
      lines.push('')
      lines.push('</details>')
      lines.push('')
    }
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

async function main() {
  const total = TEST_VECTORS.length
  console.log(`\nSmart Approval Integration Test Runner`)
  console.log(`${'='.repeat(50)}`)
  console.log(`Running ${total} test vectors against real LLM...\n`)

  const results: TestResult[] = []
  const startTime = Date.now()

  for (let i = 0; i < total; i++) {
    const vector = TEST_VECTORS[i]
    const prefix = `[${String(i + 1).padStart(3)}/${total}]`

    process.stdout.write(`${prefix} ${vector.category}: ${vector.name} ... `)

    const result = await evaluateWithDetails(vector)
    results.push(result)

    const status = result.passed ? 'PASS' : 'FAIL'
    const detail = `${result.decision} (${(result.elapsedMs / 1000).toFixed(1)}s, $${result.costUsd.toFixed(4)})`
    console.log(`${status} — ${detail}`)

    if (!result.passed) {
      console.log(`  >>> UNEXPECTED: expected ${vector.expectation}, got ${result.decision}`)
      console.log(`  >>> Response: ${result.rawResponse.slice(0, 200)}`)
    }
  }

  const totalElapsed = Date.now() - startTime

  // Generate report
  const report = generateReport(results, totalElapsed)

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const reportPath = path.resolve(__dirname, `../../../docs/integration-report-${timestamp}.md`)
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, report, 'utf-8')

  // Summary
  const passed = results.filter((r) => r.passed).length
  const failed = results.filter((r) => !r.passed).length
  const totalCost = results.reduce((sum, r) => sum + r.costUsd, 0)

  console.log(`\n${'='.repeat(50)}`)
  console.log(`RESULTS: ${passed} passed, ${failed} failed out of ${total}`)
  console.log(`Duration: ${(totalElapsed / 1000).toFixed(1)}s`)
  console.log(`Total cost: $${totalCost.toFixed(4)}`)
  console.log(`Report: ${reportPath}`)
  console.log(`${'='.repeat(50)}\n`)

  // Exit with error code if any failures
  if (failed > 0) process.exit(1)
}

main()
