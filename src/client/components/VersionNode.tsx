import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { ProgramVersion, RunnerMode } from '../../shared/model'
import { chosenAlternative } from '../../shared/model'
import { VERSION_NODE_WIDTH } from '../layout'
import { Icon } from './Icon'

export interface VersionNodeData extends Record<string, unknown> {
  version: ProgramVersion
  runnerMode?: RunnerMode
  selectedDecisionId: string | null
  onSelectDecision: (versionId: string, decisionId: string) => void
  onOpenRun: (runId: string) => void
  highlighted: boolean
  inFocusedPath: boolean
}

export type VersionFlowNode = Node<VersionNodeData, 'version'>

const statusLabel: Record<ProgramVersion['status'], string> = {
  ready: 'Baseline',
  queued: 'Queued',
  working: 'Agent working',
  complete: 'Generated',
  failed: 'Needs attention',
}

function shortCommit(commit: string): string {
  return commit === 'pending' ? commit : commit.slice(0, 7)
}

export function VersionNode({ data }: NodeProps<VersionFlowNode>) {
  const {
    version,
    runnerMode,
    selectedDecisionId,
    onSelectDecision,
    onOpenRun,
    highlighted,
    inFocusedPath,
  } = data
  const preview = runnerMode === 'preview' || version.commit.startsWith('preview-')
  const realized = version.status === 'ready' || version.status === 'complete'
  const displayedStatus = preview
    ? {
        ...statusLabel,
        queued: 'Preview queued',
        working: 'Previewing',
        complete: 'Preview',
        failed: 'Preview failed',
      }[version.status]
    : statusLabel[version.status]

  return (
    <article
      className={`version-node version-node--${version.status} ${highlighted ? 'version-node--highlighted' : inFocusedPath ? 'version-node--path' : ''}`}
      style={{ width: `min(${VERSION_NODE_WIDTH}px, calc(100vw - 24px))` }}
      aria-label={`${version.name}, ${displayedStatus}`}
    >
      {version.parentId ? (
        <Handle
          aria-hidden="true"
          className="version-node__handle version-node__handle--target"
          position={Position.Left}
          type="target"
        />
      ) : null}

      <header className="version-node__header">
        <div className="version-node__eyebrow">
          <span className={`status-chip status-chip--${version.status}`}>
            <span className="status-chip__dot" />
            {displayedStatus}
          </span>
          <span className="version-node__meta-actions">
            <span
              className="version-node__commit"
              title={preview ? `Synthetic preview result ID: ${version.commit}` : version.commit}
            >
              {preview ? `sim · ${shortCommit(version.commit)}` : shortCommit(version.commit)}
            </span>
            {version.runId ? (
              <button
                aria-label={`Open run evidence for ${version.name}`}
                className="version-node__run-button nodrag nopan"
                onClick={(event) => {
                  event.stopPropagation()
                  onOpenRun(version.runId!)
                }}
                title="Open run evidence"
                type="button"
              >
                <Icon name="activity" size={13} />
                Evidence
              </button>
            ) : null}
          </span>
        </div>
        <div className="version-node__title-row">
          <div>
            <h2>{version.name}</h2>
            <span className="version-node__branch" title={version.branch}>
              <Icon name={preview ? 'spark' : 'branch'} size={13} />
              {preview ? 'sim · ' : ''}
              {version.branch}
            </span>
          </div>
          {version.changedFiles !== undefined ? (
            <span
              className="file-count"
              title={preview ? 'Illustrative simulation only' : 'Files changed'}
            >
              <strong>{version.changedFiles}</strong> {preview ? 'simulated' : 'files'}
            </span>
          ) : null}
        </div>
        <p title={version.summary}>{version.summary}</p>
      </header>

      <div className="decision-list" aria-label={`Design decisions in ${version.name}`}>
        {version.decisions.length ? (
          version.decisions.map((decision, index) => {
            const selected = decision.id === selectedDecisionId
            let choice = 'Choice unavailable'
            try {
              choice = chosenAlternative(decision).label
            } catch {
              // Keep malformed server data inspectable rather than crashing the tree.
            }
            return (
              <button
                aria-label={`${decision.title}. ${realized ? 'Current' : 'Target'} choice: ${choice}`}
                aria-pressed={selected}
                className={`decision-row nodrag nopan ${selected ? 'decision-row--selected' : ''}`}
                key={decision.id}
                onClick={(event) => {
                  event.stopPropagation()
                  onSelectDecision(version.id, decision.id)
                }}
                type="button"
              >
                <span className="decision-row__index">{String(index + 1).padStart(2, '0')}</span>
                <span className="decision-row__copy">
                  <strong>{decision.title}</strong>
                  <span>{realized ? choice : `Target · ${choice}`}</span>
                </span>
                <span className="decision-row__arrow">
                  <Icon name="chevron" size={15} />
                </span>
              </button>
            )
          })
        ) : (
          <div className="decision-list__empty">No documented decisions</div>
        )}
      </div>

      <Handle
        aria-hidden="true"
        className="version-node__handle version-node__handle--source"
        position={Position.Right}
        type="source"
      />
    </article>
  )
}
