import type { Edge, XYPosition } from '@xyflow/react'
import { MarkerType } from '@xyflow/react'
import type { ProgramVersion } from '../shared/model'

export const VERSION_NODE_WIDTH = 340
export const VERSION_COLUMN_GAP = 150
export const VERSION_ROW_GAP = 56

function estimatedHeight(version: ProgramVersion): number {
  return 128 + Math.max(version.decisions.length, 1) * 67
}

/**
 * Variable-height, left-to-right tree layout. Each parent is centered against
 * the vertical span of its children, keeping forks legible without a layout
 * dependency or a second async render pass.
 */
export function layoutVersionTree(versions: ProgramVersion[]): Map<string, XYPosition> {
  const byId = new Map(versions.map((version) => [version.id, version]))
  const children = new Map<string, ProgramVersion[]>()

  for (const version of versions) {
    if (!version.parentId || !byId.has(version.parentId)) continue
    const siblings = children.get(version.parentId) ?? []
    siblings.push(version)
    children.set(version.parentId, siblings)
  }

  const byCreatedAt = (a: ProgramVersion, b: ProgramVersion) =>
    a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  for (const siblings of children.values()) siblings.sort(byCreatedAt)

  const roots = versions
    .filter((version) => !version.parentId || !byId.has(version.parentId))
    .sort(byCreatedAt)
  const positions = new Map<string, XYPosition>()
  const placed = new Set<string>()
  const measuring = new Set<string>()
  const heightCache = new Map<string, number>()

  const subtreeHeight = (version: ProgramVersion): number => {
    const cached = heightCache.get(version.id)
    if (cached !== undefined) return cached
    if (measuring.has(version.id)) return estimatedHeight(version)
    measuring.add(version.id)
    const descendants = children.get(version.id) ?? []
    const descendantsHeight = descendants.reduce(
      (total, child, index) => total + subtreeHeight(child) + (index ? VERSION_ROW_GAP : 0),
      0,
    )
    measuring.delete(version.id)
    const height = Math.max(estimatedHeight(version), descendantsHeight)
    heightCache.set(version.id, height)
    return height
  }

  const place = (version: ProgramVersion, depth: number, top: number): void => {
    if (placed.has(version.id)) return
    placed.add(version.id)
    const ownHeight = estimatedHeight(version)
    const totalHeight = subtreeHeight(version)
    positions.set(version.id, {
      x: depth * (VERSION_NODE_WIDTH + VERSION_COLUMN_GAP),
      y: top + (totalHeight - ownHeight) / 2,
    })

    let cursor = top
    for (const child of children.get(version.id) ?? []) {
      place(child, depth + 1, cursor)
      cursor += subtreeHeight(child) + VERSION_ROW_GAP
    }
  }

  let cursor = 0
  for (const root of roots) {
    place(root, 0, cursor)
    cursor += subtreeHeight(root) + VERSION_ROW_GAP * 1.5
  }

  // Malformed cycles are still rendered in a separate lane rather than lost.
  for (const version of [...versions].sort(byCreatedAt)) {
    if (placed.has(version.id)) continue
    positions.set(version.id, { x: 0, y: cursor })
    placed.add(version.id)
    cursor += estimatedHeight(version) + VERSION_ROW_GAP
  }

  return positions
}

export function lineagePathVersionIds(
  versions: ProgramVersion[],
  focusedVersionId: string | null,
): Set<string> {
  const byId = new Map(versions.map((version) => [version.id, version]))
  const path = new Set<string>()
  let cursor = focusedVersionId ? byId.get(focusedVersionId) : undefined
  while (cursor && !path.has(cursor.id)) {
    path.add(cursor.id)
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
  }
  return path
}

export function lineageEdges(
  versions: ProgramVersion[],
  focusedVersionId: string | null = null,
): Edge[] {
  const ids = new Set(versions.map((version) => version.id))
  const focusedPath = lineagePathVersionIds(versions, focusedVersionId)
  return versions.flatMap((version) => {
    if (!version.parentId || !ids.has(version.parentId)) return []
    const origin = version.forkOrigin
    const decision = origin
      ? version.decisions.find((candidate) => candidate.id === origin.decisionId)
      : undefined
    const alternative = origin
      ? decision?.alternatives.find((candidate) => candidate.id === origin.toAlternativeId)
      : undefined
    const active = version.status === 'queued' || version.status === 'working'
    const highlighted = focusedPath.has(version.id)
    const muted = focusedPath.size > 0 && !highlighted && !active

    return [
      {
        id: `${version.parentId}:${version.id}`,
        source: version.parentId,
        target: version.id,
        type: 'smoothstep',
        animated: active,
        label: alternative?.label,
        labelShowBg: true,
        labelBgPadding: [8, 5],
        labelBgBorderRadius: 6,
        labelBgStyle: { fill: '#f8f7ef', fillOpacity: 0.96 },
        labelStyle: {
          fill: '#536059',
          fontFamily: 'Geist Mono Variable, monospace',
          fontSize: 10,
          fontWeight: 620,
          opacity: muted ? 0.42 : 1,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 15,
          height: 15,
          color: active || highlighted ? '#3e63f4' : '#8c9790',
        },
        style: {
          stroke: active || highlighted ? '#3e63f4' : '#8c9790',
          strokeWidth: active ? 2.5 : highlighted ? 2.2 : 1.8,
          opacity: muted ? 0.34 : 1,
        },
      },
    ]
  })
}
