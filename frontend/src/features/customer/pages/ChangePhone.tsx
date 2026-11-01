import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { CheckIcon } from '../../../components/icons/icons'
import { BackLink, Footer, MobileShell, ScrollArea, TopBar, TopBarTitle } from '../../../components/layout/MobileShell'
import { LoadingBlock } from '../../../components/layout/StateScreens'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { Chip } from '../../../components/ui/Chip'
import { TextField } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { ApiError } from '../../../lib/api/client'
import type { PhoneChangeInput } from '../../../lib/api/phoneVerification'
import { formatPhone } from '../../../lib/format/phone'
import { applyServerFieldErrors, phoneField } from '../../../lib/forms'
import { CodeStep, ProblemNotice, SuccessStep } from '../../auth/PhoneCodeParts'
import { sentNow, type SentCode } from '../../auth/phoneCode'
import { useRequestPhoneChange, useSession, useVerifyPhoneChange } from '../../auth/useSession'

const schema = z.object({
  phone: phoneField,
  password: z.string().min(1, 'Enter your password.'),
})
type Values = z.infer<typeof schema>

/**
 * Change the account's phone number (P1 New number, P2 Enter the code, P3
 * Number changed; FR-004). Design: docs/design/phone-verification.md.
 *
 * The current number stays on the account until the code sent to the new one
 * is verified (decision 7). The typed number and password are kept in memory
 * only, so "Send a new code" can send P1 again.
 */
export function ChangePhone() {
  const navigate = useNavigate()
  const session = useSession()
  const send = useRequestPhoneChange()
  const check = useVerifyPhoneChange()
  const [request, setRequest] = useState<PhoneChangeInput | null>(null)
  const [sent, setSent] = useState<SentCode | null>(null)
  const [resent, setResent] = useState(false)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema) })

  const user = session.data?.user

  function sendTo(input: PhoneChangeInput, isResend: boolean) {
    send.mutate(input, {
      onSuccess: (s) => {
        setRequest(input)
        setSent(sentNow(s))
        setResent(isResend)
        check.reset()
      },
      onError: (error) => {
        if (isResend || !(error instanceof ApiError)) return
        if (error.code === 'password_incorrect') setError('password', { message: 'That password is not right.' })
        else if (error.code === 'phone_unchanged') setError('phone', { message: 'This is already your number.' })
        else if (error.code === 'phone_already_registered') setError('phone', { message: 'This number already has an account.' })
        else applyServerFieldErrors(error, setError, { phone: 'phone', password: 'password' })
      },
    })
  }

  function backToForm() {
    setSent(null)
    check.reset()
    send.reset()
  }

  const fieldLevel =
    send.error instanceof ApiError &&
    ['password_incorrect', 'phone_unchanged', 'phone_already_registered', 'validation_error'].includes(send.error.code)

  const title = check.isSuccess ? 'Number changed' : 'Change phone number'
  return (
    <MobileShell background="white">
      <TopBar left={<BackLink to="/settings" />} center={<TopBarTitle>{title}</TopBarTitle>} />
      {!user ? (
        <ScrollArea>
          <LoadingBlock label="Loading your account" />
        </ScrollArea>
      ) : check.isSuccess ? (
        <SuccessStep title="Phone number changed" action="Done" onAction={() => navigate('/profile', { replace: true })}>
          Your number is now {formatPhone(check.data.phone)}. Use it to sign in next time.
        </SuccessStep>
      ) : sent && request ? (
        <CodeStep
          purpose="phone_change"
          sent={sent}
          intro={
            <>
              <p className="m-0 text-sub text-slate">
                We sent it by SMS to <b>{formatPhone(sent.phone)}</b>. It works for 5 minutes.
              </p>
              <p className="m-0 text-caption text-mute">Your current number stays on the account until this code is verified.</p>
            </>
          }
          verify={(code) => check.mutate(code)}
          verifying={check.isPending}
          verifyError={check.error}
          verifySubmittedAt={check.submittedAt}
          resend={() => sendTo(request, true)}
          resending={send.isPending}
          resendError={send.error}
          resent={resent}
          renderVerifyError={(error) =>
            error instanceof ApiError && error.code === 'phone_already_registered' ? (
              <Notice tone="error">
                <b>This number now has another account.</b> Your number has not changed. Use a different number.
                <span className="mt-2 block">
                  <Button variant="alt" size="sm" block={false} onClick={backToForm}>
                    Change number
                  </Button>
                </span>
              </Notice>
            ) : null
          }
        />
      ) : (
        <form onSubmit={handleSubmit((v) => sendTo({ phone: v.phone, password: v.password }, false))} noValidate className="contents">
          <ScrollArea className="gap-3.5">
            <Card pad className="flex items-center justify-between gap-3">
              <span>
                <span className="block text-chip text-mute">Current number</span>
                <span className="text-[18px] font-extrabold tabular-nums">{formatPhone(user.phone)}</span>
              </span>
              {user.phone_verified ? (
                <Chip tone="green" icon={<CheckIcon size={14} strokeWidth={3} />}>Verified</Chip>
              ) : (
                <Chip tone="amber">Not verified yet</Chip>
              )}
            </Card>
            <p className="m-0 text-caption text-mute">We send a code to the new number. Your current number stays until you verify it.</p>
            {send.isError && !fieldLevel && <ProblemNotice error={send.error} smsNote="Your number has not changed. Try again in a moment." />}
            <TextField
              label="New phone number"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="0803 123 4567"
              error={errors.phone?.message}
              {...register('phone')}
            />
            <TextField
              label="Current password"
              type="password"
              autoComplete="current-password"
              hint="To confirm it is you."
              error={errors.password?.message}
              {...register('password')}
            />
          </ScrollArea>
          <Footer>
            <Button type="submit" loading={send.isPending}>
              Send code
            </Button>
          </Footer>
        </form>
      )}
    </MobileShell>
  )
}
