import type { InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Marks the field invalid for styling and `aria-invalid`. */
  invalid?: boolean
}

/** Text, date or search input with the shared field styling. Always pair with a visible `<label>`. */
export function Input({ invalid, className, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        // 16 px text so phones do not zoom in; 48 px tall (design-system.md "Form fields").
        'min-h-touch w-full rounded-md border-2 bg-surface px-3.5 py-2.5 text-body text-text-primary',
        'placeholder:text-text-secondary focus-visible:border-primary',
        'disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-muted disabled:text-text-disabled',
        invalid ? 'border-danger-600 bg-danger-50' : 'border-border-strong hover:border-neutral-800',
        className,
      )}
      {...props}
    />
  )
}
