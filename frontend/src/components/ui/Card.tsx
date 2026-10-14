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
    <section className={cn('rounded-card border border-line bg-surface shadow-card', className)}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {aside}
        </header>
      )}
      {children}
    </section>
  )
}
