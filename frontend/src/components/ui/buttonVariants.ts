import { cn } from '../../lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost'
export type ButtonSize = 'sm' | 'md'

/** Shared button classes, also used to style router `<Link>`s as buttons. */
export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md') {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap',
    'transition-colors disabled:pointer-events-none disabled:opacity-50',
    // 44px minimum touch target on the default size (PRD §9).
    size === 'md' ? 'min-h-11 px-4 text-sm' : 'min-h-9 px-3 text-sm',
    variant === 'primary' && 'bg-brand-600 text-white shadow-sm hover:bg-brand-700',
    variant === 'secondary' && 'border border-line bg-surface text-ink shadow-sm hover:bg-canvas',
    variant === 'ghost' && 'text-ink-muted hover:bg-brand-50 hover:text-ink',
  )
}
