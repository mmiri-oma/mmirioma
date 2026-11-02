import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import { useLocation, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { AlertCircleIcon } from '../../../components/icons/icons'
import { Button } from '../../../components/ui/Button'
import { PhoneField, TextField } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { ApiError } from '../../../lib/api/client'
import { errorMessage } from '../../../lib/api/errorMessage'
import { USE_MOCKS } from '../../../lib/api/mode'
import { normalizeNigerianPhone } from '../../../lib/format/phone'
import { phoneField, retryAfterSeconds } from '../../../lib/forms'
import { AuthShell } from '../../auth/AuthShell'
import { HOME_PATH } from '../../auth/authPaths'
import { useLogin } from '../../auth/useSession'


/**
 * The demo staff account's phone and password, read on click and only in mock mode: they must not be in a build
 * without mocks, where anyone can read the JavaScript (#236).
 */
const loadDemoAccount = async () => {
  if (!__USE_MOCKS__) throw new Error('The demo account is not part of this build.')
  const { DEMO_ADMIN_PHONE, DEMO_PASSWORD } = await import('../../../mocks/seed')
  return { DEMO_ADMIN_PHONE, DEMO_PASSWORD }
}
const schema = z.object({ phone: phoneField, password: z.string().min(1, 'Enter your password.') })
type Values = z.infer<typeof schema>

/**
 * Staff sign-in (`/admin/login`), on the shared sign-in layout in its dark
 * tone so staff can tell it from the customer screen at a glance. Staff
 * accounts are created by the team's command-line tool (auth.md), so there
 * is no sign-up or self-service reset.
 */
export function AdminLogin() {
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  const login = useLogin()
  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema) })
  const [phone, password] = useWatch({ control, name: ['phone', 'password'] })
  const progress = ((normalizeNigerianPhone(phone ?? '') ? 1 : 0) + (password ? 1 : 0)) / 2

  const onSubmit = handleSubmit((v) =>
    login.mutate(v, {
      onSuccess: (s) => navigate(from && s.user.role === 'admin' ? from : HOME_PATH[s.user.role], { replace: true }),
    }),
  )

  const wait = retryAfterSeconds(login.error)
  const message =
    wait !== null
      ? `Too many tries. Wait ${Math.max(1, Math.ceil(wait / 60))} minutes, then try again.`
      : login.error instanceof ApiError && login.error.code === 'invalid_credentials'
        ? 'That phone number or password is not right.'
        : errorMessage(login.error)

  return (
    <AuthShell
      tone="dark"
      progress={progress}
      title={
        <>
          Orders, riders <em>and stations.</em>
        </>
      }
      points={['Assign riders and confirm orders', 'Keep refill stations open', 'Sort out delivery problems']}
    >
      <div className="rise-1">
        <span className="inline-block rounded-full bg-ink px-3 py-1.5 text-[11.5px] font-bold tracking-[0.14em] text-gold uppercase">Staff only</span>
        <h1 className="mt-4 mb-0 font-display text-[clamp(2.2rem,4.6vw,3rem)] leading-[1.02] font-semibold tracking-[-0.028em]">Staff sign in</h1>
        <p className="mt-2 mb-0 text-mute">For Waterline admins, dispatchers and support.</p>
      </div>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {login.isError && <Notice tone="error">{message}</Notice>}
        <PhoneField label="Phone number" autoComplete="username" error={errors.phone?.message} {...register('phone')} />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          placeholder="Your password"
          error={errors.password?.message}
          {...register('password')}
        />
        <Button type="submit" loading={login.isPending}>
          Sign in
        </Button>
      </form>
      {USE_MOCKS && (
        <div className="flex flex-col gap-2 rounded-icon border border-dashed border-input-line p-3 text-caption text-slate">
          <span>
            <b>Mock mode:</b> sample data in this browser only. Fill in the demo staff account to look around.
          </span>
          <Button
            variant="alt"
            size="sm"
            onClick={async () => {
              const { DEMO_ADMIN_PHONE, DEMO_PASSWORD } = await loadDemoAccount()
              setValue('phone', DEMO_ADMIN_PHONE, { shouldValidate: true })
              setValue('password', DEMO_PASSWORD, { shouldValidate: true })
            }}
          >
            Use demo staff account
          </Button>
        </div>
      )}
      <div className="flex items-start gap-2.5 rounded-icon bg-sky p-3 text-caption text-primary-dark">
        <AlertCircleIcon size={18} color="#11708C" roundJoin={false} className="shrink-0" />
        <span>Staff accounts are set up by the Waterline team. Forgot your password? Ask your team lead to reset it.</span>
      </div>
    </AuthShell>
  )
}
