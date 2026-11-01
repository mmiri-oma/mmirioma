// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  assignOrder,
  continueSource,
  createOrderForCustomer,
  decideProof,
  getCancellationOutcome,
  getDashboard,
  getHoldReview,
  getOrder as getAdminOrder,
  listEligibleRiders,
  listOrders,
  listPriceLists,
  refundAsPoints,
  resumeUnsafe,
  resolveIssue,
  saveArea,
  savePriceList,
  setRiderApproval,
  setStationOpen,
  transitionOrder,
  uploadStationPapers,
  verifyCustomerPhone,
  withdrawJob,
} from './adminMock'
import { DEMO_ADMIN_ID } from './adminSeed'
import { mockLogin, mockLogout } from './authMock'
import { createOrder, getOrder, getQuote } from './customerMock'
import { mutate, read, resetMockDb } from './db'
import { DANIEL_ID, DEMO_RIDER_ID, IFEANYI_ID, SUNDAY_ID } from './partnerSeed'
import { DEMO_PASSWORD } from './seed'

const ADMIN = { phone: '0800 000 0100', password: DEMO_PASSWORD }
const CUSTOMER = { phone: '0803 123 4567', password: DEMO_PASSWORD }
const RIDER = { phone: '0800 000 0101', password: DEMO_PASSWORD }

const KEKE = { delivery_type: 'keke', can_size_litres: 25, can_count: 24 } as const

beforeEach(async () => {
  resetMockDb()
  await mockLogin(ADMIN)
})

describe('admin access', () => {
  it('refuses customers and partners (403)', async () => {
    await mockLogout()
    await mockLogin(RIDER)
    await expect(listOrders()).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  })

  it('lists every order with counts per filter, and finds by phone', async () => {
    const all = await listOrders()
    expect(all.counts.all).toBe(all.orders.length)
    expect(all.counts.awaiting_rider).toBeGreaterThan(0)
    const found = await listOrders('all', '0806 555 0192')
    expect(found.orders.map((o) => o.customer_name)).toContain('Ifeoma Eze')
  })

  it('seeds one held order of each kind, and the "On hold" filter lists only those (admin hold review, R0)', async () => {
    const held = await listOrders('on_hold')
    expect(held.counts.on_hold).toBe(4)
    expect(held.orders.map((o) => o.hold?.kind).sort()).toEqual(['proof_review', 'source_review', 'source_review', 'unsafe_stop'])
    // A hold is not a status: the orders keep theirs, and show under the other pills too.
    const all = await listOrders('all')
    expect(all.orders.filter((o) => o.hold !== null)).toHaveLength(4)
    expect(all.orders.filter((o) => o.hold === null).every((o) => !held.orders.includes(o))).toBe(true)
    // Each hold opened before now, so "12 minutes ago" is a past time.
    expect(held.orders.every((o) => Date.parse(o.hold!.since) < Date.now())).toBe(true)
  })

  it('works out the dashboard from the records', async () => {
    const d = await getDashboard()
    expect(d.orders.awaiting_rider).toBe((await listOrders('awaiting_rider')).orders.length)
    expect(d.riders_online.total).toBe(3)
    expect(d.stations).toEqual({ open: 4, closed: 1 })
    expect(d.is_sample).toBe(true)
  })
})

describe('assigning riders', () => {
  it('offers only approved riders who can take the order, online first', async () => {
    const riders = await listEligibleRiders('MO-6RTA2KXP9B')
    const ids = riders.map((r) => r.id)
    expect(ids).toEqual(expect.arrayContaining([DEMO_RIDER_ID, IFEANYI_ID]))
    expect(ids).not.toContain(DANIEL_ID) // suspended
    expect(ids).not.toContain(SUNDAY_ID) // tanker, pending
  })

  it('assigns, tells the rider, and lets admin reassign before pickup', async () => {
    const o = await assignOrder('MO-6RTA2KXP9B', IFEANYI_ID)
    expect(o.status).toBe('assigned')
    expect(o.partner?.id).toBe(IFEANYI_ID)
    expect(read().partners[IFEANYI_ID].notifications[0]).toMatchObject({ kind: 'assigned', reference: 'MO-6RTA2KXP9B' })
    const moved = await assignOrder('MO-6RTA2KXP9B', DEMO_RIDER_ID)
    expect(moved.partner?.id).toBe(DEMO_RIDER_ID)
    expect(read().partners[IFEANYI_ID].notifications[0].kind).toBe('reassigned')
    expect(read().admin.audit[0].action).toBe('Reassigned MO-6RTA from Ifeanyi James to Chinedu Okafor')
  })

  it('cannot reassign water that is already on its way', async () => {
    await expect(assignOrder('MO-7KQ2M9XH4T', IFEANYI_ID)).rejects.toMatchObject({ code: 'already_collected' })
  })
})

describe('refunding', () => {
  it('pays a refund as points at the sample rate (1 point = ₦1)', async () => {
    const before = read().customers['user-kelechi'].points.balance
    await refundAsPoints('MO-4WQ9NC3RZF', 'Cancelled after a bank transfer')
    const order = read().customers['user-kelechi'].orders[0]
    expect(order.payment.status).toBe('refunded')
    expect(read().customers['user-kelechi'].points.balance - before).toBe(order.quote.total_minor_units / 100)
  })
})

describe('creating an order for a customer', () => {
  it('makes the same order and pool job as the customer app', async () => {
    const o = await createOrderForCustomer({ customer_id: 'user-ifeoma', choice: KEKE, address_id: 'addr-home', payment_method: 'pay_on_delivery', assign_to: null })
    expect(o.status).toBe('awaiting_rider')
    expect(o.timeline[0].detail).toMatch(/By support/)
    const job = read().jobs.find((j) => j.reference === o.reference)!
    expect(job.station.area).toBe('Independence Layout')
    expect(read().customers['user-ifeoma'].orders[0].reference).toBe(o.reference)
  })

  it('needs a quote for a custom tanker size', async () => {
    await expect(
      createOrderForCustomer({ customer_id: 'user-obinna', choice: { delivery_type: 'tanker', tank_type: 'ground', tank_size_gallons: null, source: 'borehole' }, address_id: 'addr-home', payment_method: 'bank_transfer', assign_to: null }),
    ).rejects.toMatchObject({ code: 'manual_quote_required' })
  })
})

describe('stations (FR-012)', () => {
  it('blocks new orders when no station is open with valid papers', async () => {
    for (const st of read().admin.stations.filter((x) => x.open)) await setStationOpen(st.id, false)
    await mockLogout()
    await mockLogin(CUSTOMER)
    await expect(
      createOrder({ idempotency_key: 'k-x', choice: KEKE, address_label: 'Home', address: '12 Lakeview Street, GRA, Enugu', landmark: null, receiver_name: 'Adaeze Nwosu', receiver_phone: '0803 123 4567', instructions: null }),
    ).rejects.toMatchObject({ status: 409, code: 'no_station_open' })
  })

  it('will not open a station whose papers expired until new papers are uploaded', async () => {
    mutate((s) => {
      const st = s.admin.stations.find((x) => x.id === 'st-newhaven')!
      st.papers.valid_until = '2026-01-01'
    })
    await expect(setStationOpen('st-newhaven', true)).rejects.toMatchObject({ code: 'papers_not_valid' })
    await uploadStationPapers('st-newhaven', 'new-papers.pdf', '2099-12-31')
    expect((await setStationOpen('st-newhaven', true)).open).toBe(true)
  })

  it('tells partners when a station closes', async () => {
    await setStationOpen('st-gra', false)
    expect(read().partners[DEMO_RIDER_ID].notifications[0]).toMatchObject({ kind: 'station_closed' })
  })
})

describe('prices (FR-024)', () => {
  it('saves a new version that new quotes use, while placed orders keep their price', async () => {
    const [current] = await listPriceLists()
    const placed = read().customers['user-adaeze'].orders[0].quote.total_minor_units
    await savePriceList({ ...structuredClone(current), keke: { ...current.keke, can_minor_units: { 25: 30_000, 50: 45_000 } } })
    const [next] = await listPriceLists()
    expect(next.version).toBe(current.version + 1)
    expect(next.note).toBe('Keke 25 L can ₦250 → ₦300')
    await mockLogout()
    await mockLogin(CUSTOMER)
    const q = await getQuote(KEKE, null)
    if (q.status !== 'quote_available') throw new Error('expected a quote')
    expect(q.water.amount_minor_units).toBe(24 * 30_000)
    expect((await getOrder(read().customers['user-adaeze'].orders[0].reference)).quote?.total_minor_units).toBe(placed)
  })

  it('refuses a save with nothing changed', async () => {
    const [current] = await listPriceLists()
    await expect(savePriceList(structuredClone(current))).rejects.toMatchObject({ code: 'no_changes' })
  })

  it('uses the fixed area fee once admin switches it on (decision 10a)', async () => {
    const [current] = await listPriceLists()
    await saveArea('ar-gra', { name: 'GRA', enabled: true, centre: { latitude: 6.4584, longitude: 7.5464 }, fixed_fee_minor_units: 80_000 })
    await savePriceList({ ...structuredClone(current), delivery_fee: { ...current.delivery_fee, per_area_enabled: true } })
    await mockLogout()
    await mockLogin(CUSTOMER)
    const q = await getQuote(KEKE, '12 Lakeview Street, GRA, Enugu')
    if (q.status !== 'quote_available') throw new Error('expected a quote')
    expect(q.delivery?.amount_minor_units).toBe(80_000)
  })
})

describe('riders, customers and support', () => {
  it('needs a reason to suspend, and puts assigned orders back in the pool', async () => {
    await expect(setRiderApproval(DEMO_RIDER_ID, 'suspend', '')).rejects.toMatchObject({ code: 'validation_error' })
    const r = await setRiderApproval(DEMO_RIDER_ID, 'suspend', 'Papers out of date')
    expect(r).toMatchObject({ approval: 'suspended', online: false })
    expect(read().jobs.find((j) => j.reference === 'MO-3HT8WQ2KZP')!.stage).toBe('available')
    expect((await setRiderApproval(SUNDAY_ID, 'approve', '')).approval).toBe('approved')
  })

  it('marks a phone verified by hand (FR-003) and logs it', async () => {
    const c = await verifyCustomerPhone('user-ifeoma')
    expect(c.phone_verified).toBe(true)
    expect(read().admin.audit[0].action).toBe('Marked phone verified for Ifeoma Eze')
  })

  it('confirms a delivery without the code: the rider is paid and the order is delivered', async () => {
    const wallet = read().partners[DEMO_RIDER_ID].wallet_minor_units
    const issue = await resolveIssue('is-12', 'confirm_without_code', 'Called both; customer confirmed 600 L in the tank')
    expect(issue.status).toBe('resolved')
    expect(read().jobs.find((j) => j.reference === 'MO-7KQ2M9XH4T')!.stage).toBe('delivered')
    expect(read().partners[DEMO_RIDER_ID].wallet_minor_units).toBeGreaterThan(wallet)
    expect(read().customers['user-adaeze'].orders.find((o) => o.reference === 'MO-7KQ2M9XH4T')!.stage).toBe('delivered')
  })

  it('adds goodwill points to the customer on the order', async () => {
    const before = read().customers['user-adaeze'].points.balance
    await resolveIssue('is-11', 'goodwill_points', 'Late delivery, apologised by phone', 50)
    expect(read().customers['user-adaeze'].points.balance).toBe(before + 50)
  })

  it('keeps one admin account in the seed', () => {
    expect(read().users.filter((u) => u.role === 'admin').map((u) => u.id)).toEqual([DEMO_ADMIN_ID])
  })
})

describe('hold review (#166)', () => {
  const PROOF_REF = 'MO-6PRF2KQ7XD'
  const approveRequest = (over: Record<string, unknown> = {}) =>
    ({
      hold_id: 'hold-proof-1',
      decision: 'approve',
      customer_acknowledgment: { method: 'phone_call', confirmed_at: new Date(Date.now() - 60_000).toISOString(), note: null },
      note: 'Customer confirmed by phone that 1,000 litres were delivered.',
      ...over,
    }) as Parameters<typeof decideProof>[1]

  it('returns the evidence for each kind of seeded hold, as the server shapes it', async () => {
    const proof = await getHoldReview(PROOF_REF)
    expect(proof).toMatchObject({ kind: 'proof_review', order_status: 'unloading', withdraw_allowed: false, driver: { name: 'Ifeanyi James' } })
    expect(proof.proof).toMatchObject({ reason: 'customer_cannot_receive_code', location: null, delivery_code: { attempts_used: 3, attempts_limit: 5, expired: true } })
    // The code itself is never part of the evidence.
    expect(JSON.stringify(proof)).not.toMatch(/\b\d{6}\b/)
    // A source that is not in the records cannot be continued; the assigned one with a safety concern can.
    const other = await getHoldReview('MO-3SRC8WT5NB')
    expect(other.pickup).toMatchObject({ used_source: { assigned: false, name: 'Borehole near the market' }, safety_concern: false })
    expect(other.source_eligibility).toEqual({ answer: 'not_eligible', message: 'This source is not in the source records.' })
    const assigned = await getHoldReview('MO-8SRC5LV3QE')
    expect(assigned.pickup).toMatchObject({ used_source: { assigned: true }, safety_concern: true, safety_note: expect.stringContaining('flooded') })
    expect(assigned.source_eligibility).toEqual({ answer: 'eligible', message: "This source is activated for the order's water category." })
    const unsafe = await getHoldReview('MO-9UNS4VH2ZC')
    expect(unsafe).toMatchObject({ order_status: 'accepted', withdraw_allowed: true, report: { kind: 'unsafe_access' } })
  })

  it('says there is no open hold for an order without one, and no order for an unknown reference', async () => {
    await expect(getHoldReview('MO-6RTA2KXP9B')).rejects.toMatchObject({ status: 404, code: 'hold_not_found' })
    await expect(getHoldReview('MO-0000000000')).rejects.toMatchObject({ status: 404, code: 'order_not_found' })
  })

  it('approving delivers the order, closes the hold and records who decided and why', async () => {
    await decideProof(PROOF_REF, approveRequest())
    const order = await getAdminOrder(PROOF_REF)
    expect(order.status).toBe('delivered')
    expect(order.hold).toBeNull()
    expect((await listOrders('on_hold')).counts.on_hold).toBe(3)
    expect(order.timeline.map((t) => t.label).slice(-2)).toEqual(['Hold opened: Proof review', 'Proof approved'])
    expect(order.timeline.at(-1)!.detail).toBe('Chidimma M. · "Customer confirmed by phone that 1,000 litres were delivered."')
    expect(read().admin.audit[0].action).toMatch(/Approved alternative proof/)
  })

  it('rejecting closes the hold and leaves the order where it was', async () => {
    const before = (await getAdminOrder(PROOF_REF)).status
    await decideProof(PROOF_REF, { hold_id: 'hold-proof-1', decision: 'reject', note: 'The person who answered is not the customer.' })
    const order = await getAdminOrder(PROOF_REF)
    expect(order.status).toBe(before)
    expect(order.hold).toBeNull()
    expect(order.timeline.at(-1)!.label).toBe('Proof rejected')
    await expect(getHoldReview(PROOF_REF)).rejects.toMatchObject({ code: 'hold_not_found' })
  })

  it('refuses a decision on a hold that is no longer open, or that is not a proof review, changing nothing', async () => {
    await decideProof(PROOF_REF, approveRequest())
    await expect(decideProof(PROOF_REF, approveRequest())).rejects.toMatchObject({ status: 409, code: 'hold_not_open' })
    await expect(decideProof('MO-3SRC8WT5NB', { hold_id: 'hold-source-1', decision: 'reject', note: 'No.' })).rejects.toMatchObject({ status: 409, code: 'hold_not_open' })
    expect((await getAdminOrder('MO-3SRC8WT5NB')).hold).not.toBeNull()
  })

  it('checks the note, the confirmation time and the details for "Other" (422, nothing changes)', async () => {
    const refusal = async (request: Parameters<typeof decideProof>[1]) => {
      const error = await decideProof(PROOF_REF, request).then(() => null, (e: unknown) => e as { code: string; details: { loc: string[] }[] })
      expect(error?.code).toBe('validation_error')
      return error!.details.map((d) => d.loc.join('.'))
    }
    expect(await refusal(approveRequest({ note: '   ' }))).toEqual(['body.note'])
    expect(await refusal({ hold_id: 'hold-proof-1', decision: 'reject', note: '' })).toEqual(['body.note'])
    const future = { method: 'phone_call', confirmed_at: new Date(Date.now() + 3_600_000).toISOString(), note: null }
    expect(await refusal(approveRequest({ customer_acknowledgment: future }))).toEqual(['body.customer_acknowledgment.confirmed_at'])
    const other = { method: 'other', confirmed_at: new Date(Date.now() - 60_000).toISOString(), note: null }
    expect(await refusal(approveRequest({ customer_acknowledgment: other }))).toEqual(['body.customer_acknowledgment.note'])
    expect((await getAdminOrder(PROOF_REF)).hold).not.toBeNull()
  })

  it('refuses customers and partners (403)', async () => {
    await mockLogout()
    await mockLogin(RIDER)
    await expect(getHoldReview(PROOF_REF)).rejects.toMatchObject({ status: 403, code: 'forbidden' })
    await expect(decideProof(PROOF_REF, approveRequest())).rejects.toMatchObject({ status: 403, code: 'forbidden' })
    await expect(continueSource('MO-8SRC5LV3QE', { hold_id: 'hold-source-2', note: 'Fine.' })).rejects.toMatchObject({ status: 403, code: 'forbidden' })
    await expect(resumeUnsafe('MO-9UNS4VH2ZC', { hold_id: 'hold-unsafe-1', note: 'Fine.' })).rejects.toMatchObject({ status: 403, code: 'forbidden' })
    await expect(withdrawJob('MO-9UNS4VH2ZC', { expected_status: 'accepted', note: null })).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  })

  describe('continue, resume and withdraw (R2, R3)', () => {
    const SOURCE_OK = 'MO-8SRC5LV3QE'
    const SOURCE_BAD = 'MO-3SRC8WT5NB'
    const UNSAFE = 'MO-9UNS4VH2ZC'

    it('continues a source that can be used: the hold closes, the decision is recorded, the order keeps its status', async () => {
      const before = (await getAdminOrder(SOURCE_OK)).status
      await continueSource(SOURCE_OK, { hold_id: 'hold-source-2', note: ' Source records match the order category. ' })
      const order = await getAdminOrder(SOURCE_OK)
      expect([order.status, order.hold]).toEqual([before, null])
      expect(order.timeline.map((t) => t.label).slice(-2)).toEqual(['Hold opened: Source review', 'Source continued'])
      expect(order.timeline.at(-1)!.detail).toBe('Chidimma M. · "Source records match the order category."')
      expect(read().admin.audit[0].action).toMatch(/Continued the delivery after a source review/)
    })

    it('refuses to continue a source that cannot be used, with the server’s sentence and its answer, changing nothing', async () => {
      const error = await continueSource(SOURCE_BAD, { hold_id: 'hold-source-1', note: 'Looks fine.' }).then(() => null, (e: unknown) => e as { status: number; code: string; message: string; details: unknown })
      expect(error).toMatchObject({ status: 409, code: 'source_not_eligible', message: 'This source is not in the source records.', details: { answer: 'not_eligible' } })
      expect((await getAdminOrder(SOURCE_BAD)).hold).not.toBeNull()
    })

    it('resumes after an unsafe stop with the safe alternative', async () => {
      await resumeUnsafe(UNSAFE, { hold_id: 'hold-unsafe-1', note: 'Use the side gate on Zik Avenue.' })
      const order = await getAdminOrder(UNSAFE)
      expect(order.hold).toBeNull()
      expect(order.timeline.at(-1)).toMatchObject({ label: 'Delivery resumed after unsafe stop', detail: 'Chidimma M. · "Use the side gate on Zik Avenue."' })
    })

    it('needs a note to continue or resume, and a hold of the right kind that is still open', async () => {
      await expect(continueSource(SOURCE_OK, { hold_id: 'hold-source-2', note: '  ' })).rejects.toMatchObject({ status: 422, code: 'validation_error' })
      await expect(resumeUnsafe(UNSAFE, { hold_id: 'hold-unsafe-1', note: '' })).rejects.toMatchObject({ status: 422, code: 'validation_error' })
      // A proof hold is not decided by continue; a stale id is not open; a decided hold cannot be decided twice.
      await expect(continueSource(PROOF_REF, { hold_id: 'hold-proof-1', note: 'Fine.' })).rejects.toMatchObject({ status: 409, code: 'hold_not_open' })
      await expect(resumeUnsafe(UNSAFE, { hold_id: 'old-hold', note: 'Fine.' })).rejects.toMatchObject({ status: 409, code: 'hold_not_open' })
      await resumeUnsafe(UNSAFE, { hold_id: 'hold-unsafe-1', note: 'Fine.' })
      await expect(resumeUnsafe(UNSAFE, { hold_id: 'hold-unsafe-1', note: 'Fine.' })).rejects.toMatchObject({ status: 409, code: 'hold_not_open' })
    })

    it('withdraws an accepted job: back to the pool with no driver, the hold closed, no decision line', async () => {
      await withdrawJob(UNSAFE, { expected_status: 'accepted', note: 'Road closed for the day.' })
      const job = read().jobs.find((j) => j.reference === UNSAFE)!
      expect([job.stage, job.partner_id, job.hold, job.hold_decision]).toEqual(['available', null, null, undefined])
      const order = await getAdminOrder(UNSAFE)
      expect(order.status).toBe('awaiting_rider')
      expect(order.partner).toBeNull()
      expect(order.timeline.map((t) => t.label).slice(-2)).toEqual(['Hold opened: Unsafe stop', 'Job withdrawn from Daniel Nnadi'])
      expect(order.timeline.at(-1)!.detail).toBe('Road closed for the day.')
      expect(order.timeline.some((t) => t.label === 'Delivery resumed after unsafe stop')).toBe(false)
      expect((await listOrders('on_hold')).counts.on_hold).toBe(3)
    })

    it('refuses to withdraw once the driver has left, or when nobody is assigned', async () => {
      await expect(withdrawJob(SOURCE_OK, { expected_status: 'accepted', note: null })).rejects.toMatchObject({ status: 409, code: 'invalid_order_transition' })
      await expect(withdrawJob(UNSAFE, { expected_status: 'offered', note: null })).rejects.toMatchObject({ status: 409, code: 'invalid_order_transition' })
      await withdrawJob(UNSAFE, { expected_status: 'accepted', note: null })
      await expect(withdrawJob(UNSAFE, { expected_status: 'accepted', note: null })).rejects.toMatchObject({ status: 404, code: 'assignment_not_found', message: 'This order has no driver assigned' })
      expect((await getAdminOrder(SOURCE_OK)).hold).not.toBeNull()
    })
  })

  describe('fail and cancel (FAIL, CANCEL)', () => {
    const SOURCE_OK = 'MO-8SRC5LV3QE'
    const UNSAFE = 'MO-9UNS4VH2ZC'
    const fail = (over: Record<string, unknown> = {}) =>
      ({ to: 'failed', expected_status: 'collected', reason_code: 'source_quality_concern', note: 'Source flooded. Driver cannot use it.', hold_id: 'hold-source-2', ...over }) as Parameters<typeof transitionOrder>[1]
    const cancel = (over: Record<string, unknown> = {}) =>
      ({ to: 'cancelled', expected_status: 'accepted', reason_code: 'mmirioma_unable', note: null, hold_id: 'hold-unsafe-1', ...over }) as Parameters<typeof transitionOrder>[1]

    it('says what a cancel costs the customer in the server’s sentence, and refuses one that cannot be cancelled', async () => {
      expect(await getCancellationOutcome(UNSAFE, 'mmirioma_unable')).toEqual({ reason_code: 'mmirioma_unable', customer_charge_minor_units: 0, message: 'The customer is not charged for this cancellation.' })
      expect(await getCancellationOutcome(UNSAFE, 'customer_request')).toMatchObject({ reason_code: 'customer_request', customer_charge_minor_units: 0 })
      await expect(getCancellationOutcome('MO-0000000000', 'mmirioma_unable')).rejects.toMatchObject({ status: 404, code: 'order_not_found' })
      await transitionOrder(UNSAFE, cancel())
      await expect(getCancellationOutcome(UNSAFE, 'mmirioma_unable')).rejects.toMatchObject({ status: 409, code: 'invalid_order_transition' })
    })

    it('cancels because the customer asked, and refuses other cancel reasons and a missing note at unloading (#174)', async () => {
      await transitionOrder(UNSAFE, cancel({ reason_code: 'customer_request' }))
      expect((await getAdminOrder(UNSAFE)).status).toBe('cancelled')
      await expect(transitionOrder(SOURCE_OK, cancel({ expected_status: 'collected', reason_code: 'other', hold_id: 'hold-source-2' }))).rejects.toMatchObject({ status: 422, code: 'validation_error' })
      await expect(transitionOrder(SOURCE_OK, cancel({ expected_status: 'unloading', reason_code: 'customer_request', hold_id: null }))).rejects.toMatchObject({ status: 422, code: 'validation_error' })
    })

    it('fails a held delivery: the order shows Delivery failed, the hold closes with it, and the history says why', async () => {
      await transitionOrder(SOURCE_OK, fail())
      const order = await getAdminOrder(SOURCE_OK)
      expect([order.status, order.hold]).toEqual(['failed', null])
      expect(order.timeline.map((t) => t.label).slice(-2)).toEqual(['Hold opened: Source review', 'Delivery failed'])
      expect(order.timeline.at(-1)!.detail).toBe('Chidimma M. · Source quality concern · "Source flooded. Driver cannot use it."')
      // A hold closed by a fail has no decision line.
      expect(order.timeline.some((t) => /Source continued/.test(t.label))).toBe(false)
      expect(read().admin.audit[0].action).toMatch(/Failed the delivery of/)
      expect((await listOrders('on_hold')).counts.on_hold).toBe(3)
    })

    it('cancels from a hold: the order is cancelled, the hold closes, and the driver is not notified', async () => {
      const notifications = read().partners[DANIEL_ID].notifications.length
      await transitionOrder(UNSAFE, cancel({ note: 'Road closed for the day.' }))
      const order = await getAdminOrder(UNSAFE)
      expect([order.status, order.hold]).toEqual(['cancelled', null])
      expect(order.timeline.at(-1)).toMatchObject({ label: 'Cancelled', detail: 'Chidimma M. · MmiriOma is unable to deliver · "Road closed for the day."' })
      expect(read().partners[DANIEL_ID].notifications).toHaveLength(notifications)
    })

    it('fails an accepted job that has no hold, and sends no hold id', async () => {
      const job = read().jobs.find((j) => j.reference === 'MO-3HT8WQ2KZP')!
      job.stage = 'accepted'
      await transitionOrder('MO-3HT8WQ2KZP', { to: 'failed', expected_status: 'accepted', reason_code: 'unsafe_access', note: null, hold_id: null })
      expect((await getAdminOrder('MO-3HT8WQ2KZP')).status).toBe('failed')
    })

    it('refuses a status the dispatcher did not see, an order that cannot move, and a hold that is not open, changing nothing', async () => {
      await expect(transitionOrder(SOURCE_OK, fail({ expected_status: 'accepted' }))).rejects.toMatchObject({ status: 409, code: 'invalid_order_transition' })
      await expect(transitionOrder(SOURCE_OK, fail({ hold_id: 'old-hold' }))).rejects.toMatchObject({ status: 409, code: 'hold_not_open' })
      // An order still in the pool (confirmed, no driver) cannot be failed: row 20 starts at assigned.
      await expect(transitionOrder('MO-6RTA2KXP9B', { to: 'failed', expected_status: 'confirmed', reason_code: 'unsafe_access', note: null, hold_id: null })).rejects.toMatchObject({ status: 409, code: 'invalid_order_transition' })
      await transitionOrder(UNSAFE, cancel())
      await expect(transitionOrder(UNSAFE, cancel())).rejects.toMatchObject({ status: 409, code: 'invalid_order_transition' })
      expect((await getAdminOrder(SOURCE_OK)).hold).not.toBeNull()
    })

    it('checks the reason and the note (422): Other needs a note, and only the agreed reasons exist', async () => {
      const refusal = async (request: Parameters<typeof transitionOrder>[1]) => {
        const error = await transitionOrder(SOURCE_OK, request).then(() => null, (e: unknown) => e as { code: string; details: { loc: string[] }[] })
        expect(error?.code).toBe('validation_error')
        return error!.details.map((d) => d.loc.join('.'))
      }
      expect(await refusal(fail({ reason_code: 'other', note: '  ' }))).toEqual(['body.note'])
      expect(await refusal(fail({ reason_code: 'vehicle_failure' }))).toEqual(['body.reason_code'])
      expect(await refusal(cancel({ reason_code: 'other' }))).toEqual(['body.reason_code'])
      expect((await getAdminOrder(SOURCE_OK)).hold).not.toBeNull()
    })

    it('refuses customers and partners (403)', async () => {
      await mockLogout()
      await mockLogin(RIDER)
      await expect(getCancellationOutcome(UNSAFE, 'mmirioma_unable')).rejects.toMatchObject({ status: 403, code: 'forbidden' })
      await expect(transitionOrder(UNSAFE, cancel())).rejects.toMatchObject({ status: 403, code: 'forbidden' })
    })
  })
})

describe('the "Delivery failed" filter (#273)', () => {
  it('finds a failed order without opening All, and the counts add up', async () => {
    const before = await listOrders('failed')
    expect(before.counts.failed).toBe(0)
    const job = read().jobs.find((j) => j.stage === 'accepted')!
    await transitionOrder(job.reference, { to: 'failed', expected_status: 'accepted', reason_code: 'unsafe_access', note: null, hold_id: null })
    const failed = await listOrders('failed')
    expect(failed.orders.map((o) => o.reference)).toEqual([job.reference])
    expect(failed.counts.failed).toBe(1)
    expect(failed.counts.all).toBe(before.counts.all)
    // A failed order is no longer counted under In progress.
    expect(failed.counts.in_progress).toBe(before.counts.in_progress - 1)
  })
})

describe('contact attempts on a mock order\'s timeline (#280)', () => {
  const minute = 60_000

  /** Make the first job one that failed, ending a day after its last step; returns its reference and timeline so far. */
  async function failedJob() {
    const reference = read().jobs[0].reference
    await mutate((s) => {
      const job = s.jobs.find((j) => j.reference === reference)!
      job.stage = 'failed'
      job.contact_attempts = []
      job.ended = { kind: 'failed', reason_code: 'customer_unreachable', note: null, by: 'Chinedu', at: new Date(Date.now() + 24 * 60 * minute).toISOString() }
    })
    return { reference, base: (await getAdminOrder(reference)).timeline }
  }

  /** Record attempts one and two minutes after the last step before the failure. */
  async function recordAttempts(reference: string, base: { at: string }[], count: number) {
    const lastStep = Date.parse(base[base.length - 2].at)
    await mutate((s) => {
      s.jobs.find((j) => j.reference === reference)!.contact_attempts = Array.from({ length: count }, (_, i) => new Date(lastStep + (i + 1) * minute).toISOString())
    })
  }

  it('shows the attempts the partner recorded, after the job\'s steps and before Delivery failed', async () => {
    const { reference, base } = await failedJob()
    expect(base.at(-1)?.label).toBe('Delivery failed')
    await recordAttempts(reference, base, 2)
    const labels = (await getAdminOrder(reference)).timeline.map((t) => t.label)
    expect(labels).toEqual([...base.slice(0, -1).map((t) => t.label), 'Contact attempt 1', 'Contact attempt 2', 'Delivery failed'])
  })

  it('shows none for a job with no attempt', async () => {
    const { base } = await failedJob()
    expect(base.some((t) => t.label.startsWith('Contact attempt'))).toBe(false)
  })

  it('does not change the stored timeline, so reading twice shows each attempt once', async () => {
    const { reference, base } = await failedJob()
    await recordAttempts(reference, base, 1)
    const attempts = async () => (await getAdminOrder(reference)).timeline.filter((t) => t.label.startsWith('Contact attempt'))
    expect(await attempts()).toHaveLength(1)
    expect(await attempts()).toHaveLength(1)
  })
})
