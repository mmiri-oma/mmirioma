import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Illustration } from '../../../components/brand/Illustration'
import { ErrorBlock, LoadingBlock } from '../../../components/layout/StateScreens'
import { DataTable } from '../../../components/ui/Admin'
import { Avatar } from '../../../components/ui/Avatar'
import { Button, ButtonLink } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { RadioRow } from '../../../components/ui/Choice'
import { Chip } from '../../../components/ui/Chip'
import { KeyValue } from '../../../components/ui/Content'
import { Pills } from '../../../components/ui/Controls'
import { Notice } from '../../../components/ui/Notice'
import { isHoldDecisionLabel, type AdminOrder, type AdminOrderFilter, type EligibleRider } from '../../../domain/admin'
import { choiceLitres, describeChoice, type WaterChoice } from '../../../domain/orders'
import { describeQuantity } from '../../../domain/quantity'
import { errorMessage } from '../../../lib/api/errorMessage'
import { USE_MOCKS } from '../../../lib/api/mode'
import { ORDER_FOR_CUSTOMER_ENABLED, PAYMENTS_PAGE_ENABLED } from '../../../lib/features'
import { formatDateTime, formatTime } from '../../../lib/format/datetime'
import { formatNaira } from '../../../lib/format/money'
import { formatPhone } from '../../../lib/format/phone'
import * as api from '../adminApi'
import { ConfirmCard } from '../confirm/ConfirmOrder'
import { ConfirmedSummary } from '../confirm/ConfirmedSummary'
import { CancelDialog, FailDialog } from '../hold/EndDelivery'
import { DecidedCard, HoldBanner, HoldChip } from '../hold/HoldParts'
import { HoldSheet } from '../hold/HoldSheet'
import { backendStatusFor, canCancel, canFail, cancelDriverState } from '../hold/logic'
import { holdSummary, METHOD_LABEL, notReadyToAssign, revealDetail, showsPaymentChip } from '../adminFormat'
import { AdminFrame, PageHead, PaymentChip, SplitLayout, StatusChip } from '../AdminParts'
import { adminKeys, useAdminMutation, useAdminOrder, useAdminOrders, useEligibleRiders } from '../queries'

const FILTERS: { value: AdminOrderFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'awaiting_confirmation', label: 'Awaiting confirmation' },
  { value: 'awaiting_rider', label: 'Awaiting rider' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'failed', label: 'Delivery failed' },
  { value: 'cancelled', label: 'Cancelled' },
]

/**
 * Orders and rider assignment (`a-orders`). Selecting a row opens the side
 * panel: assign or reassign a rider while the water has not been collected,
 * the order's details, and cancel (the CANCEL dialog of the hold review). `?ref=` selects an order and
 * `?q=` searches (links from the dashboard and header search).
 */
export function Orders() {
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState<AdminOrderFilter>('all')
  const query = params.get('q') ?? ''
  const list = useAdminOrders(filter, query)
  const orders = list.data?.orders ?? []
  const picked = params.get('ref')
  const created = params.get('created')
  const selected =
    picked ??
    orders.find((o) => o.status === 'awaiting_confirmation')?.reference ??
    orders.find((o) => o.status === 'awaiting_rider')?.reference ??
    orders[0]?.reference ??
    null

  function select(reference: string) {
    const next = new URLSearchParams(params)
    next.set('ref', reference)
    setParams(next, { replace: true })
  }

  function open(reference: string) {
    select(reference)
    revealDetail()
  }

  return (
    <AdminFrame
      searchPlaceholder="Search by order number, customer or phone"
      onSearch={(q) => {
        const next = new URLSearchParams(params)
        if (q) next.set('q', q)
        else next.delete('q')
        next.delete('ref')
        setParams(next, { replace: true })
      }}
    >
      <SplitLayout
        sideWidth="lg:w-[380px]"
        main={
          <>
            <PageHead
              title="Orders"
              sub={query ? `Results for “${query}”. Confirm new orders, then assign a rider.` : 'Confirm new orders, then assign a rider.'}
              actions={
                ORDER_FOR_CUSTOMER_ENABLED && (
                  <ButtonLink to="/admin/orders/new" size="sm" block={false}>
                    + Create order for a customer
                  </ButtonLink>
                )
              }
            />
            {created && (
              <Notice tone="success">
                Order {created} created and offered to eligible riders. Select it below to assign someone instead.
              </Notice>
            )}
            <Pills
              className="rise-2"
              label="Filter orders"
              value={filter}
              onChange={setFilter}
              options={FILTERS.map((f) => ({ value: f.value, label: `${f.label}${list.data ? ` (${list.data.counts[f.value]})` : ''}` }))}
            />
            {list.isPending && <LoadingBlock label="Loading orders" />}
            {list.isError && <ErrorBlock error={list.error} onRetry={() => list.refetch()} />}
            {list.isSuccess && (
              <Card className="rise-3 overflow-x-auto px-1 py-1.5">
                <DataTable<AdminOrder>
                  caption="Orders"
                  rows={orders}
                  rowKey={(o) => o.reference}
                  selectedKey={selected ?? undefined}
                  empty={query ? 'No orders match your search.' : 'No orders here yet.'}
                  columns={[
                    {
                      header: 'Order',
                      cell: (o) => (
                        <button type="button" onClick={() => open(o.reference)} className="hit-44 cursor-pointer border-0 bg-transparent p-0 font-extrabold text-primary-dark">
                          {o.reference}
                        </button>
                      ),
                    },
                    { header: 'Customer', cell: (o) => o.customer_name },
                    { header: 'Area', cell: (o) => o.area ?? <span className="text-mute">No area</span> },
                    { header: 'Type', cell: (o) => (o.choice ? (o.choice.delivery_type === 'keke' ? 'Keke' : 'Tanker') : <span className="text-mute">Not recorded</span>), className: 'font-bold' },
                    { header: 'Quantity', cell: (o) => (o.choice ? <QuantityCell choice={o.choice} /> : o.quantity) },
                    // The order list sends no payment status: it shows on the order (payments.md).
                    { header: 'Payment', cell: (o) => (o.payment.status ? showsPaymentChip(o) && <PaymentChip status={o.payment.status} /> : <span className="text-mute">On the order</span>) },
                    {
                      header: 'Status',
                      cell: (o) => (
                        <>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusChip status={o.status} />
                            {o.hold && <HoldChip />}
                          </div>
                          {o.hold && <div className="mt-1 text-chip text-mute">{holdSummary(o.hold)}</div>}
                        </>
                      ),
                    },
                    { header: 'Rider', cell: (o) => o.partner?.name ?? <span className="text-mute">None yet</span> },
                  ]}
                />
              </Card>
            )}
            <p className="m-0 text-caption text-mute">Payment status and delivery status are tracked separately.{USE_MOCKS ? ' Sample data.' : ''}</p>
          </>
        }
        side={selected ? <OrderPanel key={selected} reference={selected} onChange={() => select(selected)} /> : null}
      />
    </AdminFrame>
  )
}

/**
 * Side panel for one order: assign, details, cancel. `onChange` pins the
 * order in the address first, so the panel stays on it after the list
 * changes (otherwise it would jump to the next waiting order).
 */
/** Quantity on two short lines so the table stays narrow: "25 L × 24" over "600 L · 150 gal". */
function QuantityCell({ choice }: { choice: WaterChoice }) {
  const litres = choiceLitres(choice)
  const main =
    choice.delivery_type === 'keke'
      ? `${choice.can_size_litres} L × ${choice.can_count}`
      : choice.tank_size_gallons === null
        ? 'Custom size'
        : `${choice.tank_size_gallons.toLocaleString('en-NG')} gal`
  const units = litres === null ? null : choice.delivery_type === 'keke' ? describeQuantity(litres, 'litres', 'short') : `${litres.toLocaleString('en-NG')} L`
  return (
    <>
      <div className="whitespace-nowrap">{main}</div>
      {units && <div className="text-chip whitespace-nowrap text-mute">{units}</div>}
    </>
  )
}

/** The dispatcher picks the water source in the confirm sheet, so before confirmation there is none to show. */
function stationFallback(status: AdminOrder['status']): string {
  return status === 'awaiting_confirmation' ? 'Chosen when you confirm the order' : 'Not recorded'
}

function OrderPanel({ reference, onChange }: { reference: string; onChange: () => void }) {
  const order = useAdminOrder(reference)
  // The toast after confirming (admin-confirm-order.md, Q4) or deciding a hold (admin-hold-review.md, decision 13).
  const [confirmed, setConfirmed] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [failing, setFailing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const qc = useQueryClient()
  const o = order.data
  if (order.isPending) return <Card className="p-4"><LoadingBlock lines={3} label="Loading the order" /></Card>
  if (order.isError || !o) return <Card className="p-4"><ErrorBlock error={order.error} onRetry={() => order.refetch()} /></Card>
  const notReady = notReadyToAssign(o)
  // No assign or reassign on a held order: the job is stopped and waits for a decision (admin-hold-review.md, R0).
  const canAssign = !notReady && !o.hold && (o.status === 'awaiting_rider' || o.status === 'assigned' || o.status === 'loading')
  const closed = o.status === 'delivered' || o.status === 'cancelled'
  // Pin the order in the address before an action that ends or changes it opens: the list refreshes when the action lands, and with no ?ref= the panel would move to another waiting order and lose its toast (#176, #209).
  const pinThen = (open: () => void) => () => {
    onChange()
    open()
  }
  // After a decision: who decided, when and the note, from the history line (no open hold any more).
  const decided = o.hold ? undefined : [...o.timeline].reverse().find((t) => isHoldDecisionLabel(t.label))
  return (
    <>
      {confirmed && <Notice tone="success">{confirmed}</Notice>}
      {/* Not confirmed yet: confirm first; no rider can be assigned (Q0). */}
      {o.status === 'awaiting_confirmation' && (
        <ConfirmCard
          reference={o.reference}
          onConfirmed={(message) => {
            onChange()
            setConfirmed(message)
          }}
        />
      )}
      {!USE_MOCKS && o.status !== 'awaiting_confirmation' && <ConfirmedSummary reference={o.reference} />}
      {o.status !== 'awaiting_confirmation' && (
        <Card className="rise-2 flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="m-0 text-[20px] font-extrabold">{notReady ? 'Not ready to assign' : o.status === 'awaiting_rider' ? 'Assign a rider' : canAssign ? 'Reassign the rider' : 'Order details'}</h2>
            <StatusChip status={o.status} />
          </div>
          {o.hold && <HoldBanner hold={o.hold} driverName={o.partner?.name ?? null} onReview={pinThen(() => setReviewing(true))} />}
          {decided && <DecidedCard entry={decided} />}
          <div className="flex items-center gap-3 rounded-card bg-[linear-gradient(160deg,#EEF6FF,#DCEBFD)] px-3.5 py-3">
            <Illustration name={o.choice?.delivery_type ?? 'drop-hero'} className="w-24 shrink-0" />
            <div className="min-w-0">
              <div className="font-extrabold">{o.reference}</div>
              <div className="text-caption text-slate">
                {o.choice ? `${o.choice.delivery_type === 'keke' ? 'Keke' : 'Tanker'} · ${describeChoice(o.choice)}` : o.quantity}
              </div>
              <div className="text-caption text-slate">
                {o.customer_name} · {o.area ?? 'No area'}
              </div>
            </div>
          </div>
          {o.partner && (
            <KeyValue
              label={o.status === 'assigned' ? 'Assigned to' : o.status === 'delivered' ? 'Delivered by' : 'Rider'}
              value={
                <span>
                  {o.partner.code ? `${o.partner.name} · ${o.partner.code}` : o.partner.name}
                  {o.status === 'assigned' && <span className="block text-right text-chip text-mute">Waiting for them to start</span>}
                </span>
              }
            />
          )}
          {canAssign && <AssignRiders order={o} onBefore={onChange} />}
          {notReady && <Notice>Waiting for the customer's payment to be verified. A rider can be assigned once this order is confirmed.</Notice>}
          {o.status === 'on_the_way' && (
            <Notice>The water is on its way with {o.partner?.name ?? 'the rider'}. To change anything now, use Support (for example, confirm the delivery if the code fails).</Notice>
          )}
        </Card>
      )}
      <Card className="flex flex-col gap-1 p-4 text-[13.5px]">
        <h3 className="m-0 mb-1 text-[15px] font-extrabold">Details</h3>
        <KeyValue label="Customer" value={`${o.customer_name} · ${formatPhone(o.customer_phone)}`} />
        <KeyValue label="Deliver to" value={o.address} />
        {o.landmark && <KeyValue label="Landmark" value={o.landmark} />}
        <KeyValue label="Station" value={o.station_name || stationFallback(o.status)} />
        {/* Only mock amounts are samples; a real price comes from the server (FR-022). */}
        <KeyValue label="Amount" value={o.total_minor_units === null ? 'Quote needed' : `${formatNaira(o.total_minor_units)}${USE_MOCKS ? ' (SAMPLE)' : ''}`} />
        <KeyValue
          label="Payment"
          value={
            <span className="flex items-center justify-end gap-2">
              {METHOD_LABEL[o.payment.method]} {showsPaymentChip(o) && o.payment.status && <PaymentChip status={o.payment.status} />}
            </span>
          }
        />
        {o.instructions && <KeyValue label="Instructions" value={o.instructions} />}
        {o.tank_note && <KeyValue label="Tank" value={o.tank_note} />}
        <h3 className="m-0 mt-2 mb-1 text-[15px] font-extrabold">Timeline</h3>
        <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
          {o.timeline.map((t, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
              {/* The detail on its own line: confirmation lines are long (#136, Q5). */}
              <span className="min-w-0">
                <b>{t.label}</b> · {formatTime(t.at)}
                {t.detail && <span className="block text-mute">{t.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-1 mb-0 text-chip text-mute">Placed {formatDateTime(o.created_at)}</p>
      </Card>
      {/* FAIL from an accepted order with no hold: a rejected proof can end in a failed delivery, and nothing else on the page does it (admin-hold-review.md, decision 5). */}
      {!closed && !o.hold && canFail(o) && (
        <Button variant="line-danger" size="sm" onClick={pinThen(() => setFailing(true))}>
          Fail this delivery
        </Button>
      )}
      {canCancel(o) && (
        <Button variant="line-danger" size="sm" onClick={pinThen(() => setCancelling(true))}>
          Cancel this order
        </Button>
      )}
      {/* No hold_id from the entry: the server closes every open hold on cancel, and the dialog says which (decision 5). */}
      {cancelling && (
        <CancelDialog
          reference={o.reference}
          expectedStatus={backendStatusFor(o)}
          hold={null}
          openHold={o.hold}
          driver={cancelDriverState(o)}
          onClose={() => setCancelling(false)}
          onDone={(message) => {
            setCancelling(false)
            onChange()
            setConfirmed(message)
          }}
          onRefresh={() => {
            setCancelling(false)
            void qc.invalidateQueries({ queryKey: adminKeys.all })
          }}
        />
      )}
      {failing && (
        <FailDialog
          reference={o.reference}
          expectedStatus={backendStatusFor(o)}
          hold={null}
          onClose={() => setFailing(false)}
          onDone={(message) => {
            setFailing(false)
            onChange()
            setConfirmed(message)
          }}
          onRefresh={() => {
            setFailing(false)
            void qc.invalidateQueries({ queryKey: adminKeys.all })
          }}
        />
      )}
      {reviewing && o.hold && (
        <HoldSheet
          reference={o.reference}
          customer={{ name: o.customer_name, phone: o.customer_phone }}
          onClose={() => setReviewing(false)}
          onDecided={(message) => {
            setReviewing(false)
            onChange()
            setConfirmed(message)
          }}
        />
      )}
      {o.payment.status === 'awaiting_verification' && (
        <Notice tone="note">
          This customer's transfer is waiting for a check.
          {PAYMENTS_PAGE_ENABLED && (
            <>
              {' '}
              <Link to="/admin/payments" className="font-bold text-primary no-underline hover:text-primary-dark">
                Go to payments
              </Link>
            </>
          )}
        </Notice>
      )}
    </>
  )
}

function AssignRiders({ order, onBefore }: { order: AdminOrder; onBefore: () => void }) {
  const riders = useEligibleRiders(order.reference, true)
  // The mutation takes the whole rider, so the notice can name them from
  // `assign.variables`: the eligible list refetches after the assign and no
  // longer contains them (#143).
  const assign = useAdminMutation((rider: EligibleRider) => api.assignOrder(order.reference, rider.id))
  const [pick, setPick] = useState<string | null>(null)
  const list = riders.data ?? []
  const chosen = list.find((r) => r.id === (pick ?? list[0]?.id))
  const kind = order.choice ? (order.choice.delivery_type === 'keke' ? 'Keke riders' : 'tanker drivers') : 'partners'

  if (assign.isSuccess && !assign.isPending) {
    return <Notice tone="success">Assigned. {assign.variables.name.split(' ')[0]} gets the order on their dashboard and must start it or decline with a reason.</Notice>
  }
  return (
    <>
      <h3 className="m-0 text-[14px] font-extrabold">Eligible {kind}</h3>
      {riders.isPending && <LoadingBlock lines={2} label="Finding riders" />}
      {riders.isError && <ErrorBlock error={riders.error} onRetry={() => riders.refetch()} />}
      {riders.isSuccess && list.length === 0 && (
        <Notice>No approved {kind} can take this order right now (vehicle, tank size or an earlier decline). It stays in the pool.</Notice>
      )}
      <div role="radiogroup" aria-label={`Eligible ${kind}`} className="flex flex-col gap-2">
        {list.map((r) => (
          <RadioRow key={r.id} checked={chosen?.id === r.id} onSelect={() => setPick(r.id)}>
            <Avatar name={r.name} size={38} />
            <span className="min-w-0 flex-1">
              <span className="block font-extrabold">{r.name}</span>
              <span className="block text-caption text-mute">
                {/* No vehicle word when the server does not say Keke or tanker (#16). */}
                {[r.vehicle && (r.vehicle === 'keke' ? 'Keke' : 'Tanker'), r.rating !== null && `★ ${r.rating}`, `${r.active_orders} active ${r.active_orders === 1 ? 'order' : 'orders'}`]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {r.works_in_area && <span className="block text-chip font-bold text-green">Works in {order.area}</span>}
            </span>
            <Chip tone={r.online ? 'green' : 'gray'}>{r.online ? 'Online' : 'Offline'}</Chip>
          </RadioRow>
        ))}
      </div>
      {assign.isError && <Notice tone="error">{errorMessage(assign.error)}</Notice>}
      {chosen && (
        <Button
          loading={assign.isPending}
          onClick={() => {
            onBefore()
            assign.mutate(chosen)
          }}
        >
          Assign {chosen.name.split(' ')[0]}
        </Button>
      )}
      <p className="m-0 text-caption text-mute">Assigning removes the order from other riders' lists. The action is saved in the audit log.</p>
    </>
  )
}
