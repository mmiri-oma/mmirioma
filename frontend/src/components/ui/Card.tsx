import { cn } from '../../lib/cn'

interface CardProps {
  /** Optional heading rendered as an `h2` in the card header. */
  title?: string
  /** Icon or small control shown at the right of the header. */
  aside?: React.ReactNode
  children: React.ReactNode
  className?: string
}

/** White surface that groups related content. */
export function Card({ title, aside, children, className }: CardProps) {
  return (
    <section className={cn('rounded-lg border border-border bg-surface shadow-xs', className)}>
      {title && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3">
          <h2 className="text-h3 font-bold text-text-primary">{title}</h2>
          {aside}
        </header>
      )}
      {children}
    </section>
  )
}
