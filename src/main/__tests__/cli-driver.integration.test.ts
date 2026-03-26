import { describe, it, expect } from 'vitest'
import { CliDriver } from '../cli-driver'
import type { SessionInfo, SessionResult } from '../../shared/cli-driver'

/**
 * Integration test — requires a real Claude CLI installation.
 * Remove `.skip` to run locally:
 *   npx vitest run src/main/__tests__/cli-driver.integration.test.ts
 */
describe.skip('CliDriver integration (requires Claude CLI)', () => {
  it('completes a simple prompt', async () => {
    const driver = new CliDriver()
    const events: string[] = []
    let initInfo: SessionInfo | null = null
    let finalResult: SessionResult | null = null

    driver.on('session:init', (info) => {
      events.push('init')
      initInfo = info
    })
    driver.on('stream:text', () => events.push('text'))
    driver.on('assistant:message', () => events.push('assistant'))
    driver.on('session:result', (r) => {
      events.push('result')
      finalResult = r
    })

    await driver.startSession({
      prompt: 'Say "hello" and nothing else.',
      cwd: process.cwd(),
      maxTurns: 1
    })

    expect(events).toContain('init')
    expect(events).toContain('result')
    expect(initInfo).not.toBeNull()
    expect(initInfo!.sessionId).toBeTruthy()
    expect(finalResult).not.toBeNull()
    expect(finalResult!.subtype).toBe('success')
    expect(finalResult!.costUsd).toBeGreaterThan(0)
  }, 60_000)
})
