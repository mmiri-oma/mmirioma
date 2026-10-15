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

/** Centred empty, error or not-found message with an optional recovery action (design-system.md "Empty state"). */
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
      className={cn('flex flex-col items-center gap-3 px-4 py-8 text-center', className)}
    >
      <span
        className={cn(
          'grid size-14 place-items-center rounded-full',
          tone === 'error' ? 'bg-danger-50 text-danger-700' : 'bg-primary-50 text-primary-700',
        )}
      >
        <Icon aria-hidden className="size-7" />
      </span>
      <p className="max-w-[32ch] font-semibold text-text-primary">{title}</p>
      {description && <p className="max-w-sm text-small text-text-secondary">{description}</p>}
      {action && <div>{action}</div>}
    </div>
  )
}
