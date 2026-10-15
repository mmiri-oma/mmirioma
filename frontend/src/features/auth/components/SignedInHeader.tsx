import { ChevronDown, LogOut, Menu, User } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { Logo } from '../../../components/ui/Logo'
import { Toast } from '../../../components/ui/Toast'
import type { User as SessionUser } from '../../../lib/api/auth'
import type { AppArea } from '../access'
import { AUTH_TEXT } from '../messages'
import { formatPhoneForDisplay } from '../phone'
import { useSignOut, type SignOutProblem } from '../useSignOut'

export interface SignedInHeaderProps {
  app: AppArea
  user: SessionUser
}

/**
 * X5 Signed-in header and sign out.
 *
 * - Customer: logo and an account button with the name; its panel shows the
 *   name and phone and "Sign out".
 * - Staff, 768 px and wider: logo, "Staff" label, name and "Sign out" in the
 *   top bar. Narrower: a "Menu" button with the same panel (Decision 5).
 *
 * Sign-out failures: no connection shows the error toast with "Try again"
 * and keeps the panel open; a failed security check shows the X3 banner with
 * "Reload" where the action was taken (Decision 7).
 */
export function SignedInHeader({ app, user }: SignedInHeaderProps) {
  const { signOut, signingOut, problem, clearProblem } = useSignOut(app)

  const signOutButton = (block: boolean) => (
    <Button
      variant="secondary"
      block={block}
      loading={signingOut}
      onClick={signOut}
      icon={<LogOut aria-hidden="true" className="size-5" />}
    >
      {signingOut ? 'Signing out' : 'Sign out'}
    </Button>
  )

  return (
    <>
      <header className="flex min-h-16 items-center justify-between gap-2 border-b border-border bg-surface py-2 pr-3 pl-4 tablet:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Logo className="w-31 tablet:w-37.5" />
          {app === 'staff' ? <StaffLabel /> : null}
        </div>

        {app === 'staff' ? (
          <div className="hidden items-center gap-3 tablet:flex">
            <span className="inline-flex items-center gap-2 font-semibold">
              <User aria-hidden="true" className="size-5" />
              {user.name}
            </span>
            {signOutButton(false)}
          </div>
        ) : null}

        <AccountPanel
          className={app === 'staff' ? 'tablet:hidden' : ''}
          trigger={
            app === 'customer' ? (
              <>
                <User aria-hidden="true" className="size-5 shrink-0" />
                <span className="max-w-32 truncate">{user.name}</span>
                <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
              </>
            ) : (
              <>
                <Menu aria-hidden="true" className="size-5" />
                Menu
              </>
            )
          }
          triggerShape={app === 'customer' ? 'pill' : 'square'}
          keepOpen={signingOut || problem !== null}
        >
          <div>
            <p className="text-lg leading-[26px] font-bold">{user.name}</p>
            {app === 'customer' ? (
              <p className="text-sm leading-5 text-text-secondary">
                {formatPhoneForDisplay(user.phone)}
              </p>
            ) : null}
          </div>
          <div className="h-px bg-border" />
          <SecurityProblem problem={problem} />
          {signOutButton(true)}
        </AccountPanel>
      </header>

      {app === 'staff' ? (
        <div className="hidden px-6 pt-4 tablet:block">
          <SecurityProblem problem={problem} />
        </div>
      ) : null}

      {problem === 'network' ? (
        <Toast
          tone="error"
          text={AUTH_TEXT.signOutFailed}
          actionLabel="Try again"
          onAction={() => {
            clearProblem()
            signOut()
          }}
        />
      ) : null}
    </>
  )
}

function StaffLabel() {
  return (
    <span className="inline-flex min-h-6 items-center rounded-sm border border-border bg-surface-muted px-2 text-[13px] leading-4 font-bold text-neutral-800">
      Staff
    </span>
  )
}

/** X3 banner: exact server text and "Reload" (fetches a new security token). */
function SecurityProblem({ problem }: { problem: SignOutProblem }) {
  if (problem !== 'security') return null
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

interface AccountPanelProps {
  trigger: ReactNode
  triggerShape: 'pill' | 'square'
  /** Keep the panel open while signing out or showing a problem. */
  keepOpen: boolean
  className?: string
  children: ReactNode
}

/**
 * Disclosure button and panel. Uses `aria-expanded`/`aria-controls` (a
 * disclosure, not an ARIA menu, because it holds text and one button rather
 * than a list of menu items). Closes on Escape or a click outside, unless
 * `keepOpen`.
 */
function AccountPanel({
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
