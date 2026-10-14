import { cn } from '../../lib/cn'

/** Placeholder block shown while content loads. Hidden from screen readers; pair it with a `role="status"` label. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-slate-200/70', className)} />
}
