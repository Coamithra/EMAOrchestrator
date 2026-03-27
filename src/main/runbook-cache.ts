import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { Runbook } from '../shared/runbook'
import type { RunbookParserType } from '../shared/config'

function getCacheDir(): string {
  return join(app.getPath('userData'), 'runbook-cache')
}

function cacheKey(markdown: string, parserType: RunbookParserType): string {
  return createHash('sha256').update(`${parserType}:${markdown}`).digest('hex')
}

function cachePath(key: string): string {
  return join(getCacheDir(), `${key}.json`)
}

/** Look up a cached runbook by content hash. Returns null on miss or error. */
export async function getCachedRunbook(
  markdown: string,
  parserType: RunbookParserType
): Promise<Runbook | null> {
  try {
    const key = cacheKey(markdown, parserType)
    const data = await readFile(cachePath(key), 'utf-8')
    return JSON.parse(data) as Runbook
  } catch {
    return null
  }
}

/** Store a parsed runbook in the cache. Fire-and-forget safe. */
export async function cacheRunbook(
  markdown: string,
  parserType: RunbookParserType,
  runbook: Runbook
): Promise<void> {
  try {
    const dir = getCacheDir()
    await mkdir(dir, { recursive: true })
    const key = cacheKey(markdown, parserType)
    await writeFile(cachePath(key), JSON.stringify(runbook, null, 2), 'utf-8')
  } catch (err) {
    console.error('Failed to cache runbook:', err)
  }
}
