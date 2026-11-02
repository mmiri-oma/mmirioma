import { useId, useState, type InputHTMLAttributes, type ReactNode, type Ref, type TextareaHTMLAttributes } from 'react'
import { cx } from '../../lib/cx'
import { PHONE_COUNTRIES } from '../../lib/format/phone'
import { AlertCircleIcon, EyeIcon, EyeOffIcon } from '../icons/icons'

/** Classes of the design's `.in` input. */
export const INPUT = 'mo-in'

interface FieldShellProps {
  label: ReactNode
  /** Shows "(optional)" after the label in muted text, as the design does. */
  optional?: boolean
  /** Helper text under the control. */
  hint?: ReactNode
  /** Error text; also marks the control invalid and links it with aria-describedby. */
  error?: string
}

function FieldMessages({ id, hint, error }: { id: string; hint?: ReactNode; error?: string }) {
  return (
    <>
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1.5 mb-0 text-caption text-mute">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1.5 mb-0 flex items-center gap-1.5 text-caption font-bold text-red">
          <AlertCircleIcon size={16} />
          {error}
        </p>
      )}
    </>
  )
}

function Label({ htmlFor, label, optional }: { htmlFor: string; label: ReactNode; optional?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-label font-bold">
      {label}
      {optional && <span className="font-normal text-mute"> (optional)</span>}
    </label>
  )
}

type TextFieldProps = FieldShellProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> & {
    ref?: Ref<HTMLInputElement>
    className?: string
  }

/**
 * Labelled text input (`.lbl` + `.in`). Works with React Hook Form's
 * `register()`, which passes `ref`, `name`, `onChange` and `onBlur`.
 *
 * With `type="password"` it adds a Show/Hide button inside the field, so
 * people can check what they typed. The button only switches the input type;
 * the value, autofill and React Hook Form state are untouched.
 */
export function TextField({ label, optional, hint, error, className, id, ref, type, ...input }: TextFieldProps) {
  const autoId = useId()
  const fieldId = id ?? autoId
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined
  const isPassword = type === 'password'
  const [shown, setShown] = useState(false)
  const control = (
    <input
      ref={ref}
      id={fieldId}
      type={isPassword && shown ? 'text' : type}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      className={cx(INPUT, isPassword && 'pr-[52px]', error && 'border-[#DC2626] bg-[#FEF2F2]')}
      {...input}
    />
  )
  return (
    <div className={className}>
      <Label htmlFor={fieldId} label={label} optional={optional} />
      {isPassword ? (
        <div className="relative">
          {control}
          <button
            type="button"
            aria-label={shown ? 'Hide password' : 'Show password'}
            aria-pressed={shown}
            aria-controls={fieldId}
            onClick={() => setShown((v) => !v)}
            className="absolute top-1/2 right-1 flex size-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-[10px] border-0 bg-transparent text-mute transition-colors duration-150 hover:bg-sky hover:text-primary-dark"
          >
            {shown ? <EyeOffIcon size={20} /> : <EyeIcon size={20} />}
          </button>
        </div>
      ) : (
        control
      )}
      <FieldMessages id={fieldId} hint={hint} error={error} />
    </div>
  )
}

type PhoneFieldProps = FieldShellProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'type'> & {
    ref?: Ref<HTMLInputElement>
    className?: string
  }

/**
 * Labelled phone number input with a country picker in front of it. The
 * picker lists `PHONE_COUNTRIES` (Nigeria, +234, for now); the number field
 * takes the local number in any accepted form (`0803…`, `803…`, `+234…`), and
 * the form schema (`phoneField`) turns it into the `+234` form. Works with
 * React Hook Form's `register()` like `TextField`.
 *
 * The picker is a real `<select>` even with one country, so more countries
 * can be switched on later without changing the screens.
 */
export function PhoneField({ label, optional, hint, error, className, id, ref, placeholder = '803 123 4567', ...input }: PhoneFieldProps) {
  const autoId = useId()
  const fieldId = id ?? autoId
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined
  const [country, setCountry] = useState(PHONE_COUNTRIES[0].code)
  return (
    <div className={className}>
      <Label htmlFor={fieldId} label={label} optional={optional} />
      <div className="flex gap-2">
        <select
          aria-label="Country code"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className={cx(INPUT, 'w-[118px] shrink-0 cursor-pointer pr-2', error && 'border-[#DC2626]')}
        >
          {PHONE_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} {c.dial}
            </option>
          ))}
        </select>
        <input
          ref={ref}
          id={fieldId}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cx(INPUT, 'min-w-0 flex-1', error && 'border-[#DC2626] bg-[#FEF2F2]')}
          {...input}
        />
      </div>
      <FieldMessages id={fieldId} hint={hint} error={error} />
    </div>
  )
}

type TextAreaFieldProps = FieldShellProps &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> & {
    ref?: Ref<HTMLTextAreaElement>
    className?: string
  }

/** Labelled multi-line input with the same look as `.in`. */
export function TextAreaField({ label, optional, hint, error, className, id, ref, ...input }: TextAreaFieldProps) {
  const autoId = useId()
  const fieldId = id ?? autoId
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined
  return (
    <div className={className}>
      <Label htmlFor={fieldId} label={label} optional={optional} />
      <textarea
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(INPUT, 'h-auto min-h-[96px] resize-y py-3', error && 'border-[#DC2626] bg-[#FEF2F2]')}
        {...input}
      />
      <FieldMessages id={fieldId} hint={hint} error={error} />
    </div>
  )
}
