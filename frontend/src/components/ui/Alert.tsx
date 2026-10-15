import { CircleCheck, CircleX, Info, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

export type AlertTone = 'info' | 'success' | 'warning' | 'error'

const TONES: Record<
  AlertTone,
  { box: string; accent: string; Icon: typeof Info; role: 'status' | 'alert' }
> = {
  info: {
    box: 'border-info-200 bg-info-50',
    accent: 'text-info-700',
    Icon: Info,
    role: 'status',
  },
  success: {
    box: 'border-success-200 bg-success-50',
    accent: 'text-success-700',
    Icon: CircleCheck,
    role: 'status',
  },
  warning: {
    box: 'border-warning-200 bg-warning-50',
    accent: 'text-warning-800',
    Icon: TriangleAlert,
    role: 'status',
  },
  error: {
    box: 'border-danger-200 bg-danger-50',
    accent: 'text-danger-700',
    Icon: CircleX,
    role: 'alert',
  },
}

export interface AlertProps {
  tone: AlertTone
  /** Bold first line, coloured with the tone. */
  title?: ReactNode
  /** Further lines. */
  children?: ReactNode
  /** Optional action button, shown below the text. */
  action?: ReactNode
  className?: string
}

/**
 * Design-system alert/banner. Always an icon plus words, never colour alone.
 * Errors use `role="alert"` so screen readers announce them at once; the
 * others use `role="status"`.
 */
export function Alert({ tone, title, children, action, className = '' }: AlertProps) {
  const { box, accent, Icon, role } = TONES[tone]
  return (
    <div
      role={role}
      className={`flex gap-3 rounded-box border px-4 py-3.5 ${box} ${className}`}
    >
      <Icon aria-hidden="true" className={`mt-0.5 size-5 shrink-0 ${accent}`} />
      <div className="flex min-w-0 flex-col gap-1">
        {title ? <p className={`font-bold ${accent}`}>{title}</p> : null}
        {children}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  )
}
