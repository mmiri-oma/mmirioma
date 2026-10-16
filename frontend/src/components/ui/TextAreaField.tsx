import { CircleAlert } from 'lucide-react'
import { useId, type Ref, type TextareaHTMLAttributes } from 'react'

export interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Visible label above the control (never placeholder-only). */
  label: string
  /** Shows a muted "(optional)" after the label. */
  optional?: boolean
  /** Helper text below the control, hidden while an error shows. */
  help?: string
  /** Inline error text; also sets `aria-invalid`. */
  error?: string
  /** Shown under the control on the right, e.g. a character count. */
  counter?: string
  /** Locked while a form is being sent: read-only, muted, value still visible. */
  locked?: boolean
  ref?: Ref<HTMLTextAreaElement>
}

/**
 * Design-system multi-line text field. Same label, border, helper, error and
 * locked states as {@link Field}; the control is at least three lines tall
 * and can be resized vertically.
 */
export function TextAreaField({
  label,
  optional = false,
  help,
  error,
  counter,
  locked = false,
  id,
  className = '',
  rows = 3,
  ...textAreaProps
}: TextAreaFieldProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const describedById = `${inputId}-description`
  const description = error ?? help

  const stateClasses = error
    ? 'border-danger-600 bg-danger-50'
    : locked
      ? 'border-border bg-surface-muted cursor-progress'
      : 'border-border-strong bg-surface hover:border-neutral-800'

  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <label htmlFor={inputId} className="font-semibold">
        {label}
        {optional ? <span className="font-normal text-text-secondary"> (optional)</span> : null}
      </label>
      <textarea
        {...textAreaProps}
        id={inputId}
        rows={rows}
        readOnly={locked || textAreaProps.readOnly}
        aria-invalid={error ? true : undefined}
        aria-describedby={description ? describedById : undefined}
        className={[
          'min-h-24 w-full resize-y rounded-md border-2 px-3.5 py-2.5 text-base leading-6 text-text-primary',
          'focus-visible:border-primary focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
          stateClasses,
        ].join(' ')}
      />
      {error || help || counter ? (
        <div className="flex items-start justify-between gap-3">
          {error ? (
            <p
              id={describedById}
              className="flex items-start gap-1.5 text-sm leading-5 font-semibold text-danger-700"
            >
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          ) : help ? (
            <p id={describedById} className="text-sm leading-5 text-text-secondary">
              {help}
            </p>
          ) : (
            <span />
          )}
          {counter ? (
            <p className="shrink-0 text-sm leading-5 text-text-secondary">{counter}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
