import { ChevronDown, User } from 'lucide-react'
import type { ReactNode } from 'react'
import { Logo } from '../../../components/ui/Logo'
import type { User as SessionUser } from '../../../lib/api/auth'
import { formatPhoneForDisplay } from '../phone'
import { useSignOut } from '../useSignOut'
import {
  AccountPanel,
  SignOutButton,
  SignOutFailedToast,
  SignOutSecurityProblem,
} from './AccountControls'

/**
 * Customer app header (X5): the logo and an account button with the
 * person's name. Its panel shows the name, the phone (as `0800 000 0001`) and
 * "Sign out". The panel stays open while signing out or showing a problem.
 *
 * @param nav - Optional links shown after the logo from tablet width up (the
 *   customer ordering design's desktop top bar: "My orders", "Request water").
 */
export function CustomerHeader({ user, nav }: { user: SessionUser; nav?: ReactNode }) {
  const signOut = useSignOut()
  return (
    <>
      <header className="flex min-h-16 items-center justify-between gap-2 border-b border-border bg-surface py-2 pr-3 pl-4 tablet:px-6">
        <div className="flex items-center gap-8">
          <Logo className="w-31" />
          {nav ? <div className="hidden tablet:block">{nav}</div> : null}
        </div>
        <AccountPanel
          triggerShape="pill"
          keepOpen={signOut.signingOut || signOut.problem !== null}
          trigger={
            <>
              <User aria-hidden className="size-5 shrink-0" />
              <span className="max-w-32 truncate">{user.name}</span>
              <ChevronDown aria-hidden className="size-4 shrink-0" />
            </>
          }
        >
          <div>
            <p className="text-lg leading-[26px] font-bold">{user.name}</p>
            <p className="text-sm leading-5 text-text-secondary">
              {formatPhoneForDisplay(user.phone)}
            </p>
          </div>
          <div className="h-px bg-border" />
          <SignOutSecurityProblem signOut={signOut} />
          <SignOutButton signOut={signOut} fullWidth />
        </AccountPanel>
      </header>
      <SignOutFailedToast signOut={signOut} />
    </>
  )
}
