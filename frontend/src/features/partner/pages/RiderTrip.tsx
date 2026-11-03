/**
 * The Keke trip after accepting: go to the station (`r-refill`), confirm the
 * pickup (`r-pickup`), go to the customer (`r-customer`). Each screen checks
 * the job's stage and sends the rider to the right step if it does not match
 * (for example after a reload or a back tap).
 */
import { useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { CustomerMapArt, MapBadge, MapControl, MapFrame, MapPin, RefillMapArt } from '../../../components/art/Art'
import { Illustration } from '../../../components/brand/Illustration'
import {
  CameraIcon,
  CheckIcon,
  MapPinIcon,
  MessageSquareIcon,
  NavigationIcon,
  PhoneIcon,
  StationDoorIcon,
  StationWindowsIcon,
} from '../../../components/icons/icons'
import { BackLink, Footer, MobileShell, ScrollArea, TopBar } from '../../../components/layout/MobileShell'
import { Avatar } from '../../../components/ui/Avatar'
import { Button, ButtonLink, ExternalButton } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { Chip } from '../../../components/ui/Chip'
import { IconBadge, ScreenHeading } from '../../../components/ui/Content'
import type { PartnerJob } from '../../../domain/partner'
import { describeQuantity, litresFromGallons } from '../../../domain/quantity'
import { errorMessage } from '../../../lib/api/errorMessage'
import { cx } from '../../../lib/cx'
import { Notice } from '../../../components/ui/Notice'
import { StepChip } from '../components/PartnerChrome'
import { directionsUrl } from '../maps'
import { readPickupPhoto } from '../photo'
import { jobDeliveryType, placeAddress } from '../jobHelpers'
import { usePartnerApp } from '../partnerContext'
import { useConfirmPickup } from '../queries'
import { ArriveButton } from '../components/ArriveButton'
import { JobStep } from '../components/JobStep'

/** Step 1: go to the refill station (`r-refill`). */
export function RefillStep() {
  const { base } = usePartnerApp()
  return (
    <JobStep stage="accepted">
      {(j) => (
        <MobileShell>
          <TopBar left={<BackLink to={base} />} right={<StepChip>Step 1 of 2</StepChip>} />
          <ScrollArea className="gap-3">
            <ScreenHeading
              className="rise-1"
              title="Go to refill station"
              sub={
                j.choice === null
                  ? `Collect ${describeQuantity(j.quantity_litres)} for ${j.reference}.`
                  : j.choice.delivery_type === 'keke'
                    ? `Collect ${j.choice.can_count} cans of ${j.choice.can_size_litres} L for ${j.reference}.`
                    : `Load ${describeQuantity(litresFromGallons(j.choice.tank_size_gallons ?? 0), 'gallons')} for ${j.reference}.`
              }
            />
            <Card className="rise-2 flex items-center gap-3 px-3.5 py-3">
              <IconBadge tone="blue">
                <StationWindowsIcon size={22} />
              </IconBadge>
              <div className="flex-1">
                <div className="font-extrabold">{j.station.name}</div>
                <div className="text-caption text-mute">{placeAddress(j.station)}</div>
              </div>
              {/* No road distance yet (no OSRM, SRS §12.1): nothing rather than a guess. */}
              {j.station.minutes !== null && j.station.distance_km !== null && (
                <div className="text-right">
                  <div className="font-extrabold text-primary">{j.station.minutes} min</div>
                  <div className="text-chip text-mute">{j.station.distance_km} km</div>
                </div>
              )}
            </Card>
            <MapFrame height={400} className="rise-3">
              <RefillMapArt />
              <div className="absolute top-[86.5%] left-[18.6%]" aria-hidden="true">
                <span className="animate-ping absolute inset-0 rounded-full bg-[rgba(17,112,140,.4)]" />
                <span className="relative flex size-7 items-center justify-center rounded-full bg-white shadow-[0_4px_10px_rgba(10,37,64,0.3)]">
                  <span className="size-4 rounded-full bg-primary" />
                </span>
              </div>
              <div
                aria-hidden="true"
                className="animate-float absolute top-[10%] left-[64.4%] flex size-[42px] items-center justify-center rounded-icon bg-primary text-white shadow-[0_8px_16px_rgba(17,112,140,0.4)]"
              >
                <StationDoorIcon size={22} />
              </div>
              <MapBadge tone="light" className="top-3 left-3">
                Head to {j.station.name}
              </MapBadge>
              <MapControl style={{ bottom: 12 }} />
            </MapFrame>
          </ScrollArea>
          <Footer>
            <ExternalButton href={directionsUrl(placeAddress(j.station))}>
              <NavigationIcon size={20} filled />
              Start navigation
            </ExternalButton>
            <ButtonLink to={`${base}/jobs/${j.reference}/pickup`} variant="alt" className="h-[46px]">
              I have arrived at the station
            </ButtonLink>
          </Footer>
        </MobileShell>
      )}
    </JobStep>
  )
}

/** At the station: confirm the load (`r-pickup`, FR-034). */
export function PickupStep() {
  const { base } = usePartnerApp()
  return <JobStep stage="accepted">{(j) => <PickupForm job={j} base={base} />}</JobStep>
}

function PickupForm({ job: j, base }: { job: PartnerJob; base: string }) {
  const { vehicle } = usePartnerApp()
  const navigate = useNavigate()
  const confirm = useConfirmPickup(j.reference)
  const fileRef = useRef<HTMLInputElement>(null)
  const [checks, setChecks] = useState({ loaded: false, closed: false, receipt: false })
  const [photo, setPhoto] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  if (jobDeliveryType(j, vehicle) !== 'keke') return <Navigate to={`${base}/jobs/${j.reference}/loading`} replace />
  // The cans are unknown until the backend sends them (#21); then only the litres show.
  const cans = j.choice?.delivery_type === 'keke' ? j.choice : null
  const count = cans?.can_count ?? null
  const litres = cans ? cans.can_size_litres * cans.can_count : j.quantity_litres
  const allLoaded = count === null ? 'All the cans are loaded' : `All ${count} cans are loaded`

  function pick(file: File | undefined) {
    setProblem(file ? readPickupPhoto(file, setPhoto) : null)
  }

  function submit() {
    if (!checks.loaded) return setProblem(`Tick "${allLoaded}" before you leave the station.`)
    confirm.mutate(
      { loaded: true, receipt: checks.receipt, photo_url: photo, gallons_loaded: null },
      { onSuccess: () => navigate(`${base}/jobs/${j.reference}/customer`) },
    )
  }

  const rows: { key: keyof typeof checks; label: string }[] = [
    { key: 'loaded', label: allLoaded },
    // Design said "Cans are clean and sealed": no sealed cans yet and no quality claims (decision 15).
    { key: 'closed', label: 'Cans are closed for the trip' },
    { key: 'receipt', label: 'Station gave me the water receipt' },
  ]

  return (
    <MobileShell>
      <TopBar left={<BackLink to={`${base}/jobs/${j.reference}/refill`} />} right={<StepChip>At station</StepChip>} />
      <ScrollArea className="gap-3">
        <ScreenHeading className="rise-1" title="Confirm water pickup" sub={`Order ${j.reference} · ${j.station.name}`} />
        <div className="rise-2 flex items-center gap-3 rounded-card border-[1.5px] border-solid border-[#F7D98B] bg-[#FFF7E2] p-3.5">
          <div className="flex-1">
            <div className="text-[13px] font-bold text-[#6B5210]">Have you collected the water?</div>
            {cans && (
              <div className="text-[20px] font-extrabold">
                {cans.can_size_litres} L × {cans.can_count} cans
              </div>
            )}
            <div className={cans ? 'text-caption text-[#6B5210]' : 'text-[20px] font-extrabold'}>{describeQuantity(litres)}{cans ? ' in total' : ''}</div>
          </div>
          <Illustration name="keke" className="animate-drive w-[118px]" />
        </div>
        <Card className="rise-3 px-3.5 py-1.5">
          {rows.map((r, i) => {
            const on = checks[r.key]
            return (
              <button
                key={r.key}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => {
                  setChecks((c) => ({ ...c, [r.key]: !c[r.key] }))
                  setProblem(null)
                }}
                className={cx(
                  'flex min-h-[54px] w-full cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left text-[14.5px] font-semibold text-ink',
                  i < rows.length - 1 && 'border-b border-solid border-hairline',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    'flex size-6 shrink-0 items-center justify-center rounded-[8px] border-2 border-solid transition-colors duration-200',
                    on ? 'border-[#16A34A] bg-[#16A34A]' : 'border-radio-line bg-white',
                  )}
                >
                  {on && <CheckIcon size={14} strokeWidth={3.4} color="#fff" roundJoin={false} />}
                </span>
                {r.label}
              </button>
            )
          })}
        </Card>
        <div className="rise-4">
          <span className="mb-1.5 block text-label font-bold">
            Photo <span className="font-normal text-mute">(optional)</span>
          </span>
          <div className="grid grid-cols-2 gap-2.5">
            {photo ? (
              <div className="relative flex h-[120px] items-center justify-center overflow-hidden rounded-option bg-[linear-gradient(160deg,#D4ECEF,#8CCBD8)]">
                <img src={photo} alt="Photo of the loaded keke" className="size-full object-cover" />
                <Chip tone="green" className="absolute bottom-2 left-2">
                  Added
                </Chip>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex h-[120px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-option border-2 border-dashed border-blink bg-[#F4F9FF] text-[13px] font-bold text-primary"
            >
              <CameraIcon size={26} />
              {photo ? 'Change photo' : 'Add photo'}
            </button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => pick(e.target.files?.[0])} />
          </div>
        </div>
      </ScrollArea>
      <Footer>
        {problem && <Notice tone="error">{problem}</Notice>}
        {confirm.isError && <Notice tone="error">{errorMessage(confirm.error)}</Notice>}
        <Button onClick={submit} loading={confirm.isPending}>
          Confirm pickup
        </Button>
        <Link to={`${base}/issue?ref=${j.reference}&type=station_problem`} className="p-1.5 text-center text-sub font-bold text-primary no-underline hover:text-primary-dark">
          Report a problem at the station
        </Link>
      </Footer>
    </MobileShell>
  )
}

/** Step 2: go to the customer (`r-customer`). */
export function CustomerStep() {
  const { base } = usePartnerApp()
  return (
    <JobStep stage="collected" step="customer">
      {(j) => {
        const eta = j.remaining ?? (j.customer.distance_km !== null && j.customer.minutes !== null ? { distance_km: j.customer.distance_km, minutes: j.customer.minutes } : null)
        return (
          <MobileShell>
            <TopBar left={<BackLink to={base} />} right={<StepChip>Step 2 of 2</StepChip>} />
            <ScrollArea className="gap-3">
              <ScreenHeading className="rise-1" title="Almost there!" sub="Water collected. Head to the customer." />
              <Card className="rise-2 flex items-center gap-3 px-3.5 py-3">
                <IconBadge tone="red">
                  <MapPinIcon size={22} />
                </IconBadge>
                <div className="flex-1">
                  <div className="font-extrabold">{j.customer.name}</div>
                  {j.customer.landmark && <div className="text-caption text-mute">{j.customer.landmark}</div>}
                </div>
                {eta && (
                  <div className="text-right">
                    <div className="font-extrabold text-primary">{eta.minutes} min</div>
                    <div className="text-chip text-mute">{eta.distance_km} km</div>
                  </div>
                )}
              </Card>
              <MapFrame height={330} className="rise-3">
                <CustomerMapArt />
                <Illustration
                  name="keke"
                  alt="Your keke"
                  className="animate-drive absolute top-[57%] left-[32.8%] w-[82px] drop-shadow-[0_6px_8px_rgba(10,37,64,0.25)]"
                />
                <MapPin color="#DC2626" ringColor="rgba(220,38,38,.35)" ringSize={20} className="absolute top-[15%] left-[71%]" />
                {eta && <MapBadge className="right-3 bottom-3.5 text-[14px]">{eta.minutes} min away</MapBadge>}
              </MapFrame>
              <Card className="rise-4 flex items-center gap-3 px-3.5 py-3">
                <Avatar name={j.customer.contact_name ?? j.customer.area} tone="plain" />
                <div className="flex-1">
                  <div className="font-extrabold">{j.customer.contact_name ?? j.customer.area}</div>
                  <div className="text-caption text-mute">{j.instructions?.split('.')[0] ?? 'Call when you are close'}</div>
                </div>
                {j.customer.phone && (
                  <>
                    <a href={`sms:${j.customer.phone}`} aria-label="Message customer" className="mo-ib mo-ib-soft">
                      <MessageSquareIcon size={20} />
                    </a>
                    <a href={`tel:${j.customer.phone}`} aria-label="Call customer" className="mo-ib bg-green-bg text-green hover:text-green">
                      <PhoneIcon size={20} />
                    </a>
                  </>
                )}
              </Card>
            </ScrollArea>
            <Footer>
              <ExternalButton href={directionsUrl(placeAddress(j.customer))}>
                <NavigationIcon size={20} filled />
                Start navigation
              </ExternalButton>
              <ArriveButton reference={j.reference} />
            </Footer>
          </MobileShell>
        )
      }}
    </JobStep>
  )
}
