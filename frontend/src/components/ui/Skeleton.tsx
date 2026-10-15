import { cn } from '../../lib/cn'

/** Placeholder block shown while content loads. Hidden from screen readers; pair it with a `role="status"` label. */
export function Skeleton({ className }: { className?: string }) {
  // The shimmer stops under prefers-reduced-motion (design-system.md "Loading").
  return <div aria-hidden className={cn('rounded-sm bg-neutral-200 motion-safe:animate-pulse', className)} />
}
