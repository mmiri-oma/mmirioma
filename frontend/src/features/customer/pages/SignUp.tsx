import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { Button } from '../../../components/ui/Button'
import { ScreenHeading } from '../../../components/ui/Content'
import { PageTabs } from '../../../components/ui/Controls'
import { PhoneField, TextField } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { ApiError } from '../../../lib/api/client'
import { errorMessage } from '../../../lib/api/errorMessage'
import { normalizeNigerianPhone } from '../../../lib/format/phone'
import { applyServerFieldErrors, newPasswordField, PASSWORD_MISMATCH, phoneField, retryAfterSeconds, withoutConfirm } from '../../../lib/forms'
import { AuthShell } from '../../auth/AuthShell'
import { useRegister } from '../../auth/useSession'

const schema = z
  .object({
    name: z.string().trim().min(1, 'Enter your full name.').max(100, 'Use 100 characters or fewer.'),
    phone: phoneField,
    password: newPasswordField,
    confirm: z.string().min(1, 'Type your password again.'),
  })
  // Typed twice because there is no self-service password reset yet: a typo
  // here would lock the customer out until support resets it.
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: PASSWORD_MISMATCH })
type Values = z.infer<typeof schema>

/**
 * Create a customer account (`c-signup`): name, phone, password and the
 * password again. Google sign-up and the email field are removed (decision 6).
 * A new account goes straight to verifying its phone by SMS code, with "Do
 * this later" (FR-003; docs/design/phone-verification.md).
 */
export function SignUp() {
  const navigate = useNavigate()
  const registerMutation = useRegister()
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema) })
  const [name, phone, password, confirm] = useWatch({ control, name: ['name', 'phone', 'password', 'confirm'] })
  const progress =
    [name?.trim(), normalizeNigerianPhone(phone ?? ''), (password ?? '').length >= 8, confirm && confirm === password].filter(Boolean).length / 4

  const onSubmit = handleSubmit((values) =>
    registerMutation.mutate(withoutConfirm(values), {
      onSuccess: () => navigate('/verify-phone', { replace: true, state: { afterSignup: true, from: '/home' } }),
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'phone_already_registered') {
          setError('phone', { message: 'This number already has an account. Sign in instead.' })
        } else {
          applyServerFieldErrors(error, setError, { name: 'name', phone: 'phone', password: 'password' })
        }
      },
    }),
  )

  const err = registerMutation.error
  const fieldLevel = err instanceof ApiError && (err.code === 'phone_already_registered' || err.code === 'validation_error')
  const wait = retryAfterSeconds(err)

  return (
    <AuthShell
      progress={progress}
      back={{ to: '/signin', label: 'Back' }}
      title={
        <>
          Your account takes <em>under a minute.</em>
        </>
      }
      points={['Just your name and phone number', 'We text your codes to that phone', 'No card needed. Pay cash on delivery']}
    >
      <ScreenHeading
        className="rise-1"
        titleClassName="font-display text-[clamp(2.2rem,4.6vw,3rem)] leading-[1.02] font-semibold tracking-[-0.028em]"
        title="Create your account"
        sub="It takes less than a minute."
      />
      <div className="rise-2">
        <PageTabs
          variant="blue"
          label="Account"
          tabs={[
            { to: '/signin', label: 'Sign in', current: false },
            { to: '/signup', label: 'Create account', current: true },
          ]}
        />
      </div>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3.5">
        {registerMutation.isError && !fieldLevel && (
          <Notice tone="error">
            {wait !== null ? `Too many tries. Wait ${Math.max(1, Math.ceil(wait / 60))} minutes, then try again.` : errorMessage(err)}
          </Notice>
        )}
        <TextField className="rise-3" label="Full name" autoComplete="name" placeholder="e.g. Adaeze Nwosu" error={errors.name?.message} {...register('name')} />
        <PhoneField
          className="rise-3"
          label="Phone number"
          autoComplete="username"
          hint="We send delivery codes to this number."
          error={errors.phone?.message}
          {...register('phone')}
        />
        <TextField
          className="rise-4"
          label="Password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          error={errors.password?.message}
          {...register('password')}
        />
        <TextField
          className="rise-4"
          label="Type your password again"
          type="password"
          autoComplete="new-password"
          placeholder="The same password"
          error={errors.confirm?.message}
          {...register('confirm')}
        />
        <Button type="submit" className="rise-5" loading={registerMutation.isPending}>
          Create account
        </Button>
      </form>
      <p className="rise-5 m-0 text-center text-chip text-mute">
        By signing up you agree to our{' '}
        <Link to="/terms" className="text-mute underline hover:text-ink">
          Terms
        </Link>{' '}
        and{' '}
        <Link to="/privacy" className="text-mute underline hover:text-ink">
          Privacy Notice
        </Link>
        .
      </p>
      <p className="m-0 text-center text-[13px] text-slate">
        Register as a driver?{' '}
        <Link to="/partner/signup" className="font-bold text-primary no-underline hover:text-primary-dark">
          Click here
        </Link>
      </p>
    </AuthShell>
  )
}
