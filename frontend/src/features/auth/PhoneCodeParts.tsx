/**
 * Parts shared by the phone verification (V1-V3) and phone change (P1-P3)
 * screens: the code step, the success screen and the messages for failed
 * sends. Design: docs/design/phone-verification.md (decisions and the main
 * repo's corrections 9-13). Contract: docs/api/auth.md, "Phone verification".
 */
import { useEffect, useState, type ReactNode } from 'react'
import { CheckIcon, ClockIcon } from '../../components/icons/icons'
import { Footer, ScrollArea } from '../../components/layout/MobileShell'
import { Button } from '../../components/ui/Button'
import { Notice } from '../../components/ui/Notice'
import { ApiError } from '../../lib/api/client'
import { errorMessage } from '../../lib/api/errorMessage'
import { USE_MOCKS } from '../../lib/api/mode'
import { formatPhone } from '../../lib/format/phone'
import { retryAfterSeconds } from '../../lib/forms'
import { useCodeDelivery } from './useSession'
import type { CodePurpose } from '../../lib/api/phoneVerification'
import { cleanCode, resendWaitMs, waitText, type SentCode } from './phoneCode'

/** Show "No SMS yet?" this long after a send if nothing was typed (decision 6). */
const SLOW_SMS_MS = 60_000

/**
 * The banner for a failed send or check that is not about one field: too many
 * attempts, SMS failed, no connection, security check, session ended.
 */
export function ProblemNotice({ error, smsNote }: { error: unknown; smsNote: string }) {
  const wait = waitText(error)
  if (wait) return <Notice tone="error"><b>Too many attempts.</b> {wait}</Notice>
  if (error instanceof ApiError) {
    if (error.code === 'sms_unavailable') return <Notice tone="error"><b>We could not send the SMS.</b> {smsNote}</Notice>
    if (error.code === 'csrf_failed') return <Notice tone="error"><b>Security check failed.</b> Reload the page, then try again.</Notice>
    if (error.status === 401) return <Notice tone="error"><b>You were signed out.</b> Sign in again to continue.</Notice>
    if (error.kind === 'network') return <Notice tone="error"><b>No connection.</b> Check your connection and try again.</Notice>
  }
  return <Notice tone="error">{errorMessage(error)}</Notice>
}

/** Seconds left until `deadline` (ms since epoch), ticking once a second. */
function useSecondsLeft(deadline: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (now >= deadline) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [deadline, now])
  return Math.max(0, Math.ceil((deadline - now) / 1000))
}

interface CodeStepProps {
  /** The code that was sent; a new object after each resend restarts the countdown. */
  sent: SentCode
  /** Heading's lead line: where the code went, and for a change what happens meanwhile. */
  intro: ReactNode
  verify: (code: string) => void
  verifying: boolean
  verifyError: unknown
  /** When the last Verify was sent (the mutation's `submittedAt`), to time a 429 wait. */
  verifySubmittedAt: number
  resend: () => void
  resending: boolean
  resendError: unknown
  /** True right after a successful resend, for the "New code sent." message. */
  resent: boolean
  /** Which flow the code belongs to, so the screen can ask whether the SMS arrived. */
  purpose: CodePurpose
  /** Extra handling for a verify error this screen owns (P2 "number taken"); return null to fall back. */
  renderVerifyError?: (error: unknown) => ReactNode | null
}

/**
 * V2 / P2: one large code field, Verify, and the resend countdown.
 *
 * - A wrong code clears the field and puts the focus back (decision 4); the
 *   tries left come from `details.attempts_remaining`.
 * - At 0 tries, or for `verification_code_expired`, the field is off and
 *   "Send a new code" is the only action.
 * - A 429 on Verify shows the wait and turns Verify off until it ends
 *   (correction 13).
 */
export function CodeStep(p: CodeStepProps) {
  // A new code (resend) or a failed check starts a fresh entry: the field is
  // emptied and, being remounted with a new key, takes the focus again.
  const entryKey = `${p.sent.received_at}-${p.verifySubmittedAt}`
  const [entry, setEntry] = useState({ key: entryKey, code: '', typed: false, incomplete: false })
  const current = entry.key === entryKey ? entry : { key: entryKey, code: '', typed: false, incomplete: false }
  const { code, typed, incomplete } = current
  const secondsLeft = useSecondsLeft(p.sent.received_at + resendWaitMs(p.sent))
  const sinceSend = useSecondsLeft(p.sent.received_at + SLOW_SMS_MS)
  const delivery = useCodeDelivery(p.purpose, p.sent.received_at)
  const verifyWait = useSecondsLeft(
    p.verifyError instanceof ApiError && p.verifyError.code === 'too_many_attempts'
      ? p.verifySubmittedAt + (retryAfterSeconds(p.verifyError) ?? 60) * 1000
      : 0,
  )

  const err = p.verifyError instanceof ApiError ? p.verifyError : null
  const attemptsLeft = err?.code === 'verification_code_invalid' ? (err.details as { attempts_remaining?: number } | null)?.attempts_remaining : undefined
  const dead = err?.code === 'verification_code_expired' || attemptsLeft === 0

  const owned = p.verifyError ? p.renderVerifyError?.(p.verifyError) : null
  let fieldError: string | undefined
  if (incomplete) fieldError = 'Enter all 6 digits.'
  else if (attemptsLeft === 0) fieldError = 'That code is wrong and no tries are left. Send a new code.'
  else if (attemptsLeft !== undefined) fieldError = `That code is wrong. ${attemptsLeft} ${attemptsLeft === 1 ? 'try' : 'tries'} left.`
  else if (dead) fieldError = 'This code no longer works. Send a new code.'
  else if (err?.code === 'validation_error') fieldError = 'Enter all 6 digits.'

  const fieldOff = dead || p.verifying || Boolean(owned)
  const verifyOff = fieldOff || verifyWait > 0
  const showProblem = Boolean(p.verifyError) && !owned && !fieldError && !(err?.code === 'too_many_attempts' && verifyWait === 0)

  function submit() {
    if (code.length !== 6) {
      setEntry({ ...current, incomplete: true })
      return
    }
    p.verify(code)
  }

  return (
    <>
      <ScrollArea className="gap-3.5">
        <h1 className="m-0 text-[22px] font-extrabold tracking-[-0.4px]">Enter the 6-digit code</h1>
        {p.intro}
        {USE_MOCKS && <Notice tone="note">Mock mode: the SMS is printed in the browser console.</Notice>}
        {p.resent && !p.resendError && <Notice tone="success">New code sent.</Notice>}
        {p.resendError ? <ProblemNotice error={p.resendError} smsNote="Your last code may still work. Try again in a moment." /> : null}
        {owned}
        {showProblem && <ProblemNotice error={p.verifyError} smsNote="Try again in a moment." />}
        {delivery === 'failed' && !dead && (
          <Notice tone="error">
            <b>The code did not reach your phone.</b> Your network may have blocked the SMS. Check the number above and send a new code
            {secondsLeft > 0 ? ' when the timer ends' : ''}.
          </Notice>
        )}
        {delivery !== 'failed' && sinceSend === 0 && !typed && !dead && <Notice tone="info">No SMS yet? Check the number above, then send a new code.</Notice>}
        <div>
          <label htmlFor="sms-code" className="mb-1.5 block text-label font-bold">
            Code
          </label>
          <input
            key={entryKey}
            autoFocus
            id="sms-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            disabled={fieldOff}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? 'sms-code-error' : undefined}
            onChange={(e) => setEntry({ key: entryKey, code: cleanCode(e.target.value), typed: true, incomplete: false })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
            className={`mo-in h-16 text-center text-[30px] leading-10 font-bold tracking-[0.6em] tabular-nums ${fieldError ? 'border-red' : ''} ${fieldOff ? 'bg-canvas text-mute' : ''}`}
          />
          {fieldError && (
            <p id="sms-code-error" role="alert" className="mt-1.5 mb-0 text-caption font-bold text-red">
              {fieldError}
            </p>
          )}
        </div>
        {secondsLeft > 0 ? (
          <p className="m-0 flex items-center gap-2 text-sub text-mute">
            <ClockIcon size={18} />
            <span>
              Send a new code in <b className="tabular-nums">{`${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`}</b>
            </span>
          </p>
        ) : (
          <div className="flex flex-col items-start gap-1">
            <Button variant="alt" size="sm" block={false} onClick={p.resend} loading={p.resending}>
              Send a new code
            </Button>
          </div>
        )}
        {/* Announced once when the countdown ends, not every second (decision 5). */}
        <span className="sr-only" aria-live="polite">
          {secondsLeft === 0 ? 'You can send a new code now.' : ''}
        </span>
      </ScrollArea>
      <Footer>
        <Button onClick={submit} loading={p.verifying} disabled={verifyOff}>
          Verify
        </Button>
      </Footer>
    </>
  )
}

/** V3 / P3: big check, one sentence, one button. */
export function SuccessStep({ title, children, action, onAction }: { title: string; children: ReactNode; action: string; onAction: () => void }) {
  return (
    <>
      <ScrollArea className="items-center gap-3 pt-10 text-center">
        <span className="flex size-[76px] items-center justify-center rounded-full bg-[#16A34A]" aria-hidden="true">
          <CheckIcon size={38} strokeWidth={3} color="#fff" />
        </span>
        <h1 className="m-0 text-[22px] font-extrabold tracking-[-0.4px]">{title}</h1>
        <p className="m-0 max-w-[300px] text-sub text-slate">{children}</p>
      </ScrollArea>
      <Footer>
        <Button onClick={onAction}>{action}</Button>
      </Footer>
    </>
  )
}

/** The account's number shown large, in local form. */
export function PhoneDisplay({ phone }: { phone: string }) {
  return <div className="text-[22px] font-extrabold tracking-[0.5px] tabular-nums">{formatPhone(phone)}</div>
}
