import type { LucideIcon } from 'lucide-react'
import { cn } from '../../lib/cn'

interface StateMessageProps {
  icon: LucideIcon
  title: string
  description?: React.ReactNode
  /** `error` is announced immediately to screen readers (`role="alert"`). */
  tone?: 'neutral' | 'error'
  /** Recovery action, e.g. "Clear filters" or "Try again". */
  action?: React.ReactNode
  className?: string
}

/** Centered empty, error or not-found message with an optional recovery action. */
export function StateMessage({
  icon: Icon,
  title,
  description,
  tone = 'neutral',
  action,
  className,
}: StateMessageProps) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex flex-col items-center px-6 py-14 text-center', className)}
    >
      <span
        className={cn(
          'mb-4 grid size-12 place-items-center rounded-full',
          tone === 'error' ? 'bg-rose-50 text-rose-600' : 'bg-brand-50 text-brand-600',
        )}
      >
        <Icon aria-hidden className="size-6" />
      </span>
      <p className="text-base font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
