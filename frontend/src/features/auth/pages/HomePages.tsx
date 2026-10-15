import { useLocation, useNavigate } from 'react-router-dom'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import type { Session } from '../../../lib/api/auth'
import { SignedInHeader } from '../components/SignedInHeader'
import { AUTH_TEXT } from '../messages'
import type { NewAccountState } from './CreateAccountPage'

/**
 * Signed-in customer home. In this release it holds only the account header
 * and the phone-confirmation notices; ordering screens arrive with S1-05.
 *
 * - One-time notice after creating an account, with "Got it" (C2 success).
 * - X6: info banner while the phone is unconfirmed (FR-003). It has no close
 *   button and goes away only when staff confirm the phone.
 */
export function CustomerHome({ session }: { session: Session }) {
  const location = useLocation()
  const navigate = useNavigate()
  const justRegistered =
    (location.state as Partial<NewAccountState> | null)?.justRegistered === true

  return (
    <div className="min-h-svh bg-surface">
      <SignedInHeader app="customer" user={session.user} />
      <main className="flex flex-col gap-4 px-4 pt-5 pb-6 tablet:mx-auto tablet:max-w-[720px]">
        {justRegistered ? (
          <Alert
            tone="info"
            action={
              // Clear the router state so the notice is not shown again.
              <Button
                variant="secondary"
                onClick={() => navigate('.', { replace: true, state: null })}
              >
                Got it
              </Button>
            }
          >
            <p>{AUTH_TEXT.welcomeNotice}</p>
          </Alert>
        ) : null}
        {session.user.phone_verified ? null : (
          <Alert tone="info">
            <p>{AUTH_TEXT.phoneNotConfirmed}</p>
          </Alert>
        )}
      </main>
    </div>
  )
}

/**
 * Signed-in staff home. In this release it holds only the staff top bar; the
 * order directory arrives with S1-09.
 */
export function StaffHome({ session }: { session: Session }) {
  return (
    <div className="min-h-svh bg-background">
      <SignedInHeader app="staff" user={session.user} />
    </div>
  )
}
