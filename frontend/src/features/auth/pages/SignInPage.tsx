import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { Phone } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Navigate, useLocation } from 'react-router-dom'
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
 * - `phone`: number to prefill ("Sign in instead" from C2).
 */
export interface SignInLocationState {
  from?: string
  phone?: string
}

const TITLES: Record<AppArea, string> = { customer: 'Sign in', staff: 'MmiriOma staff' }

/**
 * C3 customer sign in and S1 staff sign in (docs/design/authentication.md).
 * While the session is being checked it shows the splash, never the form.
 */
export function SignInPage({ app }: { app: AppArea }) {
  const { status, retry } = useSession()
  const location = useLocation()
  const state = (location.state ?? {}) as SignInLocationState
  if (status.kind === 'checking') return <SessionSplash />
  if (status.kind === 'unavailable') return <SessionUnavailable onRetry={retry} />
  // Signed in (including just now): go to the page the person came from, or
  // the app's home. Done here, not with navigate() after sign-in, because
  // React Router navigations are transitions and would lose that race.
  if (status.kind === 'signed-in') {
    return <Navigate to={state.from ?? APP_HOME[app]} replace />
  }
  return (
    <SignInForm
      app={app}
      initialPhone={state.phone ?? ''}
      sessionEnded={status.ended}
      signedOutByUser={status.byUser}
    />
  )
}

interface SignInFormProps {
  app: AppArea
  initialPhone: string
  sessionEnded: boolean
  signedOutByUser: boolean
}

function SignInForm({
  app,
  initialPhone,
  sessionEnded,
  signedOutByUser,
}: SignInFormProps) {
  const { signedIn, dismissSignedOutNotice } = useSession()
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
    defaultValues: { phone: initialPhone, password: '' },
  })

  const mutation = useMutation({
    mutationFn: (values: SignInValues) => login(values),
    onMutate: clear,
    onSuccess: signedIn,
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
        <Button type="submit" className="w-full" loading={locked} disabled={waiting}>
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

      {signedOutByUser ? (
        <Toast
          tone="success"
          text={AUTH_TEXT.signedOut}
          onDismiss={dismissSignedOutNotice}
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
