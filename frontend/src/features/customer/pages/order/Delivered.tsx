import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Confetti } from '../../../../components/art/Art'
import { Illustration } from '../../../../components/brand/Illustration'
import { Logo } from '../../../../components/brand/Logo'
import { StarIcon } from '../../../../components/icons/icons'
import { MobileShell, ScrollArea } from '../../../../components/layout/MobileShell'
import { ErrorBlock, LoadingBlock } from '../../../../components/layout/StateScreens'
import { Button, ButtonLink } from '../../../../components/ui/Button'
import { Card } from '../../../../components/ui/Card'
import { SampleTag } from '../../../../components/ui/Chip'
import { SectionTitle } from '../../../../components/ui/Content'
import { Notice } from '../../../../components/ui/Notice'
import { errorMessage } from '../../../../lib/api/errorMessage'
import { formatTime } from '../../../../lib/format/datetime'
import { useOrderDraft } from '../../order/orderDraftContext'
import { draftFromOrder } from '../../order/reorder'
import { POINTS_ENABLED } from '../../../../lib/features'
import { useAddresses, useOrder, usePoints, useSubmitFeedback } from '../../queries'

const CONFETTI = [
  { left: 30, top: 0, color: '#F2B33D', delay: 0 },
  { left: 90, top: 14, color: '#11708C', delay: 0.5 },
  { left: 170, top: 0, color: '#22C55E', delay: 1 },
  { left: 250, top: 10, color: '#F2B33D', delay: 0.3 },
  { left: 330, top: 4, color: '#16A0B8', delay: 0.8 },
]

/** Delivered, points earned and feedback (`c-delivered`). */
export function Delivered() {
  const { reference = '' } = useParams()
  const navigate = useNavigate()
  const order = useOrder(reference)
  const points = usePoints()
  const addresses = useAddresses()
  const feedback = useSubmitFeedback(reference)
  const { reset } = useOrderDraft()
  const o = order.data

  const [rating, setRating] = useState<number | null>(null)
  const [poured, setPoured] = useState<boolean | null>(null)
  const shownRating = rating ?? o?.feedback?.rating ?? 0
  const shownPoured = poured ?? o?.feedback?.poured_by_partner ?? null

  /**
   * Saves the rating and the answer together. The API needs both (`poured_by_partner` is a required boolean), and the
   * customer must have given both: nothing is saved, and no answer is made up, until each is chosen (#256).
   */
  function send(nextRating: number, nextPoured: boolean | null) {
    if (nextRating < 1 || nextPoured === null) return
    feedback.mutate({ rating: nextRating, poured_by_partner: nextPoured })
  }

  function orderAgain() {
    if (!o) return
    reset(draftFromOrder(o, addresses.data ?? []))
    navigate('/order/review')
  }

  return (
    <MobileShell className="bg-[linear-gradient(180deg,#E6F3F5_0%,#F4F7FB_40%)]">
      <Confetti pieces={CONFETTI} height={240} />
      <ScrollArea className="items-center gap-3 pt-[34px] text-center">
        {order.isPending && <LoadingBlock label="Loading your order" />}
        {order.isError && <ErrorBlock error={order.error} onRetry={() => order.refetch()} />}
        {o && (
          <>
            <div className="relative flex size-28 shrink-0 items-center justify-center" aria-hidden="true">
              <span className="animate-ping absolute size-[76px] rounded-full bg-[rgba(17,112,140,.3)]" />
              <span className="animate-pop flex size-[92px] items-center justify-center rounded-full bg-white shadow-[0_14px_30px_rgba(17,112,140,0.25)]">
                <Logo variant="mark" height={75} alt="" />
              </span>
            </div>
            <h1 className="rise-1 m-0 text-[26px] font-extrabold tracking-[-0.5px]">Water delivered!</h1>
            <p className="rise-2 m-0 text-sub text-mute">
              {o.delivered_quantity ?? 'Your water'} {o.choice ? (o.choice.delivery_type === 'keke' ? 'poured into your tank' : 'pumped into your tank') : 'delivered'}
              {o.delivered_at ? ` at ${formatTime(o.delivered_at)}` : ''}. Code confirmed.
            </p>
            {POINTS_ENABLED && o.points_earned !== null && (
              <div className="rise-3 relative box-border flex w-full items-center gap-3 overflow-hidden rounded-[22px] bg-[linear-gradient(120deg,#FFF7E2_0%,#FFE6A8_100%)] p-4 text-left">
                <Illustration name="gift" className="animate-float w-28 shrink-0" />
                <div>
                  <div className="animate-pop text-big font-extrabold text-gold-ink [animation-delay:.4s]">+{o.points_earned} points</div>
                  {points.data && (
                    <div className="text-[13px] text-[#5A4310]">
                      New balance <b>{points.data.balance} pts</b>
                    </div>
                  )}
                  <SampleTag className="mt-1 inline-block">SAMPLE REWARD</SampleTag>
                </div>
              </div>
            )}
            <Card pad className="rise-4 box-border w-full text-left">
              <SectionTitle>How did we do?</SectionTitle>
              <div role="radiogroup" aria-label="Rate this delivery" className="mt-2.5 mb-3 flex gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={shownRating === n}
                    aria-label={`${n} star${n > 1 ? 's' : ''}`}
                    onClick={() => {
                      setRating(n)
                      send(n, shownPoured)
                    }}
                    className="flex size-11 cursor-pointer items-center justify-center border-0 bg-transparent p-0"
                    style={{ color: n <= shownRating ? '#F2B33D' : '#C9D4E1' }}
                  >
                    <StarIcon size={32} filled />
                  </button>
                ))}
              </div>
              <div className="mb-2 text-sub font-bold">
                Did the {o.choice ? (o.choice.delivery_type === 'keke' ? 'rider' : 'driver') : 'partner'} pour it in for you?
              </div>
              <div role="radiogroup" aria-label="Did they pour it in?" className="grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  role="radio"
                  aria-checked={shownPoured === true}
                  variant={shownPoured === true ? 'primary' : 'line'}
                  className={shownPoured === true ? 'shadow-none' : undefined}
                  onClick={() => {
                    setPoured(true)
                    send(shownRating, true)
                  }}
                >
                  Yes, no lifting
                </Button>
                <Button
                  size="sm"
                  role="radio"
                  aria-checked={shownPoured === false}
                  variant={shownPoured === false ? 'primary' : 'line'}
                  className={shownPoured === false ? 'shadow-none' : undefined}
                  onClick={() => {
                    setPoured(false)
                    send(shownRating, false)
                  }}
                >
                  I had to help
                </Button>
              </div>
              {shownRating === 0 && shownPoured !== null && (
                <p className="mt-2 mb-0 text-caption text-mute">Choose the stars too, so we can save your answer.</p>
              )}
              {shownRating > 0 && shownPoured === null && (
                <p className="mt-2 mb-0 text-caption text-mute">Answer this question too, so we can save your rating.</p>
              )}
              {feedback.isSuccess && (
                <Notice tone="success" className="mt-3">
                  Thank you. Your feedback is saved.
                </Notice>
              )}
              {feedback.isError && (
                <Notice tone="error" className="mt-3">
                  {errorMessage(feedback.error)}
                </Notice>
              )}
            </Card>
            <div className="rise-5 flex w-full flex-col gap-2">
              <Button onClick={orderAgain}>Order this again</Button>
              <ButtonLink to="/home" variant="alt">
                Back to home
              </ButtonLink>
            </div>
          </>
        )}
      </ScrollArea>
    </MobileShell>
  )
}
