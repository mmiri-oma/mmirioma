import { LogOut } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { Toast } from '../../../components/ui/Toast'
import { AUTH_TEXT } from '../messages'
import type { SignOutState } from '../useSignOut'

/**
 * "Sign out" button with its loading state (X5). The label changes to
 * "Signing out" and clicks are ignored while the request runs.
 */
export function SignOutButton({
  signOut,
  fullWidth = false,
}: {
  signOut: SignOutState
  fullWidth?: boolean
}) {
  return (
    <Button
      variant="secondary"
      className={fullWidth ? 'w-full' : undefined}
      loading={signOut.signingOut}
      onClick={signOut.signOut}
    >
      {signOut.signingOut ? null : <LogOut aria-hidden className="size-5" />}
      {signOut.signingOut ? 'Signing out' : 'Sign out'}
    </Button>
  )
}

/**
 * X3 banner where sign-out was attempted (Decision 7): exact server text and
 * "Reload", which fetches a new security token.
 */
export function SignOutSecurityProblem({ signOut }: { signOut: SignOutState }) {
  if (signOut.problem !== 'security') return null
  return (
    <Alert
      tone="error"
      title={AUTH_TEXT.csrfFailed}
      action={
        <Button variant="secondary" onClick={() => window.location.reload()}>
          Reload
        </Button>
      }
    />
  )
}

/**
 * Sign-out failed for lack of connection: error toast with "Try again". The
 * person stays signed in.
 */
export function SignOutFailedToast({ signOut }: { signOut: SignOutState }) {
  if (signOut.problem !== 'network') return null
  return (
    <Toast
      tone="error"
      text={AUTH_TEXT.signOutFailed}
      actionLabel="Try again"
      onAction={() => {
        signOut.clearProblem()
        signOut.signOut()
      }}
    />
  )
}

export interface AccountPanelProps {
  /** Content of the trigger button (icon and label). */
  trigger: ReactNode
  triggerShape: 'pill' | 'square'
  /** Keep the panel open while signing out or showing a problem. */
  keepOpen: boolean
  className?: string
  children: ReactNode
}

/**
 * Account button and panel (X5). A disclosure (`aria-expanded`,
 * `aria-controls`) rather than an ARIA menu, because it holds text and one
 * button, not a list of menu items. Closes on Escape or a click outside,
 * unless `keepOpen`.
 */
export function AccountPanel({
  trigger,
  triggerShape,
  keepOpen,
  className = '',
  children,
}: AccountPanelProps) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const rootRef = useRef<HTMLDivElement>(null)

  // Listen for Escape and outside clicks only while the panel is open.
  useEffect(() => {
    if (!open || keepOpen) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open, keepOpen])

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((isOpen) => !isOpen || keepOpen)}
        className={[
          'inline-flex min-h-12 items-center gap-2 border-2 border-border bg-surface font-semibold text-text-primary hover:border-border-strong',
          triggerShape === 'pill' ? 'max-w-43 rounded-full px-2.5' : 'rounded-md px-3.5',
        ].join(' ')}
      >
        {trigger}
      </button>
      {open ? (
        <div
          id={panelId}
          className="absolute top-[calc(100%+6px)] right-0 z-40 flex w-67 flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-lg"
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}
