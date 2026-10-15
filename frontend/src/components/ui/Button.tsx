import { LoaderCircle } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'
import { buttonClasses, type ButtonSize, type ButtonVariant } from './buttonVariants'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual weight. `primary` is for the one main action on a screen. */
  variant?: ButtonVariant
  size?: ButtonSize
  /** Adds a spinner before the label and blocks clicks; the label stays so the width does not change. */
  loading?: boolean
}

/** Standard button. Defaults to `type="button"` so it never submits a form by accident. */
export function Button({ variant, size, loading, className, type = 'button', disabled, onClick, children, ...props }: ButtonProps) {
  return (
    <button
      type={type}
      aria-busy={loading || undefined}
      disabled={disabled}
      onClick={loading ? undefined : onClick}
      className={cn(buttonClasses(variant, size), loading && 'cursor-progress', className)}
      {...props}
    >
      {loading && <LoaderCircle aria-hidden className="size-5 shrink-0 motion-safe:animate-spin" />}
      {children}
    </button>
  )
}
