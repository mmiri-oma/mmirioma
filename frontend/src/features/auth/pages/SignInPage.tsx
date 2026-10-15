import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { Phone } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '../../../components/ui/Button'
import { Field, PasswordField } from '../../../components/ui/Field'
import { Toast } from '../../../components/ui/Toast'
import { login } from '../../../lib/api/auth'
import { APP_HOME, type AppArea } from '../access'
import { AuthBannerView } from '../components/AuthBannerView'
import { AuthLayout } from '../components/AuthLayout'
import { SessionSplash, SessionUnavailable } from '../components/StatusScreens'
import { ExternalTextLink, TextLink } from '../components/TextLink'
import { supportContact } from '../contact'
import { AUTH_TEXT, type BannerAction } from '../messages'
import { signInSchema, type SignInValues } from '../schemas'
import { useSession } from '../sessionContext'
import { useAuthFormBanner } from '../useAuthFormBanner'

/**
 * Router state a sign-in screen understands:
 * - `from`: page to return to after signing in (staff keep their page and
 *   filters after "session ended", X2);
 * - `phone`: number to prefill ("Sign in instead" from C2);
 * - `signedOut`: show the "You've signed out." toast (X5).
 */
export interface SignInLocationState {
  from?: string
  phone?: string
  signedOut?: boolean
}

const TITLES: Record<AppArea, string> = { customer: 'Sign in', staff: 'MmiriOma staff' }

/**
 * C3 customer sign in and S1 staff sign in (docs/design/authentication.md).
 * While the session is being checked it shows the splash, never the form.
 */
export function SignInPage({ app }: { app: AppArea }) {
  const { status, retry } = useSession()
  if (status.kind === 'checking') return <SessionSplash />
  if (status.kind === 'unavailable') return <SessionUnavailable onRetry={retry} />
  if (status.kind === 'signed-in') return <Navigate to={APP_HOME[app]} replace />
  return <SignInForm app={app} sessionEnded={status.ended} />
}

function SignInForm({ app, sessionEnded }: { app: AppArea; sessionEnded: boolean }) {
  const { signedIn } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state ?? {}) as SignInLocationState
  const [showSignedOut, setShowSignedOut] = useState(state.signedOut === true)
  const { banner, bannerKey, waiting, showError, clear, onWaitOver } = useAuthFormBanner()

  const {
    register,
    handleSubmit,
    setValue,
    setFocus,
    getValues,
    formState: { errors },
  } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { phone: state.phone ?? '', password: '' },
  })

  const mutation = useMutation({
    mutationFn: (values: SignInValues) => login(values),
    onMutate: clear,
    onSuccess: (session) => {
      signedIn(session)
      navigate(state.from ?? APP_HOME[app], { replace: true })
    },
    onError: (error) => {
      showError(error)
      // Keep the phone number; always clear the password after a failure.
      setValue('password', '')
    },
  })

  const submit = handleSubmit((values) => {
    if (!mutation.isPending) mutation.mutate(values)
  })

  const onBannerAction = (action: BannerAction) => {
    if (action !== 'retry') return
    // The password was cleared, so Retry asks for it first.
    if (getValues('password') === '') setFocus('password')
    else void submit()
  }

  const locked = mutation.isPending
  return (
    <AuthLayout title={TITLES[app]}>
      {banner ? (
        <AuthBannerView
          key={bannerKey}
          banner={banner}
          onAction={onBannerAction}
          onWaitOver={onWaitOver}
        />
      ) : sessionEnded ? (
        <AuthBannerView banner={{ tone: 'info', title: AUTH_TEXT.sessionEnded }} />
      ) : null}

      <form noValidate onSubmit={submit} className="flex flex-col gap-5">
        <Field
          label="Phone number"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          leading={<Phone aria-hidden="true" className="size-5" />}
          error={errors.phone?.message}
          locked={locked}
          {...register('phone')}
        />
        <PasswordField
          label="Password"
          autoComplete="current-password"
          maxLength={128}
          error={errors.password?.message}
          locked={locked}
          {...register('password')}
        />
        <Button type="submit" block loading={locked} disabled={waiting}>
          {locked ? 'Signing in' : 'Sign in'}
        </Button>
      </form>

      <div className="flex flex-col">
        <ForgotPassword app={app} />
        {app === 'customer' ? (
          <p className="flex flex-wrap items-center gap-x-1.5">
            <span>New to MmiriOma?</span>
            <TextLink to="/create-account">Create account</TextLink>
          </p>
        ) : null}
      </div>

      {showSignedOut ? (
        <Toast
          tone="success"
          text={AUTH_TEXT.signedOut}
          onDismiss={() => setShowSignedOut(false)}
        />
      ) : null}
    </AuthLayout>
  )
}

/**
 * "Forgot your password?" guidance. There is no self-service reset in this
 * release (prompt 04): customers are pointed to support, staff to the
 * technical lead.
 */
function ForgotPassword({ app }: { app: AppArea }) {
  if (app === 'staff') {
    return (
      <p className="flex min-h-12 items-center">
        Forgot your password? Ask the technical lead to reset it.
      </p>
    )
  }
  const contactHref = supportContact.callHref ?? supportContact.whatsAppHref
  return (
    <p className="flex flex-wrap items-center gap-x-1.5">
      <span>Forgot your password?</span>
      {contactHref ? (
        <ExternalTextLink href={contactHref}>Contact us</ExternalTextLink>
      ) : (
        <span className="flex min-h-12 items-center font-bold">Contact us</span>
      )}
    </p>
  )
}
