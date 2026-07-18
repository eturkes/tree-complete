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
  const { version, runnerMode, selectedDecisionId, onSelectDecision } = data
  const preview = runnerMode === 'preview' || version.commit.startsWith('preview-')
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
      className={`version-node version-node--${version.status}`}
      style={{ width: VERSION_NODE_WIDTH }}
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
          <span className="version-node__commit">{shortCommit(version.commit)}</span>
        </div>
        <div className="version-node__title-row">
          <div>
            <h2>{version.name}</h2>
            <span className="version-node__branch">
              <Icon name="branch" size={13} />
              {version.branch}
            </span>
          </div>
          {version.changedFiles !== undefined ? (
            <span className="file-count" title={preview ? 'Files affected in preview' : 'Files changed'}>
              <strong>{version.changedFiles}</strong> files
            </span>
          ) : null}
        </div>
        <p>{version.summary}</p>
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
                aria-label={`${decision.title}. Current choice: ${choice}`}
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
                  <span>{choice}</span>
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
