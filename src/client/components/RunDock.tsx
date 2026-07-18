import type { AgentRun, ProgramVersion } from '../../shared/model'
import { Icon } from './Icon'

interface RunDockProps {
  run: AgentRun
  version?: ProgramVersion
}

const phaseLabel: Record<AgentRun['phase'], string> = {
  queued: 'Waiting for agent',
  preparing: 'Preparing worktree',
  generating: 'Writing the fork',
  verifying: 'Verifying changes',
  complete: 'Fork complete',
  failed: 'Run failed',
}

const previewPhaseLabel: Record<AgentRun['phase'], string> = {
  queued: 'Preview queued',
  preparing: 'Preparing preview',
  generating: 'Building preview',
  verifying: 'Checking preview',
  complete: 'Preview complete',
  failed: 'Preview failed',
}

function logTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

export function RunDock({ run, version }: RunDockProps) {
  const active = ['queued', 'preparing', 'generating', 'verifying'].includes(run.phase)
  const logs = run.logs.slice(-2)
  const preview = run.mode === 'preview'
  const displayedPhase = preview ? previewPhaseLabel[run.phase] : phaseLabel[run.phase]

  return (
    <section className={`run-dock run-dock--${run.phase}`} aria-label={preview ? 'Preview activity' : 'Coding agent activity'}>
      <div className="run-dock__heading">
        <span className="run-dock__glyph"><Icon name={active ? 'activity' : run.phase === 'failed' ? 'warning' : 'check'} size={17} /></span>
        <span>
          <span className="run-dock__eyebrow">{preview ? 'Preview activity' : 'Agent activity'} · {run.mode}</span>
          <strong>{displayedPhase}</strong>
        </span>
        <span className="run-dock__percent">{Math.round(run.progress)}%</span>
      </div>
      <div className="progress-track" aria-label={`${Math.round(run.progress)} percent complete`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(run.progress)}>
        <span style={{ width: `${Math.max(0, Math.min(100, run.progress))}%` }} />
      </div>
      <div className="run-dock__meta">
        <span>Target <strong>{version?.name ?? run.versionId}</strong></span>
        <span className={`live-indicator ${active ? 'live-indicator--active' : ''}`}>{active ? 'Live' : 'Latest run'}</span>
      </div>
      {run.error ? <p className="run-dock__error">{run.error}</p> : null}
      {logs.length ? (
        <ul className="run-log" aria-live={active ? 'polite' : 'off'}>
          {logs.map((entry) => (
            <li className={`run-log--${entry.tone}`} key={entry.id}>
              <time dateTime={entry.at}>{logTime(entry.at)}</time>
              <span>{entry.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
