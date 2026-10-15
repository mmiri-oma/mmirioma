import type { LucideIcon } from 'lucide-react'
import { cn } from '../../lib/cn'

/** Status badge styles from the approved design system ("Status badge"). */
export type BadgeTone = 'info' | 'warning' | 'brand' | 'success' | 'off' | 'danger' | 'review'

const toneClasses: Record<BadgeTone, string> = {
  info: 'border-info-200 bg-info-50 text-info-700',
  warning: 'border-warning-200 bg-warning-50 text-warning-800',
  brand: 'border-primary-200 bg-primary-50 text-primary-800',
  success: 'border-success-200 bg-success-50 text-success-700',
  off: 'border-neutral-300 bg-neutral-200 text-neutral-700',
  danger: 'border-danger-200 bg-danger-50 text-danger-700',
  review: 'border-dashed border-neutral-500 bg-surface text-neutral-800',
}

interface BadgeProps {
  tone?: BadgeTone
  /**
   * Icon shown before the label. Badges always carry text, so meaning never
   * depends on colour alone (NFR-021).
   */
  icon?: LucideIcon
  children: React.ReactNode
  className?: string
}

/** Pill-shaped status or attribute label. */
export function Badge({ tone = 'off', icon: Icon, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex min-h-7 items-center gap-1 rounded-full border py-0.5 pr-3 pl-2 text-small font-semibold whitespace-nowrap',
        toneClasses[tone],
        className,
      )}
    >
      {Icon && <Icon aria-hidden className="size-4 shrink-0" />}
      {children}
    </span>
  )
}
