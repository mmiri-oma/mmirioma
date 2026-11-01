import { describe, expect, it, vi } from 'vitest'
import customerSample from '../../../../../docs/api/examples/admin-customer.json'
import customersPageSample from '../../../../../docs/api/examples/admin-customers-page.json'
import driversPageSample from '../../../../../docs/api/examples/admin-drivers-page.json'
import phoneNotVerifiedSample from '../../../../../docs/api/examples/error-partner-phone-not-verified.json'
import { createApiClient } from '../../../lib/api/client'
import type { AdminCustomerRead, AdminDriverRead } from '../../../lib/api/adminDirectory'
import {
  addCustomerAddress,
  customerFromRead,
  getCustomer,
  getRider,
  listCustomers,
  listRiders,
  riderFromRead,
  setRiderApproval,
} from './directory'

const envelope = (code: string) => ({ error: { code, message: 'No', details: null } })

/** A fetch that answers by method and path; a path with no answer is a 404. */
function clientByPath(routes: Record<string, { body: unknown; status?: number }>) {
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input))
    const key = `${(init as RequestInit | undefined)?.method ?? 'GET'} ${url.pathname.replace('/api/v1', '')}`
    const { body, status = 200 } = routes[key] ?? { body: envelope('not_found'), status: 404 }
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  })
  const client = createApiClient({ baseUrl: 'http://api.test', fetch: fetchMock })
  client.setCsrfToken('csrf-token')
  return { fetchMock, client }
}

const CUSTOMER = customerSample as unknown as AdminCustomerRead
const TANKER = driversPageSample.items[0] as unknown as AdminDriverRead
const PENDING_KEKE = driversPageSample.items[1] as unknown as AdminDriverRead
const sentBody = (fetchMock: ReturnType<typeof clientByPath>['fetchMock'], at = 0) => JSON.parse(String((fetchMock.mock.calls[at][1] as RequestInit).body))

describe('customers', () => {
  it('lists the first 100 with the search text; ordered_this_week is the last 7 days', async () => {
    const { client, fetchMock } = clientByPath({ 'GET /admin/customers': { body: customersPageSample } })
    const list = await listCustomers('  Sample ', client)
    expect(String(fetchMock.mock.calls[0][0])).toContain('q=Sample')
    expect(String(fetchMock.mock.calls[0][0])).toContain('limit=100')
    expect(list.total).toBe(customersPageSample.total)
    expect(list.ordered_this_week).toBe(customersPageSample.ordered_last_7_days)
    expect(list.customers[0]).toEqual({ id: customersPageSample.items[0].id, name: 'Sample Customer', phone: '+2348000000001', phone_verified: true, orders: 3 })
  })

  it('shows a customer with no email, points or complaints, and the paid total as integer kobo', () => {
    const customer = customerFromRead(CUSTOMER)
    expect(customer).toMatchObject({ name: 'Sample Customer', email: null, customer_since: '2026-10-17T08:00:00Z', total_paid_minor_units: 4500000, orders: 3 })
    expect(customer).not.toHaveProperty('points')
    expect(customer).not.toHaveProperty('complaints')
  })

  it('keeps the addresses (default flag, landmark) and drops the zone', () => {
    expect(customerFromRead(CUSTOMER).addresses).toEqual([
      { id: '5c2d9e1a-7b3f-4a6e-8d0c-1f2e3a4b5c6d', label: 'Home', address: '12 Sample Close, Independence Layout, Enugu', landmark: 'Opposite the blue gate', is_default: true },
      { id: '8e9f0a1b-2c3d-4e5f-9a6b-7c8d9e0f1a2b', label: 'Shop', address: '4 Sample Market Road, New Haven, Enugu', landmark: null, is_default: false },
    ])
  })

  it('words the recent orders with the quantity rules and the admin status, and keeps no delivery type as null', () => {
    const customer = customerFromRead({
      ...CUSTOMER,
      recent_orders: [
        { reference: 'MO-1', created_at: '2026-10-24T09:30:00Z', status: 'en_route', quantity_litres: 3000, delivery_type: 'tanker' },
        { reference: 'MO-2', created_at: '2026-10-01T09:30:00Z', status: 'delivered', quantity_litres: 1200, delivery_type: null },
      ],
    })
    expect(customer.recent_orders[0]).toMatchObject({ quantity: '3,000 L · 750 gal', status: 'on_the_way', delivery_type: 'tanker' })
    expect(customer.recent_orders[1]).toMatchObject({ status: 'delivered', delivery_type: null })
  })

  it('loads one customer and passes 404 customer_not_found through', async () => {
    const ok = clientByPath({ 'GET /admin/customers/c1': { body: customerSample } })
    expect((await getCustomer('c1', ok.client)).name).toBe('Sample Customer')
    const missing = clientByPath({ 'GET /admin/customers/nope': { body: envelope('customer_not_found'), status: 404 } })
    await expect(getCustomer('nope', missing.client)).rejects.toMatchObject({ status: 404, code: 'customer_not_found' })
  })

  it('saves an address with its zone and returns the customer', async () => {
    const { client, fetchMock } = clientByPath({ 'POST /admin/customers/c1/addresses': { body: customerSample } })
    const customer = await addCustomerAddress('c1', { label: ' Shop ', address: ' 4 Sample Market Road ', landmark: '', zone_id: 'z1' }, client)
    expect(sentBody(fetchMock)).toEqual({ label: 'Shop', address: '4 Sample Market Road', landmark: null, zone_id: 'z1' })
    expect(customer.addresses).toHaveLength(2)
  })

  it('refuses an address with no zone as a validation_error on zone_id, and sends nothing', async () => {
    const { client, fetchMock } = clientByPath({})
    await expect(addCustomerAddress('c1', { label: 'Shop', address: '4 Sample Market Road', landmark: null }, client)).rejects.toMatchObject({
      status: 422,
      code: 'validation_error',
      details: [expect.objectContaining({ loc: ['body', 'zone_id'] })],
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    [404, 'service_zone_not_found'],
    [404, 'customer_not_found'],
    [422, 'validation_error'],
  ])('passes %i %s from the address call through', async (status, code) => {
    const { client } = clientByPath({ 'POST /admin/customers/c1/addresses': { body: envelope(code), status } })
    await expect(addCustomerAddress('c1', { label: 'Shop', address: '4 Sample Market Road', landmark: null, zone_id: 'z1' }, client)).rejects.toMatchObject({ status, code })
  })

  it('passes 403 forbidden through', async () => {
    const { client } = clientByPath({ 'GET /admin/customers': { body: envelope('forbidden'), status: 403 } })
    await expect(listCustomers(undefined, client)).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  })
})

describe('riders and drivers', () => {
  it('shows a verified tanker: gallons are the verified litres divided by 4, no fleet code, rating or pay', () => {
    const rider = riderFromRead(TANKER)
    expect(rider).toMatchObject({
      name: 'Sample Driver One',
      code: null,
      approval: 'approved',
      online: true,
      trips: 39,
      active_orders: 1,
      partner_since: '2026-10-10T08:00:00Z',
      service_areas: ['Independence Layout', 'New Haven'],
      vehicle: { type: 'tanker', plate: 'ENU-456-CD', tank_gallons: 3000 },
      vehicle_verified: true,
      rating: null,
    })
    for (const missing of ['today_minor_units', 'payout_due_minor_units', 'documents_note', 'reported_issues']) expect(rider).not.toHaveProperty(missing)
  })

  it('shows a partner waiting for approval: no verified vehicle, no gallons, the declared claim kept', () => {
    const rider = riderFromRead(PENDING_KEKE)
    expect(rider).toMatchObject({ approval: 'pending', vehicle_verified: false })
    expect(rider.vehicle.tank_gallons).toBeNull()
    expect(rider.declared_vehicle).toEqual({ plate: PENDING_KEKE.vehicle.plate, capacity_gallons: PENDING_KEKE.vehicle.declared_capacity_gallons, capacity_litres: PENDING_KEKE.vehicle.declared_capacity_litres })
  })

  it('keeps a driver with no vehicle type or plate (command-line tool) as no type and an empty plate', () => {
    const rider = riderFromRead({ ...TANKER, vehicle: { ...TANKER.vehicle, delivery_type: null, plate: null, description: null, safe_payload_litres: null, transfer_methods: [] } })
    expect(rider.vehicle).toEqual({ type: null, plate: '', tank_gallons: null })
  })

  it('counts delivered jobs as trips, never completed jobs: a failed or cancelled job is no trip (#275)', () => {
    expect(riderFromRead({ ...TANKER, completed_jobs: 1, delivered_jobs: 0 }).trips).toBe(0)
  })

  it('shows no trip count, not completed_jobs, when an older server sends no delivered_jobs (#275)', () => {
    expect(riderFromRead({ ...TANKER, delivered_jobs: undefined }).trips).toBeNull()
  })

  it('reads an approval status it does not know as waiting for approval, never failing', () => {
    expect(riderFromRead({ ...TANKER, approval_status: 'under_review' }).approval).toBe('pending')
  })

  it('lists active accounts only, with the pill as a server filter, and the counts from the server', async () => {
    const { client, fetchMock } = clientByPath({ 'GET /admin/drivers': { body: driversPageSample } })
    const list = await listRiders('pending', 'ENU', client)
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(Object.fromEntries(url.searchParams)).toEqual({ approval_status: 'pending', is_active: 'true', q: 'ENU', limit: '100' })
    expect(list.counts).toEqual({ all: 2, keke: 1, tanker: 1, pending: 1, suspended: null })
    expect(list.online).toBe(1)
    expect(list.pending).toBe(1)
    expect(list.riders).toHaveLength(2)
  })

  it.each([
    ['all', {}],
    ['keke', { delivery_type: 'keke' }],
    ['tanker', { delivery_type: 'tanker' }],
    ['suspended', { approval_status: 'suspended' }],
  ] as const)('maps the %s pill to its server filter', async (pill, expected) => {
    const { client, fetchMock } = clientByPath({ 'GET /admin/drivers': { body: driversPageSample } })
    await listRiders(pill, undefined, client)
    expect(Object.fromEntries(new URL(String(fetchMock.mock.calls[0][0])).searchParams)).toEqual({ ...expected, is_active: 'true', limit: '100' })
  })

  it('shows a deactivated account as an error, never as suspended', async () => {
    const { client } = clientByPath({ 'GET /admin/drivers/d1': { body: { ...TANKER, is_active: false } } })
    await expect(getRider('d1', client)).rejects.toMatchObject({ code: 'driver_inactive', message: 'This account is deactivated.' })
  })

  it('loads one active rider and passes 404 driver_not_found through', async () => {
    const ok = clientByPath({ 'GET /admin/drivers/d1': { body: TANKER } })
    expect((await getRider('d1', ok.client)).name).toBe('Sample Driver One')
    const missing = clientByPath({ 'GET /admin/drivers/nope': { body: envelope('driver_not_found'), status: 404 } })
    await expect(getRider('nope', missing.client)).rejects.toMatchObject({ status: 404, code: 'driver_not_found' })
  })

  it('approves with the verified vehicle', async () => {
    const { client, fetchMock } = clientByPath({ 'POST /admin/drivers/d1/approval': { body: TANKER } })
    const vehicle = { description: 'Tanker truck', safe_payload_litres: 12000, transfer_methods: ['ground', 'overhead'] as ('ground' | 'overhead')[] }
    await setRiderApproval('d1', 'approve', '', vehicle, client)
    expect(sentBody(fetchMock)).toEqual({ approval_status: 'approved', reason: null, vehicle })
  })

  it('reactivates a suspended partner without a vehicle, and suspends with a reason and no vehicle', async () => {
    const reactivate = clientByPath({ 'POST /admin/drivers/d1/approval': { body: TANKER } })
    await setRiderApproval('d1', 'reactivate', 'New papers checked', undefined, reactivate.client)
    expect(sentBody(reactivate.fetchMock)).toEqual({ approval_status: 'approved', reason: 'New papers checked' })

    const suspend = clientByPath({ 'POST /admin/drivers/d1/approval': { body: { ...TANKER, approval_status: 'suspended' } } })
    const rider = await setRiderApproval('d1', 'suspend', '  Papers expired  ', { description: 'x', safe_payload_litres: 1, transfer_methods: [] }, suspend.client)
    expect(sentBody(suspend.fetchMock)).toEqual({ approval_status: 'suspended', reason: 'Papers expired' })
    expect(rider.approval).toBe('suspended')
  })

  it.each([
    [409, 'driver_inactive', envelope('driver_inactive')],
    [409, 'partner_phone_not_verified', phoneNotVerifiedSample],
    [409, 'driver_has_accepted_job', envelope('driver_has_accepted_job')],
    [422, 'validation_error', envelope('validation_error')],
    [404, 'driver_not_found', envelope('driver_not_found')],
  ])('passes %i %s from the approval through', async (status, code, body) => {
    const { client } = clientByPath({ 'POST /admin/drivers/d1/approval': { body, status } })
    await expect(setRiderApproval('d1', 'suspend', 'Papers expired', undefined, client)).rejects.toMatchObject({ status, code })
  })
})
