import { describe, expect, it, vi } from 'vitest'
import notApproved from '../../../../docs/api/examples/error-partner-not-approved.json'
import notificationsPage from '../../../../docs/api/examples/partner-notifications.json'
import profileUpdate from '../../../../docs/api/examples/partner-profile-update-request.json'
import partnerProfile from '../../../../docs/api/examples/partner-profile.json'
import pendingProfile from '../../../../docs/api/examples/partner-profile-pending.json'
import registerRequest from '../../../../docs/api/examples/partner-register-request.json'
import authSession from '../../../../docs/api/examples/auth-session.json'
import serviceZones from '../../../../docs/api/examples/service-zones.json'
import { ApiError, createApiClient, CSRF_HEADER } from './client'
import {
  getDriverProfile,
  listDriverNotifications,
  listServiceZoneOptions,
  markDriverNotificationsRead,
  registerPartner,
  setDriverAvailability,
  updateDriverProfile,
  type PartnerRegisterRequest,
} from './partners'

const BASE_URL = 'http://api.test'

function jsonResponse(body: unknown, status = 200): Response {
  return status === 204
    ? new Response(null, { status })
    : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function setup(body: unknown, status = 200) {
  const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(body, status))
  const client = createApiClient({ baseUrl: BASE_URL, fetch: fetchMock })
  client.setCsrfToken('csrf-token')
  return { fetchMock, client }
}

function sent(fetchMock: ReturnType<typeof setup>['fetchMock']) {
  const [url, init] = fetchMock.mock.calls[0]
  const request = init as RequestInit
  return {
    url: String(url),
    method: request.method ?? 'GET',
    body: request.body ? JSON.parse(String(request.body)) : null,
    csrf: new Headers(request.headers).get(CSRF_HEADER),
  }
}

const envelope = (code: string, details: unknown = null) => ({ error: { code, message: `Sample ${code}`, details } })

describe('partner account calls', () => {
  it('registers a partner with the contract example and keeps the CSRF token', async () => {
    const { fetchMock, client } = setup({ ...authSession, user: { ...authSession.user, role: 'driver' } }, 201)
    const session = await registerPartner(registerRequest as PartnerRegisterRequest, client)
    expect(sent(fetchMock)).toMatchObject({ url: `${BASE_URL}/api/v1/auth/partner-register`, method: 'POST', body: registerRequest })
    expect(session.user.role).toBe('driver')

    await getDriverProfile(undefined, client).catch(() => undefined)
    await setDriverAvailability(false, client).catch(() => undefined)
    const [, init] = fetchMock.mock.calls[2]
    expect(new Headers((init as RequestInit).headers).get(CSRF_HEADER)).toBe(authSession.csrf_token)
  })

  it('passes phone_already_registered through', async () => {
    const { client } = setup(envelope('phone_already_registered'), 409)
    await expect(registerPartner(registerRequest as PartnerRegisterRequest, client)).rejects.toMatchObject({
      status: 409,
      code: 'phone_already_registered',
    } satisfies Partial<ApiError>)
  })

  it('lists the service zones without a session', async () => {
    const { fetchMock, client } = setup(serviceZones)
    // The list now also carries each zone's centre and boundary (#346); the sign-up picker reads only id and name.
    await expect(listServiceZoneOptions(undefined, client)).resolves.toEqual(serviceZones.items.map(({ id, name }) => ({ id, name })))
    expect(sent(fetchMock)).toMatchObject({ url: `${BASE_URL}/api/v1/service-zones`, method: 'GET' })
  })

  it('reads both profile examples in the contract', async () => {
    for (const example of [partnerProfile, pendingProfile]) {
      const { fetchMock, client } = setup(example)
      await expect(getDriverProfile(undefined, client)).resolves.toEqual(example)
      expect(sent(fetchMock).url).toBe(`${BASE_URL}/api/v1/driver/profile`)
    }
  })

  it('preserves a future location state without accepting coordinates (#410)', async () => {
    const location = { ...partnerProfile.location, state: 'unavailable' }
    const { client } = setup({ ...partnerProfile, location: { ...location, latitude: 6.452713, longitude: 7.510348, grant: 7 } })
    const profile = await getDriverProfile(undefined, client)
    expect(profile.location).toEqual(location)
  })

  it('rejects malformed location sharing metadata (#410)', async () => {
    const { client } = setup({ ...partnerProfile, location: { ...partnerProfile.location, sharing: 'yes' } })
    await expect(getDriverProfile(undefined, client)).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('reads an approval status this build does not know', async () => {
    const { client } = setup({ ...partnerProfile, approval_status: 'on_hold' })
    await expect(getDriverProfile(undefined, client)).resolves.toMatchObject({ approval_status: 'on_hold' })
  })

  it('reports a profile with the wrong shape as invalid_response', async () => {
    const { client } = setup({ ...partnerProfile, is_available: 'yes' })
    await expect(getDriverProfile(undefined, client)).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('passes no_driver_profile through', async () => {
    const { client } = setup(envelope('no_driver_profile'), 404)
    await expect(getDriverProfile(undefined, client)).rejects.toMatchObject({ status: 404, code: 'no_driver_profile' })
  })

  it('patches the preferences with CSRF', async () => {
    const { fetchMock, client } = setup({ ...partnerProfile, preferences: { new_order_alerts: true, sms_updates: false } })
    const profile = await updateDriverProfile(profileUpdate, client)
    expect(sent(fetchMock)).toMatchObject({ url: `${BASE_URL}/api/v1/driver/profile`, method: 'PATCH', body: profileUpdate, csrf: 'csrf-token' })
    expect(profile.preferences.sms_updates).toBe(false)
  })

  it('passes validation_error from the profile update through', async () => {
    const details = [{ loc: ['body', 'preferences', 'sms_updates'], msg: 'Input should be a valid boolean', type: 'bool_type' }]
    const { client } = setup(envelope('validation_error', details), 422)
    await expect(updateDriverProfile({ preferences: { sms_updates: false } }, client)).rejects.toMatchObject({ code: 'validation_error', details })
  })

  it('puts the availability', async () => {
    const { fetchMock, client } = setup(partnerProfile)
    await setDriverAvailability(true, client)
    expect(sent(fetchMock)).toMatchObject({ url: `${BASE_URL}/api/v1/driver/availability`, method: 'PUT', body: { is_available: true }, csrf: 'csrf-token' })
  })

  it('passes partner_not_approved through', async () => {
    const { client } = setup(notApproved, 403)
    await expect(setDriverAvailability(true, client)).rejects.toMatchObject({
      status: 403,
      code: 'partner_not_approved',
      message: notApproved.error.message,
    })
  })

  it('lists notifications, with a page when asked', async () => {
    const { fetchMock, client } = setup(notificationsPage)
    const page = await listDriverNotifications({}, undefined, client)
    expect(sent(fetchMock).url).toBe(`${BASE_URL}/api/v1/driver/notifications`)
    expect(page.unread_count).toBe(1)
    expect(page.items[1].read_at).toBe('2026-08-14T11:02:00Z')

    const paged = setup(notificationsPage)
    await listDriverNotifications({ limit: 20, offset: 40 }, undefined, paged.client)
    expect(sent(paged.fetchMock).url).toBe(`${BASE_URL}/api/v1/driver/notifications?limit=20&offset=40`)
  })

  it('marks every notification read, or only the given ids', async () => {
    const all = setup(null, 204)
    await markDriverNotificationsRead(undefined, all.client)
    expect(sent(all.fetchMock)).toMatchObject({ url: `${BASE_URL}/api/v1/driver/notifications/read`, method: 'POST', body: {}, csrf: 'csrf-token' })

    const some = setup(null, 204)
    await markDriverNotificationsRead(['c3e1a9b0-5d7f-4a2c-8e6b-1f0d9a3c5b72'], some.client)
    expect(sent(some.fetchMock).body).toEqual({ ids: ['c3e1a9b0-5d7f-4a2c-8e6b-1f0d9a3c5b72'] })
  })

  it('passes validation_error from mark-read through', async () => {
    const { client } = setup(envelope('validation_error', [{ loc: ['body', 'ids', 0], msg: 'Input should be a valid UUID', type: 'uuid_parsing' }]), 422)
    await expect(markDriverNotificationsRead(['nope'], client)).rejects.toMatchObject({ code: 'validation_error' })
  })
})
