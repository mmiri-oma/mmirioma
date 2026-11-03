import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDownIcon, ChevronRightIcon, DocumentLinesIcon, MapPinIcon, StarIcon } from '../../../components/icons/icons'
import { MobileShell, ScrollArea } from '../../../components/layout/MobileShell'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../../../components/layout/StateScreens'
import { CardLink } from '../../../components/ui/Card'
import { ActionTile, IconBadge, SectionHeader, TextLink } from '../../../components/ui/Content'
import { ButtonLink } from '../../../components/ui/Button'
import { isActiveStage, STAGE_LABEL, type CustomerOrder, type DeliveryStage } from '../../../domain/orders'
import { cx } from '../../../lib/cx'
import { POINTS_ENABLED } from '../../../lib/features'
import { useSession } from '../../auth/useSession'
import { ArtDefs, TankerArt } from '../../marketing/landing/Art'
import { useSupportContact } from '../../marketing/queries'
import '../../marketing/waterline.css'
import { HomeAppCard } from '../../pwa/PushParts'
import { CustomerTabs, CustomerTopBar } from '../components/CustomerChrome'
import { RecentOrderCard, StageChip } from '../components/OrderBits'
import { VerifyPhoneBanner } from '../components/VerifyPhoneBanner'
import { useOrderDraft } from '../order/orderDraftContext'
import { draftFromOrder } from '../order/reorder'
import { deliveryWindowText, orderLink, orderPlaceLabel, orderPriceText, orderQuantityText } from '../orderHelpers'
import { useAddresses, useOrders, usePoints, useProfile } from '../queries'

type Vehicle = 'keke' | 'tanker'

/** "Good morning" before noon, "Good afternoon" before 5 PM, else "Good evening" (the phone's local time). */
function greeting(now = new Date()): string {
  const h = now.getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

/**
 * Where an active order is on its way to the gate, as four steps for the bar
 * on the live order card. The words on the card are always the server's stage
 * label (STAGE_LABEL); the bar only shows how far along that is, and never
 * claims a rider before one has accepted (FR-027, FR-032).
 */
const STAGE_STEP: Partial<Record<DeliveryStage, number>> = {
  request_received: 0,
  awaiting_confirmation: 0,
  waiting_rider: 1,
  rider_assigned: 2,
  picked_up: 2,
  on_the_way: 3,
}
const STEP_LABELS = ['Placed', 'Confirmed', 'Rider set', 'On the way'] as const

/**
 * Customer home (`c-home`), Waterline design. Built so a customer can see
 * what is happening and order in as few taps as possible:
 *
 * 1. a live order, if there is one, is the first thing on the screen;
 * 2. otherwise their last order is one tap away ("Order again"), priced again
 *    on the review screen before they confirm;
 * 3. new orders start from what they are filling (drums or a tank), with a
 *    "Help me choose" sheet for anyone unsure, instead of a vehicle name.
 *
 * No price appears here: prices come from the server once there is an
 * address (FR-022, FR-023). Payment is cash after unloading (FR-040, pilot).
 */
export function Home() {
  const navigate = useNavigate()
  const { reset } = useOrderDraft()
  const profile = useProfile()
  const addresses = useAddresses()
  const orders = useOrders()
  const points = usePoints()
  const [helpOpen, setHelpOpen] = useState(false)

  const session = useSession()
  // The name also comes with the session (`GET /auth/me`), so the greeting
  // works before the customer profile endpoint exists (#82).
  const firstName = (profile.data?.name ?? session.data?.user.name ?? '').split(' ')[0]
  const defaultAddress = addresses.data?.find((a) => a.is_default) ?? addresses.data?.[0]
  const latest = orders.data?.[0]
  const active = orders.data?.find((o) => isActiveStage(o.stage))

  function startOrder(type: Vehicle) {
    reset({ delivery_type: type })
    navigate(type === 'keke' ? '/order/keke' : '/order/tanker')
  }

  function reorder() {
    if (latest) {
      reset(draftFromOrder(latest, addresses.data ?? []))
      navigate('/order/review')
    } else {
      navigate('/order')
    }
  }

  return (
    <MobileShell>
      <ArtDefs />
      <CustomerTopBar />
      <ScrollArea className="app-wide gap-4">
        <VerifyPhoneBanner from="/home" />

        {/* Phone: one column. Laptop: ordering on the left, shortcuts and recent orders on the right. */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:items-start lg:gap-8">
        <div className="flex min-w-0 flex-col gap-4">
        <div className="rise-1">
          <p className="m-0 text-[13px] font-semibold text-mute">{greeting()}</p>
          <h1 className="m-0 font-display text-[30px] leading-[1.05] font-semibold tracking-[-0.02em]">{firstName ? `${firstName}.` : 'Welcome.'}</h1>
        </div>

        {defaultAddress ? (
          <CardLink to="/order/details" className="rise-1 flex items-center gap-3 px-3.5 py-2.5">
            <IconBadge tone="blue" size={36} radius={11}>
              <MapPinIcon size={20} />
            </IconBadge>
            <span className="flex flex-1 flex-col leading-[1.3]">
              <span className="text-chip text-mute">Delivering to · {defaultAddress.label}</span>
              <span className="text-[14.5px] font-bold">{defaultAddress.address}</span>
            </span>
            <ChevronDownIcon size={18} strokeWidth={2.2} color="#56677D" roundJoin={false} />
          </CardLink>
        ) : (
          addresses.isSuccess && (
            <CardLink to="/addresses/new" className="rise-1 flex items-center gap-3 px-3.5 py-2.5">
              <IconBadge tone="blue" size={36} radius={11}>
                <MapPinIcon size={20} />
              </IconBadge>
              <span className="flex flex-1 flex-col leading-[1.3]">
                <span className="text-chip text-mute">Delivering to</span>
                <span className="text-[14.5px] font-bold">Add your delivery address</span>
              </span>
              <ChevronRightIcon size={18} strokeWidth={2.2} color="#56677D" roundJoin={false} />
            </CardLink>
          )
        )}

        {active ? <LiveOrderCard order={active} /> : latest && <OrderAgainCard order={latest} onReorder={reorder} />}

        <section aria-labelledby="home-order-title" className="rise-2 flex flex-col gap-3">
          <div className="flex items-end justify-between gap-3">
            <h2 id="home-order-title" className="m-0 text-[17px] font-extrabold">
              {active ? 'Need more water?' : 'What are you filling?'}
            </h2>
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="hit-44 cursor-pointer border-0 bg-transparent p-0 text-[13.5px] font-bold text-primary underline decoration-[1.5px] underline-offset-[3px] hover:text-primary-dark"
            >
              Help me choose
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NeedCard
              onClick={() => startOrder('keke')}
              title="Drums & jerrycans"
              sub="By keke · 25 L or 50 L cans · 300 to 3,000 litres"
              art={
                <svg viewBox="0 0 196 124" className="h-auto w-[92%]" aria-hidden="true">
                  <use href="#wl-keke" />
                </svg>
              }
            />
            <NeedCard
              onClick={() => startOrder('tanker')}
              title="A water tank"
              sub="By tanker · 500 to 1,000 gallons (2,000 to 4,000 L) or custom"
              art={
                <div className="w-full">
                  <TankerArt label="" />
                </div>
              }
            />
          </div>
          <p className="m-0 flex items-center gap-2 text-caption text-mute">
            <span aria-hidden="true" className="size-2 shrink-0 -rotate-45 rounded-[50%_0_50%_50%] bg-[#1D8BA6]" />
            You see the full price before you confirm. Pay cash after your water is poured.
          </p>
        </section>
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-[96px]">
        <div className={cx('rise-3 grid gap-2.5', POINTS_ENABLED ? 'grid-cols-3' : 'grid-cols-2')}>
          <ActionTile to="/addresses" icon={<IconBadge tone="green"><MapPinIcon size={22} /></IconBadge>} label="Addresses" />
          {POINTS_ENABLED && (
            <ActionTile
              to="/points"
              icon={<IconBadge tone="gold"><StarIcon size={22} filled /></IconBadge>}
              label={points.data ? `${points.data.balance} pts` : 'Points'}
            />
          )}
          <ActionTile to="/orders" icon={<IconBadge tone="violet"><DocumentLinesIcon size={22} /></IconBadge>} label="My orders" />
        </div>

        <HomeAppCard app="customer" className="rise-4" />

        <SectionHeader className="mt-0.5" title="Recent orders" action={<TextLink to="/orders" className="text-sub">View all</TextLink>} />
        {orders.isPending && <LoadingBlock lines={1} label="Loading your orders" />}
        {orders.isError && <ErrorBlock error={orders.error} onRetry={() => orders.refetch()} />}
        {orders.isSuccess &&
          (latest ? (
            <RecentOrderCard order={latest} />
          ) : (
            <EmptyBlock
              title="No orders yet"
              text="Your orders will show here."
              action={<ButtonLink to="/order" variant="alt">Order water</ButtonLink>}
            />
          ))}
        </div>
        </div>
      </ScrollArea>
      <CustomerTabs current="/home" />
      {helpOpen && (
        <HelpMeChoose
          onClose={() => setHelpOpen(false)}
          onPick={(v) => {
            setHelpOpen(false)
            startOrder(v)
          }}
        />
      )}
    </MobileShell>
  )
}

/** One of the two ways to order, named by what the customer fills rather than by vehicle. */
function NeedCard({ onClick, title, sub, art }: { onClick: () => void; title: string; sub: string; art: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex min-h-[200px] cursor-pointer flex-col lg:min-h-[260px] overflow-hidden rounded-card border border-solid border-card-line bg-[#E6F3F5] px-3 pt-4 pb-3.5 text-left text-ink transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-card"
    >
      <span className="flex h-[86px] items-center justify-center lg:h-[130px]">{art}</span>
      <span className="mt-auto text-[17px] leading-[1.15] font-extrabold">{title}</span>
      <span className="mt-1 text-chip font-semibold text-primary-dark">{sub}</span>
      <span className="absolute top-2.5 right-2.5 flex size-8 items-center justify-center rounded-full bg-white shadow-[0_4px_10px_rgba(12,39,51,0.12)] transition-transform duration-200 group-hover:translate-x-0.5">
        <ChevronRightIcon size={16} strokeWidth={2.6} color="#11708C" roundJoin={false} />
      </span>
    </button>
  )
}

/**
 * The order on its way, at the top of home. Shows the server's stage label,
 * a four-step bar, the agreed delivery window when there is one (never an
 * ETA), and the delivery-code reminder.
 */
function LiveOrderCard({ order }: { order: CustomerOrder }) {
  const step = STAGE_STEP[order.stage] ?? 0
  const deliveryWindow = deliveryWindowText(order)
  return (
    <section aria-label="Your order on its way" className="rise-2 rounded-card bg-ink p-4 text-white">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-bold tracking-[0.12em] text-[#5CC6D4] uppercase">Your order</span>
        <StageChip stage={order.stage} />
      </div>
      <p className="mt-2.5 mb-0 font-display text-[22px] leading-[1.15] font-semibold">{STAGE_LABEL[order.stage]}</p>
      <p className="mt-1 mb-0 text-[13.5px] text-white/75">
        {orderQuantityText(order, 'short')} · {orderPlaceLabel(order)}
      </p>
      <ol className="m-0 mt-3.5 grid list-none grid-cols-4 gap-1.5 p-0" aria-label={`Step ${step + 1} of 4`}>
        {STEP_LABELS.map((label, i) => (
          <li key={label} className="flex flex-col gap-1.5">
            <span className={cx('h-1.5 rounded-full', i <= step ? 'bg-[#5CC6D4]' : 'bg-white/15')} />
            <span className={cx('text-[11px] font-semibold', i <= step ? 'text-white' : 'text-white/50')}>{label}</span>
          </li>
        ))}
      </ol>
      {deliveryWindow && (
        <p className="mt-3 mb-0 text-[13px] text-white/80">
          Delivery window: <b className="text-white">{deliveryWindow.day}, {deliveryWindow.times}</b>
        </p>
      )}
      <p className="mt-3 mb-0 rounded-[12px] bg-white/8 px-3 py-2.5 text-[13px] leading-[1.45] text-white/85">
        When the water is in, we text you a 6-digit delivery code. Check your water first, then give the code to your rider.
      </p>
      <Link
        to={orderLink(order)}
        className="mt-3.5 flex min-h-12 items-center justify-center rounded-button bg-white text-[15px] font-bold text-ink no-underline hover:bg-[#E6F3F5] hover:text-ink"
      >
        Track this order
      </Link>
    </section>
  )
}

/** The customer's last order, one tap from ordering again. The old total is labelled as last time's; review prices it again. */
function OrderAgainCard({ order, onReorder }: { order: CustomerOrder; onReorder: () => void }) {
  return (
    <section aria-label="Order again" className="rise-2 flex items-center gap-3.5 rounded-card border border-solid border-card-line bg-white p-4 shadow-tile">
      <span className="flex-1">
        <span className="block text-[12px] font-bold tracking-[0.12em] text-primary-dark uppercase">Same as last time?</span>
        <span className="mt-1 block text-[15.5px] font-extrabold">{orderQuantityText(order, 'short')}</span>
        <span className="block text-[13px] text-mute">
          {orderPlaceLabel(order)} · Last time {orderPriceText(order)}
        </span>
      </span>
      <button
        type="button"
        onClick={onReorder}
        className="min-h-12 shrink-0 cursor-pointer rounded-button border-0 bg-ink px-4 text-[14.5px] font-bold text-white hover:bg-primary-dark"
      >
        Order again
      </button>
    </section>
  )
}

const HELP_CHOICES: { label: string; sub: string; pick: Vehicle | 'call' }[] = [
  { label: 'Drums, buckets or a few containers', sub: 'A keke brings 25 L or 50 L cans and pours them in.', pick: 'keke' },
  { label: 'A ground tank or an overhead tank', sub: 'A tanker pumps straight into your tank.', pick: 'tanker' },
  { label: 'Not sure, or something bigger', sub: 'Call us and we will tell you what fits.', pick: 'call' },
]

/**
 * "Help me choose": a small sheet that turns what the customer wants to fill
 * into keke or tanker. A suggestion only; every order is checked by the team.
 * A native modal `<dialog>` keeps focus inside and closes on Escape.
 */
function HelpMeChoose({ onClose, onPick }: { onClose: () => void; onPick: (v: Vehicle) => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const support = useSupportContact()
  // Open as a modal once mounted; closing (Escape, backdrop, buttons) unmounts it through `onClose`.
  useEffect(() => {
    const dialog = ref.current
    if (!dialog || dialog.open) return
    // Older browsers (and jsdom) without showModal still get the sheet, just not as a modal.
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
  }, [])
  return (
    <dialog
      ref={ref}
      aria-labelledby="help-choose-title"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-0 mt-auto w-full max-w-none rounded-t-[28px] border-0 bg-white p-0 text-ink backdrop:bg-[rgba(12,39,51,0.45)] sm:m-auto sm:max-w-[420px] sm:rounded-[28px]"
    >
      <div className="animate-sheet flex flex-col gap-3 px-5 pt-3 pb-[max(20px,env(safe-area-inset-bottom))]">
        <span aria-hidden="true" className="mx-auto mb-1 h-1 w-10 rounded-full bg-line" />
        <h2 id="help-choose-title" className="m-0 font-display text-[24px] font-semibold">
          What do you want to fill?
        </h2>
        {HELP_CHOICES.map((c) =>
          c.pick === 'call' ? (
            <a key={c.label} href={`tel:${support.phone}`} className="rounded-option border border-solid border-card-line p-3.5 text-ink no-underline hover:border-primary hover:text-ink">
              <b className="block text-[15px]">{c.label}</b>
              <span className="text-[13px] text-mute">{c.sub}</span>
            </a>
          ) : (
            <button
              key={c.label}
              type="button"
              onClick={() => onPick(c.pick as Vehicle)}
              className="cursor-pointer rounded-option border border-solid border-card-line bg-white p-3.5 text-left text-ink hover:border-primary"
            >
              <b className="block text-[15px]">{c.label}</b>
              <span className="text-[13px] text-mute">{c.sub}</span>
            </button>
          ),
        )}
        <button type="button" onClick={onClose} className="mt-1 min-h-11 cursor-pointer border-0 bg-transparent text-[14px] font-bold text-primary-dark">
          Close
        </button>
      </div>
    </dialog>
  )
}
