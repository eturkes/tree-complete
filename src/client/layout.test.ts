import { describe, expect, it } from 'vitest'

import type { ProgramVersion } from '../shared/model.js'
import { layoutVersionTree, lineageEdges, lineagePathVersionIds } from './layout.js'

function version(id: string, parentId: string | null, createdAt: string): ProgramVersion {
  return {
    id,
    parentId,
    name: id,
    branch: id,
    commit: id,
    createdAt,
    status: 'complete',
    summary: id,
    decisions: [],
  }
}

describe('lineage layout and focus', () => {
  const versions = [
    version('root', null, '2026-01-01T00:00:00.000Z'),
    version('left', 'root', '2026-01-02T00:00:00.000Z'),
    version('right', 'root', '2026-01-03T00:00:00.000Z'),
    version('leaf', 'left', '2026-01-04T00:00:00.000Z'),
  ]

  it('places descendants in later columns without overlapping siblings', () => {
    const positions = layoutVersionTree(versions)

    expect(positions.get('root')?.x).toBe(0)
    expect(positions.get('left')?.x).toBeGreaterThan(positions.get('root')?.x ?? 0)
    expect(positions.get('leaf')?.x).toBeGreaterThan(positions.get('left')?.x ?? 0)
    expect(positions.get('left')?.y).not.toBe(positions.get('right')?.y)
  })

  it('returns the focused root-to-leaf path and highlights only its edges', () => {
    expect([...lineagePathVersionIds(versions, 'leaf')]).toEqual(['leaf', 'left', 'root'])

    const edges = lineageEdges(versions, 'leaf')
    expect(edges.find((edge) => edge.target === 'left')?.style?.opacity).toBe(1)
    expect(edges.find((edge) => edge.target === 'leaf')?.style?.opacity).toBe(1)
    expect(edges.find((edge) => edge.target === 'right')?.style?.opacity).toBe(0.34)
  })

  it('terminates malformed parent cycles while keeping every member visible', () => {
    const cycle = [
      version('one', 'two', '2026-01-01T00:00:00.000Z'),
      version('two', 'one', '2026-01-02T00:00:00.000Z'),
    ]

    expect([...lineagePathVersionIds(cycle, 'one')]).toEqual(['one', 'two'])
    expect(layoutVersionTree(cycle).size).toBe(2)
  })
})
