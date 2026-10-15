import { cn } from '../../lib/cn'

/** Variants from the approved design system; `icon` is the 48 × 48 icon-only button. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'icon'
/** Both sizes keep the 48 px touch target; `sm` only narrows the padding. */
export type ButtonSize = 'sm' | 'md'

/** Shared button classes, also used to style router `<Link>`s as buttons. */
export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md') {
  return cn(
    // 48 px minimum touch target on every button (design-system.md, NFR-020).
    'inline-flex min-h-touch min-w-touch items-center justify-center gap-2 rounded-md border-2',
    'text-body font-semibold whitespace-nowrap transition-colors active:translate-y-px',
    'disabled:translate-y-0 disabled:cursor-not-allowed',
    variant !== 'icon' && (size === 'md' ? 'px-5' : 'px-3'),
    variant === 'primary' &&
      'border-primary bg-primary text-text-inverse hover:border-primary-hover hover:bg-primary-hover active:border-primary-pressed active:bg-primary-pressed',
    variant === 'secondary' &&
      'border-primary bg-surface text-primary-700 hover:border-primary-hover hover:bg-primary-50 hover:text-primary-800 active:border-primary-pressed active:bg-primary-100 active:text-primary-900',
    variant === 'ghost' &&
      'border-transparent bg-transparent text-primary-700 hover:bg-primary-50 hover:text-primary-800 active:bg-primary-100 active:text-primary-900',
    variant === 'destructive' &&
      'border-danger-600 bg-danger-600 text-text-inverse hover:border-danger-700 hover:bg-danger-700 active:border-danger-800 active:bg-danger-800',
    variant === 'icon' &&
      'border-transparent bg-transparent text-text-primary hover:bg-neutral-100 active:bg-neutral-200',
    variant === 'ghost' || variant === 'icon'
      ? 'disabled:bg-transparent disabled:text-text-disabled'
      : 'disabled:border-border disabled:bg-surface-muted disabled:text-text-disabled',
  )
}
