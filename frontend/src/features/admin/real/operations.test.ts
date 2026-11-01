import { describe, expect, it, vi } from 'vitest'
import activitySample from '../../../../../docs/api/examples/admin-activity.json'
import dashboardSample from '../../../../../docs/api/examples/admin-dashboard.json'
import liveMapSample from '../../../../../docs/api/examples/admin-live-map.json'
import settingsSample from '../../../../../docs/api/examples/admin-settings.json'
import shellSample from '../../../../../docs/api/examples/admin-shell.json'
import { ApiError, createApiClient } from '../../../lib/api/client'
import type { AdminDashboardRead, LiveMapRead } from '../../../lib/api/adminOperations'
import { dashboardFromRead, getAdminAccount, getDashboard, getLiveMap, getSettings, getShellData, listActivity, liveMapFromRead, settingsFromRead } from './operations'

const ME = { user: { id: 'u1', name: 'Sample Admin', phone: '+2348000000099', role: 'admin', phone_verified: true }, csrf_token: 'csrf', expires_at: '2026-10-29T00:00:00Z' }
const envelope = (code: string) => ({ error: { code, message: 'No', details: null } })

/** A fetch that answers by path, so the shell's two parallel requests each get their own body. */
function clientByPath(routes: Record<string, { body: unknown; status?: number }>) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const path = new URL(String(input)).pathname.replace('/api/v1', '')
    const { body, status = 200 } = routes[path] ?? { body: envelope('not_found'), status: 404 }
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  })
  return { fetchMock, client: createApiClient({ baseUrl: 'http://api.test', fetch: fetchMock }) }
}

const DASHBOARD = dashboardSample as unknown as AdminDashboardRead
const LIVE_MAP = liveMapSample as unknown as LiveMapRead

describe('getShellData', () => {
  it('takes the name from /auth/me and the counts from /admin/shell; the role is Admin', async () => {
    const { client } = clientByPath({ '/auth/me': { body: ME }, '/admin/shell': { body: shellSample } })
    expect(await getShellData(client)).toEqual({ user: { name: 'Sample Admin', role: 'Admin' }, counts: { orders: 3, support: 1 }, unread: 2 })
  })

  it('passes 401 not_authenticated through', async () => {
    const { client } = clientByPath({ '/auth/me': { body: envelope('not_authenticated'), status: 401 }, '/admin/shell': { body: envelope('not_authenticated'), status: 401 } })
    await expect(getShellData(client)).rejects.toMatchObject({ status: 401, code: 'not_authenticated' })
  })
})

describe('getAdminAccount (#235)', () => {
  it('takes the name and phone from /auth/me, the role is Admin, and nothing else is read', async () => {
    const { client, fetchMock } = clientByPath({ '/auth/me': { body: ME } })
    expect(await getAdminAccount(client)).toEqual({ name: 'Sample Admin', phone: '+2348000000099', role: 'Admin', last_active: null })
    // Only /auth/me: the page shows no last sign-in, so the settings staff list is not read.
    expect(fetchMock.mock.calls.map((c) => new URL(String(c[0])).pathname)).toEqual(['/api/v1/auth/me'])
  })

  it.each([
    [401, 'not_authenticated'],
    [403, 'forbidden'],
  ])('passes %i %s through', async (status, code) => {
    const { client } = clientByPath({ '/auth/me': { body: envelope(code), status } })
    await expect(getAdminAccount(client)).rejects.toMatchObject({ status, code })
  })
})

describe('dashboardFromRead', () => {
  it('groups by_status into the four tiles, keeps the total, and leaves out what has no source', () => {
    const dashboard = dashboardFromRead(DASHBOARD)
    // confirmed (2) is awaiting a rider; assigned (1) and en_route (3) are in progress.
    expect(dashboard.orders).toEqual({ total: 14, awaiting_rider: 2, in_progress: 4, delivered: 7, cancelled: 1, oldest_waiting_minutes: 42 })
    expect(dashboard.disputes_open).toBe(1)
    expect(dashboard.riders_online).toEqual({ total: 4, keke: 3, tanker: 1 })
    expect(dashboard.stations).toEqual({ open: 2, closed: 1 })
    expect(dashboard.revenue_today_minor_units).toBe(4130000)
    expect(dashboard.by_type).toEqual({ keke: 9, tanker: 5 })
    expect(dashboard.is_sample).toBe(true)
    expect(dashboard.payouts_due).toBeUndefined()
    expect(dashboard.payments_to_verify).toBeUndefined()
  })

  it('counts failed, disputed and unconfirmed orders in the total only, never in a tile', () => {
    const read = { ...DASHBOARD, orders: { ...DASHBOARD.orders, total: 5, by_status: { failed: 1, disputed: 1, awaiting_confirmation: 2, quote_requested: 1 } } }
    expect(dashboardFromRead(read).orders).toMatchObject({ total: 5, awaiting_rider: 0, in_progress: 0, delivered: 0, cancelled: 0 })
  })

  it('reads a real-orders dashboard as not sample', () => {
    expect(dashboardFromRead({ ...DASHBOARD, is_simulated: false }).is_sample).toBe(false)
  })

  it('loads the dashboard through the client, sending no simulated parameter', async () => {
    const { client, fetchMock } = clientByPath({ '/admin/dashboard': { body: dashboardSample } })
    expect((await getDashboard(client)).orders.total).toBe(14)
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('simulated')
  })

  it('passes 403 forbidden through', async () => {
    const { client } = clientByPath({ '/admin/dashboard': { body: envelope('forbidden'), status: 403 } })
    await expect(getDashboard(client)).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  })
})

describe('liveMapFromRead', () => {
  it('uses the plate as the code, the zone as the customer area and the source location as the station area', () => {
    const map = liveMapFromRead(LIVE_MAP)
    expect(map.deliveries).toEqual([
      { reference: 'MO-7KQ2M9XH4T', code: 'ENU-123-KK', vehicle: 'keke', status: 'on_the_way', station_area: 'Off Ogui Road', customer_area: 'Sample Zone Independence Layout', partner: 'Sample Driver One' },
    ])
    expect(map.stations).toEqual([
      { id: '9c1d3e5f-7a2b-4c4d-8e6f-1a3b5c7d9e02', name: 'Sample Borehole A', area: 'Off Ogui Road', open: true },
      { id: '1e3f5a7b-9c2d-4e4f-8a6b-3c5d7e9f1a04', name: 'Sample Borehole B', area: 'Near Abakpa market', open: false },
    ])
  })

  it('keeps no vehicle, plate, source or zone as null: the map draws a neutral marker and no label', () => {
    const sparse: LiveMapRead = { ...LIVE_MAP, deliveries: [{ ...LIVE_MAP.deliveries[0], delivery_type: null, driver: { ...LIVE_MAP.deliveries[0].driver, plate: null }, source: null, zone: null }] }
    expect(liveMapFromRead(sparse).deliveries[0]).toMatchObject({ vehicle: null, code: null, station_area: null, customer_area: null })
  })

  it('loads through the client and passes 403 through', async () => {
    const ok = clientByPath({ '/admin/live-map': { body: liveMapSample } })
    expect((await getLiveMap(ok.client)).deliveries).toHaveLength(1)
    const denied = clientByPath({ '/admin/live-map': { body: envelope('forbidden'), status: 403 } })
    await expect(getLiveMap(denied.client)).rejects.toBeInstanceOf(ApiError)
  })
})

describe('listActivity', () => {
  it('words each item, never names a customer, and keeps the order reference', async () => {
    const { client } = clientByPath({ '/admin/activity': { body: activitySample } })
    expect(await listActivity(undefined, client)).toEqual([
      { id: 'b71e4a2c-6d8f-4a1b-9c3e-5f7a9b1d3e08', at: '2026-10-27T09:40:00Z', kind: 'accepted', text: 'Sample Driver One accepted MO-7KQ2', reference: 'MO-7KQ2M9XH4T' },
      { id: '4c2a6e8b-0d1f-4b3a-8c5e-7a9d1f3b5c10', at: '2026-10-27T09:31:00Z', kind: 'complaint', text: 'New support request on MO-3HT8', reference: 'MO-3HT8WQ2KZP' },
      { id: '8e0a2c4e-6f1b-4d3c-9e5a-1b3d5f7a9c12', at: '2026-10-27T09:12:00Z', kind: 'admin', text: 'Sample Admin moved MO-3HT8 to Assigned', reference: 'MO-3HT8WQ2KZP' },
    ])
  })

  it.each([
    ['quote_requested', null, 'new_order', 'New order MO-7KQ2'],
    ['delivered', null, 'delivered', 'MO-7KQ2 delivered'],
    ['cancelled', null, 'admin', 'MO-7KQ2 is now Cancelled'],
  ])('maps %s without an actor', async (to, actor, kind, text) => {
    const item = { ...activitySample.items[0], to_status: to, actor }
    const { client } = clientByPath({ '/admin/activity': { body: { items: [item] } } })
    expect((await listActivity(undefined, client))[0]).toMatchObject({ kind, text })
  })

  // #275 item 3 (G2, @nnamdi-security, 2026-11-01): each driver step keeps its own name, as on the order timeline.
  it.each([
    ['departed', 'Demo Driver moved MO-7KQ2 to Departed'],
    ['collected', 'Demo Driver moved MO-7KQ2 to Collected'],
    ['en_route', 'Demo Driver moved MO-7KQ2 to En route'],
    ['arrived', 'Demo Driver moved MO-7KQ2 to Arrived'],
    ['unloading', 'Demo Driver moved MO-7KQ2 to Unloading'],
  ])('names the driver step %s, not the shared status label (#275)', async (to, text) => {
    const item = { ...activitySample.items[0], to_status: to, actor: { ...activitySample.items[0].actor, name: 'Demo Driver' } }
    const { client } = clientByPath({ '/admin/activity': { body: { items: [item] } } })
    expect((await listActivity(undefined, client))[0]).toMatchObject({ kind: 'admin', text })
  })

  it('keeps the step name without an actor (#275)', async () => {
    const item = { ...activitySample.items[0], to_status: 'en_route', actor: null }
    const { client } = clientByPath({ '/admin/activity': { body: { items: [item] } } })
    expect((await listActivity(undefined, client))[0]).toMatchObject({ text: 'MO-7KQ2 is now En route' })
  })

  it('shows a kind it does not know as a plain line, not an error', async () => {
    const item = { ...activitySample.items[0], kind: 'something_new', to_status: null, actor: null }
    const { client } = clientByPath({ '/admin/activity': { body: { items: [item] } } })
    expect((await listActivity(undefined, client))[0]).toMatchObject({ kind: 'admin', text: 'Update on MO-7KQ2' })
  })

  it('passes 422 validation_error through for a limit outside 1 to 20', async () => {
    const { client } = clientByPath({ '/admin/activity': { body: envelope('validation_error'), status: 422 } })
    await expect(listActivity(50, client)).rejects.toMatchObject({ status: 422, code: 'validation_error' })
  })
})

describe('settings', () => {
  it('maps the support phone, the code limit and the staff; support hours and safe load stay empty', async () => {
    const { client } = clientByPath({ '/admin/settings': { body: settingsSample } })
    const { settings, staff } = await getSettings(client)
    expect(settings).toEqual({ support_phone: '+2348133774902', support_hours: null, code_time_limit: '10 minutes', safe_load: { keke: null, tanker: null } })
    expect(staff).toEqual([{ id: '7d3c2e1f-4b5a-4c6d-8e9f-0a1b2c3d4e5f', name: 'Sample Admin', role: 'Admin', phone: '+2348000000099', last_active: '2026-10-27T07:58:00Z' }])
  })

  it('keeps a staff member who never signed in as null, and words one minute in the singular', () => {
    const read = { ...settingsSample, delivery_code_validity_minutes: 1, staff: [{ ...settingsSample.staff[0], last_sign_in_at: null }] }
    const { settings, staff } = settingsFromRead(read)
    expect(settings.code_time_limit).toBe('1 minute')
    expect(staff[0].last_active).toBeNull()
  })

  it('passes 403 forbidden through', async () => {
    const { client } = clientByPath({ '/admin/settings': { body: envelope('forbidden'), status: 403 } })
    await expect(getSettings(client)).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  })
})
