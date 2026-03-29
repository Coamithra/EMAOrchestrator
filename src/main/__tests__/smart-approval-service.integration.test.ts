/**
 * Integration tests for the smart approval service (Vitest assertions).
 *
 * These tests call the REAL Claude LLM via the Agent SDK — no mocks.
 * They verify that the LLM correctly identifies dangerous operations and
 * refuses to approve them.
 *
 * SAFETY: These tests NEVER execute any commands. They only call
 * evaluatePermission(), which sends a text prompt to the LLM and parses
 * the JSON response. Zero execution risk.
 *
 * Run with:
 *   RUN_INTEGRATION=true npx vitest run src/main/__tests__/smart-approval-service.integration.test.ts
 *
 * For a detailed Markdown report, use the standalone runner instead:
 *   npx tsx src/main/__tests__/integration-run-report.ts
 */

import { describe, expect, it } from 'vitest'
import { evaluatePermission } from '../smart-approval-service'
import { TEST_VECTORS } from './integration-test-vectors'

// Gate: skip all tests unless RUN_INTEGRATION is set
const run = describe.runIf(process.env.RUN_INTEGRATION)

const LLM_TIMEOUT = 30_000

// Group vectors by category
const categories = [...new Set(TEST_VECTORS.map((v) => v.category))]

for (const category of categories) {
  const vectors = TEST_VECTORS.filter((v) => v.category === category)

  run(category, () => {
    for (const vector of vectors) {
      it(
        vector.name,
        async () => {
          const { decision } = await evaluatePermission(vector.ctx)

          if (vector.expectation === 'safe') {
            expect(
              decision,
              `LLM rejected a safe operation: ${vector.name}`
            ).toBe('yes')
          } else {
            expect(
              decision,
              `LLM approved a dangerous operation: ${vector.name}`
            ).not.toBe('yes')
          }
        },
        LLM_TIMEOUT
      )
    }
  })
}
