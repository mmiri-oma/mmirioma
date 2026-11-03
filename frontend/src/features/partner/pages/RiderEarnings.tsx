import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { DropletIcon } from '../../../components/icons/icons'
import { BackLink, Footer, MobileShell, ScrollArea, TopBar, TopBarSpacer, TopBarTitle } from '../../../components/layout/MobileShell'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../../../components/layout/StateScreens'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { Chip, SampleTag } from '../../../components/ui/Chip'
import { IconBadge } from '../../../components/ui/Content'
import { TextField } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import type { EarningEntry } from '../../../domain/partner'
import { errorMessage } from '../../../lib/api/errorMessage'
import { cx } from '../../../lib/cx'
import { formatNaira, nairaInputToKobo } from '../../../lib/format/money'
import { relativeWhen } from '../jobHelpers'
import { usePartnerApp } from '../partnerContext'
import { useEarnings, usePartnerProfile, useRequestPayout } from '../queries'

type Filter = 'all' | 'completed' | 'pending'

/** My earnings with the week chart (`r-earnings`). All amounts are SAMPLE. */
export function RiderEarnings() {
  const { base } = usePartnerApp()
  const earnings = useEarnings()
  const [filter, setFilter] = useState<Filter>('all')
  const e = earnings.data
  const max = e ? Math.max(1, ...e.week.map((w) => w.amount_minor_units)) : 1
  const list: EarningEntry[] = (e?.entries ?? []).filter((x) => filter === 'all' || x.status === filter)

  return (
    <MobileShell>
      <TopBar left={<BackLink to={base} />} />
      <ScrollArea className="gap-3">
        <h1 className="rise-1 m-0 text-title font-extrabold">My earnings</h1>
        {earnings.isPending && <LoadingBlock />}
        {earnings.isError && <ErrorBlock error={earnings.error} onRetry={() => earnings.refetch()} />}
        {e && (
          <>
            <div className="rise-2 relative overflow-hidden rounded-[22px] bg-[linear-gradient(135deg,#0C2733_0%,#0E4A5A_70%,#11708C_100%)] p-[18px] text-white">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-bold text-[#D4ECEF]">Wallet balance</span>
                {e.is_sample && <SampleTag />}
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-[32px] font-extrabold tracking-[-1px]">{formatNaira(e.wallet_minor_units)}</span>
                <Link
                  to={`${base}/earnings/withdraw`}
                  className="flex h-10 items-center rounded-input bg-white px-4 font-extrabold text-primary-dark no-underline hover:text-primary-dark"
                >
                  Withdraw
                </Link>
              </div>
              <div
                role="img"
                aria-label={`Earnings this week: ${e.week.map((w) => `${w.day} ${formatNaira(w.amount_minor_units)}`).join(', ')}`}
                className="mt-3.5 flex h-[74px] items-end gap-2.5"
              >
                {e.week.map((w, i) => {
                  const today = i === e.week.length - 1
                  return (
                    <div key={w.day + i} className="flex flex-1 flex-col items-center gap-1">
                      <span
                        className={cx('animate-grow-y w-full rounded-sample', today ? 'bg-gold' : 'bg-white/35')}
                        style={{ height: Math.max(4, Math.round((w.amount_minor_units / max) * 56)), animationDelay: `${i * 0.06}s` }}
                      />
                      <span className={cx('text-sample', today ? 'font-bold text-white' : 'text-[#D4ECEF]')}>{w.day}</span>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="rise-3 grid grid-cols-2 gap-2.5">
              <Card className="border-[#C8F0D6] bg-[#E7F9EE] px-3.5 py-3">
                <div className="text-caption text-slate">Today</div>
                <div className="text-[20px] font-extrabold">{formatNaira(e.today_minor_units)}</div>
              </Card>
              <Card className="px-3.5 py-3">
                <div className="text-caption text-mute">Deliveries today</div>
                <div className="text-[20px] font-extrabold">{e.deliveries_today}</div>
              </Card>
            </div>
            <div role="tablist" aria-label="Filter" className="rise-4 flex gap-2">
              {(['all', 'completed', 'pending'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="tab"
                  aria-selected={filter === f}
                  onClick={() => setFilter(f)}
                  className={cx(
                    'mo-pill hit-44 px-4 text-sub transition-colors duration-200',
                    filter === f ? 'border-0 bg-primary text-white' : 'border-[1.5px] border-solid border-line bg-white text-slate hover:border-primary hover:text-ink',
                  )}
                >
                  {f === 'all' ? 'All' : f === 'completed' ? 'Completed' : 'Pending'}
                </button>
              ))}
            </div>
            {list.length === 0 ? (
              <EmptyBlock illustration="keke" title="Nothing here yet" text="Your trips show here once delivered." />
            ) : (
              <Card className="rise-5 px-3.5 py-1">
                {list.map((x) => (
                  <div key={x.reference + x.at} className="mo-li">
                    <IconBadge tone="blue" size={36} radius={11}>
                      <DropletIcon size={18} />
                    </IconBadge>
                    <div className="flex-1">
                      <div className="text-sub font-bold">{x.reference}</div>
                      <div className="text-chip text-mute">{relativeWhen(x.at)}</div>
                    </div>
                    <div className="flex flex-col items-end gap-[3px]">
                      <span className="font-extrabold">{formatNaira(x.amount_minor_units)}</span>
                      <Chip tone={x.status === 'completed' ? 'green' : 'amber'} className="px-2 py-0.5 text-[11px]">
                        {x.status === 'completed' ? 'Completed' : 'Pending'}
                      </Chip>
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

const withdrawSchema = z.object({ amount: z.string().trim().min(1, 'Enter an amount.') })

/**
 * Ask for a payout to the bank account on file. Not in the handoff (the
 * Withdraw button had no screen); built from form patterns. Staff pay out;
 * the app only records the request. Amounts are whole naira, sent as kobo.
 */
export function WithdrawRequest() {
  const navigate = useNavigate()
  const { base, role } = usePartnerApp()
  const earnings = useEarnings()
  const profile = usePartnerProfile()
  const payout = useRequestPayout()
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors },
  } = useForm<z.infer<typeof withdrawSchema>>({ resolver: zodResolver(withdrawSchema) })
  const wallet = earnings.data?.wallet_minor_units ?? 0

  const onSubmit = handleSubmit((v) => {
    const kobo = nairaInputToKobo(v.amount)
    if (kobo === null || kobo <= 0) return setError('amount', { message: 'Enter whole naira, like 20,000.' })
    if (kobo > wallet) return setError('amount', { message: `You can withdraw up to ${formatNaira(wallet)}.` })
    payout.mutate(kobo, { onSuccess: () => setTimeout(() => navigate(`${base}/earnings`), 1500) })
  })

  const account = profile.data?.payout_account_ending
  return (
    <MobileShell>
      <TopBar left={<BackLink to={`${base}/earnings`} />} center={<TopBarTitle>Withdraw</TopBarTitle>} right={<TopBarSpacer />} />
      <ScrollArea className="gap-3">
        <Card pad className="rise-1">
          <div className="text-caption text-mute">Wallet balance</div>
          <div className="text-[28px] font-extrabold">{formatNaira(wallet)}</div>
          <div className="text-chip text-mute">{account ? `Pays out to your bank account ending ${account}` : 'No bank account on file yet'}</div>
        </Card>
        {!account && <Notice tone="error">Ask admin to add your bank account before you request a payout.</Notice>}
        <form id="withdraw-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
          <TextField
            className="rise-2"
            label="Amount (₦)"
            inputMode="numeric"
            placeholder="e.g. 20,000"
            hint="Whole naira only."
            error={errors.amount?.message}
            {...register('amount')}
          />
          <Button variant="alt" size="sm" block={false} className="self-start" onClick={() => setValue('amount', String(wallet / 100))}>
            Use full balance
          </Button>
          {payout.isSuccess && <Notice tone="success">Payout requested. Our team pays it into your account.</Notice>}
          {payout.isError && <Notice tone="error">{errorMessage(payout.error)}</Notice>}
        </form>
        <Notice className="rise-3">Sample wallet. {role === 'rider' ? 'Rider' : 'Driver'} pay and payout rules are not final.</Notice>
      </ScrollArea>
      <Footer>
        <Button type="submit" form="withdraw-form" disabled={!account || wallet <= 0} loading={payout.isPending}>
          Request payout
        </Button>
      </Footer>
    </MobileShell>
  )
}
