import { Icon } from './Icon'

export interface PanelFeedbackValue {
  tone: 'error' | 'success'
  title: string
  detail: string
}

export function PanelFeedback({
  value,
  onDismiss,
  className = '',
}: {
  value: PanelFeedbackValue | null
  onDismiss: () => void
  className?: string
}) {
  if (!value) return null
  return (
    <div
      className={`panel-feedback panel-feedback--${value.tone} ${className}`}
      role={value.tone === 'error' ? 'alert' : 'status'}
    >
      <span aria-hidden="true">
        <Icon name={value.tone === 'error' ? 'warning' : 'check'} size={17} />
      </span>
      <div>
        <strong>{value.title}</strong>
        <p>{value.detail}</p>
      </div>
      <button aria-label="Dismiss notification" onClick={onDismiss} type="button">
        <Icon name="close" size={16} />
      </button>
    </div>
  )
}
