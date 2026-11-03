import { Navigate, useParams } from 'react-router-dom'
import { Confetti, Wave } from '../../../components/art/Art'
import { Illustration } from '../../../components/brand/Illustration'
import { CheckIcon } from '../../../components/icons/icons'
import { MobileShell, ScrollArea } from '../../../components/layout/MobileShell'
import { ErrorBlock, LoadingBlock } from '../../../components/layout/StateScreens'
import { ButtonLink } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { KeyValue, Separator } from '../../../components/ui/Content'
import { formatDateTime } from '../../../lib/format/datetime'
import { formatNaira } from '../../../lib/format/money'
import { describeQuantity } from '../../../domain/quantity'
import { jobQuantity } from '../jobHelpers'
import { ArrivalToast, CashCard } from '../cash/CashParts'
import { jobStepPath, usePartnerApp } from '../partnerContext'
import { useJob, usePartnerProfile } from '../queries'

const CONFETTI = [
  { left: 36, top: 0, color: '#22C55E', delay: 0 },
  { left: 110, top: 12, color: '#F2B33D', delay: 0.5 },
  { left: 190, top: 0, color: '#11708C', delay: 1 },
  { left: 270, top: 8, color: '#22C55E', delay: 0.3 },
  { left: 340, top: 0, color: '#F2B33D', delay: 0.8 },
]

/**
 * Delivery successful (`r-done`). No payment status (FR-040, BR-13): the K1
 * Cash card shows the amount due and the cash recorded (driver-cash.md, #20).
 */
export function RiderDone() {
  const { reference = '' } = useParams()
  const { base } = usePartnerApp()
  const job = useJob(reference)
  const profile = usePartnerProfile()
  const j = job.data
  if (j && j.stage !== 'delivered') return <Navigate to={jobStepPath(base, j)} replace />
  // Cans poured, when the choice is known; without it the quantity line already shows the litres.
  const litres = j?.choice?.delivery_type === 'keke' ? j.choice.can_size_litres * j.choice.can_count : null

  return (
    <MobileShell className="bg-[linear-gradient(180deg,#E7F9EE_0%,#F4F7FB_45%)]">
      <Confetti pieces={CONFETTI} height={240} />
      <ScrollArea className="items-center gap-3 pt-10 text-center">
        <ArrivalToast />
        {job.isPending && <LoadingBlock />}
        {job.isError && <ErrorBlock error={job.error} onRetry={() => job.refetch()} />}
        {j && (
          <>
            <div className="relative flex size-[120px] items-center justify-center" aria-hidden="true">
              <span className="animate-ping absolute size-20 rounded-full bg-[rgba(34,197,94,.3)]" />
              <span className="animate-pop flex size-[88px] items-center justify-center rounded-full bg-[#16A34A] shadow-[0_14px_30px_rgba(22,163,74,0.35)]">
                <CheckIcon size={44} strokeWidth={3} color="#fff" />
              </span>
            </div>
            <h1 className="rise-1 m-0 text-[26px] font-extrabold tracking-[-0.5px] text-green">Delivery successful!</h1>
            <p className="rise-2 m-0 text-sub text-mute">Code verified. Great job{profile.data ? `, ${profile.data.name.split(' ')[0]}` : ''}.</p>
            {/* Partner pay is out of the MVP (partners.md, decision 7): no card without an amount. */}
            {j.earning_minor_units !== null && (
              <div className="rise-3 relative box-border w-full overflow-hidden rounded-[22px] bg-[linear-gradient(120deg,#0E4A5A,#11708C)] p-[18px] text-left text-white">
                <div className="text-[13px] font-bold text-[#D4ECEF]">YOU EARNED</div>
                <div className="animate-pop text-[38px] font-extrabold tracking-[-1px] [animation-delay:.3s]">{formatNaira(j.earning_minor_units)}</div>
                <div className="text-caption text-[#DCEBFD]">Added to your wallet · sample amount</div>
                <Wave fill="#FFFFFF" variant="low" height={34} className="bottom-[-10px] opacity-20" />
              </div>
            )}
            <Card pad className="rise-4 box-border w-full text-left">
              <div className="flex items-center gap-3">
                <Illustration name="keke" className="w-[86px]" />
                <div className="flex-1">
                  <div className="font-extrabold">{j.reference}</div>
                  <div className="text-caption text-mute">
                    {jobQuantity(j)}
                    {litres ? ` · ${describeQuantity(litres, 'litres', 'short')} poured` : ''}
                  </div>
                </div>
              </div>
              <Separator />
              {/* The receiver is not sent once the job ends (real API): leave the row out. */}
              {j.customer.contact_name && <KeyValue label="Customer" value={j.customer.contact_name} />}
              {j.delivered_at && <KeyValue label="Delivered at" value={formatDateTime(j.delivered_at)} />}
            </Card>
            {/* No payment row: partners never see an order's payment status (FR-040, BR-13). The K1 Cash card takes its place (#20). */}
            <CashCard job={j} base={base} vehicle="keke" />
            <div className="rise-5 flex w-full flex-col gap-2">
              <ButtonLink to={base}>Back to dashboard</ButtonLink>
              <ButtonLink to={`${base}/earnings`} variant="alt">
                View earnings
              </ButtonLink>
            </div>
          </>
        )}
      </ScrollArea>
    </MobileShell>
  )
}
