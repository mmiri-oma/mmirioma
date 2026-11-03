import { Link } from 'react-router-dom'
import { Illustration } from '../../../components/brand/Illustration'
import { DropletIcon, WalletOutlineIcon } from '../../../components/icons/icons'
import { BackLink, MobileShell, ScrollArea, TopBar, TopBarSpacer, TopBarTitle } from '../../../components/layout/MobileShell'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../../../components/layout/StateScreens'
import { Card } from '../../../components/ui/Card'
import { Chip, SampleTag } from '../../../components/ui/Chip'
import { IconBadge, SectionTitle } from '../../../components/ui/Content'
import { shortReference } from '../../../domain/orders'
import { litresFromGallons } from '../../../domain/quantity'
import type { PartnerEarnings } from '../../../domain/partner'
import { formatNaira } from '../../../lib/format/money'
import { relativeWhen } from '../jobHelpers'
import { usePartnerApp } from '../partnerContext'
import { useEarnings, usePartnerProfile } from '../queries'

type Row =
  | { kind: 'trip'; key: string; at: string; title: string; amount: number; status: 'pending' | 'completed' }
  | { kind: 'payout'; key: string; at: string; amount: number; status: 'requested' | 'paid' }

/** Trips and payouts in one list, newest first. */
function recentRows(e: PartnerEarnings): Row[] {
  const trips: Row[] = e.entries.map((x) => ({
    kind: 'trip',
    key: `t-${x.reference}-${x.at}`,
    at: x.at,
    title: `${shortReference(x.reference)} · ${x.label}`,
    amount: x.amount_minor_units,
    status: x.status,
  }))
  const payouts: Row[] = e.payouts.map((p) => ({ kind: 'payout', key: `p-${p.id}`, at: p.at, amount: p.amount_minor_units, status: p.status }))
  return [...trips, ...payouts].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

/** Tanker earnings and payouts (`t-earnings`). All amounts are SAMPLE (decision 16). */
export function DriverEarnings() {
  const { base } = usePartnerApp()
  const earnings = useEarnings()
  const profile = usePartnerProfile()
  const e = earnings.data
  const account = profile.data?.payout_account_ending
  const rows = e ? recentRows(e) : []

  return (
    <MobileShell>
      <TopBar left={<BackLink to={base} />} center={<TopBarTitle>My earnings</TopBarTitle>} right={<TopBarSpacer />} />
      <ScrollArea className="gap-3">
        {earnings.isPending && <LoadingBlock />}
        {earnings.isError && <ErrorBlock error={earnings.error} onRetry={() => earnings.refetch()} />}
        {e && (
          <>
            <div className="rise-1 relative overflow-hidden rounded-hero bg-[linear-gradient(135deg,#0C2733_0%,#14532D_60%,#15803D_100%)] p-[18px] text-white">
              <Illustration name="tanker" className="absolute right-[-40px] bottom-[-6px] w-[190px] opacity-25" />
              <div className="relative flex items-center justify-between">
                <span className="text-[13px] font-bold text-[#BBF7D0]">Wallet balance</span>
                {e.is_sample && <SampleTag />}
              </div>
              <div className="relative text-[34px] font-extrabold tracking-[-1px]">{formatNaira(e.wallet_minor_units)}</div>
              <div className="relative text-caption text-[#DCFCE7]">
                {account ? `Pays out to your bank account · ending ${account}` : 'No bank account on file yet'}
              </div>
              <Link
                to={`${base}/earnings/withdraw`}
                className="relative mt-3 inline-flex h-[42px] items-center rounded-input bg-white px-[18px] font-extrabold text-[#14532D] no-underline hover:text-[#14532D]"
              >
                Request payout
              </Link>
            </div>
            <div className="rise-2 grid grid-cols-3 gap-2">
              <Stat label="This week" value={formatNaira(e.week_minor_units)} />
              <Stat label="Trips" value={String(e.trips_this_week)} />
              <Stat label={`Gallons · ${litresFromGallons(e.gallons_this_week).toLocaleString('en-NG')} L`} value={e.gallons_this_week.toLocaleString('en-NG')} />
            </div>
            <SectionTitle className="rise-3">Recent trips</SectionTitle>
            {rows.length === 0 ? (
              <EmptyBlock illustration="tanker" title="No trips yet" text="Your trips and payouts show here." />
            ) : (
              <Card className="rise-3 px-3.5 py-1">
                {rows.map((r) => (
                  <div key={r.key} className="mo-li">
                    <IconBadge tone={r.kind === 'trip' ? 'green' : 'violet'} size={36}>
                      {r.kind === 'trip' ? <DropletIcon size={18} /> : <WalletOutlineIcon size={18} />}
                    </IconBadge>
                    <div className="flex-1">
                      <div className="text-[13.5px] font-bold">{r.kind === 'trip' ? r.title : 'Payout to bank'}</div>
                      <div className="text-chip text-mute">{relativeWhen(r.at)}</div>
                    </div>
                    <div className="flex flex-col items-end gap-[3px]">
                      {r.kind === 'trip' ? (
                        <>
                          <span className="font-extrabold">{formatNaira(r.amount)}</span>
                          <Chip tone={r.status === 'completed' ? 'green' : 'amber'} className="px-[7px] py-0.5 text-[11px]">
                            {r.status === 'completed' ? 'Completed' : 'Pending'}
                          </Chip>
                        </>
                      ) : (
                        <>
                          <span className="font-extrabold text-[#6D28D9]">−{formatNaira(r.amount)}</span>
                          <Chip tone={r.status === 'paid' ? 'violet' : 'amber'} className="px-[7px] py-0.5 text-[11px]">
                            {r.status === 'paid' ? 'Paid out' : 'Requested'}
                          </Chip>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </Card>
            )}
          </>
        )}
      </ScrollArea>
    </MobileShell>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3">
      <div className="text-[11.5px] text-mute">{label}</div>
      <div className="text-[17px] font-extrabold">{value}</div>
    </Card>
  )
}
