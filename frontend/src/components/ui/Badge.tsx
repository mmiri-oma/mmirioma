import type { LucideIcon } from 'lucide-react'
import { cn } from '../../lib/cn'

export type BadgeTone = 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger' | 'violet'

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  brand: 'bg-brand-50 text-brand-800 ring-brand-600/20',
  info: 'bg-sky-50 text-sky-800 ring-sky-600/20',
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  warning: 'bg-amber-50 text-amber-900 ring-amber-600/25',
  danger: 'bg-rose-50 text-rose-800 ring-rose-600/20',
  violet: 'bg-violet-50 text-violet-800 ring-violet-600/20',
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

/** Compact status or attribute label. */
export function Badge({ tone = 'neutral', icon: Icon, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        toneClasses[tone],
        className,
      )}
    >
      {Icon && <Icon aria-hidden className="size-3.5 shrink-0" />}
      {children}
    </span>
  )
}
