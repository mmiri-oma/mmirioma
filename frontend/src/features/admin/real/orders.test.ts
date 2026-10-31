import { describe, expect, it, vi } from 'vitest'
import detailSample from '../../../../../docs/api/examples/admin-order-detail.json'
import historySample from '../../../../../docs/api/examples/admin-order-history.json'
import pageSample from '../../../../../docs/api/examples/admin-orders-page.json'
import { ApiError, createApiClient } from '../../../lib/api/client'
import { parseDetail, type AdminOrderDetail, type AdminOrderEvent } from '../../../lib/api/adminDispatch'
import type { AdminOrderRead, Page } from '../../../lib/api/adminOrders'
import { adminOrderFromRead, adminStatusFromBackend, getOrder, listOrders, timelineFromHistory } from './orders'

/** The agreed contract's examples (docs/api/orders.md, deliveries.md). */
const DETAIL = detailSample as unknown as AdminOrderDetail
const PAGE = pageSample as unknown as Page<AdminOrderRead>
const ROW = PAGE.items[0]

const NOT_FOUND = { error: { code: 'order_not_found', message: 'Order not found', details: null } }
const FORBIDDEN = { error: { code: 'forbidden', message: 'Not allowed', details: null } }

/** A fetch that answers by URL, so parallel requests (the pill counts) get the right body. */
function clientByUrl(route: (url: string) => { body: unknown; status?: number }) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const { body, status = 200 } = route(String(input))
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  })
  return { fetch, client: createApiClient({ baseUrl: 'http://api.test', fetch }) }
}

const page = (items: AdminOrderRead[], total = items.length) => ({ items, total, limit: 100, offset: 0 })

describe('adminStatusFromBackend', () => {
  it('follows api-mapping.md, with failed and disputed as their own statuses', () => {
    // Not confirmed yet: no rider can be assigned (admin-confirm-order.md, decision 3).
    expect(adminStatusFromBackend('quote_requested')).toBe('awaiting_confirmation')
    expect(adminStatusFromBackend('awaiting_confirmation')).toBe('awaiting_confirmation')
    expect(adminStatusFromBackend('confirmed')).toBe('awaiting_rider')
    expect(adminStatusFromBackend('accepted')).toBe('assigned')
    expect(adminStatusFromBackend('departed')).toBe('loading')
    expect(adminStatusFromBackend('unloading')).toBe('on_the_way')
    expect(adminStatusFromBackend('failed')).toBe('failed')
    expect(adminStatusFromBackend('disputed')).toBe('disputed')
  })

  it('never hides an order with a status the app does not know', () => {
    expect(adminStatusFromBackend('rescheduling')).toBe('awaiting_rider')
  })
})

describe('adminOrderFromRead', () => {
  it('converts the detail example: live partner, source, confirmed price; nothing invented', () => {
    const order = adminOrderFromRead(DETAIL)
    expect(order.reference).toBe(DETAIL.reference)
    expect(order.status).toBe('assigned')
    // The server's status stays available where the design groups several (#144).
    expect(order.backend_status).toBe(DETAIL.status)
    expect(order.customer_name).toBe(DETAIL.customer.name)
    expect(order.partner).toEqual({ id: DETAIL.assignment!.driver.id, name: 'Sample Driver One', code: null, vehicle: null, plate: null })
    expect(order.assigned_by).toBe(DETAIL.assignment!.offered_by.name)
    expect(order.station_name).toBe('Sample Borehole A')
    expect(order.total_minor_units).toBe(4_500_000)
    // pending_collection shows as "Cash to collect" (decided on PR #92).
    expect(order.payment).toEqual({ method: 'pay_on_delivery', status: 'pending_collection' })
    expect(order.timeline).toEqual([{ label: 'Order placed', at: DETAIL.created_at }])
  })

  describe('the driver of an ended order (#243)', () => {
    const ended = (status: string, assignment: Partial<NonNullable<AdminOrderDetail['assignment']>>): AdminOrderDetail =>
      ({ ...DETAIL, status, assignment: { ...DETAIL.assignment!, responded_at: '2026-10-19T09:10:00Z', ended_at: '2026-10-19T11:00:00Z', ...assignment } }) as AdminOrderDetail
    const driver = { id: DETAIL.assignment!.driver.id, name: 'Sample Driver One', code: null, vehicle: null, plate: null }

    it('names the driver who delivered, from the completed assignment', () => {
      const order = adminOrderFromRead(ended('delivered', { status: 'completed' }))
      expect(order.status).toBe('delivered')
      expect(order.partner).toMatchObject({ id: driver.id, name: 'Sample Driver One' })
    })

    it('names the driver of a failed delivery, and of a cancelled job the driver had accepted', () => {
      expect(adminOrderFromRead(ended('failed', { status: 'completed' })).partner?.name).toBe('Sample Driver One')
      expect(adminOrderFromRead(ended('cancelled', { status: 'withdrawn' })).partner?.name).toBe('Sample Driver One')
    })

    it('names nobody for an offer never accepted, a decline, or an order back in the pool', () => {
      expect(adminOrderFromRead(ended('cancelled', { status: 'withdrawn', responded_at: null })).partner).toBeNull()
      expect(adminOrderFromRead(ended('cancelled', { status: 'declined', decline_reason: 'too_far' })).partner).toBeNull()
      expect(adminOrderFromRead(ended('confirmed', { status: 'withdrawn' })).partner).toBeNull()
    })
  })

  it('carries the open hold, and no hold as null (admin hold review, R0)', () => {
    const hold = { id: '9b2c4d6e-8f1a-4b3c-9d5e-6f7a8b9c0d1e', kind: 'proof_review' as const, since: '2026-10-20T08:48:00Z' }
    expect(adminOrderFromRead({ ...ROW, hold }).hold).toEqual(hold)
    expect(adminOrderFromRead({ ...ROW, hold: null }).hold).toBeNull()
    // A server that sends no hold field reads as none.
    const withoutHold: Partial<AdminOrderRead> = { ...ROW }
    delete withoutHold.hold
    expect(adminOrderFromRead(withoutHold as AdminOrderRead).hold).toBeNull()
  })

  it('shows a payment status without a label yet as no chip, never a guessed one', () => {
    expect(adminOrderFromRead({ ...DETAIL, payment: { ...DETAIL.payment!, status: 'partially_refunded' } }).payment.status).toBeNull()
  })

  it('shows a part-paid order as Part paid, from the cash design', () => {
    const order = adminOrderFromRead({ ...DETAIL, payment: { ...DETAIL.payment!, status: 'partially_paid' } })
    expect(order.payment.status).toBe('partially_paid')
  })

  it('shows an ended assignment as no partner', () => {
    const ended = { ...DETAIL, assignment: { ...DETAIL.assignment!, status: 'declined' as const } }
    expect(adminOrderFromRead(ended).partner).toBeNull()
  })

  it('maps an exact payment status, and a Keke choice when the order has one', () => {
    const order = adminOrderFromRead({
      ...DETAIL,
      payment: { ...DETAIL.payment!, status: 'paid' },
      delivery_type: 'keke',
      keke: { can_size_litres: 25, can_count: 24 },
      tanker: null,
      water_source: null,
      service_zone: { id: 'z1', name: 'Independence Layout' },
    })
    expect(order.payment.status).toBe('paid')
    expect(order.choice).toEqual({ delivery_type: 'keke', can_size_litres: 25, can_count: 24 })
    expect(order.area).toBe('Independence Layout')
    expect(order.tank_note).toBeNull()
  })

  it('keeps a list row honest: litres only, no area, payment status or partner', () => {
    const order = adminOrderFromRead({ ...ROW, delivery_type: null, keke: null, tanker: null, water_source: null, service_zone: null, quote: null })
    expect(order.choice).toBeNull()
    expect(order.quantity).toContain('L')
    expect(order.area).toBeNull()
    expect(order.payment.status).toBeNull()
    expect(order.partner).toBeNull()
    expect(order.station_name).toBeNull()
    expect(order.total_minor_units).toBeNull()
  })
})

describe('the driver on a list row (#204)', () => {
  const [unassigned, , assigned] = PAGE.items

  it('names the driver of a live assignment, without inventing a code, vehicle or plate', () => {
    expect(adminOrderFromRead(assigned).partner).toEqual({ id: assigned.driver!.id, name: 'Sample Driver One', code: null, vehicle: null, plate: null })
  })

  it('names the driver of a delivered order on the list row too (#243)', () => {
    const delivered = PAGE.items.find((i) => i.status === 'delivered')!
    expect(adminOrderFromRead(delivered).status).toBe('delivered')
    expect(adminOrderFromRead(delivered).partner).toMatchObject({ id: delivered.driver!.id, name: 'Sample Driver One' })
  })

  it('shows no partner for an order without a live driver (driver: null)', () => {
    expect(unassigned.driver).toBeNull()
    expect(adminOrderFromRead(unassigned).partner).toBeNull()
  })

  it('shows no partner when the server does not send the field, or sends a half-formed one', () => {
    const without: AdminOrderRead = { ...assigned }
    delete without.driver
    expect(adminOrderFromRead(without).partner).toBeNull()
    expect(adminOrderFromRead({ ...assigned, driver: { id: 'd1' } as never }).partner).toBeNull()
  })

  it('leaves the detail to its assignment: a declined one names nobody even if a row did', () => {
    const ended = { ...DETAIL, assignment: { ...DETAIL.assignment!, status: 'declined' as const } }
    expect(adminOrderFromRead(ended).partner).toBeNull()
  })

  it('carries the driver through listOrders, one row each', async () => {
    const { client } = clientByUrl((url) => ({ body: url.includes('limit=1&') ? page([], 3) : PAGE }))
    const list = await listOrders('all', undefined, client)
    expect(list.orders.map((o) => o.partner?.name ?? null)).toEqual([null, null, 'Sample Driver One', 'Sample Driver One'])
  })
})

describe('listOrders (real)', () => {
  it('loads the pill from the server and every pill count from its total', async () => {
    const { fetch, client } = clientByUrl((url) => {
      if (url.includes('limit=1&')) return { body: page([], url.includes('status=delivered') ? 7 : 3) }
      return { body: page([ROW]) }
    })
    const result = await listOrders('awaiting_rider', undefined, client)
    expect(result.orders.map((o) => o.reference)).toEqual([ROW.reference])
    expect(result.counts.delivered).toBe(7)
    expect(result.counts.all).toBe(3)
    const listCall = fetch.mock.calls.map((c) => String(c[0])).find((u) => u.includes('limit=100'))!
    expect(listCall).toContain('status=confirmed')
    expect(listCall).toContain('status=awaiting_payment')
    expect(listCall).not.toContain('status=quote_requested')
  })

  it('lists quote requests and priced orders under "Awaiting confirmation"', async () => {
    const { fetch, client } = clientByUrl(() => ({ body: page([ROW]) }))
    await listOrders('awaiting_confirmation', undefined, client)
    const listCall = fetch.mock.calls.map((c) => String(c[0])).find((u) => u.includes('limit=100'))!
    expect(listCall).toContain('status=quote_requested')
    expect(listCall).toContain('status=awaiting_confirmation')
    expect(listCall).not.toContain('status=confirmed')
  })

  it('lists held orders with on_hold=true, whatever their status, and counts them from the total', async () => {
    const { fetch, client } = clientByUrl((url) => {
      if (url.includes('limit=1&')) return { body: page([], url.includes('on_hold=true') ? 4 : 9) }
      return { body: page([ROW]) }
    })
    const result = await listOrders('on_hold', undefined, client)
    expect(result.counts.on_hold).toBe(4)
    const calls = fetch.mock.calls.map((c) => String(c[0]))
    const listCall = calls.find((u) => u.includes('limit=100'))!
    expect(listCall).toContain('on_hold=true')
    expect(listCall).not.toContain('status=')
    // The other pills never send it.
    expect(calls.filter((u) => u.includes('limit=1&') && !u.includes('on_hold=true')).length).toBe(6)
  })

  it('keeps an order on the "On hold" pill only while it has a hold (reference lookup)', async () => {
    const hold = { id: '9b2c4d6e-8f1a-4b3c-9d5e-6f7a8b9c0d1e', kind: 'source_review' as const, since: '2026-10-20T08:48:00Z' }
    const held = clientByUrl(() => ({ body: { ...DETAIL, hold } }))
    expect((await listOrders('on_hold', DETAIL.reference, held.client)).orders).toHaveLength(1)
    const free = clientByUrl(() => ({ body: { ...DETAIL, hold: null } }))
    expect((await listOrders('on_hold', DETAIL.reference, free.client)).orders).toHaveLength(0)
  })

  it('looks a reference up directly', async () => {
    const { fetch, client } = clientByUrl(() => ({ body: DETAIL }))
    const result = await listOrders('all', ` ${DETAIL.reference.toLowerCase()} `, client)
    expect(result.orders.map((o) => o.reference)).toEqual([DETAIL.reference])
    expect(String(fetch.mock.calls[0][0])).toBe(`http://api.test/api/v1/admin/orders/${DETAIL.reference}`)
  })

  it('treats an unknown reference as no match, not an error', async () => {
    const { client } = clientByUrl(() => ({ body: NOT_FOUND, status: 404 }))
    expect(await listOrders('all', 'MO-0000000000', client)).toEqual({
      orders: [],
      counts: { all: 0, awaiting_confirmation: 0, awaiting_rider: 0, in_progress: 0, on_hold: 0, delivered: 0, cancelled: 0 },
    })
  })

  it('matches other text against the newest orders only', async () => {
    const other = {
      ...ROW,
      reference: 'MO-ZZZZZZZZZZ',
      customer: { ...ROW.customer, name: 'Somebody Else', phone: '+2348099999999' },
      delivery_address: '9 Other Road, GRA, Enugu',
    }
    const { client } = clientByUrl(() => ({ body: page([ROW, other]) }))
    const result = await listOrders('all', ROW.customer.name, client)
    expect(result.orders.map((o) => o.reference)).toEqual([ROW.reference])
    expect(result.counts.all).toBe(1)
  })

  it('passes 403 forbidden through as an ApiError', async () => {
    const { client } = clientByUrl(() => ({ body: FORBIDDEN, status: 403 }))
    await expect(listOrders('all', undefined, client)).rejects.toMatchObject({ status: 403, code: 'forbidden' } satisfies Partial<ApiError>)
  })
})

describe('getOrder (real)', () => {
  it('loads and converts the detail', async () => {
    const { client } = clientByUrl(() => ({ body: DETAIL }))
    expect((await getOrder(DETAIL.reference, client)).station_name).toBe('Sample Borehole A')
  })

  it('adds the assignment events from the history, oldest first, in the contract wording', async () => {
    const { client } = clientByUrl((url) => ({ body: url.includes('/history') ? historySample : DETAIL }))
    const order = await getOrder(DETAIL.reference, client)
    expect(order.timeline).toEqual([
      { label: 'Order placed', at: DETAIL.created_at },
      { label: 'Offered to Sample Driver Two', at: '2026-10-19T08:31:00Z' },
      { label: 'Declined by Sample Driver Two', at: '2026-10-19T08:50:00Z', detail: 'Truck is at the mechanic.' },
      { label: 'Offered to Sample Driver One', at: '2026-10-19T09:05:00Z' },
    ])
  })

  it('words accepts and withdrawals, and leaves other events out', () => {
    const driver = { id: 'd1', name: 'Ada' }
    const event = (from: string | null, to: string | null, reason: string | null, withDriver = true) =>
      ({ id: 'e', kind: 'status_change', from_status: from, to_status: to, actor: null, reason_code: reason, note: null, created_at: '2026-10-19T10:00:00Z', assignment: withDriver ? { id: 'a', driver, decline_reason: null } : null, hold: null, confirmation: null, cash: null }) as AdminOrderEvent
    const lines = timelineFromHistory('2026-10-19T07:00:00Z', [
      event('accepted', 'confirmed', 'reassigned'),
      event('assigned', 'confirmed', 'reassigned'),
      event('assigned', 'accepted', null),
      event('awaiting_confirmation', 'confirmed', null, false),
    ]).map((t) => t.label)
    expect(lines).toEqual(['Order placed', 'Accepted by Ada', 'Offer to Ada withdrawn', 'Job withdrawn from Ada'])
  })

  it('shows a delivered order’s driver steps after Accepted, in order, with their times (#242)', () => {
    const driver = { id: 'd1', role: 'driver' as const, name: 'Ada' }
    const step = (from: string, to: string, at: string) =>
      ({ id: to, kind: 'status_change', from_status: from, to_status: to, actor: driver, reason_code: null, note: null, created_at: at, assignment: null, hold: null, confirmation: null, cash: null }) as AdminOrderEvent
    // Newest first, as the server sends them.
    const lines = timelineFromHistory('2026-10-20T07:00:00Z', [
      step('unloading', 'delivered', '2026-10-20T11:30:00Z'),
      step('arrived', 'unloading', '2026-10-20T11:10:00Z'),
      step('en_route', 'arrived', '2026-10-20T11:00:00Z'),
      step('collected', 'en_route', '2026-10-20T10:20:00Z'),
      step('departed', 'collected', '2026-10-20T10:00:00Z'),
      step('accepted', 'departed', '2026-10-20T09:30:00Z'),
      { ...step('assigned', 'accepted', '2026-10-20T09:00:00Z'), assignment: { id: 'a', driver, decline_reason: null } },
    ])
    expect(lines.map((t) => [t.label, t.at])).toEqual([
      ['Order placed', '2026-10-20T07:00:00Z'],
      ['Accepted by Ada', '2026-10-20T09:00:00Z'],
      ['Departed', '2026-10-20T09:30:00Z'],
      ['Collected', '2026-10-20T10:00:00Z'],
      ['En route', '2026-10-20T10:20:00Z'],
      ['Arrived', '2026-10-20T11:00:00Z'],
      ['Unloading', '2026-10-20T11:10:00Z'],
      ['Delivered', '2026-10-20T11:30:00Z'],
    ])
  })

  it('words the hold entries: "Hold opened" with who, the concern and the driver’s note, and the decision with who and the note (H)', () => {
    const driver = { id: 'd1', role: 'driver' as const, name: 'Ada' }
    const admin = { id: 'a1', role: 'admin' as const, name: 'Sample Dispatcher' }
    const entry = (kind: string, actor: typeof driver | typeof admin, note: string | null, category: string, decision: string | null, at: string) =>
      ({ id: kind + at, kind, from_status: null, to_status: null, actor, reason_code: null, note, created_at: at, assignment: null, hold: { id: 'h1', kind: 'proof_review', category, decision }, confirmation: null, cash: null }) as AdminOrderEvent
    // Newest first, as the server sends them.
    const lines = timelineFromHistory('2026-10-20T07:00:00Z', [
      entry('hold_decided', admin, 'The person who answered is not the customer.', 'alternative_proof', 'proof_rejected', '2026-10-20T09:31:00Z'),
      entry('hold_opened', driver, "Customer's phone is off.", 'alternative_proof', null, '2026-10-20T08:48:00Z'),
    ])
    expect(lines.slice(1)).toEqual([
      { label: 'Hold opened: Proof review', at: '2026-10-20T08:48:00Z', detail: `Ada · Alternative proof · "Customer's phone is off."` },
      { label: 'Proof rejected', at: '2026-10-20T09:31:00Z', detail: 'Sample Dispatcher · "The person who answered is not the customer."' },
    ])
  })

  it('shows the status change that ended the delivery, with who, why in words and the note; a hold it closed has no decision line (H)', () => {
    const admin = { id: 'a1', role: 'admin' as const, name: 'Sample Dispatcher' }
    const change = (to: string, reason: string | null, note: string | null, at: string) =>
      ({ id: to, kind: 'status_change', from_status: 'collected', to_status: to, actor: admin, reason_code: reason, note, created_at: at, assignment: null, hold: null, confirmation: null, cash: null }) as AdminOrderEvent
    const lines = timelineFromHistory('2026-10-20T07:00:00Z', [
      change('failed', 'source_quality_concern', 'Source flooded. Driver cannot use it.', '2026-10-20T09:40:00Z'),
    ])
    expect(lines.slice(1)).toEqual([
      { label: 'Delivery failed', at: '2026-10-20T09:40:00Z', detail: 'Sample Dispatcher · Source quality concern · "Source flooded. Driver cannot use it."' },
    ])
    const cancelled = timelineFromHistory('2026-10-20T07:00:00Z', [change('cancelled', 'mmirioma_unable', null, '2026-10-20T09:50:00Z')])
    expect(cancelled.at(-1)).toEqual({ label: 'Cancelled', at: '2026-10-20T09:50:00Z', detail: 'Sample Dispatcher · MmiriOma is unable to deliver' })
    // A reason the app does not know shows no reason, never a raw code.
    expect(timelineFromHistory('2026-10-20T07:00:00Z', [change('failed', 'a_new_reason', null, '2026-10-20T09:40:00Z')]).at(-1)).toEqual({ label: 'Delivery failed', at: '2026-10-20T09:40:00Z', detail: 'Sample Dispatcher' })
  })

  it('shows no concern for a category it does not know, and no decision line for a hold closed by a fail', () => {
    const driver = { id: 'd1', role: 'driver' as const, name: 'Ada' }
    const hold = (kind: string, category: string, decision: string | null) =>
      ({ id: kind, kind, from_status: null, to_status: null, actor: driver, reason_code: null, note: null, created_at: '2026-10-20T08:48:00Z', assignment: null, hold: { id: 'h1', kind: 'source_review', category, decision }, confirmation: null, cash: null }) as AdminOrderEvent
    const lines = timelineFromHistory('2026-10-20T07:00:00Z', [hold('hold_decided', 'source_mismatch', 'failed'), hold('hold_opened', 'a_new_category', null)])
    // Never a raw code, and a decision the contract does not list for hold_decided shows nothing.
    expect(lines).toEqual([
      { label: 'Order placed', at: '2026-10-20T07:00:00Z' },
      { label: 'Hold opened: Source review', at: '2026-10-20T08:48:00Z', detail: 'Ada' },
    ])
  })

  it('still shows the order when only the history fails', async () => {
    const { client } = clientByUrl((url) => (url.includes('/history') ? { body: FORBIDDEN, status: 500 } : { body: DETAIL }))
    expect((await getOrder(DETAIL.reference, client)).timeline).toEqual([{ label: 'Order placed', at: DETAIL.created_at }])
  })

  it('passes 404 order_not_found through', async () => {
    const { client } = clientByUrl(() => ({ body: NOT_FOUND, status: 404 }))
    await expect(getOrder('MO-0000000000', client)).rejects.toMatchObject({ status: 404, code: 'order_not_found' } satisfies Partial<ApiError>)
  })
})

describe('contact attempts on the timeline (#280)', () => {
  // The detail example as a failed delivery with two attempts, as admin-order-detail-failed.json (#289) shows it.
  const FAILED = { ...DETAIL, status: 'failed', contact_attempts: [{ attempted_at: '2026-10-20T09:44:00Z' }, { attempted_at: '2026-10-20T09:49:00Z' }] } as AdminOrderDetail
  const driver = { id: 'd1', role: 'driver' as const, name: 'Sample Driver One' }
  const step = (to: string, at: string) =>
    ({ id: to, kind: 'status_change', from_status: null, to_status: to, actor: driver, reason_code: to === 'failed' ? 'customer_unreachable' : null, note: null, created_at: at, assignment: null, hold: null, confirmation: null, cash: null }) as AdminOrderEvent
  // Newest first, as the server sends them. The example's attempts are at 09:44 and 09:49.
  const history = { items: [step('failed', '2026-10-20T09:56:00Z'), step('arrived', '2026-10-20T09:42:00Z')] }

  it('shows each attempt between Arrived and Delivery failed, from the detail', async () => {
    const { client } = clientByUrl((url) => ({ body: url.includes('/history') ? history : FAILED }))
    const lines = (await getOrder(FAILED.reference, client)).timeline
    expect(lines.map((t) => t.label)).toEqual(['Order placed', 'Arrived', 'Contact attempt 1', 'Contact attempt 2', 'Delivery failed'])
    expect(lines.filter((t) => t.label.startsWith('Contact')).map((t) => t.at)).toEqual(['2026-10-20T09:44:00Z', '2026-10-20T09:49:00Z'])
  })

  it('shows the timeline at "Order placed" only, with no attempts, when the history cannot be read', async () => {
    const { client } = clientByUrl((url) => (url.includes('/history') ? { body: FORBIDDEN, status: 500 } : { body: FAILED }))
    const lines = (await getOrder(FAILED.reference, client)).timeline
    expect(lines.map((t) => t.label)).toEqual(['Order placed'])
  })

  it('leaves an order with no attempt as it was', async () => {
    const { client } = clientByUrl((url) => ({ body: url.includes('/history') ? historySample : DETAIL }))
    const lines = (await getOrder(DETAIL.reference, client)).timeline
    expect(lines.some((t) => t.label.startsWith('Contact attempt'))).toBe(false)
  })

  it('reads a server that does not send the field yet as no attempts', () => {
    const older: Record<string, unknown> = { ...FAILED }
    delete older.contact_attempts
    expect(parseDetail(older).contact_attempts).toEqual([])
    expect(parseDetail(FAILED).contact_attempts).toHaveLength(2)
  })

  it('refuses an attempt that is not a time string', () => {
    expect(() => parseDetail({ ...FAILED, contact_attempts: [{ attempted_at: 5 }] })).toThrow()
  })
})
