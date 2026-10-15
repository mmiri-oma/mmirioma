import { LoaderCircle } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

/** Button variants from the design system ("Buttons"). */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'sun'

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'border-primary bg-primary text-text-inverse hover:border-primary-hover hover:bg-primary-hover active:translate-y-px active:border-primary-pressed active:bg-primary-pressed',
  secondary:
    'border-primary bg-surface text-primary-700 hover:border-primary-hover hover:bg-primary-50 hover:text-primary-800 active:translate-y-px active:border-primary-pressed active:bg-primary-100 active:text-primary-900',
  ghost:
    'border-transparent bg-transparent text-primary-700 hover:bg-primary-50 hover:text-primary-800 active:translate-y-px active:bg-primary-100 active:text-primary-900',
  danger:
    'border-danger-600 bg-danger-600 text-text-inverse hover:border-danger-700 hover:bg-danger-700 active:translate-y-px active:border-danger-800 active:bg-danger-800',
  // Driver app sunlight variant: primary-800 fill, 10.84:1 with white text.
  sun: 'border-primary-pressed bg-primary-pressed text-text-inverse hover:border-primary-900 hover:bg-primary-900 active:translate-y-px',
}

const DISABLED_CLASSES =
  'disabled:translate-y-0 disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-muted disabled:text-text-disabled'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual variant; defaults to `primary`. */
  variant?: ButtonVariant
  /** `lg` is the 56 px driver-app size (`--spacing-touch-lg`). */
  size?: 'md' | 'lg'
  /** Full width, used for primary actions on mobile. */
  block?: boolean
  /**
   * Shows a spinner before the label and ignores clicks. The label stays, so
   * the button keeps its width (design system, "Loading").
   */
  loading?: boolean
  /** Optional leading icon (decorative). */
  icon?: ReactNode
}

/**
 * Design-system button: at least 48 × 48 px, visible focus ring, and
 * `aria-busy` while loading.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  loading = false,
  icon,
  className = '',
  type = 'button',
  onClick,
  children,
  ...rest
}: ButtonProps) {
  const sizeClasses =
    size === 'lg'
      ? 'min-h-14 px-6 text-lg leading-7'
      : 'min-h-12 px-5 text-base leading-6'
  return (
    <button
      type={type}
      aria-busy={loading || undefined}
      onClick={loading ? undefined : onClick}
      className={[
        'inline-flex min-w-12 items-center justify-center gap-2 rounded-md border-2 font-semibold',
        sizeClasses,
        VARIANT_CLASSES[variant],
        DISABLED_CLASSES,
        loading ? 'cursor-progress' : 'cursor-pointer',
        block ? 'w-full' : '',
        className,
      ].join(' ')}
      {...rest}
    >
      {loading ? (
        <LoaderCircle aria-hidden="true" className="size-5 shrink-0 animate-spin" />
      ) : (
        icon
      )}
      {children}
    </button>
  )
}
