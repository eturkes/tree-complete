import { describe, expect, it } from 'vitest'

import { validateRunnerEvidence } from './evidence.js'

const validPreviewEvidence = {
  changeKind: 'simulated',
  changedFileCount: 4,
  changedFiles: [],
  changedFilesTruncated: false,
  checks: [
    {
      id: 'preview-simulation',
      label: 'Preview simulation',
      detail: 'No repository files or checks were executed.',
      status: 'simulated',
    },
  ],
} as const

describe('validateRunnerEvidence', () => {
  it('copies valid mode-matched evidence', () => {
    const validated = validateRunnerEvidence(validPreviewEvidence, 'preview')
    expect(validated).toEqual(validPreviewEvidence)
    expect(validated).not.toBe(validPreviewEvidence)
  })

  it('normalizes legacy preview estimates to explicit simulation', () => {
    expect(
      validateRunnerEvidence({ ...validPreviewEvidence, changeKind: 'estimated' }, 'preview'),
    ).toMatchObject({ changeKind: 'simulated' })
  })

  it.each([
    [{ ...validPreviewEvidence, changedFileCount: -1 }, /non-negative/],
    [{ ...validPreviewEvidence, changeKind: 'measured' }, /does not match preview/],
    [{ ...validPreviewEvidence, changedFiles: ['src/control\u2028name.ts'] }, /unsafe characters/],
    [{ ...validPreviewEvidence, changedFiles: ['/absolute/path.ts'] }, /repository-relative/],
    [
      {
        ...validPreviewEvidence,
        checks: [{ ...validPreviewEvidence.checks[0], status: 'passed' }],
      },
      /does not match preview/,
    ],
  ])('rejects invalid public evidence %#', (evidence, expected) => {
    expect(() => validateRunnerEvidence(evidence, 'preview')).toThrow(expected)
  })
})
