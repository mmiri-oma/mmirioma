import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { Phone } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Navigate, useNavigate } from 'react-router-dom'
import { Button } from '../../../components/ui/Button'
import { Field, PasswordField } from '../../../components/ui/Field'
import { register as registerAccount } from '../../../lib/api/auth'
import { AuthBannerView } from '../components/AuthBannerView'
import { AuthLayout } from '../components/AuthLayout'
import { SessionSplash, SessionUnavailable } from '../components/StatusScreens'
import { TextLink } from '../components/TextLink'
import type { BannerAction } from '../messages'
import { createAccountSchema, type CreateAccountValues } from '../schemas'
import { useSession } from '../sessionContext'
import { useAuthFormBanner } from '../useAuthFormBanner'
import type { SignInLocationState } from './SignInPage'

/** Router state for the customer home right after creating an account. */
export interface NewAccountState {
  /** Show the one-time "A team member will confirm your phone number" notice. */
  justRegistered: true
}

/**
 * C2 Create account (customers only; staff and drivers get accounts from the
 * team). Success signs the person in and opens the customer home with a
 * one-time notice.
 */
export function CreateAccountPage() {
  const { status, retry } = useSession()
  if (status.kind === 'checking') return <SessionSplash />
  if (status.kind === 'unavailable') return <SessionUnavailable onRetry={retry} />
  if (status.kind === 'signed-in') return <Navigate to="/" replace />
  return <CreateAccountForm />
}

function CreateAccountForm() {
  const { signedIn } = useSession()
  const navigate = useNavigate()
  const { banner, bannerKey, waiting, showError, clear, onWaitOver } = useAuthFormBanner()

  const {
    register,
    handleSubmit,
    setValue,
    setFocus,
    getValues,
    formState: { errors },
  } = useForm<CreateAccountValues>({
    resolver: zodResolver(createAccountSchema),
    defaultValues: { name: '', phone: '', password: '' },
  })

  const mutation = useMutation({
    mutationFn: (values: CreateAccountValues) => registerAccount(values),
    onMutate: clear,
    onSuccess: (session) => {
      signedIn(session)
      const state: NewAccountState = { justRegistered: true }
      navigate('/', { replace: true, state })
    },
    onError: (error) => {
      showError(error)
      // Keep the name and phone; always clear the password after a failure.
      setValue('password', '')
    },
  })

  const submit = handleSubmit((values) => {
    if (!mutation.isPending) mutation.mutate(values)
  })

  const onBannerAction = (action: BannerAction) => {
    if (action === 'sign-in-instead') {
      // Carry the phone number over to C3.
      const state: SignInLocationState = { phone: getValues('phone') }
      navigate('/sign-in', { state })
    } else if (action === 'retry') {
      if (getValues('password') === '') setFocus('password')
      else void submit()
    }
  }

  const locked = mutation.isPending
  return (
    <AuthLayout title="Create account">
      {banner ? (
        <AuthBannerView
          key={bannerKey}
          banner={banner}
          onAction={onBannerAction}
          onWaitOver={onWaitOver}
        />
      ) : null}

      <form noValidate onSubmit={submit} className="flex flex-col gap-5">
        <Field
          label="Full name"
          autoComplete="name"
          maxLength={100}
          error={errors.name?.message}
          locked={locked}
          {...register('name')}
        />
        <Field
          label="Phone number"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          leading={<Phone aria-hidden="true" className="size-5" />}
          help="We'll use this to contact you about deliveries."
          error={errors.phone?.message}
          locked={locked}
          {...register('phone')}
        />
        <PasswordField
          label="Password"
          autoComplete="new-password"
          maxLength={128}
          help="At least 8 characters."
          error={errors.password?.message}
          locked={locked}
          {...register('password')}
        />
        <Button type="submit" block loading={locked} disabled={waiting}>
          {locked ? 'Creating account' : 'Create account'}
        </Button>
      </form>

      <p className="flex flex-wrap items-center gap-x-1.5">
        <span>Already have an account?</span>
        <TextLink to="/sign-in">Sign in</TextLink>
      </p>
    </AuthLayout>
  )
}
