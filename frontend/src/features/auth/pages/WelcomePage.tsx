import { MessageCircle, Phone } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Logo } from '../../../components/ui/Logo'
import { Toast } from '../../../components/ui/Toast'
import { supportContact } from '../contact'
import { AUTH_TEXT } from '../messages'
import { useSession } from '../sessionContext'

const BUTTON_BASE =
  'inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md border-2 px-5 font-semibold'
const PRIMARY = `${BUTTON_BASE} border-primary bg-primary text-text-inverse hover:border-primary-hover hover:bg-primary-hover`
const SECONDARY = `${BUTTON_BASE} border-primary bg-surface text-primary-700 hover:bg-primary-50 hover:text-primary-800`

/**
 * C1 Welcome: one sentence on the service, "Create account" (primary), "Sign
 * in" (secondary), and support contacts when configured. Also where
 * customers land after signing out (X5), with the "You've signed out." toast.
 */
export function WelcomePage() {
  const { status, dismissSignedOutNotice } = useSession()
  const showSignedOut = status.kind === 'signed-out' && status.byUser
  const { callHref, whatsAppHref } = supportContact

  return (
    <main className="flex min-h-svh flex-col justify-between gap-8 bg-surface px-5 pt-6 pb-7 tablet:mx-auto tablet:max-w-[440px]">
      <Logo className="w-60" />
      <h1 className="text-[30px] leading-10 font-bold">
        We bring water to your door in Enugu, and the driver unloads it for you.
      </h1>
      <div className="flex flex-col gap-3">
        <Link to="/create-account" className={PRIMARY}>
          Create account
        </Link>
        <Link to="/sign-in" className={SECONDARY}>
          Sign in
        </Link>
      </div>

      {callHref || whatsAppHref ? (
        <section className="flex flex-col gap-3 rounded-lg border border-border bg-neutral-50 p-4">
          <h2 className="font-bold">Need help? Call or WhatsApp us</h2>
          <div className="flex gap-2">
            {callHref ? (
              <a href={callHref} className={`${SECONDARY} flex-1`}>
                <Phone aria-hidden="true" className="size-5" />
                Call
              </a>
            ) : null}
            {whatsAppHref ? (
              <a href={whatsAppHref} className={`${SECONDARY} flex-1`}>
                <MessageCircle aria-hidden="true" className="size-5" />
                WhatsApp
              </a>
            ) : null}
          </div>
        </section>
      ) : null}

      {showSignedOut ? (
        <Toast
          tone="success"
          text={AUTH_TEXT.signedOut}
          onDismiss={dismissSignedOutNotice}
        />
      ) : null}
    </main>
  )
}
