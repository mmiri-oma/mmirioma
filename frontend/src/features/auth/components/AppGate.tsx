import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import type { Session } from '../../../lib/api/auth'
import { SIGN_IN_PATH, decideAccess, type AppArea } from '../access'
import type { SignInLocationState } from '../pages/SignInPage'
import { useSession } from '../sessionContext'
import { useSignOut } from '../useSignOut'
import { SessionSplash, SessionUnavailable, WrongAppScreen } from './StatusScreens'

export interface AppGateProps {
  app: AppArea
  /** Rendered for the app's own role. */
  children: (session: Session) => ReactNode
  /**
   * Rendered for a visitor who is simply signed out. Defaults to sending them
   * to the app's sign-in screen; the customer home shows the welcome screen
   * (C1) instead.
   */
  signedOut?: ReactNode
}

/**
 * Route guard for one app (FR-001 in the UI; the server enforces it too).
 *
 * Checking → splash (X1). No connection → retry. Signed out → sign-in (with
 * "Your session has ended" if it ended while open, X2, and the page to
 * return to). Wrong role → X4. Otherwise the page.
 */
export function AppGate({ app, children, signedOut }: AppGateProps) {
  const { status, session, retry } = useSession()
  const location = useLocation()
  const decision = decideAccess(status, app)

  switch (decision.kind) {
    case 'checking':
      return <SessionSplash />
    case 'unavailable':
      return <SessionUnavailable onRetry={retry} />
    case 'sign-in': {
      if (!decision.sessionEnded && signedOut !== undefined) return <>{signedOut}</>
      const state: SignInLocationState = {
        from: `${location.pathname}${location.search}`,
      }
      return <Navigate to={SIGN_IN_PATH[app]} replace state={state} />
    }
    case 'wrong-app':
      return <WrongAppGate app={app} />
    case 'allowed':
      return session ? <>{children(session)}</> : <SessionSplash />
  }
}

function WrongAppGate({ app }: { app: AppArea }) {
  const { signOut, signingOut } = useSignOut(app)
  return <WrongAppScreen app={app} onSignOut={signOut} signingOut={signingOut} />
}
