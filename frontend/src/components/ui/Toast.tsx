import { CircleAlert, CircleCheck } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from './Button'

/** How long a toast without an action stays (design system, "Toast"). */
export const TOAST_DURATION_MS = 6000

export interface ToastProps {
  tone: 'success' | 'error'
  text: string
  /** Label of the optional action button. A toast with an action stays. */
  actionLabel?: string
  onAction?: () => void
  /** Called when a toast without an action times out. */
  onDismiss?: () => void
}

/**
 * Dark toast pinned to the bottom of the screen. Success uses
 * `role="status"`, errors `role="alert"`.
 */
export function Toast({ tone, text, actionLabel, onAction, onDismiss }: ToastProps) {
  const autoDismiss = actionLabel === undefined && onDismiss !== undefined

  // Timer for toasts without an action; cleared if the toast unmounts or the
  // message changes first.
  useEffect(() => {
    if (!autoDismiss) return undefined
    const timer = window.setTimeout(() => onDismiss?.(), TOAST_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [autoDismiss, onDismiss, text])

  const Icon = tone === 'success' ? CircleCheck : CircleAlert
  return (
    <div
      role={tone === 'success' ? 'status' : 'alert'}
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex min-h-14 max-w-[440px] items-center gap-3 rounded-box bg-neutral-900 py-2 pr-2 pl-4 text-text-inverse shadow-lg"
    >
      <Icon
        aria-hidden="true"
        className={`size-5 shrink-0 ${tone === 'success' ? 'text-success-200' : 'text-danger-200'}`}
      />
      <span className="min-w-0 flex-1">{text}</span>
      {actionLabel ? (
        <Button
          variant="ghost"
          onClick={onAction}
          className="text-text-inverse hover:bg-neutral-700 hover:text-text-inverse"
        >
          {actionLabel}
        </Button>
      ) : null}
    </div>
  )
}
