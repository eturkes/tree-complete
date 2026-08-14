import { describe, expect, it } from 'vitest'

import { workspaceStateKey } from './config.js'

describe('workspace state keys', () => {
  it('preserves target-less keys and isolates targeted preview baselines', () => {
    expect(workspaceStateKey('preview')).toBe('preview')
    expect(workspaceStateKey('codex')).toBe('codex-unconfigured')

    const first = workspaceStateKey('preview', '/repo/a\0commit-1\0project\0preview-v1')
    const secondTarget = workspaceStateKey('preview', '/repo/b\0commit-1\0project\0preview-v1')
    const secondBaseline = workspaceStateKey('preview', '/repo/a\0commit-2\0project\0preview-v1')
    expect(first).toMatch(/^preview-[0-9a-f]{12}$/)
    expect(new Set([first, secondTarget, secondBaseline]).size).toBe(3)
  })
})
