import { describe, expect, it, vi } from 'vitest'
import auditSample from '../../../../../docs/api/examples/admin-audit-logs-page.json'
import notificationsSample from '../../../../../docs/api/examples/admin-notifications-page.json'
import alreadyResolvedSample from '../../../../../docs/api/examples/error-support-request-already-resolved.json'
import requestSample from '../../../../../docs/api/examples/admin-support-request.json'
import requestsPageSample from '../../../../../docs/api/examples/admin-support-requests-page.json'
import { createApiClient } from '../../../lib/api/client'
import type { AdminSupportRequest, AuditLogRead } from '../../../lib/api/adminSupport'
import {
  auditEntryFromRead,
  getIssuePeople,
  issueFromRead,
  listAdminNotifications,
  listAudit,
  listIssues,
  markAdminNotificationsRead,
  notificationFromRead,
  resolveIssue,
} from './support'

const envelope = (code: string) => ({ error: { code, message: 'No', details: null } })

/** A fetch that answers by method and path; a path with no answer is a 404. */
function clientByPath(routes: Record<string, { body: unknown; status?: number }>) {
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input))
    const key = `${(init as RequestInit | undefined)?.method ?? 'GET'} ${url.pathname.replace('/api/v1', '')}`
    const { body, status = 200 } = routes[key] ?? { body: envelope('not_found'), status: 404 }
    return status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  })
  const client = createApiClient({ baseUrl: 'http://api.test', fetch: fetchMock })
  client.setCsrfToken('csrf-token')
  return { fetchMock, client }
}

const OPEN = requestsPageSample.items[0] as AdminSupportRequest
const RESOLVED = requestSample as AdminSupportRequest

describe('issueFromRead', () => {
  it('uses the reference as id and number, the customer as the reporter, and never invents an urgent flag', () => {
    expect(issueFromRead(OPEN)).toEqual({
      id: 'SR-9P3T6W2Z',
      number: 'SR-9P3T6W2Z',
      type: 'wrong_quantity',
      title: 'Wrong quantity',
      message: 'I think the tank was not filled to 2,000 litres.',
      reference: 'MO-3HT8WQ2KZP',
      reported_by: 'customer',
      reporter_name: 'Sample Customer',
      at: '2026-10-27T09:31:00Z',
      urgent: false,
      status: 'open',
      resolution: null,
    })
  })

  it('shows a resolution as its note, who resolved it and when, with no action or points', () => {
    const issue = issueFromRead(RESOLVED)
    expect(issue.status).toBe('resolved')
    expect(issue.resolution).toEqual({
      reason: 'Called the customer: the driver arrived at 13:40 and delivered in full.',
      by: 'Sample Admin',
      at: '2026-10-26T13:55:00Z',
    })
    expect(issue.resolution).not.toHaveProperty('action')
    expect(issue.resolution).not.toHaveProperty('points')
  })

  it.each([
    ['late', 'late', 'Delivery was late'],
    ['wrong_quantity', 'wrong_quantity', 'Wrong quantity'],
    ['payment', 'other', 'Problem reported'],
    ['rider', 'other', 'Problem reported'],
    ['other', 'other', 'Problem reported'],
    ['something_new', 'other', 'Problem reported'],
  ])('maps the request type %s to the issue type %s and the title "%s"', (type, issueType, title) => {
    expect(issueFromRead({ ...OPEN, type })).toMatchObject({ type: issueType, title })
  })

  it('keeps a request that is not about an order as having no reference', () => {
    expect(issueFromRead({ ...OPEN, order_reference: null }).reference).toBeNull()
  })
})

describe('listIssues', () => {
  it('reads the first 100 with the search text, in the server order', async () => {
    const { client, fetchMock } = clientByPath({ 'GET /admin/support-requests': { body: requestsPageSample } })
    const issues = await listIssues('  MO-3HT8  ', client)
    expect(issues.map((i) => i.id)).toEqual(['SR-9P3T6W2Z', 'SR-4K7M2Q9X'])
    expect(String(fetchMock.mock.calls[0][0])).toContain('q=MO-3HT8')
    expect(String(fetchMock.mock.calls[0][0])).toContain('limit=100')
  })

  it('sends no q when the search is empty', async () => {
    const { client, fetchMock } = clientByPath({ 'GET /admin/support-requests': { body: requestsPageSample } })
    await listIssues('', client)
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('q=')
  })

  it('passes 403 forbidden through', async () => {
    const { client } = clientByPath({ 'GET /admin/support-requests': { body: envelope('forbidden'), status: 403 } })
    await expect(listIssues(undefined, client)).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  })
})

describe('getIssuePeople', () => {
  it('words the roles: a customer is "Customer" and a driver is "Driver" (the contacts carry no delivery type)', async () => {
    const detail = {
      ...requestSample,
      contacts: [
        { name: 'Sample Customer', role: 'customer', phone: '+2348000000001' },
        { name: 'Sample Driver One', role: 'driver', phone: '+2348000000011' },
      ],
    }
    const { client } = clientByPath({ 'GET /admin/support-requests/SR-4K7M2Q9X': { body: detail } })
    expect(await getIssuePeople('SR-4K7M2Q9X', client)).toEqual([
      { name: 'Sample Customer', role: 'Customer', phone: '+2348000000001' },
      { name: 'Sample Driver One', role: 'Driver', phone: '+2348000000011' },
    ])
  })

  it('passes 404 support_request_not_found through', async () => {
    const { client } = clientByPath({ 'GET /admin/support-requests/SR-NOPE0000': { body: envelope('support_request_not_found'), status: 404 } })
    await expect(getIssuePeople('SR-NOPE0000', client)).rejects.toMatchObject({ status: 404, code: 'support_request_not_found' })
  })
})

describe('resolveIssue', () => {
  it('sends only the note and returns the resolved issue', async () => {
    const { client, fetchMock } = clientByPath({ 'POST /admin/support-requests/SR-4K7M2Q9X/resolve': { body: requestSample } })
    const issue = await resolveIssue('SR-4K7M2Q9X', 'Called the customer.', client)
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ note: 'Called the customer.' })
    expect(issue.status).toBe('resolved')
  })

  it.each([
    [409, 'support_request_already_resolved', alreadyResolvedSample],
    [422, 'validation_error', envelope('validation_error')],
    [404, 'support_request_not_found', envelope('support_request_not_found')],
  ])('passes %i %s through', async (status, code, body) => {
    const { client } = clientByPath({ 'POST /admin/support-requests/SR-4K7M2Q9X/resolve': { body, status } })
    await expect(resolveIssue('SR-4K7M2Q9X', 'Called the customer.', client)).rejects.toMatchObject({ status, code })
  })
})

describe('audit log', () => {
  it('words a known action, names the actor and the record, and has no reason', () => {
    expect(auditEntryFromRead(auditSample.items[0] as unknown as AuditLogRead)).toEqual({
      id: 'e5a1c3e5-7b9d-4f1a-8c3e-5a7c9e1b3d14',
      at: '2026-10-27T10:05:00Z',
      actor: 'Sample Admin',
      action: 'Resolved a support request',
      reason: null,
      target: 'Support request · 6a8c0e',
    })
  })

  const row = (action: string, details: Record<string, unknown> = {}, target = { target_type: 'driver', target_id: '4f3a2c9e-1111-4222-8333-444455556666' }) =>
    ({ ...(auditSample.items[0] as unknown as AuditLogRead), action, details, ...target }) as AuditLogRead

  it.each(['driver_approved', 'driver_suspended', 'driver_activated', 'driver_deactivated'])('shows the staff reason on %s (#293)', (action) => {
    expect(auditEntryFromRead(row(action, { reason: 'Papers expired' })).reason).toBe('Papers expired')
  })

  it('shows no reason on a driver row that has none', () => {
    expect(auditEntryFromRead(row('driver_approved', { safe_payload_litres: 600 })).reason).toBeNull()
  })

  it('shows no reason on any other action, even if its details hold one (#293)', () => {
    for (const action of ['support_request_resolved', 'price_list_saved', 'cash_received', 'order_confirmed', 'service_zone_updated']) {
      expect(auditEntryFromRead(row(action, { reason: 'A staff note that must stay off the screen' })).reason).toBeNull()
    }
  })

  it('ignores a reason that is not text, or only spaces, and trims the rest', () => {
    expect(auditEntryFromRead(row('driver_suspended', { reason: 5 })).reason).toBeNull()
    expect(auditEntryFromRead(row('driver_suspended', { reason: '   ' })).reason).toBeNull()
    expect(auditEntryFromRead(row('driver_suspended', { reason: '  Papers expired ' })).reason).toBe('Papers expired')
  })

  it.each([
    ['cash_recorded', 'Recorded a cash collection'],
    ['cash_handed_over', 'Handed over cash'],
    ['cash_received', 'Received cash'],
    ['cash_reconciled', 'Reconciled cash'],
    ['cash_corrected', 'Corrected a cash amount'],
    ['cash_remittance_recorded', 'Recorded a cash handover'],
  ])('words %s as "%s" (#293, G2 approved)', (code, words) => {
    expect(auditEntryFromRead(row(code)).action).toBe(words)
  })

  it('names the record by its kind and the first six characters of its id', () => {
    expect(auditEntryFromRead(row('driver_suspended')).target).toBe('Driver · 4f3a2c')
    expect(auditEntryFromRead(row('service_zone_updated', {}, { target_type: 'service_zone', target_id: 'abcdef123456' })).target).toBe('Service area · abcdef')
  })

  it('shows a kind it has no words for as the code, and no target when the server sent neither', () => {
    expect(auditEntryFromRead(row('x', {}, { target_type: 'new_kind', target_id: '123456789' })).target).toBe('new_kind · 123456')
    expect(auditEntryFromRead(row('x', {}, { target_type: '', target_id: '' })).target).toBeNull()
  })

  it('shows an action code it has no words for as the code itself', () => {
    expect(auditEntryFromRead({ ...(auditSample.items[0] as unknown as AuditLogRead), action: 'deletion_request_approved' }).action).toBe('deletion_request_approved')
  })

  it('does not treat an object property name as a known action', () => {
    expect(auditEntryFromRead({ ...(auditSample.items[0] as unknown as AuditLogRead), action: 'constructor' }).action).toBe('constructor')
  })

  it('reads the log with a limit and passes 403 forbidden through', async () => {
    const ok = clientByPath({ 'GET /admin/audit-logs': { body: auditSample } })
    expect((await listAudit(20, ok.client)).map((e) => e.action)).toEqual(['Resolved a support request', 'Approved alternative proof'])
    expect(String(ok.fetchMock.mock.calls[0][0])).toContain('limit=20')
    const denied = clientByPath({ 'GET /admin/audit-logs': { body: envelope('forbidden'), status: 403 } })
    await expect(listAudit(undefined, denied.client)).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  })
})

describe('notifications', () => {
  const [declined, partner, support] = notificationsSample.items

  it('opens an order from a notification with a reference, and marks read from read_at', () => {
    expect(notificationFromRead(declined)).toEqual({
      id: declined.id,
      at: declined.created_at,
      title: 'A driver declined an order',
      body: 'MO-3HT8WQ2KZP needs another driver.',
      read: false,
      link: '/admin/orders?ref=MO-3HT8WQ2KZP',
    })
    expect(notificationFromRead(support).read).toBe(true)
  })

  it('opens the drivers page for a partner waiting for approval, and the Support page for a request with no order', () => {
    expect(notificationFromRead(partner).link).toBe('/admin/riders')
    expect(notificationFromRead({ ...support, reference: null }).link).toBe('/admin/support')
    expect(notificationFromRead({ ...support, reference: null, kind: 'something_new' }).link).toBe('/admin/notifications')
  })

  it('lists the notifications and marks them all read with an empty body', async () => {
    const { client, fetchMock } = clientByPath({
      'GET /admin/notifications': { body: notificationsSample },
      'POST /admin/notifications/read': { body: null, status: 204 },
    })
    expect(await listAdminNotifications(client)).toHaveLength(3)
    await markAdminNotificationsRead(client)
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST')!
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({})
  })

  it('passes 403 forbidden and csrf_failed through', async () => {
    const list = clientByPath({ 'GET /admin/notifications': { body: envelope('forbidden'), status: 403 } })
    await expect(listAdminNotifications(list.client)).rejects.toMatchObject({ status: 403, code: 'forbidden' })
    const mark = clientByPath({ 'POST /admin/notifications/read': { body: envelope('csrf_failed'), status: 403 } })
    await expect(markAdminNotificationsRead(mark.client)).rejects.toMatchObject({ status: 403, code: 'csrf_failed' })
  })
})
