import type { InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Marks the field invalid for styling and `aria-invalid`. */
  invalid?: boolean
}

/** Text, date or search input with the shared field styling. Always pair with a `<label>`. */
export function Input({ invalid, className, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        'min-h-11 w-full rounded-lg border bg-surface px-3 text-sm text-ink shadow-sm placeholder:text-ink-muted/70',
        invalid ? 'border-rose-400' : 'border-line hover:border-slate-300',
        className,
      )}
      {...props}
    />
  )
}
