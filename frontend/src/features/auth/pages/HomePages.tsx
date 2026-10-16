import { useLocation, useNavigate } from 'react-router-dom'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import type { User } from '../../../lib/api/auth'
import { AUTH_TEXT } from '../messages'
import type { NewAccountState } from './CreateAccountPage'

/**
 * Account notices at the top of the customer home (My orders, O1):
 *
 * - One-time notice after creating an account, with "Got it" (C2 success).
 * - X6: info banner while the phone is unconfirmed (FR-003). It has no close
 *   button and goes away only when staff confirm the phone.
 */
export function CustomerAccountNotices({ user }: { user: User }) {
  const location = useLocation()
  const navigate = useNavigate()
  const justRegistered =
    (location.state as Partial<NewAccountState> | null)?.justRegistered === true

  return (
    <>
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
      {user.phone_verified ? null : (
        <Alert tone="info">
          <p>{AUTH_TEXT.phoneNotConfirmed}</p>
        </Alert>
      )}
    </>
  )
}
