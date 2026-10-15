import { FlaskConical, Info } from 'lucide-react'
import { cn } from '../../lib/cn'

const TAGS = {
  /** Any screen showing example names, numbers or naira amounts. */
  sample: { label: 'Sample data', icon: Info, className: 'border border-warning-200 bg-warning-50 text-warning-800' },
  /** Staff screens showing demo records (BR-09). */
  simulated: { label: 'Simulated', icon: FlaskConical, className: 'bg-neutral-900 text-text-inverse' },
}

/**
 * "Sample data" and "Simulated" tags (design-system.md "Sample data and
 * Simulated tags"). Never removed to make a screen look cleaner.
 */
export function Tag({ kind, className }: { kind: keyof typeof TAGS; className?: string }) {
  const { label, icon: Icon, className: kindClasses } = TAGS[kind]
  return (
    <span
      className={cn(
        'inline-flex min-h-6 items-center gap-1 rounded-sm px-2 text-[0.8125rem]/4 font-bold tracking-[0.04em] whitespace-nowrap uppercase',
        kindClasses,
        className,
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      {label}
    </span>
  )
}
