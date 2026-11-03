import { Navigate, useParams } from 'react-router-dom'
import { Confetti, Wave } from '../../../components/art/Art'
import { Illustration } from '../../../components/brand/Illustration'
import { CheckIcon } from '../../../components/icons/icons'
import { MobileShell, ScrollArea } from '../../../components/layout/MobileShell'
import { ErrorBlock, LoadingBlock } from '../../../components/layout/StateScreens'
import { ButtonLink } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { KeyValue } from '../../../components/ui/Content'
import { PARTNER_PAY_ENABLED } from '../../../lib/features'
import { formatTime } from '../../../lib/format/datetime'
import { formatNaira } from '../../../lib/format/money'
import { jobQuantity } from '../jobHelpers'
import { ArrivalToast, CashCard } from '../cash/CashParts'
import { jobStepPath, usePartnerApp } from '../partnerContext'
import { useJob, usePartnerProfile } from '../queries'

const CONFETTI = [
  { left: 36, top: 0, color: '#22C55E', delay: 0 },
  { left: 120, top: 12, color: '#F2B33D', delay: 0.5 },
  { left: 200, top: 0, color: '#11708C', delay: 1 },
  { left: 280, top: 8, color: '#22C55E', delay: 0.3 },
  { left: 345, top: 0, color: '#F2B33D', delay: 0.8 },
]

/**
 * Tanker delivery done (`t-done`). As on the rider screen, no payment status
 * (FR-040, BR-13): the K1 Cash card takes its place (driver-cash.md, #20).
 */
export function DriverDone() {
  const { reference = '' } = useParams()
  const { base } = usePartnerApp()
  const job = useJob(reference)
  const profile = usePartnerProfile()
  const j = job.data
  if (j && j.stage !== 'delivered') return <Navigate to={jobStepPath(base, j)} replace />

  return (
    <MobileShell className="bg-[linear-gradient(180deg,#E7F9EE_0%,#F4F7FB_45%)]">
      <Confetti pieces={CONFETTI} height={240} />
      <ScrollArea className="items-center gap-3 pt-[30px] text-center">
        <ArrivalToast />
        {job.isPending && <LoadingBlock />}
        {job.isError && <ErrorBlock error={job.error} onRetry={() => job.refetch()} />}
        {j && (
          <>
            <div className="relative h-[150px] w-full" aria-hidden="true">
              <Illustration name="tanker" className="animate-drive absolute top-5 left-1/2 ml-[-115px] w-[230px]" />
              <span className="animate-pop absolute top-0 left-1/2 ml-[60px] flex size-[54px] items-center justify-center rounded-full bg-[#16A34A] shadow-[0_10px_22px_rgba(22,163,74,0.35)] [animation-delay:.3s]">
                <CheckIcon size={28} strokeWidth={3} color="#fff" roundJoin={false} />
              </span>
            </div>
            <h1 className="rise-1 m-0 text-[26px] font-extrabold tracking-[-0.5px] text-[#15803D]">{jobQuantity(j)} delivered!</h1>
            <p className="rise-2 m-0 text-sub text-mute">
              Code verified{j.delivered_at ? ` at ${formatTime(j.delivered_at)}` : ''}. Nice work{profile.data ? `, ${profile.data.name.split(' ')[0]}` : ''}.
            </p>
            {/* Partner pay is out of the MVP (partners.md, decision 7): no card without an amount. */}
            {j.earning_minor_units !== null && (
              <div className="rise-3 relative box-border w-full overflow-hidden rounded-[22px] bg-[linear-gradient(120deg,#14532D,#15803D)] p-[18px] text-left text-white">
                <div className="text-[13px] font-bold text-[#BBF7D0]">YOU EARNED</div>
                <div className="animate-pop text-[38px] font-extrabold tracking-[-1px] [animation-delay:.4s]">{formatNaira(j.earning_minor_units)}</div>
                <div className="text-caption text-[#DCFCE7]">Added to your wallet · sample amount</div>
                <Wave fill="#FFFFFF" variant="low" height={34} className="bottom-[-10px] opacity-20" />
              </div>
            )}
            <Card pad className="rise-4 box-border w-full text-left">
              <KeyValue label="Order" value={j.reference} />
              <KeyValue label="Loaded at" value={`${j.station.name}${j.collected_at ? ` · ${formatTime(j.collected_at)}` : ''}`} />
              {/* The receiver is not sent once the job ends (real API): leave the row out. */}
              {j.customer.contact_name && <KeyValue label="Delivered to" value={j.customer.contact_name} />}
            </Card>
            {/* No payment row: partners never see an order's payment status (FR-040, BR-13). The K1 Cash card takes its place (#20). */}
            <CashCard job={j} base={base} vehicle="tanker" />
            <div className="rise-5 flex w-full flex-col gap-2">
              <ButtonLink to={base}>Back to dashboard</ButtonLink>
              {PARTNER_PAY_ENABLED && (
                <ButtonLink to={`${base}/earnings`} variant="alt">
                  View earnings
                </ButtonLink>
              )}
            </div>
          </>
        )}
      </ScrollArea>
    </MobileShell>
  )
}
