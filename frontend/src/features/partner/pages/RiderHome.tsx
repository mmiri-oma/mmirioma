import { Link, useParams } from 'react-router-dom'
import { Illustration } from '../../../components/brand/Illustration'
import { CheckIcon, ChevronRightIcon, ClockIcon, CurrencyIcon, WalletIcon } from '../../../components/icons/icons'
import { MobileShell, ScrollArea } from '../../../components/layout/MobileShell'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../../../components/layout/StateScreens'
import { Card, CardLink } from '../../../components/ui/Card'
import { Chip } from '../../../components/ui/Chip'
import { IconBadge, ScreenHeading, SectionHeader, TextLink, type IconBadgeTone } from '../../../components/ui/Content'
import { HomeAppCard } from '../../pwa/PushParts'
import { ToggleKnob } from '../../../components/ui/Controls'
import { Notice } from '../../../components/ui/Notice'
import { errorMessage } from '../../../lib/api/errorMessage'
import { cx } from '../../../lib/cx'
import { formatNaira } from '../../../lib/format/money'
import { AssignedSheet } from '../components/AssignedSheet'
import { PartnerHomeTopBar, PartnerTabs } from '../components/PartnerChrome'
import { VerifyPhoneNotice } from '../components/VerifyPhoneNotice'
import { greeting } from '../greeting'
import { PARTNER_PAY_ENABLED } from '../../../lib/features'
import { deliveredToday, jobQuantity, placeAddress, tripMinutes } from '../jobHelpers'
import { jobStepPath, usePartnerApp } from '../partnerContext'
import { HomeCashCard } from '../cash/CashParts'
import { useActiveJobs, useAvailableJobs, useEarnings, useHistory, usePartnerProfile, useSetOnline } from '../queries'

/** Rider dashboard with the online switch (`r-home`), plus the assigned-order sheet (`r-assigned`). */
export function RiderHome() {
  const { reference } = useParams()
  const { base } = usePartnerApp()
  const profile = usePartnerProfile()
  const earnings = useEarnings(PARTNER_PAY_ENABLED)
  // Partner pay is out of the MVP (#157): "Completed" counts today's delivered jobs from the history.
  const history = useHistory(!PARTNER_PAY_ENABLED)
  const trips = (n: number) => `${n} trip${n === 1 ? '' : 's'}`
  const completedToday = PARTNER_PAY_ENABLED
    ? earnings.data ? trips(earnings.data.deliveries_today) : '…'
    : history.data ? trips(deliveredToday(history.data)) : history.isError ? '–' : '…'
  const active = useActiveJobs()
  const available = useAvailableJobs()
  const setOnline = useSetOnline()

  const p = profile.data
  const assigned = active.data?.find((j) => j.stage === 'assigned' && (!reference || j.reference === reference))
  const inProgress = active.data?.find((j) => j.stage === 'accepted' || j.stage === 'collected')
  const first = available.data?.[0]
  const approved = p?.approval === 'approved'
  const online = Boolean(p?.online)

  return (
    <MobileShell>
      <PartnerHomeTopBar />
      <ScrollArea className="gap-3">
        {profile.isPending && <LoadingBlock />}
        {profile.isError && <ErrorBlock error={profile.error} onRetry={() => profile.refetch()} />}
        {p && (
          <>
            <ScreenHeading
              className="rise-1"
              titleClassName="text-[22px]"
              title={`${greeting()}, ${p.name.split(' ')[0]}!`}
              sub={`Keke rider · ${p.service_areas.join(' and ')} area`}
            />
            <VerifyPhoneNotice from={base} className="rise-2" />
            {!approved ? (
              <Notice tone={p.approval === 'suspended' ? 'error' : 'note'} className="rise-2">
                {p.approval === 'suspended' ? (
                  <>
                    <b>Your account is suspended.</b> You cannot get new orders. Contact admin to find out why.
                  </>
                ) : (
                  <>
                    <b>Waiting for approval.</b> Admin checks your vehicle and papers before you can go online.{' '}
                    <Link to={`${base}/vehicle`} className="font-bold text-primary no-underline hover:text-primary-dark">
                      Upload your papers
                    </Link>
                  </>
                )}
              </Notice>
            ) : (
              <button
                type="button"
                aria-pressed={online}
                disabled={setOnline.isPending}
                onClick={() => setOnline.mutate(!online)}
                className={cx(
                  'rise-2 flex w-full cursor-pointer items-center gap-3 rounded-stat border-[1.5px] border-solid px-4 py-3.5 text-ink transition-colors duration-[250ms]',
                  online ? 'border-[#86EFAC] bg-[#E7F9EE]' : 'border-line bg-white',
                )}
              >
                <span className={cx('size-3 shrink-0 rounded-full', online ? 'glow bg-green-solid' : 'bg-[#CBD5E1]')} aria-hidden="true" />
                <span className="flex flex-1 flex-col text-left">
                  <span className="text-[16px] font-extrabold">{online ? 'You are online' : 'You are offline'}</span>
                  <span className="text-caption text-slate">
                    {online ? 'New Keke orders near you will show up here' : 'Go online to see and accept orders'}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className={cx('relative h-[30px] w-[52px] shrink-0 rounded-[15px] transition-colors duration-[250ms]', online ? 'bg-green-solid' : 'bg-[#CBD5E1]')}
                >
                  <span className={cx('absolute top-0 left-0 transition-transform duration-[250ms]', online && 'translate-x-[2px]')}>
                    <ToggleKnob checked={online} />
                  </span>
                </span>
              </button>
            )}
            {setOnline.isError && <Notice tone="error">{errorMessage(setOnline.error)}</Notice>}
            {/* K2 home card: only while cash is on hand (driver-cash.md). */}
            <HomeCashCard base={base} />

            <div className="rise-3 grid grid-cols-2 gap-2.5">
              {PARTNER_PAY_ENABLED && (
                <Stat tone="green" icon={<CurrencyIcon size={16} strokeWidth={2.2} roundJoin={false} />} label="Today's earnings" value={earnings.data ? formatNaira(earnings.data.today_minor_units) : '…'} />
              )}
              <Stat tone="blue" icon={<CheckIcon size={16} strokeWidth={2.4} roundJoin={false} />} label="Completed" value={completedToday} />
              <Stat tone="gold" icon={<ClockIcon size={16} strokeWidth={2.2} roundJoin={false} />} label="Active order" value={String(active.data?.filter((j) => j.stage !== 'assigned').length ?? 0)} />
              {PARTNER_PAY_ENABLED && (
                <Stat to={`${base}/earnings`} tone="violet" icon={<WalletIcon size={16} />} label="Wallet" value={earnings.data ? formatNaira(earnings.data.wallet_minor_units) : '…'} />
              )}
            </div>

            {inProgress && (
              <Link
                to={jobStepPath(base, inProgress)}
                className="rise-4 relative flex items-center gap-3 overflow-hidden rounded-stat bg-[linear-gradient(120deg,#0E4A5A,#11708C)] px-3.5 py-3 text-white no-underline hover:text-white"
              >
                <Illustration name="keke" className="animate-drive w-[70px]" />
                <span className="flex flex-1 flex-col">
                  <span className="text-chip font-bold text-[#D4ECEF]">ACTIVE DELIVERY</span>
                  <span className="font-extrabold">
                    {inProgress.reference} · {jobQuantity(inProgress, 'short')}
                  </span>
                  <span className="text-caption text-[#DCEBFD]">
                    {inProgress.stage === 'accepted' ? `Go to ${inProgress.station.name}` : `Head to ${placeAddress(inProgress.customer).split(',')[0]}`}
                  </span>
                </span>
                <ChevronRightIcon size={20} strokeWidth={2.4} color="#fff" roundJoin={false} />
              </Link>
            )}

            <HomeAppCard app="partner" className="rise-4" />

            <SectionHeader
              className="rise-5"
              title={`Available orders (${available.data?.length ?? 0})`}
              action={<TextLink to={`${base}/orders`} className="text-sub">View all</TextLink>}
            />
            {available.isPending && <LoadingBlock lines={1} label="Loading orders" />}
            {available.isError && <ErrorBlock error={available.error} onRetry={() => available.refetch()} />}
            {available.isSuccess && !first && (
              <EmptyBlock
                illustration="keke"
                title={!approved ? 'No orders yet' : online ? 'No orders right now' : 'You are offline'}
                text={!approved ? 'Orders show here once admin approves you.' : online ? 'New orders near you will show up here.' : 'Go online to see orders near you.'}
              />
            )}
            {first && (
              <CardLink to={`${base}/orders/${first.reference}`} className="rise-5 flex gap-3 p-3.5">
                <div className="flex-1">
                  <div className="flex items-center gap-2.5">
                    <span className="font-extrabold">{jobQuantity(first)}</span>
                    <Chip className="px-2 py-[3px]">Keke</Chip>
                  </div>
                  <div className="mt-1.5 flex flex-col gap-[3px] text-caption text-mute">
                    {first.station.distance_km !== null && first.customer.distance_km !== null && (
                      <span>
                        Station {first.station.distance_km} km · Customer {first.customer.distance_km} km
                      </span>
                    )}
                    <span>
                      {tripMinutes(first) !== null ? `About ${tripMinutes(first)} min · ` : ''}
                      {first.customer.area}, Enugu
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end justify-between">
                  {first.earning_minor_units !== null && (
                    <Chip tone="amber" className="text-[13px]">
                      {formatNaira(first.earning_minor_units)}
                    </Chip>
                  )}
                  <Illustration name="keke" className="w-[86px]" />
                </div>
              </CardLink>
            )}
          </>
        )}
      </ScrollArea>
      <PartnerTabs current="home" />
      {assigned && <AssignedSheet job={assigned} />}
    </MobileShell>
  )
}

function Stat({ tone, icon, label, value, to }: { tone: IconBadgeTone; icon: React.ReactNode; label: string; value: string; to?: string }) {
  const body = (
    <>
      <div className="flex items-center gap-2 text-caption text-mute">
        <IconBadge tone={tone} size={30} radius={9}>
          {icon}
        </IconBadge>
        {label}
      </div>
      <div className="mt-1.5 text-[22px] font-extrabold">{value}</div>
    </>
  )
  return to ? (
    <CardLink to={to} className="p-3.5">
      {body}
    </CardLink>
  ) : (
    <Card className="p-3.5">{body}</Card>
  )
}
