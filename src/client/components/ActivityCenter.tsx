import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react'
import type {
  AgentRun,
  CreateForkRequest,
  ProgramVersion,
  RunnerDescriptor,
} from '../../shared/model'
import { isRunActive } from '../../shared/model'
import { useInertBackground } from '../useInertBackground'
import { Icon } from './Icon'
import { PanelFeedback, type PanelFeedbackValue } from './PanelFeedback'
import './ActivityCenter.css'

export interface ActivityCenterProps {
  runs: readonly AgentRun[]
  versions: readonly ProgramVersion[]
  selectedRunId: string | null
  runner: RunnerDescriptor
  starting: boolean
  onSelectRun: (id: string) => void
  onClose: () => void
  onRetry: (request: CreateForkRequest) => void
  onCopy: (label: string, value: string) => void
  onInspectDecision: (versionId: string, decisionId: string) => void
  feedback: PanelFeedbackValue | null
  onDismissFeedback: () => void
}

interface RunContext {
  version?: ProgramVersion
  parent?: ProgramVersion
  decisionTitle?: string
  fromLabel?: string
  toLabel?: string
  retryRequest?: CreateForkRequest
}

const phaseLabel: Record<AgentRun['phase'], string> = {
  queued: 'Queued',
  preparing: 'Preparing',
  generating: 'Generating',
  verifying: 'Verifying',
  complete: 'Complete',
  failed: 'Failed',
}

function timestamp(value: string): number {
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

function formatDate(value: string | undefined): string {
  if (!value) return 'Not finished'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed)
}

function formatLogTime(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(parsed)
}

function formatRunListTime(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed)
}

function displayLabel(value: string): string {
  return value.replace(/[-_]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

function contextFor(run: AgentRun, versions: readonly ProgramVersion[]): RunContext {
  const version = versions.find(
    (candidate) => candidate.id === run.versionId || candidate.runId === run.id,
  )
  if (!version) return {}
  const parent = version.parentId
    ? versions.find((candidate) => candidate.id === version.parentId)
    : undefined
  const origin = version.forkOrigin
  if (!origin) return { version, parent }
  const parentDecision = parent?.decisions.find((candidate) => candidate.id === origin.decisionId)
  const versionDecision = version.decisions.find((candidate) => candidate.id === origin.decisionId)
  const decision = versionDecision ?? parentDecision
  const alternatives = [
    ...(parentDecision?.alternatives ?? []),
    ...(versionDecision?.alternatives ?? []),
  ]
  const fromLabel = alternatives.find(
    (candidate) => candidate.id === origin.fromAlternativeId,
  )?.label
  const toLabel = alternatives.find((candidate) => candidate.id === origin.toAlternativeId)?.label
  return {
    version,
    parent,
    decisionTitle: decision?.title ?? displayLabel(origin.decisionId),
    fromLabel: fromLabel ?? displayLabel(origin.fromAlternativeId),
    toLabel: toLabel ?? displayLabel(origin.toAlternativeId),
    retryRequest: version.parentId
      ? {
          baseVersionId: version.parentId,
          decisionId: origin.decisionId,
          alternativeId: origin.toAlternativeId,
        }
      : undefined,
  }
}

function RunListItem({
  run,
  version,
  selected,
  onSelect,
}: {
  run: AgentRun
  version?: ProgramVersion
  selected: boolean
  onSelect: () => void
}) {
  const progress = Math.max(0, Math.min(100, Math.round(run.progress)))
  const active = isRunActive(run)
  return (
    <li>
      <button
        aria-current={selected ? 'true' : undefined}
        aria-label={`${version?.name ?? run.versionId}: ${phaseLabel[run.phase]}, ${progress} percent. Started ${formatDate(run.startedAt)}.`}
        className={`activity-center__run ${selected ? 'activity-center__run--selected' : ''}`}
        onClick={onSelect}
        type="button"
      >
        <span
          className={`activity-center__run-status activity-center__run-status--${run.phase}`}
          aria-hidden="true"
        />
        <span className="activity-center__run-copy">
          <strong>{version?.name ?? run.versionId}</strong>
          <span>
            {run.mode === 'preview' ? 'Preview' : 'Agent'} · {phaseLabel[run.phase]}
          </span>
        </span>
        <time dateTime={run.startedAt} title={formatDate(run.startedAt)}>
          {formatRunListTime(run.startedAt)}
        </time>
        <span className="activity-center__run-progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </span>
        <span className="activity-center__run-percent">
          {active ? `${progress}%` : phaseLabel[run.phase]}
        </span>
      </button>
    </li>
  )
}

function CopyField({
  label,
  value,
  onCopy,
}: {
  label: string
  value: string
  onCopy: (label: string, value: string) => void
}) {
  return (
    <div className="activity-center__copy-field">
      <span>{label}</span>
      <code title={value}>{value}</code>
      <button
        aria-label={`Copy ${label.toLowerCase()}`}
        onClick={() => onCopy(label, value)}
        type="button"
      >
        Copy
      </button>
    </div>
  )
}

export function ActivityCenter({
  runs,
  versions,
  selectedRunId,
  runner,
  starting,
  onSelectRun,
  onClose,
  onRetry,
  onCopy,
  onInspectDecision,
  feedback,
  onDismissFeedback,
}: ActivityCenterProps) {
  const title = useRef<HTMLHeadingElement>(null)
  const dialog = useRef<HTMLElement>(null)
  const sortedRuns = useMemo(
    () =>
      [...runs].sort((left, right) => {
        const activeDelta = Number(isRunActive(right)) - Number(isRunActive(left))
        return (
          activeDelta ||
          timestamp(right.startedAt) - timestamp(left.startedAt) ||
          right.id.localeCompare(left.id)
        )
      }),
    [runs],
  )
  const selectedRun = sortedRuns.find((run) => run.id === selectedRunId) ?? sortedRuns[0]
  const selectedContext = selectedRun ? contextFor(selectedRun, versions) : undefined
  const selectedResult = selectedRun?.result
  const activeCount = sortedRuns.filter(isRunActive).length
  const progress = selectedRun ? Math.max(0, Math.min(100, Math.round(selectedRun.progress))) : 0
  const changedFileCount =
    selectedResult?.changedFileCount ?? selectedContext?.version?.changedFiles
  const changedFilesSimulated =
    selectedResult?.changeKind === 'simulated' ||
    (!selectedResult &&
      selectedRun?.mode === 'preview' &&
      selectedContext?.version?.changedFiles !== undefined)
  const checksTitle = selectedRun?.mode === 'preview' ? 'Simulation check' : 'Host integrity checks'

  useInertBackground(true)

  useEffect(() => {
    title.current?.focus({ preventScroll: true })
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab' || !dialog.current) return
    const focusable = [
      ...dialog.current.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((element) => element.getClientRects().length > 0)
    if (!focusable.length) {
      event.preventDefault()
      title.current?.focus()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === title.current)
    ) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="activity-center">
      <section
        aria-describedby="activity-center-summary"
        aria-labelledby="activity-center-title"
        aria-modal="true"
        className="activity-center__dialog"
        onKeyDown={handleKeyDown}
        ref={dialog}
        role="dialog"
      >
        <div className="activity-center__chrome">
          <header className="activity-center__header">
            <span className="activity-center__header-icon">
              <Icon name="activity" size={21} />
            </span>
            <div>
              <p>Workspace activity</p>
              <h2 id="activity-center-title" ref={title} tabIndex={-1}>
                Activity center
              </h2>
              <span className="activity-center__summary" id="activity-center-summary">
                {activeCount
                  ? `${activeCount} active ${activeCount === 1 ? 'run' : 'runs'} with ${runner.label}`
                  : `${sortedRuns.length} recent ${sortedRuns.length === 1 ? 'run' : 'runs'} · ${runner.label}`}
              </span>
            </div>
            <span
              aria-label={`${runner.label}: ${runner.available ? 'available' : 'unavailable'}`}
              className={`activity-center__runner ${runner.available ? '' : 'activity-center__runner--offline'}`}
              role="status"
              title={`${runner.label}: ${runner.available ? 'available' : 'unavailable'}`}
            >
              <span aria-hidden="true">
                <Icon name={runner.available ? 'check' : 'warning'} size={12} />
              </span>
              {runner.available ? 'Runner available' : 'Runner unavailable'}
            </span>
            <button
              className="activity-center__close"
              onClick={onClose}
              type="button"
              aria-label="Close activity center"
            >
              <Icon name="close" size={20} />
            </button>
          </header>
          <PanelFeedback
            className="activity-center__feedback"
            onDismiss={onDismissFeedback}
            value={feedback}
          />
        </div>

        {sortedRuns.length ? (
          <div className="activity-center__content">
            <nav aria-label="Run history" className="activity-center__history">
              <div className="activity-center__section-heading">
                <h3>Runs</h3>
                <span>{sortedRuns.length}</span>
              </div>
              <ul>
                {sortedRuns.map((run) => (
                  <RunListItem
                    key={run.id}
                    onSelect={() => onSelectRun(run.id)}
                    run={run}
                    selected={run.id === selectedRun.id}
                    version={contextFor(run, versions).version}
                  />
                ))}
              </ul>
            </nav>

            <article
              aria-labelledby="activity-center-detail-title"
              className="activity-center__detail"
              id="activity-center-detail"
            >
              <div className="activity-center__detail-header">
                <div>
                  <span
                    className={`activity-center__phase activity-center__phase--${selectedRun.phase}`}
                  >
                    {isRunActive(selectedRun) ? <span aria-hidden="true" /> : null}
                    {selectedRun.mode === 'preview' ? 'Preview' : 'Agent'} ·{' '}
                    {phaseLabel[selectedRun.phase]}
                  </span>
                  <h3 id="activity-center-detail-title">
                    {selectedContext?.version?.name ?? selectedRun.versionId}
                  </h3>
                  <p>{selectedContext?.version?.summary ?? `Activity for run ${selectedRun.id}`}</p>
                </div>
                <div className="activity-center__progress-value">
                  <strong>{progress}%</strong>
                  <span>{phaseLabel[selectedRun.phase]}</span>
                </div>
              </div>
              <p className="activity-center__sr-only" aria-atomic="true" aria-live="polite">
                {`${selectedContext?.version?.name ?? selectedRun.versionId}: ${phaseLabel[selectedRun.phase]}, ${progress} percent`}
              </p>
              <div
                aria-label={`${progress} percent complete`}
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={progress}
                className={`activity-center__progress activity-center__progress--${selectedRun.phase}`}
                role="progressbar"
              >
                <span style={{ width: `${progress}%` }} />
              </div>

              <dl className="activity-center__metadata">
                <div>
                  <dt>Started</dt>
                  <dd>{formatDate(selectedRun.startedAt)}</dd>
                </div>
                <div>
                  <dt>Finished</dt>
                  <dd>{formatDate(selectedRun.completedAt)}</dd>
                </div>
                <div>
                  <dt>Mode</dt>
                  <dd>{selectedRun.mode === 'preview' ? 'Preview simulation' : runner.label}</dd>
                </div>
              </dl>

              {selectedContext?.decisionTitle ? (
                <section
                  className="activity-center__provenance"
                  aria-labelledby="activity-center-provenance-title"
                >
                  <div>
                    <p>Fork provenance</p>
                    <h4 id="activity-center-provenance-title">{selectedContext.decisionTitle}</h4>
                  </div>
                  <div className="activity-center__choice-change">
                    <span>
                      <small>From</small>
                      <strong>{selectedContext.fromLabel}</strong>
                    </span>
                    <Icon name="arrow" size={18} />
                    <span>
                      <small>To</small>
                      <strong>{selectedContext.toLabel}</strong>
                    </span>
                  </div>
                  {selectedContext.version?.forkOrigin ? (
                    <button
                      onClick={() =>
                        onInspectDecision(
                          selectedContext.version!.id,
                          selectedContext.version!.forkOrigin!.decisionId,
                        )
                      }
                      type="button"
                    >
                      Inspect decision <Icon name="chevron" size={16} />
                    </button>
                  ) : null}
                </section>
              ) : null}

              {selectedRun.error ? (
                <section
                  className="activity-center__failure"
                  aria-labelledby="activity-center-failure-title"
                >
                  <span aria-hidden="true">
                    <Icon name="warning" size={19} />
                  </span>
                  <div>
                    <h4 id="activity-center-failure-title">Run needs attention</h4>
                    <p>{selectedRun.error}</p>
                  </div>
                </section>
              ) : null}

              <div className="activity-center__results-grid">
                <section
                  aria-labelledby="activity-center-changes-title"
                  className="activity-center__result-card"
                >
                  <div className="activity-center__section-heading">
                    <h4 id="activity-center-changes-title">Changes</h4>
                    {selectedResult?.changeKind ? (
                      <span>
                        {selectedResult.changeKind === 'simulated' ? 'Simulation' : 'Measured'}
                      </span>
                    ) : null}
                  </div>
                  {changedFileCount !== undefined ? (
                    <p className="activity-center__file-count">
                      <strong>{changedFileCount}</strong>
                      <span>
                        {changedFilesSimulated ? 'illustrative affected files' : 'changed files'}
                      </span>
                    </p>
                  ) : (
                    <p className="activity-center__muted">No file summary reported yet.</p>
                  )}
                  {selectedResult?.changedFiles.length ? (
                    <ul className="activity-center__files">
                      {selectedResult.changedFiles.map((file) => (
                        <li key={file}>
                          <code title={file}>{file}</code>
                        </li>
                      ))}
                      {selectedResult.changedFilesTruncated ? (
                        <li>Additional files omitted from this summary.</li>
                      ) : null}
                    </ul>
                  ) : null}
                </section>

                <section
                  aria-labelledby="activity-center-checks-title"
                  className="activity-center__result-card"
                >
                  <div className="activity-center__section-heading">
                    <h4 id="activity-center-checks-title">{checksTitle}</h4>
                    <span>{selectedResult?.checks.length ?? 0}</span>
                  </div>
                  {selectedResult?.checks.length ? (
                    <ul className="activity-center__checks">
                      {selectedResult.checks.map((check) => (
                        <li key={check.id}>
                          <span
                            className={`activity-center__check-icon activity-center__check-icon--${check.status}`}
                          >
                            <Icon name={check.status === 'passed' ? 'check' : 'spark'} size={15} />
                          </span>
                          <span>
                            <strong>{check.label}</strong>
                            <small title={check.detail}>{check.detail}</small>
                          </span>
                          <em>{displayLabel(check.status)}</em>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="activity-center__muted">No check results reported yet.</p>
                  )}
                </section>
              </div>

              <section
                aria-labelledby="activity-center-timeline-title"
                className="activity-center__timeline"
              >
                <div className="activity-center__section-heading">
                  <h4 id="activity-center-timeline-title">Timeline</h4>
                  <span>
                    {selectedRun.logs.length} {selectedRun.logs.length === 1 ? 'event' : 'events'}
                  </span>
                </div>
                {selectedRun.logs.length ? (
                  <ol>
                    {selectedRun.logs.map((entry) => (
                      <li
                        className={`activity-center__log activity-center__log--${entry.tone}`}
                        key={entry.id}
                      >
                        <span aria-hidden="true" />
                        <time dateTime={entry.at}>{formatLogTime(entry.at)}</time>
                        <p>{entry.message}</p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="activity-center__muted">The run has not reported any events.</p>
                )}
              </section>

              {selectedContext?.version ? (
                <section aria-label="Version details" className="activity-center__technical">
                  <CopyField
                    label={
                      selectedRun.mode === 'preview'
                        ? selectedRun.phase === 'complete'
                          ? 'Simulated branch'
                          : 'Reserved simulated branch'
                        : selectedRun.phase === 'complete'
                          ? 'Branch'
                          : 'Reserved branch'
                    }
                    onCopy={onCopy}
                    value={selectedContext.version.branch}
                  />
                  <CopyField
                    label={
                      selectedRun.mode === 'preview'
                        ? selectedRun.phase === 'complete'
                          ? 'Result ID'
                          : 'Base ID'
                        : selectedRun.phase === 'complete'
                          ? 'Result commit'
                          : 'Base commit'
                    }
                    onCopy={onCopy}
                    value={selectedContext.version.commit}
                  />
                </section>
              ) : null}

              {selectedRun.phase === 'failed' && selectedContext?.retryRequest ? (
                <div className="activity-center__actions">
                  <p>
                    {runner.available
                      ? 'Retry this exact decision from its original parent.'
                      : runner.detail}
                  </p>
                  <button
                    disabled={starting || !runner.available}
                    onClick={() => onRetry(selectedContext.retryRequest!)}
                    type="button"
                  >
                    <Icon
                      className={starting ? 'activity-center__spin' : ''}
                      name="refresh"
                      size={18}
                    />
                    {starting
                      ? 'Starting retry…'
                      : runner.mode === 'preview'
                        ? 'Retry preview'
                        : 'Retry fork'}
                  </button>
                </div>
              ) : null}
            </article>
          </div>
        ) : (
          <div className="activity-center__empty">
            <span aria-hidden="true">
              <Icon name="activity" size={25} />
            </span>
            <h3>No activity yet</h3>
            <p>
              Generated forks and previews will appear here with their progress, checks, and
              results.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
