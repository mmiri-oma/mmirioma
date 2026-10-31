import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, type Ref, type SelectHTMLAttributes } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { ChevronDownIcon } from '../../../components/icons/icons'
import { Illustration } from '../../../components/brand/Illustration'
import { BackLink, MobileShell, ScrollArea, TopBar } from '../../../components/layout/MobileShell'
import { ErrorBlock, LoadingScreen } from '../../../components/layout/StateScreens'
import { Button } from '../../../components/ui/Button'
import { OptionTile } from '../../../components/ui/Choice'
import { ScreenHeading } from '../../../components/ui/Content'
import { INPUT, TextField } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import type { SignupArea } from '../../../domain/partner'
import { parseGallons, tankCapacityError } from '../../../domain/tankCapacity'
import { ApiError } from '../../../lib/api/client'
import { errorMessage } from '../../../lib/api/errorMessage'
import { applyServerFieldErrors, newPasswordField, phoneField } from '../../../lib/forms'
import { HOME_PATH } from '../../auth/authPaths'
import { SESSION_KEY, useLogout, useSession } from '../../auth/useSession'
import { formatPhone } from '../../../lib/format/phone'
import { cx } from '../../../lib/cx'
import { useSupportContact } from '../../marketing/queries'
import { listSignupAreas, partnerSignup } from '../partnerApi'

const schema = z
  .object({
    name: z.string().trim().min(1, 'Enter your full name.').max(100, 'Use 100 characters or fewer.'),
    phone: phoneField,
    password: newPasswordField,
    vehicle_type: z.enum(['keke', 'tanker']),
    plate: z.string().trim().min(4, 'Enter the plate number, e.g. ENU 482 KK.').max(20, 'Use 20 characters or fewer.'),
    /** Typed capacity in gallons, tankers only; stored as litres × 4 by the server (FR-013, FR-021). */
    tank_gallons: z.string(),
    /** ID of an active service zone picked from the list (`GET /service-zones`); the server checks it again. */
    service_zone_id: z.string().min(1, 'Choose the area you work in.'),
  })
  .superRefine((v, ctx) => {
    if (v.vehicle_type !== 'tanker') return
    const message = tankCapacityError(parseGallons(v.tank_gallons))
    if (message) ctx.addIssue({ code: 'custom', path: ['tank_gallons'], message })
  })
type Values = z.infer<typeof schema>

/** Server field names that have an error slot on this form. `vehicle_type` has none, so its message goes to the top notice. */
const SERVER_FIELDS = {
  name: 'name',
  phone: 'phone',
  password: 'password',
  plate: 'plate',
  tank_gallons: 'tank_gallons',
  service_zone_id: 'service_zone_id',
} as const satisfies Record<string, keyof Values>

/**
 * Messages of a `validation_error` that no field on this form can show, such
 * as `vehicle_type` or the whole body (`loc: ["body"]`). The top notice shows
 * them, so a refused sign-up never fails without a message.
 */
function unplacedMessages(error: unknown): string[] {
  if (!(error instanceof ApiError) || error.code !== 'validation_error' || !Array.isArray(error.details)) return []
  return (error.details as { loc?: unknown[]; msg?: string }[])
    .filter((d) => {
      const last = d.loc?.at(-1)
      return typeof last !== 'string' || !Object.hasOwn(SERVER_FIELDS, last)
    })
    .map((d) => d.msg ?? 'Check your details and try again.')
}

/**
 * `/partner/signup`. Signed-out visitors get the form. A signed-in customer
 * (from "Register as a driver" in the customer app) is told that a rider or
 * driver account needs its own phone number and can log out to continue;
 * partners and admins go to their own home.
 */
export function PartnerSignupPage() {
  const session = useSession()
  const logout = useLogout()
  if (session.isPending) return <LoadingScreen />
  const user = session.data?.user
  if (!user) return <PartnerSignup />
  if (user.role !== 'customer') return <Navigate to={HOME_PATH[user.role]} replace />
  return (
    <MobileShell background="white">
      <TopBar className="border-b-0" left={<BackLink to="/menu" />} />
      <ScrollArea className="gap-3.5 px-[22px] pt-2 pb-[22px]">
        <ScreenHeading className="rise-1" title="Deliver with MmiriOma" sub="Ride a keke or drive a tanker, and earn on every delivery." />
        <div className="rise-2 flex justify-center">
          <Illustration name="keke" className="animate-drive w-44" />
        </div>
        <Notice className="rise-3">
          You are signed in to the customer app as <b>{formatPhone(user.phone)}</b>. A rider or driver account needs its own phone number. Log out
          here, then create your rider or driver account.
        </Notice>
        {logout.isError && <Notice tone="error">{errorMessage(logout.error)}</Notice>}
        <Button className="rise-4" loading={logout.isPending} onClick={() => logout.mutate()}>
          Log out and continue
        </Button>
      </ScrollArea>
    </MobileShell>
  )
}

/**
 * Rider and driver sign-up form (decision 9). Not in the handoff; built from the
 * customer sign-up and option tile patterns. New accounts wait for admin to
 * approve the vehicle before they can go online. Needs an auth contract
 * change before it works with the real API.
 */
export function PartnerSignup() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const signup = useMutation({
    mutationFn: partnerSignup,
    onSuccess: (session) => {
      qc.clear()
      qc.setQueryData(SESSION_KEY, session)
      navigate('/partner', { replace: true })
    },
  })
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { vehicle_type: 'keke', tank_gallons: '', service_zone_id: '' },
  })
  const vehicle = useWatch({ control, name: 'vehicle_type' })
  const areas = useQuery({ queryKey: ['partner', 'signup-areas'], queryFn: listSignupAreas, staleTime: 60_000 })
  const support = useSupportContact()
  const noAreas = areas.isSuccess && areas.data.length === 0

  const onSubmit = handleSubmit((v) =>
    signup.mutate(
      { ...v, tank_gallons: v.vehicle_type === 'tanker' ? parseGallons(v.tank_gallons) : null },
      {
        onError: (e) => {
          if (e instanceof ApiError && e.code === 'phone_already_registered') setError('phone', { message: 'This number already has an account. Log in instead.' })
          else applyServerFieldErrors(e, setError, SERVER_FIELDS)
        },
      },
    ),
  )

  // Field errors show under their fields; anything no field can show goes in the top notice.
  const unplaced = unplacedMessages(signup.error)
  const fieldLevel =
    signup.error instanceof ApiError &&
    (signup.error.code === 'phone_already_registered' || (signup.error.code === 'validation_error' && Array.isArray(signup.error.details) && unplaced.length === 0))

  return (
    <MobileShell background="white">
      <TopBar className="border-b-0" left={<BackLink to="/partner/login" />} />
      <ScrollArea className="gap-3.5 px-[22px] pt-2 pb-[22px]">
        <ScreenHeading className="rise-1" title="Deliver with MmiriOma" sub="Create your rider or driver account. We check your vehicle before you get orders." />
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3.5">
          {signup.isError && !fieldLevel && <Notice tone="error">{unplaced.length ? unplaced.join(' ') : errorMessage(signup.error)}</Notice>}
          <fieldset className="rise-2 m-0 border-0 p-0">
            <legend className="mb-1.5 p-0 text-[14px] font-bold">What do you drive?</legend>
            <Controller
              control={control}
              name="vehicle_type"
              render={({ field }) => (
                <div className="grid grid-cols-2 gap-3">
                  <OptionTile selected={field.value === 'keke'} onSelect={() => field.onChange('keke')} className="pt-4 pb-3">
                    <Illustration name="keke" className="h-14 w-auto" />
                    <span className="text-[15px] font-extrabold">Keke</span>
                    <span className="text-tab text-mute">Jerrycans</span>
                  </OptionTile>
                  <OptionTile selected={field.value === 'tanker'} onSelect={() => field.onChange('tanker')} className="pt-4 pb-3">
                    <Illustration name="tanker" className="h-14 w-auto" />
                    <span className="text-[15px] font-extrabold">Tanker</span>
                    <span className="text-tab text-mute">Tank delivery</span>
                  </OptionTile>
                </div>
              )}
            />
          </fieldset>
          {vehicle === 'tanker' && (
            <TextField
              label="How many gallons does your tanker carry?"
              inputMode="numeric"
              autoComplete="off"
              placeholder="e.g. 4,000"
              hint="Type the full load in gallons, for example 4,000 gallons (16,000 litres)."
              error={errors.tank_gallons?.message}
              {...register('tank_gallons')}
            />
          )}
          <TextField className="rise-3" label="Full name" autoComplete="name" placeholder="e.g. Chinedu Okafor" error={errors.name?.message} {...register('name')} />
          <TextField
            className="rise-3"
            label="Phone number"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="0803 000 0000"
            hint="Customers and admin call you on this number."
            error={errors.phone?.message}
            {...register('phone')}
          />
          <TextField className="rise-4" label="Plate number" placeholder={vehicle === 'keke' ? 'ENU 482 KK' : 'ENU 115 XA'} error={errors.plate?.message} {...register('plate')} />
          {noAreas ? (
            <Notice tone="error" className="rise-4">
              Driver sign-up is not open right now because no delivery areas are set up yet. Please try again later, or contact MmiriOma support on{' '}
              <a href={`tel:${support.phone}`} className="font-bold">
                {formatPhone(support.phone)}
              </a>
              .
            </Notice>
          ) : (
            <AreaSelect
              className="rise-4"
              areas={areas.data}
              loading={areas.isPending}
              error={areas.isError ? areas.error : null}
              onRetry={() => void areas.refetch()}
              fieldError={errors.service_zone_id?.message}
              {...register('service_zone_id')}
            />
          )}
          <TextField
            className="rise-4"
            label="Password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            error={errors.password?.message}
            {...register('password')}
          />
          <Button type="submit" className="rise-5" loading={signup.isPending} disabled={!areas.isSuccess || noAreas}>
            Create account
          </Button>
        </form>
        <p className="m-0 text-center text-chip text-mute">
          Already have an account?{' '}
          <Link to="/partner/login" className="font-bold text-primary no-underline hover:text-primary-dark">
            Log in
          </Link>
        </p>
      </ScrollArea>
    </MobileShell>
  )
}

interface AreaSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> {
  className?: string
  /** Active service areas, by name; undefined until loaded. */
  areas: SignupArea[] | undefined
  loading: boolean
  /** The load failure, shown with a retry button in place of the select. */
  error: unknown
  onRetry: () => void
  /** Validation message from the form or the server. */
  fieldError?: string
}

/**
 * "Area you work in": a native select of the active service areas, so phones
 * show their own picker. Loading and load-failure states replace the select
 * (the submit button stays disabled); the chosen option's value is the
 * zone's ID, never typed text.
 */
function AreaSelect({ className, areas, loading, error, onRetry, fieldError, ref, ...select }: AreaSelectProps & { ref?: Ref<HTMLSelectElement> }) {
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-label font-bold">
        Area you work in
      </label>
      {error ? (
        <ErrorBlock error={error} onRetry={onRetry} />
      ) : (
        <div className="relative">
          <select
            ref={ref}
            id={id}
            disabled={loading}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? `${id}-error` : undefined}
            className={cx(INPUT, 'appearance-none pr-10 font-semibold', fieldError && 'border-[#DC2626] bg-[#FEF2F2]')}
            {...select}
          >
            <option value="">{loading ? 'Loading areas…' : 'Choose your area'}</option>
            {areas?.map((area) => (
              <option key={area.id} value={area.id}>
                {area.name}
              </option>
            ))}
          </select>
          <ChevronDownIcon size={18} strokeWidth={2.2} color="#56677D" roundJoin={false} className="pointer-events-none absolute top-[15px] right-3.5" />
        </div>
      )}
      {fieldError && (
        <p id={`${id}-error`} role="alert" className="mt-1.5 mb-0 text-caption font-bold text-red">
          {fieldError}
        </p>
      )}
    </div>
  )
}
