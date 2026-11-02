import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'

interface ConfirmDialogProps {
  /** Shows the dialog. Render it with `open={false}` (or not at all) to hide it. */
  open: boolean
  /** Short question, e.g. "Log out of Waterline?". */
  title: string
  /** One or two lines on what happens next. */
  children?: ReactNode
  /** Verb for the action, e.g. "Log out". Never "OK" or "Yes". */
  confirmLabel: string
  /** Label of the button that closes without acting. */
  cancelLabel?: string
  /** `danger` (red) for actions that remove or end something; `primary` otherwise. */
  tone?: 'danger' | 'primary'
  /** The action is running: the confirm button shows a spinner and the dialog cannot be dismissed. */
  loading?: boolean
  /** The action cannot be confirmed yet (a value it states is still loading): the confirm button is off. */
  confirmDisabled?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Modal that asks before an action that cannot be undone or is easy to hit
 * by mistake (log out, cancel an order, mark a payment as received).
 *
 * Behaviour:
 * - Rendered in a portal on `<body>`, so a screen's `transform` animations
 *   (rise-1 to rise-5) cannot trap the fixed overlay.
 * - Focus moves to the cancel button (the safe choice), Tab stays inside the
 *   dialog, and focus returns to the button that opened it on close.
 * - Escape and a tap on the backdrop cancel, except while `loading`.
 * - The page behind does not scroll while it is open.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  loading = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  // Read inside the effects without re-running them when the parent re-renders.
  const latest = useRef({ loading, onCancel })
  useEffect(() => {
    latest.current = { loading, onCancel }
  })

  // While open: focus the safe button, lock page scroll, put focus back on close.
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    cancelButton.current?.focus()
    return () => {
      document.body.style.overflow = overflow
      opener?.focus()
    }
  }, [open])

  // Escape cancels; Tab and Shift+Tab cycle through the dialog's buttons only.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // Escape belongs to the dialog: stop it reaching window listeners
        // underneath, such as the drawer menu's Escape-to-close.
        e.preventDefault()
        e.stopPropagation()
        if (!latest.current.loading) latest.current.onCancel()
        return
      }
      if (e.key !== 'Tab' || !panel.current) return
      const items = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, textarea, select')]
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-4 sm:items-center">
      <div aria-hidden="true" className="absolute inset-0 bg-[rgba(10,37,64,.55)]" onClick={() => !loading && onCancel()} />
      <div
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={children ? `${id}-body` : undefined}
        className="rise-1 relative flex w-full max-w-[420px] flex-col gap-3 rounded-[22px] bg-white p-5 pb-[max(20px,env(safe-area-inset-bottom))] text-ink shadow-[0_24px_60px_rgba(10,37,64,0.3)] sm:p-6"
      >
        <h2 id={`${id}-title`} className="m-0 text-[19px] leading-[1.3] font-extrabold">
          {title}
        </h2>
        {children && (
          <div id={`${id}-body`} className="text-[15px] leading-[1.5] text-slate">
            {children}
          </div>
        )}
        <div className="mt-2 grid grid-cols-2 gap-2.5">
          <Button ref={cancelButton} variant="line" disabled={loading} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={loading} disabled={confirmDisabled} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
