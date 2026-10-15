import { LoaderCircle, Lock, LogOut } from 'lucide-react'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { Logo } from '../../../components/ui/Logo'
import { WRONG_APP_MESSAGE, type AppArea } from '../access'
import { AUTH_TEXT } from '../messages'

/**
 * X1 Checking session: logo and spinner while `GET /auth/me` runs. Shown
 * instead of the sign-in screen so it never flashes first.
 */
export function SessionSplash() {
  return (
    <main
      role="status"
      className="flex min-h-svh flex-col items-center justify-center gap-5 bg-surface p-8 text-center"
    >
      <Logo className="w-60 max-w-[80%]" />
      <LoaderCircle aria-hidden="true" className="size-7 animate-spin text-primary" />
      <span className="sr-only">Checking your session</span>
    </main>
  )
}

/**
 * The session check could not reach the server. Not a separate screen in the
 * design: it is the splash with the approved "no connection" alert and Retry,
 * so the app never claims the person is signed out when it cannot know.
 */
export function SessionUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-5 bg-surface p-8">
      <Logo className="w-60 max-w-[80%]" />
      <Alert
        tone="error"
        title={AUTH_TEXT.network}
        className="w-full max-w-[440px]"
        action={
          <Button variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        }
      />
    </main>
  )
}

export interface WrongAppScreenProps {
  app: AppArea
  onSignOut: () => void
  signingOut: boolean
}

/**
 * X4 Wrong app for this account: signed in, but this app does not serve the
 * account's role. Offers only "Sign out", never a link to another area.
 */
export function WrongAppScreen({ app, onSignOut, signingOut }: WrongAppScreenProps) {
  return (
    <main className="min-h-svh bg-surface tablet:flex tablet:items-start tablet:justify-center tablet:bg-background tablet:px-6 tablet:py-14">
      <div className="flex w-full flex-col gap-5 px-5 pt-6 pb-7 tablet:max-w-[440px] tablet:rounded-xl tablet:border tablet:border-border tablet:bg-surface tablet:p-8 tablet:shadow-md">
        <Logo className="w-50" />
        <span className="flex size-14 items-center justify-center rounded-full bg-primary-50 text-primary-700">
          <Lock aria-hidden="true" className="size-7" />
        </span>
        <p role="alert" className="text-h2 font-bold">
          {WRONG_APP_MESSAGE[app]}
        </p>
        <Button
          block
          loading={signingOut}
          onClick={onSignOut}
          icon={<LogOut aria-hidden="true" className="size-5" />}
        >
          {signingOut ? 'Signing out' : 'Sign out'}
        </Button>
      </div>
    </main>
  )
}
