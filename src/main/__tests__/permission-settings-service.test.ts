import { describe, expect, it, vi, beforeEach } from 'vitest'
import { join } from 'path'

// In-memory file system for testing — normalize keys to forward slashes
// so tests work identically on Windows (path.join uses backslash) and Unix.
const files = new Map<string, string>()
const norm = (p: string): string => p.replace(/\\/g, '/')

vi.mock('fs/promises', () => ({
  readFile: vi.fn(async (path: string) => {
    const content = files.get(norm(path))
    if (content === undefined) throw new Error('ENOENT')
    return content
  }),
  writeFile: vi.fn(async (path: string, data: string) => {
    files.set(norm(path), data)
  }),
  mkdir: vi.fn(async () => undefined)
}))

import { generateToolPattern, addAllowedToolPattern } from '../permission-settings-service'

beforeEach(() => {
  files.clear()
})

// ---------------------------------------------------------------------------
// generateToolPattern
// ---------------------------------------------------------------------------

describe('generateToolPattern', () => {
  it('returns tool name for non-Bash tools', () => {
    expect(generateToolPattern('Write', {})).toBe('Write')
    expect(generateToolPattern('Read', { file_path: '/foo.ts' })).toBe('Read')
    expect(generateToolPattern('Edit', { file_path: '/foo.ts' })).toBe('Edit')
    expect(generateToolPattern('Glob', { pattern: '*.ts' })).toBe('Glob')
    expect(generateToolPattern('Grep', { pattern: 'foo' })).toBe('Grep')
    expect(generateToolPattern('WebFetch', {})).toBe('WebFetch')
  })

  it('extracts git subcommand prefix for Bash', () => {
    expect(generateToolPattern('Bash', { command: 'git add src/foo.ts' })).toBe('Bash(git add:*)')
    expect(generateToolPattern('Bash', { command: 'git commit -m "fix"' })).toBe(
      'Bash(git commit:*)'
    )
    expect(generateToolPattern('Bash', { command: 'git status' })).toBe('Bash(git status:*)')
  })

  it('extracts npm subcommand prefix for Bash', () => {
    expect(generateToolPattern('Bash', { command: 'npm run build' })).toBe('Bash(npm run:*)')
    expect(generateToolPattern('Bash', { command: 'npm install express' })).toBe(
      'Bash(npm install:*)'
    )
    expect(generateToolPattern('Bash', { command: 'npx vitest run' })).toBe('Bash(npx vitest:*)')
  })

  it('stops at flag arguments', () => {
    expect(generateToolPattern('Bash', { command: 'ls -la /tmp' })).toBe('Bash(ls:*)')
    expect(generateToolPattern('Bash', { command: 'grep -r pattern .' })).toBe('Bash(grep:*)')
  })

  it('stops at path arguments', () => {
    expect(generateToolPattern('Bash', { command: 'cat /etc/hosts' })).toBe('Bash(cat:*)')
    expect(generateToolPattern('Bash', { command: 'rm ./foo.txt' })).toBe('Bash(rm:*)')
  })

  it('stops at quoted arguments', () => {
    expect(generateToolPattern('Bash', { command: 'echo "hello world"' })).toBe('Bash(echo:*)')
    expect(generateToolPattern('Bash', { command: "echo 'hello'" })).toBe('Bash(echo:*)')
  })

  it('limits prefix to 2 words', () => {
    expect(generateToolPattern('Bash', { command: 'a b c d e' })).toBe('Bash(a b:*)')
  })

  it('handles empty command', () => {
    expect(generateToolPattern('Bash', { command: '' })).toBe('Bash')
    expect(generateToolPattern('Bash', { command: '  ' })).toBe('Bash')
  })

  it('returns tool name when command is not a string', () => {
    expect(generateToolPattern('Bash', {})).toBe('Bash')
    expect(generateToolPattern('Bash', { command: 123 })).toBe('Bash')
  })

  it('strips shell operators before extracting prefix', () => {
    expect(generateToolPattern('Bash', { command: 'echo hello && rm -rf /' })).toBe(
      'Bash(echo hello:*)'
    )
    expect(generateToolPattern('Bash', { command: 'cat file.txt | grep foo' })).toBe(
      'Bash(cat file.txt:*)'
    )
    expect(generateToolPattern('Bash', { command: 'a; b' })).toBe('Bash(a:*)')
    expect(generateToolPattern('Bash', { command: 'cmd1 || cmd2' })).toBe('Bash(cmd1:*)')
  })
})

// ---------------------------------------------------------------------------
// addAllowedToolPattern
// ---------------------------------------------------------------------------

describe('addAllowedToolPattern', () => {
  const repoPath = '/mock/repo'
  const settingsPath = norm(join(repoPath, '.claude', 'settings.local.json'))

  it('creates settings file from scratch when missing', async () => {
    await addAllowedToolPattern(repoPath, 'Write')

    const written = JSON.parse(files.get(settingsPath)!)
    expect(written.permissions.allow).toEqual(['Write'])
  })

  it('merges into existing settings preserving other fields', async () => {
    files.set(
      settingsPath,
      JSON.stringify({
        someOtherKey: true,
        permissions: { allow: ['Read'], deny: ['Bash(rm -rf:*)'] }
      })
    )

    await addAllowedToolPattern(repoPath, 'Write')

    const written = JSON.parse(files.get(settingsPath)!)
    expect(written.someOtherKey).toBe(true)
    expect(written.permissions.allow).toEqual(['Read', 'Write'])
    expect(written.permissions.deny).toEqual(['Bash(rm -rf:*)'])
  })

  it('does not duplicate existing pattern', async () => {
    files.set(settingsPath, JSON.stringify({ permissions: { allow: ['Write'] } }))

    await addAllowedToolPattern(repoPath, 'Write')

    const written = JSON.parse(files.get(settingsPath)!)
    expect(written.permissions.allow).toEqual(['Write'])
  })

  it('handles settings with permissions but no allow array', async () => {
    files.set(settingsPath, JSON.stringify({ permissions: { deny: ['Bash(rm:*)'] } }))

    await addAllowedToolPattern(repoPath, 'Edit')

    const written = JSON.parse(files.get(settingsPath)!)
    expect(written.permissions.allow).toEqual(['Edit'])
    expect(written.permissions.deny).toEqual(['Bash(rm:*)'])
  })

  it('no-ops with empty repoPath', async () => {
    await addAllowedToolPattern('', 'Write')
    expect(files.size).toBe(0)
  })

  it('throws on corrupt JSON instead of silently overwriting', async () => {
    files.set(settingsPath, '{ invalid json }}}')

    await expect(addAllowedToolPattern(repoPath, 'Write')).rejects.toThrow()
    // File should not have been overwritten
    expect(files.get(settingsPath)).toBe('{ invalid json }}}')
  })
})
