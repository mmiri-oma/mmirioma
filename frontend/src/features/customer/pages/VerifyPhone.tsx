import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BackLink, Footer, MobileShell, ScrollArea, TopBar, TopBarTitle } from '../../../components/layout/MobileShell'
import { LoadingBlock } from '../../../components/layout/StateScreens'
import { Button } from '../../../components/ui/Button'
import { ApiError } from '../../../lib/api/client'
import { formatPhone } from '../../../lib/format/phone'
import { CodeStep, PhoneDisplay, ProblemNotice, SuccessStep } from '../../auth/PhoneCodeParts'
import { sentNow, type SentCode } from '../../auth/phoneCode'
import { SESSION_KEY, useRequestPhoneVerification, useSession, useVerifyPhone } from '../../auth/useSession'
import { useQueryClient } from '@tanstack/react-query'

/** Where to go after verifying: the screen that sent the customer here (Review keeps its draft). */
function returnPath(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from
  return typeof from === 'string' && from.startsWith('/') ? from : '/home'
}

/**
 * Verify the account's phone by SMS code (V1 Send a code, V2 Enter the code,
 * V3 Verified; FR-003). Design: docs/design/phone-verification.md.
 *
 * Opened after Create account (with "Do this later"), from the Home and
 * Review banners and from My profile. `location.state.from` names the screen
 * to return to; the order draft lives in app memory, so Review still has it
 * (correction 10).
 */
export function VerifyPhone() {
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const back = returnPath(location.state)
  const afterSignup = (location.state as { afterSignup?: boolean } | null)?.afterSignup === true
  const session = useSession()
  const send = useRequestPhoneVerification()
  const check = useVerifyPhone()
  const [sent, setSent] = useState<SentCode | null>(null)
  const [resent, setResent] = useState(false)
  const [alreadyVerified, setAlreadyVerified] = useState(false)

  const user = session.data?.user
  const done = check.isSuccess || alreadyVerified || (user?.phone_verified && !sent)

  function requestCode(isResend: boolean) {
    send.mutate(undefined, {
      onSuccess: (s) => {
        setSent(sentNow(s))
        setResent(isResend)
        check.reset()
      },
      onError: (error) => {
        // Decision 3: "already verified" is a success; refresh the session.
        if (error instanceof ApiError && error.code === 'phone_already_verified') {
          setAlreadyVerified(true)
          void qc.invalidateQueries({ queryKey: SESSION_KEY })
        }
      },
    })
  }

  const title = done ? 'Phone verified' : sent ? 'Enter the code' : 'Verify your phone'
  return (
    <MobileShell background="white">
      <TopBar left={<BackLink to={back} />} center={<TopBarTitle>{title}</TopBarTitle>} />
      {!user ? (
        <ScrollArea>
          <LoadingBlock label="Loading your account" />
        </ScrollArea>
      ) : done ? (
        <SuccessStep title="Phone verified" action="Continue" onAction={() => navigate(back, { replace: true })}>
          {formatPhone(check.data?.phone ?? user.phone)} is verified. You can send water requests now.
        </SuccessStep>
      ) : sent ? (
        <CodeStep
          purpose="account_phone"
          sent={sent}
          intro={
            <p className="m-0 text-sub text-slate">
              We sent it by SMS to <b>{formatPhone(sent.phone)}</b>. It works for 5 minutes.
            </p>
          }
          verify={(code) => check.mutate(code)}
          verifying={check.isPending}
          verifyError={check.error}
          verifySubmittedAt={check.submittedAt}
          resend={() => requestCode(true)}
          resending={send.isPending}
          resendError={send.error}
          resent={resent}
        />
      ) : (
        <>
          <ScrollArea className="gap-3.5">
            <h1 className="m-0 text-[22px] font-extrabold tracking-[-0.4px]">Verify your phone number</h1>
            <p className="m-0 text-sub text-slate">We will send a 6-digit code by SMS to:</p>
            <PhoneDisplay phone={user.phone} />
            <p className="m-0 text-caption text-mute">
              You need a verified number to send your first water request. Standard SMS rates may apply.
            </p>
            {send.isError && !alreadyVerified && <ProblemNotice error={send.error} smsNote="Nothing was sent. Try again in a moment." />}
          </ScrollArea>
          <Footer>
            {send.error instanceof ApiError && send.error.code === 'csrf_failed' ? (
              <Button onClick={() => window.location.reload()}>Reload</Button>
            ) : send.error instanceof ApiError && send.error.status === 401 ? (
              <Button onClick={() => navigate('/signin', { replace: true })}>Sign in</Button>
            ) : (
              <Button onClick={() => requestCode(false)} loading={send.isPending}>
                {send.isError ? 'Try again' : 'Send code'}
              </Button>
            )}
            {afterSignup && (
              <Button variant="line" onClick={() => navigate('/home', { replace: true })}>
                Do this later
              </Button>
            )}
          </Footer>
        </>
      )}
    </MobileShell>
  )
}
