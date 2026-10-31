/**
 * Admin support, audit log and notification adapters (#219): the real-API
 * side of `listIssues`, `getIssuePeople`, `resolveIssue`, `listAudit`,
 * `listAdminNotifications` and `markAdminNotificationsRead` in `adminApi.ts`,
 * converting with docs/architecture/api-mapping.md ("Admin support, audit log
 * and notifications") and docs/api/admin-operations.md.
 *
 * What the backend does not send is left out, never filled in: a request has
 * no urgent flag, no resolution action and no points, and the audit log has
 * no reason.
 */
import type { AdminIssue, AdminNotification, AuditEntry, IssueType } from '../../../domain/admin'
import {
  getAdminSupportRequest,
  listAdminAuditLogs,
  listAdminNotificationsPage,
  listAdminSupportRequests,
  markAdminNotificationsReadRequest,
  resolveAdminSupportRequest,
  type AdminNotificationRead,
  type AdminSupportRequest,
  type AuditLogRead,
} from '../../../lib/api/adminSupport'
import { apiClient, type ApiClient } from '../../../lib/api/client'
import { AUDIT_REASON_ACTIONS, auditTarget } from '../auditWording'

/** Most requests the Support page reads: the server's page maximum. */
const SUPPORT_PAGE_SIZE = 100

/** The design's issue type for a request type: only `late` and `wrong_quantity` have one; the rest are `other`. */
function issueType(type: string): IssueType {
  return type === 'late' || type === 'wrong_quantity' ? type : 'other'
}

/** The list title for a request type (api-mapping.md, "Admin support, audit log and notifications"). */
function issueTitle(type: string): string {
  if (type === 'late') return 'Delivery was late'
  if (type === 'wrong_quantity') return 'Wrong quantity'
  return 'Problem reported'
}

/**
 * A support request as the Support page shows it. There is no urgent flag
 * (`urgent` is always `false`), and a resolution is its note only.
 */
export function issueFromRead(read: AdminSupportRequest): AdminIssue {
  return {
    id: read.reference,
    number: read.reference,
    type: issueType(read.type),
    title: issueTitle(read.type),
    message: read.message,
    reference: read.order_reference,
    reported_by: 'customer',
    reporter_name: read.customer.name,
    at: read.created_at,
    urgent: false,
    status: read.status,
    resolution: read.resolution ? { reason: read.resolution.note, by: read.resolution.resolved_by.name, at: read.resolution.resolved_at } : null,
  }
}

/**
 * The support requests, open first then newest first, as the server sends them.
 *
 * @param query - The search text (`q`); empty reads every request.
 * @param client - The API client; tests pass one with a fake `fetch`.
 * @throws {ApiError} As the server sends it (401, 403, 422, network).
 */
export async function listIssues(query?: string, client: ApiClient = apiClient): Promise<AdminIssue[]> {
  const page = await listAdminSupportRequests({ q: query?.trim() || undefined, limit: SUPPORT_PAGE_SIZE }, undefined, client)
  return page.items.map(issueFromRead)
}

/**
 * The people the "Call" buttons dial for a request: its customer and, with an
 * order, the order's receiver and driver. The contacts carry no delivery
 * type, so a driver is "Driver".
 *
 * @param issueId - The request's `reference`.
 * @throws {ApiError} `support_request_not_found` (404).
 */
export async function getIssuePeople(issueId: string, client: ApiClient = apiClient): Promise<{ name: string; role: string; phone: string }[]> {
  const detail = await getAdminSupportRequest(issueId, undefined, client)
  return detail.contacts.map((c) => ({ name: c.name, role: c.role === 'customer' ? 'Customer' : c.role === 'driver' ? 'Driver' : c.role, phone: c.phone }))
}

/**
 * Resolve a request with a note. Final; changes nothing on the order.
 *
 * @param issueId - The request's `reference`.
 * @param note - 5 to 500 characters after trimming.
 * @throws {ApiError} `support_request_not_found` (404); `support_request_already_resolved` (409); `validation_error` (422).
 */
export async function resolveIssue(issueId: string, note: string, client: ApiClient = apiClient): Promise<AdminIssue> {
  return issueFromRead(await resolveAdminSupportRequest(issueId, note, client))
}

/** The audit log's plain words for each action code the backend writes (api-mapping.md). */
const AUDIT_WORDS: Record<string, string> = {
  account_name_corrected: 'Corrected an account name',
  cash_corrected: 'Corrected a cash amount',
  cash_handed_over: 'Handed over cash',
  cash_received: 'Received cash',
  cash_reconciled: 'Reconciled cash',
  cash_recorded: 'Recorded a cash collection',
  cash_remittance_recorded: 'Recorded a cash handover',
  customer_address_added: 'Added a customer address',
  customer_anonymized: 'Anonymized a customer account',
  deletion_requested: 'Deletion requested',
  driver_approved: 'Approved a driver',
  driver_suspended: 'Suspended a driver',
  driver_activated: 'Activated a driver',
  driver_deactivated: 'Deactivated a driver',
  driver_went_online: 'A driver went online',
  driver_went_offline: 'A driver went offline',
  order_confirmed: 'Confirmed an order',
  partner_registered: 'A partner signed up',
  partner_anonymized: 'Anonymized a partner account',
  password_changed: 'Changed a password',
  price_list_saved: 'Saved a price list',
  proof_override_approved: 'Approved alternative proof',
  proof_override_rejected: 'Rejected alternative proof',
  retention_review_applied: 'Applied a retention review',
  service_zone_created: 'Added a service area',
  service_zone_updated: 'Changed a service area',
  source_review_continued: 'Let a pickup continue after a source review',
  support_request_resolved: 'Resolved a support request',
  unsafe_stop_resumed: 'Resumed a job after an unsafe stop',
  water_source_added: 'Added a water source',
  water_source_kind_set: "Set a water source's kind",
  water_source_activated: 'Activated a water source',
}

/**
 * The staff reason on an audit row (#293): `details.reason` for the four driver decisions, `null` for every other row,
 * and for a reason that is not text or is only spaces. Other actions keep their notes off the screen (admin-operations.md).
 */
function auditReason(read: AuditLogRead): string | null {
  if (!AUDIT_REASON_ACTIONS.has(read.action)) return null
  const reason = read.details.reason
  return typeof reason === 'string' && reason.trim() !== '' ? reason.trim() : null
}

/** One audit row. A code with no words shows as the code. The record is a kind and a short id until the backend sends a label (#296). */
export function auditEntryFromRead(read: AuditLogRead): AuditEntry {
  return {
    id: read.id,
    at: read.at,
    actor: read.actor.name,
    action: Object.hasOwn(AUDIT_WORDS, read.action) ? AUDIT_WORDS[read.action] : read.action,
    reason: auditReason(read),
    target: auditTarget(read.target_type, read.target_id),
  }
}

/**
 * The audit log, newest first.
 *
 * @param limit - How many rows; the server defaults to 50.
 */
export async function listAudit(limit?: number, client: ApiClient = apiClient): Promise<AuditEntry[]> {
  return (await listAdminAuditLogs(limit, undefined, client)).items.map(auditEntryFromRead)
}

/** Where a notification opens: the order, the drivers page, the Support page, or the notifications page. */
function notificationLink(read: AdminNotificationRead): string {
  if (read.reference) return `/admin/orders?ref=${encodeURIComponent(read.reference)}`
  if (read.kind === 'partner_pending') return '/admin/riders'
  if (read.kind === 'support_request') return '/admin/support'
  return '/admin/notifications'
}

/** One notification as the bell shows it: `read` from `read_at`, and a link built from the kind and reference. */
export function notificationFromRead(read: AdminNotificationRead): AdminNotification {
  return { id: read.id, at: read.created_at, title: read.title, body: read.body, read: read.read_at !== null, link: notificationLink(read) }
}

/** This admin's notifications, newest first. */
export async function listAdminNotifications(client: ApiClient = apiClient): Promise<AdminNotification[]> {
  return (await listAdminNotificationsPage(undefined, client)).items.map(notificationFromRead)
}

/** Mark every unread notification of this admin read. */
export async function markAdminNotificationsRead(client: ApiClient = apiClient): Promise<void> {
  await markAdminNotificationsReadRequest(undefined, client)
}
