/**
 * The words of the admin audit log that are not fixed by the contract
 * (docs/design/admin-audit-log.md, #293). They live here, apart from the
 * adapter, so a change the reviewer asks for is a one-line edit.
 */

/**
 * The audit rows whose staff reason the Settings page shows. For a driver the
 * audit row is the only place the reason is stored, so the decision on #293 is
 * to show it, and only for these four codes: a reason added to another action
 * later stays hidden until it is added here on purpose
 * (docs/api/admin-operations.md, "The reason").
 */
export const AUDIT_REASON_ACTIONS: ReadonlySet<string> = new Set(['driver_approved', 'driver_suspended', 'driver_activated', 'driver_deactivated'])

/**
 * What a record kind (`target_type`) is called on a row. "Driver", "Order" and
 * "Service area" are the technical lead's words (#293); the rest follow the same
 * style and await his confirmation. A kind not listed shows as the code itself.
 */
export const AUDIT_TARGET_WORDS: Readonly<Record<string, string>> = {
  driver: 'Driver',
  order: 'Order',
  service_zone: 'Service area',
  price_list: 'Price list',
  cash_collection: 'Cash collection',
  cash_remittance: 'Cash handover',
  water_source: 'Water source',
  support_request: 'Support request',
  customer_address: 'Customer address',
  user: 'Account',
  deletion_request: 'Deletion request',
  retention_review: 'Retention review',
}

/** How many characters of a record's id a row shows, until the backend sends a label (#296). The length awaits confirmation. */
export const SHORT_ID_LENGTH = 6

/** The hint under the Riders reason box: the reason is stored in the audit log, which is read by staff only. Awaits confirmation. */
export const REASON_HINT = 'Do not include customer details.'

/**
 * What an audit row is about, in words and a short id: "Driver · 4f3a2c".
 *
 * @param targetType - The server's record kind, e.g. `service_zone`.
 * @param targetId - The record's id.
 * @returns The line, or `null` when the server sent neither.
 */
export function auditTarget(targetType: string, targetId: string): string | null {
  if (!targetType && !targetId) return null
  const kind = Object.hasOwn(AUDIT_TARGET_WORDS, targetType) ? AUDIT_TARGET_WORDS[targetType] : targetType
  const id = targetId.slice(0, SHORT_ID_LENGTH)
  return [kind, id].filter(Boolean).join(' · ') || null
}
