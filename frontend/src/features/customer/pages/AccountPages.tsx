/**
 * Small account screens reached from the design's links but not drawn in the
 * handoff (decision 19: no dead links). Each uses the existing patterns: top
 * bar with title, form fields, footer button.
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { BackLink, Footer, MobileShell, ScrollArea, TopBar, TopBarSpacer, TopBarTitle } from '../../../components/layout/MobileShell'
import { ErrorBlock, LoadingBlock } from '../../../components/layout/StateScreens'
import { Button, ButtonLink } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { TextAreaField, TextField } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { ApiError } from '../../../lib/api/client'
import { errorMessage } from '../../../lib/api/errorMessage'
import { applyServerFieldErrors, newPasswordField, optionalEmailField } from '../../../lib/forms'
import { changePassword } from '../../auth/authApi'
import { waitText } from '../../auth/phoneCode'
import { useProfile, useRequestAccountDeletion, useUpdateProfile } from '../queries'
import { POINTS_ENABLED } from '../../../lib/features'

function Page({ back, title, children, footer }: { back: string | -1; title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <MobileShell>
      <TopBar left={<BackLink to={back} />} center={<TopBarTitle>{title}</TopBarTitle>} right={<TopBarSpacer />} />
      <ScrollArea className="gap-3">{children}</ScrollArea>
      {footer && <Footer>{footer}</Footer>}
    </MobileShell>
  )
}

const emailSchema = z.object({ email: optionalEmailField })

/** Add, change or remove the optional email (decision 6: updates, newsletters, promos). */
export function EmailSettings() {
  const navigate = useNavigate()
  const profile = useProfile()
  const update = useUpdateProfile()
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<z.infer<typeof emailSchema>>({
    resolver: zodResolver(emailSchema),
    values: { email: profile.data?.email ?? '' },
  })

  const onSubmit = handleSubmit((v) =>
    update.mutate(
      { email: v.email || null },
      {
        onSuccess: () => navigate('/settings'),
        onError: (e) => applyServerFieldErrors(e, setError, { email: 'email' }),
      },
    ),
  )

  return (
    <Page
      back="/settings"
      title="Email"
      footer={
        <Button type="submit" form="email-form" loading={update.isPending}>
          Save email
        </Button>
      }
    >
      {profile.isPending && <LoadingBlock lines={1} />}
      {profile.isError && <ErrorBlock error={profile.error} onRetry={() => profile.refetch()} />}
      <p className="rise-1 m-0 text-sub text-mute">
        Optional. We use it for order receipts, news and offers you choose to get. Your phone stays your sign-in.
      </p>
      <form id="email-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        <TextField
          className="rise-2"
          label="Email address"
          optional
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          hint="Leave it empty to remove your email."
          error={errors.email?.message}
          {...register('email')}
        />
        {update.isError && !errors.email && <Notice tone="error">{errorMessage(update.error)}</Notice>}
      </form>
      <Notice className="rise-3">Turn news and offers on or off any time under Offers and news on your profile.</Notice>
    </Page>
  )
}

const passwordSchema = z
  .object({ current: z.string().min(1, 'Enter your current password.'), next: newPasswordField, confirm: z.string() })
  .refine((v) => v.next === v.confirm, { path: ['confirm'], message: 'The two new passwords do not match.' })

/**
 * Change password (`POST /auth/password`, docs/api/auth.md). Used by the
 * customer, partner and admin apps. Every other device signed in to the
 * account is signed out (decided on #8); this one stays signed in.
 */
export function ChangePassword({ back = '/profile' }: { back?: string }) {
  const navigate = useNavigate()
  const [state, setState] = useState<{ pending: boolean; error: unknown; done: boolean }>({ pending: false, error: null, done: false })
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<z.infer<typeof passwordSchema>>({ resolver: zodResolver(passwordSchema) })

  const onSubmit = handleSubmit(async (v) => {
    setState({ pending: true, error: null, done: false })
    try {
      await changePassword(v.current, v.next)
      setState({ pending: false, error: null, done: true })
      setTimeout(() => navigate(back), 1200)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'password_incorrect') setError('current', { message: 'Your current password is not right.' })
      else applyServerFieldErrors(e, setError, { new_password: 'next' })
      setState({ pending: false, error: e, done: false })
    }
  })

  return (
    <Page
      back={back}
      title="Change password"
      footer={
        <Button type="submit" form="password-form" loading={state.pending}>
          Save new password
        </Button>
      }
    >
      <form id="password-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        <TextField className="rise-1" label="Current password" type="password" autoComplete="current-password" error={errors.current?.message} {...register('current')} />
        <TextField
          className="rise-2"
          label="New password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          error={errors.next?.message}
          {...register('next')}
        />
        <TextField className="rise-3" label="New password again" type="password" autoComplete="new-password" error={errors.confirm?.message} {...register('confirm')} />
        {state.done && <Notice tone="success">Your password is changed. Other devices were signed out.</Notice>}
        {state.error !== null && !(state.error instanceof ApiError && ['password_incorrect', 'validation_error'].includes(state.error.code)) && (
          <Notice tone="error">{waitText(state.error) ?? errorMessage(state.error)}</Notice>
        )}
      </form>
    </Page>
  )
}

/**
 * Ask to delete the account. Deletion is a request our team handles (orders
 * and payment records may need to be kept for a time, NFR-005), not an
 * instant delete.
 */
export function DeleteAccount() {
  const request = useRequestAccountDeletion()
  const [reason, setReason] = useState('')
  const [asking, setAsking] = useState(false)
  return (
    <Page back="/settings" title="Delete my account">
      <Notice tone="error" className="rise-1">
        This asks our team to close your account and delete your details.{POINTS_ENABLED && ' Your points will be lost.'}
      </Notice>
      <p className="rise-2 m-0 text-sub text-mute">
        We keep order and payment records only as long as the law and our privacy notice require. We will confirm by SMS when it is done.
      </p>
      {request.isSuccess ? (
        <>
          <Notice tone="success">
            Request {request.data.number} sent. Our team will contact you to confirm before anything is deleted.
          </Notice>
          <ButtonLink to="/profile" variant="alt">
            Back to profile
          </ButtonLink>
        </>
      ) : (
        <>
          <TextAreaField
            className="rise-3"
            label="Why are you leaving?"
            optional
            rows={3}
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
          {request.isError && <Notice tone="error">{errorMessage(request.error)}</Notice>}
          <Button variant="danger" className="rise-4" onClick={() => setAsking(true)}>
            Ask to delete my account
          </Button>
          <ConfirmDialog
            open={asking}
            title="Delete your Waterline account?"
            confirmLabel="Send request"
            cancelLabel="Keep my account"
            loading={request.isPending}
            onCancel={() => setAsking(false)}
            onConfirm={() => request.mutate(reason, { onSettled: () => setAsking(false) })}
          >
            Our team will close your account and delete your details.{POINTS_ENABLED && ' Your points will be lost.'}
          </ConfirmDialog>
        </>
      )}
    </Page>
  )
}

/** Forgot password. There is no reset endpoint yet, so the honest path is support. */
export function ForgotPassword({ back = '/signin', contact = '/support/contact' }: { back?: string; contact?: string }) {
  return (
    <Page back={back} title="Forgot password">
      <Card pad className="rise-1">
        <h1 className="m-0 text-section font-extrabold">Reset your password</h1>
        <p className="mt-1.5 mb-0 text-sub text-mute">
          Password reset by SMS is not available yet. Call or WhatsApp our team from the phone number on your account and we will help
          you sign in again.
        </p>
      </Card>
      <ButtonLink className="rise-2" to={contact}>
        Contact support
      </ButtonLink>
      <ButtonLink className="rise-2" to={back} variant="alt">
        Back to sign in
      </ButtonLink>
    </Page>
  )
}
