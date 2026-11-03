import { useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Illustration } from '../../../components/brand/Illustration'
import { BellIcon } from '../../../components/icons/icons'
import { Button } from '../../../components/ui/Button'
import { Notice } from '../../../components/ui/Notice'
import type { PartnerJob } from '../../../domain/partner'
import { errorMessage } from '../../../lib/api/errorMessage'
import { formatNaira } from '../../../lib/format/money'
import { jobDeliveryType, jobQuantity } from '../jobHelpers'
import { usePartnerApp } from '../partnerContext'
import { useAcceptJob } from '../queries'

/**
 * "New order for you" bottom sheet (`r-assigned`) for an order admin
 * assigned. The partner must answer: start (accept) or decline with a reason
 * (decision 13). Focus moves into the sheet when it opens.
 */
export function AssignedSheet({ job }: { job: PartnerJob }) {
  const navigate = useNavigate()
  const { base, vehicle } = usePartnerApp()
  const accept = useAcceptJob()
  const sheetRef = useRef<HTMLDivElement>(null)

  // Move keyboard and screen-reader focus into the dialog when it appears.
  useEffect(() => {
    sheetRef.current?.focus()
  }, [job.reference])

  return (
    <div className="absolute inset-0 z-20">
      <div className="rise-1 absolute inset-0 bg-[rgba(10,37,64,.55)]" aria-hidden="true" />
      <div
        ref={sheetRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="New order assigned"
        className="animate-sheet absolute inset-x-0 bottom-0 flex flex-col gap-3 rounded-t-[28px] bg-white px-[18px] pt-2.5 pb-[max(22px,env(safe-area-inset-bottom))] shadow-[0_-16px_40px_rgba(10,37,64,0.25)] outline-none"
      >
        <span aria-hidden="true" className="h-[5px] w-11 self-center rounded-[3px] bg-input-line" />
        <div className="flex items-center gap-2.5">
          <span className="relative size-11" aria-hidden="true">
            <span className="animate-ping absolute inset-0 rounded-full bg-[rgba(17,112,140,.35)]" />
            <span className="relative flex size-11 items-center justify-center rounded-full bg-primary text-white">
              <BellIcon size={22} />
            </span>
          </span>
          <div>
            <div className="text-[20px] font-extrabold">New order for you</div>
            <div className="text-[13px] text-mute">Assigned by admin{job.assigned_by ? ` · ${job.assigned_by}` : ''}</div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-card bg-[linear-gradient(160deg,#EEF6FF,#DCEBFD)] px-3.5 py-3">
          <div className="flex-1">
            <div className="text-[16px] font-extrabold">{jobQuantity(job)}</div>
            <div className="text-caption text-slate">{job.reference}</div>
            <div className="mt-1.5 text-caption text-slate">
              {job.station.name.replace(' Refill', '')}
              {job.station.distance_km === null ? '' : ` ${job.station.distance_km} km`} → {job.customer.area}
              {job.customer.distance_km === null ? '' : ` ${job.customer.distance_km} km`}
            </div>
          </div>
          <Illustration name={jobDeliveryType(job, vehicle)} className="animate-drive w-28" />
        </div>
        {/* Partner pay is out of the MVP: no line rather than "not known yet". */}
        {job.earning_minor_units !== null && (
          <div className="flex items-center justify-between">
            <span className="text-mute">You will earn</span>
            <span className="text-[20px] font-extrabold text-green">{formatNaira(job.earning_minor_units)}</span>
          </div>
        )}
        {accept.isError && <Notice tone="error">{errorMessage(accept.error)}</Notice>}
        <Button
          loading={accept.isPending}
          onClick={() => accept.mutate(job.reference, { onSuccess: () => navigate(`${base}/jobs/${job.reference}/refill`) })}
        >
          Start: go to refill station
        </Button>
        <Link to={`${base}/jobs/${job.reference}/decline`} className="p-1 text-center text-sub font-bold text-primary no-underline hover:text-primary-dark">
          I cannot take this order
        </Link>
      </div>
    </div>
  )
}
