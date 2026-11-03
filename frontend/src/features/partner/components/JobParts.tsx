import type { ReactNode } from 'react'
import { Illustration } from '../../../components/brand/Illustration'
import { ClockIcon, PinOutlineIcon } from '../../../components/icons/icons'
import { ButtonLink } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { Chip } from '../../../components/ui/Chip'
import type { PartnerJob } from '../../../domain/partner'
import { cx } from '../../../lib/cx'
import { formatNaira } from '../../../lib/format/money'
import { contactSuffix, customerLabel, jobDeliveryType, jobQuantity, kmSuffix, minutesSuffix, placeAddress, tankerTripLine, tripMinutes } from '../jobHelpers'
import { usePartnerApp } from '../partnerContext'

/** Pool card of the available orders list (`r-available`). */
export function AvailableJobCard({ job, to, className }: { job: PartnerJob; to: string; className?: string }) {
  const { vehicle } = usePartnerApp()
  const minutes = tripMinutes(job)
  return (
    <Card className={`p-3.5 ${className ?? ''}`}>
      <div className="flex items-center justify-between gap-2.5">
        <div>
          <div className="text-chip font-semibold text-mute">{job.reference}</div>
          <div className="text-[16px] font-extrabold">{jobQuantity(job)}</div>
        </div>
        {/* Partner pay is out of the MVP: no line rather than "not known yet". */}
        {job.earning_minor_units !== null && (
          <Chip tone="amber" className="text-sub">
            {formatNaira(job.earning_minor_units)}
          </Chip>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2.5">
        <div className="flex flex-1 flex-col gap-[5px] text-caption text-slate">
          <span className="flex items-center gap-1.5">
            <PinOutlineIcon size={14} strokeWidth={2.4} color="#11708C" />
            {job.station.name}
            {kmSuffix(job.station.distance_km)}
          </span>
          <span className="flex items-center gap-1.5">
            <PinOutlineIcon size={14} strokeWidth={2.4} color="#DC2626" />
            Customer in {job.customer.area}
            {kmSuffix(job.customer.distance_km)}
          </span>
          {minutes !== null && (
            <span className="flex items-center gap-1.5">
              <ClockIcon size={14} strokeWidth={2.4} color="#56677D" roundJoin={false} />
              About {minutes} min in total
            </span>
          )}
        </div>
        <Illustration name={jobDeliveryType(job, vehicle)} className="w-[104px]" />
      </div>
      <ButtonLink to={to} size="sm" className="mt-2.5">
        View and accept
      </ButtonLink>
    </Card>
  )
}

/** Route card with station and customer stops (`r-order`). */
export function RouteCard({ job, className }: { job: PartnerJob; className?: string }) {
  const keke = jobDeliveryType(job, usePartnerApp().vehicle) === 'keke'
  return (
    <Card pad className={className}>
      <h2 className="m-0 mb-2.5 text-section font-extrabold">Route</h2>
      <div className="flex gap-3">
        <div className="flex flex-col items-center pt-[3px]" aria-hidden="true">
          <span className={cx('box-border size-3.5 rounded-full border-4 bg-white', keke ? 'border-primary' : 'border-[#15803D]')} />
          <span
            className={cx(
              'min-h-10 w-0.5 flex-1',
              keke ? 'bg-[repeating-linear-gradient(180deg,#8CCBD8_0_4px,transparent_4px_8px)]' : 'bg-[repeating-linear-gradient(180deg,#86EFAC_0_4px,transparent_4px_8px)]',
            )}
          />
          <svg width="16" height="20" viewBox="0 0 24 30">
            <path d="M12 29s-10-9-10-17a10 10 0 0 1 20 0c0 8-10 17-10 17Z" fill="#DC2626" />
            <circle cx="12" cy="12" r="4" fill="#fff" />
          </svg>
        </div>
        <div className="flex flex-1 flex-col gap-3.5">
          <div>
            <div className="text-chip font-bold text-mute">{keke ? 'REFILL STATION' : 'LOAD AT'}</div>
            <div className="font-extrabold">{job.station.name}</div>
            <div className="text-caption text-mute">
              {placeAddress(job.station)}
              {kmSuffix(job.station.distance_km)}
              {minutesSuffix(job.station.minutes)}
            </div>
          </div>
          <div>
            <div className="text-chip font-bold text-mute">{keke ? 'CUSTOMER' : 'DELIVER TO'}</div>
            <div className="font-extrabold">{keke ? job.customer.name : customerLabel(job)}</div>
            <div className="text-caption text-mute">
              {keke ? (job.customer.landmark ?? job.customer.area) : placeAddress(job.customer).split(',')[0]}
              {kmSuffix(job.customer.distance_km)}
              {minutesSuffix(job.customer.minutes)}
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}

/** Small card naming the order (`r-otp`, `r-issue`): illustration, reference, quantity. */
export function JobMiniCard({ job, sub, trailing, className }: { job: PartnerJob; sub?: string; trailing?: ReactNode; className?: string }) {
  const keke = jobDeliveryType(job, usePartnerApp().vehicle) === 'keke'
  return (
    <Card className={cx('flex items-center gap-3 px-3.5', keke ? 'py-3' : 'py-2.5', className)}>
      <Illustration name={keke ? 'keke' : 'tanker'} className={keke ? 'w-[76px]' : 'w-[86px]'} />
      <div className="flex-1">
        <div className="font-extrabold">{job.reference}</div>
        <div className="text-caption text-mute">{sub ?? `${jobQuantity(job)}${contactSuffix(job)}`}</div>
      </div>
      {trailing}
    </Card>
  )
}


/** "Ground" (green) or "Overhead" (violet) chip for a tanker job (`t-home`, `t-available`). */
export function TankTypeChip({ job }: { job: PartnerJob }) {
  // Unknown until the backend sends the tank (#21): no chip.
  if (job.choice?.delivery_type !== 'tanker') return null
  const overhead = job.choice.tank_type === 'overhead'
  return (
    <Chip tone={overhead ? 'violet' : 'green'} className="px-2 py-0.5">
      {overhead ? 'Overhead' : 'Ground'}
    </Chip>
  )
}

/** Pool card of the tanker orders list (`t-available`). */
export function TankerJobCard({ job, to, className }: { job: PartnerJob; to: string; className?: string }) {
  return (
    <Card className={cx('relative overflow-hidden p-3.5', className)}>
      <div className="flex items-start justify-between gap-2.5">
        <div>
          <div className="text-chip font-semibold text-mute">{job.reference}</div>
          <div className="flex items-center gap-1.5">
            <span className="text-[18px] font-extrabold">{jobQuantity(job)}</span>
            <TankTypeChip job={job} />
          </div>
        </div>
        {job.earning_minor_units !== null && (
          <Chip tone="amber" className="text-[14px]">
            {formatNaira(job.earning_minor_units)}
          </Chip>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2.5">
        <div className="flex flex-1 flex-col gap-1 text-caption text-slate">
          <span>
            Station: {job.station.area}
            {kmSuffix(job.station.distance_km)}
          </span>
          <span>
            Customer: {job.customer.area}
            {kmSuffix(job.customer.distance_km)}
          </span>
          {tankerTripLine(job) && <span className="text-mute">{tankerTripLine(job)}</span>}
        </div>
        <Illustration name="tanker" className="w-[118px]" />
      </div>
      <ButtonLink to={to} size="sm" className="mt-2.5">
        View and accept
      </ButtonLink>
    </Card>
  )
}
