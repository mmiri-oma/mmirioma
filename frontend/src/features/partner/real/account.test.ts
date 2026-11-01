import { describe, expect, it, vi } from 'vitest'
import authSession from '../../../../../docs/api/examples/auth-session.json'
import notApproved from '../../../../../docs/api/examples/error-partner-not-approved.json'
import notificationsPage from '../../../../../docs/api/examples/partner-notifications.json'
import partnerProfile from '../../../../../docs/api/examples/partner-profile.json'
import pendingProfile from '../../../../../docs/api/examples/partner-profile-pending.json'
import serviceZones from '../../../../../docs/api/examples/service-zones.json'
import type { PartnerSignupInput } from '../../../domain/partner'
import { ApiError, createApiClient } from '../../../lib/api/client'
import type { PartnerProfileRead } from '../../../lib/api/partners'
import {
  getPartnerProfile,
  listPartnerNotifications,
  markPartnerNotificationsRead,
  partnerProfileFromRead,
  listSignupAreas,
  partnerSignup,
  setOnline,
  updatePartnerProfile,
} from './account'

type Reply = { body: unknown; status?: number }

/** A client whose `fetch` answers each request with the next reply, recording what was sent. */
function setup(...replies: Reply[]) {
  const queue = [...replies]
  const fetchMock = vi.fn<typeof fetch>(async () => {
    const { body, status = 200 } = queue.shift() ?? { body: null, status: 500 }
    return status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  })
  const client = createApiClient({ baseUrl: 'http://api.test', fetch: fetchMock })
  client.setCsrfToken('csrf-token')
  const sent = (call = 0) => {
    const [url, init] = fetchMock.mock.calls[call]
    const request = init as RequestInit
    return { url: String(url), method: request.method ?? 'GET', body: request.body ? JSON.parse(String(request.body)) : null }
  }
  return { client, fetchMock, sent }
}

const envelope = (code: string, details: unknown = null) => ({ error: { code, message: `Sample ${code}`, details } })

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(ApiError)
  return error as ApiError
}

const pending = pendingProfile as PartnerProfileRead
const approved = partnerProfile as PartnerProfileRead

describe('partnerProfileFromRead', () => {
  it('converts the approved Keke example', () => {
    expect(partnerProfileFromRead(approved)).toEqual({
      name: 'Sample Rider',
      phone: '+2348000000301',
      approval: 'approved',
      online: true,
      partner_since: '2026-08-14',
      vehicle: {
        type: 'keke',
        plate: 'ENU-123-AB',
        description: 'Tricycle with 1,000 L tank',
        tank_gallons: null,
        safe_load_litres: 1000,
        can_pour_into: 'Ground tanks',
      },
      service_areas: ['GRA'],
      documents: [],
      preferences: { new_order_alerts: true, sms_updates: true },
      payout_account_ending: null,
    })
  })

  it('builds the pending tanker text from the declared capacity', () => {
    const profile = partnerProfileFromRead(pending)
    expect(profile.approval).toBe('pending')
    expect(profile.vehicle).toMatchObject({
      type: 'tanker',
      description: '4,000 gal (16,000 L) tank',
      tank_gallons: 4000,
      safe_load_litres: null,
      can_pour_into: 'Not set yet',
    })
  })

  it('says both tank kinds, and reads an unknown approval status as pending', () => {
    const profile = partnerProfileFromRead({
      ...approved,
      approval_status: 'on_hold',
      vehicle: { ...approved.vehicle, transfer_methods: ['overhead', 'ground'] },
    })
    expect(profile.approval).toBe('pending')
    expect(profile.vehicle.can_pour_into).toBe('Ground and overhead tanks')
  })

  it('picks the app for a command-line driver without a delivery type', () => {
    const vehicle = { ...pending.vehicle, delivery_type: null, plate: null }
    expect(partnerProfileFromRead({ ...pending, vehicle }).vehicle).toMatchObject({ type: 'tanker', plate: '' })
    const keke = { ...vehicle, declared_capacity_gallons: null, declared_capacity_litres: null }
    expect(partnerProfileFromRead({ ...pending, vehicle: keke }).vehicle).toMatchObject({ type: 'keke', description: 'Tricycle' })
  })

  it('says "Tanker" for a tanker with no description and no declared capacity (#86)', () => {
    const vehicle = { ...pending.vehicle, delivery_type: 'tanker' as const, description: null, declared_capacity_gallons: null, declared_capacity_litres: null }
    expect(partnerProfileFromRead({ ...pending, vehicle }).vehicle).toMatchObject({ type: 'tanker', description: 'Tanker', tank_gallons: null })
  })
})

describe('partner account adapters (#67)', () => {
  const signupInput: PartnerSignupInput = {
    name: 'Sample Driver',
    phone: '08000000302',
    password: 'sample-password',
    vehicle_type: 'tanker',
    plate: 'enu 456 cd',
    tank_gallons: 4000,
    service_zone_id: serviceZones.items[0].id,
  }
  const driverSession = { ...authSession, user: { ...authSession.user, role: 'driver' } }

  it('listSignupAreas lists the active zones by name', async () => {
    const { client, sent } = setup({ body: serviceZones })
    const areas = await listSignupAreas(client)
    expect(sent(0)).toMatchObject({ url: 'http://api.test/api/v1/service-zones', method: 'GET' })
    expect(areas).toEqual(serviceZones.items.map((z) => ({ id: z.id, name: z.name })))
  })

  it('partnerSignup registers with the chosen zone ID', async () => {
    const { client, sent } = setup({ body: driverSession, status: 201 })
    const session = await partnerSignup(signupInput, client)
    expect(sent(0)).toEqual({
      url: 'http://api.test/api/v1/auth/partner-register',
      method: 'POST',
      body: {
        name: 'Sample Driver',
        phone: '08000000302',
        password: 'sample-password',
        delivery_type: 'tanker',
        plate: 'enu 456 cd',
        declared_capacity_gallons: 4000,
        service_zone_id: serviceZones.items[0].id,
      },
    })
    expect(session.user.role).toBe('driver')
  })

  it('partnerSignup sends no capacity for a Keke', async () => {
    const { client, sent } = setup({ body: driverSession, status: 201 })
    await partnerSignup({ ...signupInput, vehicle_type: 'keke', tank_gallons: 4000 }, client)
    expect(sent(0).body).toMatchObject({ delivery_type: 'keke', declared_capacity_gallons: null })
  })

  it('partnerSignup passes phone_already_registered through', async () => {
    const { client } = setup({ body: envelope('phone_already_registered'), status: 409 })
    const error = await rejection(partnerSignup(signupInput, client))
    expect([error.status, error.code]).toEqual([409, 'phone_already_registered'])
  })

  it('partnerSignup renames contract fields in validation_error to the form fields', async () => {
    const details = [
      { loc: ['body', 'declared_capacity_gallons'], msg: 'Use 500 to 20,000 gallons', type: 'value_error' },
      { loc: ['body', 'plate'], msg: 'Use 4 to 15 characters', type: 'value_error' },
    ]
    const { client } = setup({ body: envelope('validation_error', details), status: 422 })
    const error = await rejection(partnerSignup(signupInput, client))
    expect(error.code).toBe('validation_error')
    expect(error.details).toEqual([
      { loc: ['body', 'tank_gallons'], msg: 'Use 500 to 20,000 gallons', type: 'value_error' },
      { loc: ['body', 'plate'], msg: 'Use 4 to 15 characters', type: 'value_error' },
    ])
  })

  it('partnerSignup keeps every other field error when the server refuses the zone (#80)', async () => {
    const details = [
      { loc: ['body', 'service_zone_id'], msg: 'Choose an active service zone', type: 'value_error' },
      { loc: ['body', 'plate'], msg: 'Use 4 to 15 characters', type: 'value_error' },
      { loc: ['body'], msg: 'Request body is not valid', type: 'value_error' },
    ]
    const { client } = setup({ body: envelope('validation_error', details), status: 422 })
    const error = await rejection(partnerSignup(signupInput, client))
    expect(error.code).toBe('validation_error')
    expect(error.details).toEqual([
      { loc: ['body', 'service_zone_id'], msg: 'This area is not open for sign-up any more. Choose another area.', type: 'value_error' },
      { loc: ['body', 'plate'], msg: 'Use 4 to 15 characters', type: 'value_error' },
      { loc: ['body'], msg: 'Request body is not valid', type: 'value_error' },
    ])
  })

  it('partnerSignup leaves a field named like an inherited key alone (#80)', async () => {
    const details = [{ loc: ['body', 'constructor'], msg: 'Unexpected field', type: 'extra_forbidden' }]
    const { client } = setup({ body: envelope('validation_error', details), status: 422 })
    expect((await rejection(partnerSignup(signupInput, client))).details).toEqual(details)
  })

  it('getPartnerProfile converts the server profile', async () => {
    const { client, sent } = setup({ body: pendingProfile })
    const profile = await getPartnerProfile(client)
    expect(sent().url).toBe('http://api.test/api/v1/driver/profile')
    expect(profile).toMatchObject({ approval: 'pending', online: false, service_areas: ['GRA'] })
  })

  it('getPartnerProfile passes no_driver_profile through', async () => {
    const error = await rejection(getPartnerProfile(setup({ body: envelope('no_driver_profile'), status: 404 }).client))
    expect([error.status, error.code]).toEqual([404, 'no_driver_profile'])
  })

  it('updatePartnerProfile sends a real preference', async () => {
    const { client, sent } = setup({ body: { ...partnerProfile, preferences: { new_order_alerts: true, sms_updates: false } } })
    const profile = await updatePartnerProfile({ preferences: { sms_updates: false } }, client)
    expect(sent()).toMatchObject({ method: 'PATCH', body: { preferences: { sms_updates: false } } })
    expect(profile.preferences).toEqual({ new_order_alerts: true, sms_updates: false })
  })

  it('updatePartnerProfile passes validation_error through', async () => {
    const error = await rejection(updatePartnerProfile({ preferences: { new_order_alerts: false } }, setup({ body: envelope('validation_error', []), status: 422 }).client))
    expect(error.code).toBe('validation_error')
  })

  it('setOnline returns the converted profile', async () => {
    const { client, sent } = setup({ body: partnerProfile })
    const profile = await setOnline(true, client)
    expect(sent()).toMatchObject({ url: 'http://api.test/api/v1/driver/availability', method: 'PUT', body: { is_available: true } })
    expect(profile.online).toBe(true)
  })

  it('setOnline passes partner_not_approved through with its message', async () => {
    const error = await rejection(setOnline(true, setup({ body: notApproved, status: 403 }).client))
    expect([error.status, error.code, error.message]).toEqual([403, 'partner_not_approved', notApproved.error.message])
  })

  it('listPartnerNotifications shows a kind this build does not know in the neutral account style', async () => {
    const extra = { id: 'x', kind: 'weather_alert', title: 'Heavy rain today', body: 'Expect slow roads.', reference: null, created_at: '2026-10-27T07:00:00Z', read_at: null }
    const { client } = setup({ body: { ...notificationsPage, items: [extra], total: 1 } })
    expect((await listPartnerNotifications(client)).items).toEqual([
      { id: 'x', kind: 'account', title: 'Heavy rain today', body: 'Expect slow roads.', at: '2026-10-27T07:00:00Z', read: false, reference: null },
    ])
  })

  it('listPartnerNotifications keeps the server unread count beyond the page (#80)', async () => {
    // All messages on the page are read, but older unread ones exist on later pages.
    const read = { ...notificationsPage.items[1] }
    const { client } = setup({ body: { items: [read], unread_count: 7, total: 120, limit: 50, offset: 0 } })
    const list = await listPartnerNotifications(client)
    expect(list.items.every((n) => n.read)).toBe(true)
    expect(list.unread_count).toBe(7)
  })

  it('listPartnerNotifications converts the contract example', async () => {
    const { client } = setup({ body: notificationsPage })
    const list = await listPartnerNotifications(client)
    expect(list.unread_count).toBe(1)
    expect(list.items).toEqual([
      {
        id: 'c3e1a9b0-5d7f-4a2c-8e6b-1f0d9a3c5b72',
        kind: 'assigned',
        title: 'Admin assigned you an order',
        body: 'MO-3HT8WQ2KZP · 600 L · Independence Layout',
        at: '2026-10-26T09:12:00Z',
        read: false,
        reference: 'MO-3HT8WQ2KZP',
      },
      {
        id: 'e8f2b4c6-1a3d-4e5f-9b7c-0d2e4f6a8b13',
        kind: 'account',
        title: 'You can take orders now',
        body: 'Admin approved your keke. Go online to get orders.',
        at: '2026-08-14T10:30:00Z',
        read: true,
        reference: null,
      },
    ])
  })

  it('listPartnerNotifications passes a 401 through', async () => {
    const error = await rejection(listPartnerNotifications(setup({ body: envelope('not_authenticated'), status: 401 }).client))
    expect(error.code).toBe('not_authenticated')
  })

  it('markPartnerNotificationsRead marks all read', async () => {
    const { client, sent } = setup({ body: null, status: 204 })
    await markPartnerNotificationsRead(client)
    expect(sent()).toEqual({ url: 'http://api.test/api/v1/driver/notifications/read', method: 'POST', body: {} })
  })

  it('markPartnerNotificationsRead passes csrf_failed through', async () => {
    const error = await rejection(markPartnerNotificationsRead(setup({ body: envelope('csrf_failed'), status: 403 }).client))
    expect(error.code).toBe('csrf_failed')
  })
})
