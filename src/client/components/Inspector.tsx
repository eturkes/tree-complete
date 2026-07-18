import { useEffect, useRef } from 'react'
import type {
  DecisionAlternative,
  DesignDecision,
  ProgramVersion,
  RunnerDescriptor,
} from '../../shared/model'
import { Icon } from './Icon'

interface InspectorProps {
  version: ProgramVersion | null
  decision: DesignDecision | null
  selectedAlternativeId: string | null
  runner: RunnerDescriptor
  generating: boolean
  matchingForkActive: boolean
  onAlternativeChange: (alternativeId: string) => void
  onClose: () => void
  onGenerate: () => void
}

const signalLabel: Record<DecisionAlternative['signal'], string> = {
  recommended: 'Recommended',
  balanced: 'Balanced',
  experimental: 'Experimental',
}

export function Inspector({
  version,
  decision,
  selectedAlternativeId,
  runner,
  generating,
  matchingForkActive,
  onAlternativeChange,
  onClose,
  onGenerate,
}: InspectorProps) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (decision) heading.current?.focus({ preventScroll: true })
  }, [decision?.id, version?.id])

  if (!version || !decision) {
    const preview = runner.mode === 'preview'
    return (
      <aside className="inspector inspector--welcome" aria-label="Design decision inspector">
        <div className="inspector-welcome__graphic" aria-hidden="true">
          <div className="orbit orbit--one" />
          <div className="orbit orbit--two" />
          <span><Icon name="branch" size={26} /></span>
        </div>
        <p className="section-kicker">Decision lab</p>
        <h2>{preview ? 'Explore every branch before writing a line.' : 'Every choice is a branch waiting to happen.'}</h2>
        <p className="inspector-welcome__body">
          {preview
            ? 'Select a design decision, compare its trade-offs, and simulate how another path would grow.'
            : 'Select a design decision in the tree. Compare its trade-offs, choose a different path, and hand the change to a coding agent.'}
        </p>
        <ol className="how-it-works">
          <li><span>1</span>Pick a decision</li>
          <li><span>2</span>Choose an alternative</li>
          <li><span>3</span>{preview ? 'Preview the resulting fork' : 'Grow a working fork'}</li>
        </ol>
      </aside>
    )
  }

  const chosenId = decision.chosenAlternativeId
  const alternative = decision.alternatives.find((item) => item.id === selectedAlternativeId)
  const versionForkable = version.status === 'ready' || version.status === 'complete'
  const sameChoice = selectedAlternativeId === chosenId
  const disabled =
    generating ||
    matchingForkActive ||
    !runner.available ||
    !alternative ||
    sameChoice ||
    !versionForkable

  let ctaLabel = runner.mode === 'preview' ? 'Preview this fork' : 'Generate this fork'
  if (generating) ctaLabel = runner.mode === 'preview' ? 'Starting preview…' : 'Starting agent…'
  else if (matchingForkActive) ctaLabel = 'This fork is already running'
  else if (!runner.available) ctaLabel = 'Runner unavailable'
  else if (!versionForkable) ctaLabel = version.status === 'failed' ? 'Failed version cannot fork' : 'Version still generating'
  else if (sameChoice) ctaLabel = 'Choose a different path'

  let ctaDetail = 'Select an available alternative'
  if (!disabled) {
    ctaDetail = runner.mode === 'preview' ? `Simulate with ${runner.label}` : `with ${runner.label}`
  } else if (matchingForkActive) {
    ctaDetail = 'Follow its progress in the activity panel'
  }

  return (
    <aside className="inspector inspector--decision" aria-labelledby="inspector-title">
      <div className="inspector__topbar">
        <span className="inspector__source">
          <Icon name="branch" size={14} />
          From {version.name}
        </span>
        <button className="icon-button" onClick={onClose} type="button" aria-label="Close inspector">
          <Icon name="close" size={18} />
        </button>
      </div>

      <div className="inspector__intro">
        <p className="section-kicker">Design decision</p>
        <h2 id="inspector-title" ref={heading} tabIndex={-1}>{decision.title}</h2>
        <p className="inspector__question">{decision.question}</p>
        <div className="rationale">
          <span>Why it matters</span>
          <p>{decision.rationale}</p>
        </div>
      </div>

      <fieldset className="alternatives">
        <legend>Choose a path</legend>
        {decision.alternatives.map((item) => {
          const selected = item.id === selectedAlternativeId
          const current = item.id === chosenId
          return (
            <label
              className={`alternative ${selected ? 'alternative--selected' : ''}`}
              key={item.id}
            >
              <input
                checked={selected}
                name={`${version.id}-${decision.id}`}
                onChange={() => onAlternativeChange(item.id)}
                type="radio"
                value={item.id}
              />
              <span className="alternative__radio" aria-hidden="true"><span /></span>
              <span className="alternative__content">
                <span className="alternative__heading">
                  <strong>{item.label}</strong>
                  <span className={`signal signal--${item.signal}`}>{signalLabel[item.signal]}</span>
                  {current ? <span className="current-badge">Current</span> : null}
                </span>
                <span className="alternative__description">{item.description}</span>
                <span className="alternative__impact">
                  <span>Impact</span>{item.impact}
                </span>
              </span>
            </label>
          )
        })}
      </fieldset>

      <div className="inspector__action">
        {alternative && !sameChoice ? (
          <div className="agent-brief">
            <span><Icon name="spark" size={14} /> {runner.mode === 'preview' ? 'Preview brief' : 'Agent brief'}</span>
            <p>{alternative.agentBrief}</p>
          </div>
        ) : null}
        <button
          className="generate-button"
          disabled={disabled}
          onClick={onGenerate}
          type="button"
        >
          <span className="generate-button__icon">
            {generating ? <span className="spinner" /> : <Icon name="branch" size={18} />}
          </span>
          <span>
            <strong>{ctaLabel}</strong>
            {ctaDetail}
          </span>
          {!disabled ? <Icon name="arrow" size={19} /> : null}
        </button>
      </div>
    </aside>
  )
}
