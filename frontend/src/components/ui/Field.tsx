import { CircleAlert, Eye, EyeOff } from 'lucide-react'
import {
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react'

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Visible label above the control (never placeholder-only). */
  label: string
  /** Shows a muted "(optional)" after the label. */
  optional?: boolean
  /** Helper text below the control, hidden while an error shows. */
  help?: string
  /** Inline error text; also sets `aria-invalid`. */
  error?: string
  /** Optional leading icon inside the control (decorative). */
  leading?: ReactNode
  /** Optional trailing element inside the control, e.g. a Show button. */
  trailing?: ReactNode
  /**
   * Locked while a form is being sent: read-only, muted, value still visible
   * (design system, "Locked field state"). Read-only rather than disabled so
   * the value is still submitted and readable.
   */
  locked?: boolean
  /** Driver-app size: 56 px control, 18 px text (sunlight variant). */
  large?: boolean
  ref?: Ref<HTMLInputElement>
}

/**
 * Design-system text field: label, control, then helper or error text linked
 * with `aria-describedby`. Errors have an icon, words and a red border.
 */
export function Field({
  label,
  optional = false,
  help,
  error,
  leading,
  trailing,
  locked = false,
  large = false,
  id,
  className = '',
  ...inputProps
}: FieldProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const describedById = `${inputId}-description`
  const description = error ?? help

  const stateClasses = error
    ? 'border-danger-600 bg-danger-50'
    : locked
      ? 'border-border bg-surface-muted cursor-progress'
      : `${large ? 'border-neutral-800' : 'border-border-strong'} bg-surface hover:border-neutral-800`

  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <label
        htmlFor={inputId}
        className={`font-semibold ${large ? 'text-lg leading-7' : ''}`}
      >
        {label}
        {optional ? <span className="font-normal text-text-secondary"> (optional)</span> : null}
      </label>
      <div
        className={[
          'flex items-stretch overflow-hidden rounded-md border-2',
          'focus-within:border-primary focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-focus-ring',
          large ? 'min-h-14' : 'min-h-12',
          stateClasses,
        ].join(' ')}
      >
        {leading ? (
          <span className="flex items-center pl-3.5 text-text-secondary">{leading}</span>
        ) : null}
        <input
          {...inputProps}
          id={inputId}
          readOnly={locked || inputProps.readOnly}
          aria-invalid={error ? true : undefined}
          aria-describedby={description ? describedById : undefined}
          className={[
            'min-w-0 flex-1 bg-transparent px-3.5 text-text-primary outline-none',
            leading ? 'pl-2.5' : '',
            large ? 'text-lg leading-7' : 'text-base leading-6',
            locked ? 'cursor-progress' : '',
          ].join(' ')}
        />
        {trailing}
      </div>
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
      ) : null}
    </div>
  )
}

export type PasswordFieldProps = Omit<FieldProps, 'type' | 'trailing'>

/**
 * Password field with a Show/Hide button inside it (design system, "Password
 * field"). The button has words and an icon, is at least 48 px, and reports
 * its state with `aria-pressed`.
 */
export function PasswordField({ locked = false, error, ...props }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false)
  const Icon = visible ? EyeOff : Eye
  return (
    <Field
      {...props}
      error={error}
      locked={locked}
      type={visible ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          aria-pressed={visible}
          aria-label={visible ? 'Hide password' : 'Show password'}
          disabled={locked}
          onClick={() => setVisible((shown) => !shown)}
          className={[
            'inline-flex min-w-21 items-center justify-center gap-1.5 border-l-2 bg-surface-muted px-3 text-sm leading-5 font-semibold text-primary-700',
            'hover:bg-primary-50 disabled:cursor-progress disabled:text-text-disabled',
            error ? 'border-danger-600' : 'border-border-strong',
          ].join(' ')}
        >
          <Icon aria-hidden="true" className="size-5" />
          {visible ? 'Hide' : 'Show'}
        </button>
      }
    />
  )
}
