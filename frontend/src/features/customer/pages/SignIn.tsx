import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { Button } from '../../../components/ui/Button'
import { ScreenHeading } from '../../../components/ui/Content'
import { PageTabs } from '../../../components/ui/Controls'
import { PhoneField, TextField } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { ApiError } from '../../../lib/api/client'
import { errorMessage } from '../../../lib/api/errorMessage'
import { normalizeNigerianPhone } from '../../../lib/format/phone'
import { phoneField, retryAfterSeconds } from '../../../lib/forms'
import { AuthShell } from '../../auth/AuthShell'
import { HOME_PATH } from '../../auth/authPaths'
import { useLogin } from '../../auth/useSession'
import { POINTS_ENABLED } from '../../../lib/features'

const schema = z.object({
  phone: phoneField,
  password: z.string().min(1, 'Enter your password.'),
})
type Values = z.infer<typeof schema>

/** Message for a failed sign-in. Wrong phone and wrong password look the same on purpose (auth.md). */
function signInError(error: unknown): string {
  const wait = retryAfterSeconds(error)
  if (wait !== null) return `Too many tries. Wait ${Math.max(1, Math.ceil(wait / 60))} minutes, then try again.`
  if (error instanceof ApiError && error.code === 'invalid_credentials') return 'That phone number or password is not right.'
  return errorMessage(error)
}

/** Customer sign in (`c-signin`). Phone and password only (decision 6). */
export function SignIn() {
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  const login = useLogin()
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema) })
  const [phone, password] = useWatch({ control, name: ['phone', 'password'] })
  const progress = ((normalizeNigerianPhone(phone ?? '') ? 1 : 0) + (password ? 1 : 0)) / 2

  const onSubmit = handleSubmit((values) =>
    login.mutate(values, {
      onSuccess: (session) => navigate(from && session.user.role === 'customer' ? from : HOME_PATH[session.user.role], { replace: true }),
    }),
  )

  return (
    <AuthShell
      progress={progress}
      title={
        <>
          Water at your gate, <em>without the stress.</em>
        </>
      }
      points={['Full price before you confirm', 'Done only when you give your code', 'Cash on delivery during the pilot']}
    >
      <ScreenHeading
        className="rise-1"
        titleClassName="font-display text-[clamp(2.2rem,4.6vw,3rem)] leading-[1.02] font-semibold tracking-[-0.028em]"
        title="Welcome back."
        sub={POINTS_ENABLED ? 'Sign in to order, track your delivery and earn points.' : 'Sign in to order water and follow your delivery.'}
      />
      <div className="rise-2">
        <PageTabs
          label="Account"
          tabs={[
            { to: '/signin', label: 'Sign in', current: true },
            { to: '/signup', label: 'Create account', current: false },
          ]}
        />
      </div>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {login.isError && <Notice tone="error">{signInError(login.error)}</Notice>}
        <PhoneField className="rise-3" label="Phone number" autoComplete="username" error={errors.phone?.message} {...register('phone')} />
        <div className="rise-4">
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            placeholder="Your password"
            error={errors.password?.message}
            {...register('password')}
          />
          <div className="mt-2 text-right">
            <Link to="/forgot-password" className="text-[13px] font-bold text-primary no-underline hover:text-primary-dark">
              Forgot password?
            </Link>
          </div>
        </div>
        <Button type="submit" className="rise-5" loading={login.isPending}>
          Sign in
        </Button>
      </form>
      <p className="m-0 text-center text-chip text-mute">
        By continuing you agree to our{' '}
        <Link to="/terms" className="text-mute underline hover:text-ink">
          Terms
        </Link>{' '}
        and{' '}
        <Link to="/privacy" className="text-mute underline hover:text-ink">
          Privacy Notice
        </Link>
        .
      </p>
      <Link
        to="/partner/signup"
        className="mt-2 flex items-center gap-3.5 rounded-[20px] border border-solid border-line bg-white px-4 py-3.5 text-ink no-underline transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-primary hover:text-ink"
      >
        <span className="flex-1">
          <b className="block text-[15px]">Have a keke or tanker?</b>
          <span className="block text-[13.5px] text-mute">Register as a driver and get paid per trip.</span>
        </span>
        <span aria-hidden="true" className="text-primary">
          →
        </span>
      </Link>
    </AuthShell>
  )
}
