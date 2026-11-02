import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ErrorBlock, LoadingBlock } from '../../../components/layout/StateScreens'
import { DataTable, MiniButton } from '../../../components/ui/Admin'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { SampleTag } from '../../../components/ui/Chip'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { Pills } from '../../../components/ui/Controls'
import { TextField } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import type { AdminPayment } from '../../../domain/admin'
import { errorMessage } from '../../../lib/api/errorMessage'
import { PARTNER_PAY_ENABLED } from '../../../lib/features'
import { formatShortDate } from '../../../lib/format/datetime'
import { formatNaira } from '../../../lib/format/money'
import * as api from '../adminApi'
import { METHOD_LABEL, MONEY_TABS } from '../adminFormat'
import { AdminFrame, LinkTabs, PageHead, PaymentChip, StatusChip } from '../AdminParts'
import { useAdminMutation, useCustomer, usePayments } from '../queries'

const FILTERS: { value: api.PaymentFilter; label: string }[] = [
  { value: 'to_verify', label: 'To verify' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'paid', label: 'Paid' },
  { value: 'refunds', label: 'Refunds' },
  { value: 'all', label: 'All' },
]

/**
 * Payments (added; a-pricing "Payouts and payments" tab). Staff confirm
 * payments here (pay on delivery, transfers they checked: FR-040, BR-07), and
 * pay refunds as Waterline points (Terms §7: no cash refunds). `?customer=`
 * shows one customer's records (from Customers → Payment records).
 */
export function Payments() {
  const [params, setParams] = useSearchParams()
  const customerId = params.get('customer') ?? ''
  const [filter, setFilter] = useState<api.PaymentFilter>(customerId ? 'all' : 'to_verify')
  const list = usePayments(filter, customerId)
  const customer = useCustomer(customerId || null)
  const [refunding, setRefunding] = useState<string | null>(null)
  // The payment waiting for "Mark paid" / "Confirm transfer" to be confirmed in the dialog.
  const [marking, setMarking] = useState<AdminPayment | null>(null)
  const confirm = useAdminMutation((reference: string) => api.confirmPayment(reference))

  return (
    <AdminFrame searchPlaceholder="Search orders, customers, riders">
      <PageHead title="Pricing, points and payouts" sub="Payment status is kept apart from delivery status." actions={<SampleTag>SAMPLE AMOUNTS</SampleTag>} />
      <LinkTabs className="rise-2" label="Money settings" tabs={MONEY_TABS} />
      <div className="rise-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-[20px] font-extrabold">Customer payments</h2>
        {PARTNER_PAY_ENABLED && (
          <Link to="/admin/earnings" className="text-[14px] font-bold text-primary no-underline hover:text-primary-dark">
            Rider payouts →
          </Link>
        )}
      </div>
      {customerId && (
        <Notice>
          Showing payments for <b>{customer.data?.name ?? 'this customer'}</b>.{' '}
          <button type="button" onClick={() => setParams({}, { replace: true })} className="hit-44 cursor-pointer border-0 bg-transparent p-0 font-bold text-primary">
            Show everyone
          </button>
        </Notice>
      )}
      <Pills
        label="Filter payments"
        value={filter}
        onChange={setFilter}
        options={FILTERS.map((f) => ({ value: f.value, label: `${f.label}${list.data ? ` (${list.data.counts[f.value]})` : ''}` }))}
      />
      {confirm.isError && <Notice tone="error">{errorMessage(confirm.error)}</Notice>}
      {list.isPending && <LoadingBlock label="Loading payments" />}
      {list.isError && <ErrorBlock error={list.error} onRetry={() => list.refetch()} />}
      {list.isSuccess && (
        <Card className="overflow-x-auto px-1 py-1.5">
          <DataTable<AdminPayment>
            caption="Customer payments"
            rows={list.data.payments}
            rowKey={(p) => p.reference}
            empty="Nothing here."
            columns={[
              { header: 'Order', cell: (p) => <Link to={`/admin/orders?ref=${p.reference}`} className="font-extrabold text-primary-dark no-underline hover:underline">{p.reference}</Link> },
              { header: 'Customer', cell: (p) => p.customer_name },
              { header: 'Date', cell: (p) => formatShortDate(p.created_at) },
              { header: 'Amount', cell: (p) => (p.amount_minor_units === null ? 'Quote' : formatNaira(p.amount_minor_units)) },
              { header: 'Method', cell: (p) => METHOD_LABEL[p.method] },
              { header: 'Payment', cell: (p) => <PaymentChip status={p.status} /> },
              { header: 'Delivery', cell: (p) => <StatusChip status={p.order_status} /> },
              {
                header: 'Action',
                cell: (p) =>
                  (p.status === 'awaiting_verification' || p.status === 'unpaid') && p.order_status !== 'cancelled' ? (
                    <MiniButton disabled={confirm.isPending} onClick={() => setMarking(p)}>
                      {p.status === 'awaiting_verification' ? 'Confirm transfer' : 'Mark paid'}
                    </MiniButton>
                  ) : p.status === 'refund_due' ? (
                    <MiniButton tone="alt" onClick={() => setRefunding(p.reference)}>
                      Refund as points
                    </MiniButton>
                  ) : (
                    <span className="text-mute">None</span>
                  ),
              },
            ]}
          />
        </Card>
      )}
      {refunding && <RefundForm reference={refunding} onDone={() => setRefunding(null)} />}
      <ConfirmDialog
        open={marking !== null}
        tone="primary"
        title={marking?.status === 'awaiting_verification' ? `Confirm the transfer for ${marking.reference}?` : `Mark ${marking?.reference ?? ''} as paid?`}
        confirmLabel={marking?.status === 'awaiting_verification' ? 'Confirm transfer' : 'Mark as paid'}
        loading={confirm.isPending}
        onCancel={() => setMarking(null)}
        onConfirm={() => marking && confirm.mutate(marking.reference, { onSettled: () => setMarking(null) })}
      >
        {marking && (
          <>
            <b className="text-ink">
              {marking.customer_name}, {marking.amount_minor_units === null ? 'quote' : formatNaira(marking.amount_minor_units)}
            </b>
            . Only do this once the money has reached us. The customer is told, and it is saved in the audit log.
          </>
        )}
      </ConfirmDialog>
      <p className="m-0 text-caption text-mute">
        Mark paid only after the money is received (pay on delivery collected, transfer seen in the bank). Each confirmation is saved in the audit log and the customer is told.
      </p>
    </AdminFrame>
  )
}

function RefundForm({ reference, onDone }: { reference: string; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const refund = useAdminMutation(() => api.refundAsPoints(reference, reason))
  return (
    <Card className="flex max-w-[640px] flex-col gap-3 p-4">
      <h3 className="m-0 text-[16px] font-extrabold">Refund {reference.slice(0, 7)} as points</h3>
      <p className="m-0 text-caption text-mute">We do not give cash refunds (Terms §7). The amount becomes Waterline points at the current rule (SAMPLE: 1 point = ₦1 off).</p>
      <TextField label="Reason (saved in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Order cancelled after a bank transfer" />
      {refund.isError && <Notice tone="error">{errorMessage(refund.error)}</Notice>}
      <div className="flex gap-2">
        <Button size="sm" block={false} className="px-5" loading={refund.isPending} onClick={() => refund.mutate(undefined, { onSuccess: onDone })}>
          Pay refund as points
        </Button>
        <Button variant="line" size="sm" block={false} className="px-5" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </Card>
  )
}
