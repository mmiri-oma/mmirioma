/**
 * Mock admin cash endpoints (K3 to K5, docs/design/admin-cash.md, #19).
 *
 * Same shapes and rules as the real endpoints in docs/api/payments.md, so the
 * mock demo behaves like the backend: receiving cash sets each order's payment
 * status by the contract's table, a counted difference needs a note and never
 * changes an order, records that changed meanwhile give 409
 * `cash_collection_changed`, and reconciling never changes a payment status.
 * The SMS outcome is always `accepted` here (no SMS is sent by the mock).
 *
 * The records live in `admin.cash` of the mock state, created on first use, so
 * the reset in tests and the browser's saved demo both cover them. All names,
 * references and amounts are SAMPLE DATA.
 */
import type {
  AdminCashCollection,
  CashDay,
  CorrectionRequest,
  DriverCash,
  PilotPaymentStatus,
  ReceiveRequest,
  ReconcileRequest,
  Remittance,
} from '../lib/api/adminCash'
import { ADMIN_NAME, DEMO_ADMIN_ID } from './adminSeed'
import { requireUserId } from './authMock'
import { mutate, read } from './db'
import { DEMO_DRIVER_ID, DEMO_RIDER_ID } from './partnerSeed'
import type { MockState } from './seed'
import { clone, delay, mockError, newId } from './store'
import { lagosToday } from './time'

/** A driver the cash page can show, with the vehicle text the contract sends. */
interface CashDriver {
  id: string
  name: string
  vehicle: string | null
}

/** A received handover: only what the cash page counts (`totals.differences`). */
interface StoredRemittance {
  id: string
  driver_id: string
  difference_minor_units: number
  remitted_at: string
}

/** The mock's cash records, kept in `admin.cash` of the mock state. */
export interface CashMockData {
  drivers: CashDriver[]
  collections: AdminCashCollection[]
  remittances: StoredRemittance[]
}

const NOTE_MAX = 500
const KOBO_PER_NAIRA = 100
const LAGOS_OFFSET_MS = 60 * 60 * 1000

/** The Lagos calendar date (`YYYY-MM-DD`) of a UTC timestamp. Lagos is UTC+1 all year. */
export function lagosDateOf(iso: string): string {
  return new Date(Date.parse(iso) + LAGOS_OFFSET_MS).toISOString().slice(0, 10)
}

export function collection(
  partial: Pick<AdminCashCollection, 'id' | 'order_reference' | 'amount_minor_units' | 'amount_due_minor_units' | 'status' | 'collected_at' | 'remittance_due_at' | 'driver' | 'customer'> &
    Partial<AdminCashCollection>,
): AdminCashCollection {
  return {
    note: null,
    overdue: false,
    remitted_at: null,
    received_by: null,
    reconciled_at: null,
    payment_status: 'pending_collection',
    outstanding_balance_minor_units: 0,
    overpaid_minor_units: 0,
    remittance_id: null,
    reconciled_by: null,
    original_amount_minor_units: null,
    corrected_by: null,
    corrected_at: null,
    correction_reason: null,
    ...partial,
  }
}

/** Sample records: Chinedu holds today's cash, Emeka is overdue, and one handover waits for reconciling. */
export function seedCash(now = new Date()): CashMockData {
  const chinedu = { id: DEMO_RIDER_ID, name: 'Chinedu Okafor' }
  const emeka = { id: DEMO_DRIVER_ID, name: 'Emeka David' }
  const office = { id: DEMO_ADMIN_ID, name: ADMIN_NAME }
  const todayDue = lagosToday(18, 0, now)
  const yesterdayDue = lagosToday(18, 0, now, 1)
  return {
    drivers: [
      { ...chinedu, vehicle: 'Keke ENU 482 KK' },
      { ...emeka, vehicle: 'Tanker ENU 115 XA' },
    ],
    collections: [
      collection({
        id: 'cash-sample-1',
        order_reference: 'MO-4KD7TQ2M8P',
        amount_minor_units: 650_000,
        amount_due_minor_units: 650_000,
        status: 'collected',
        collected_at: lagosToday(10, 20, now),
        remittance_due_at: todayDue,
        driver: chinedu,
        customer: { name: 'Adaeze Nwosu', phone: '+2348031234567' },
      }),
      collection({
        id: 'cash-sample-2',
        order_reference: 'MO-9PX3LM6QA2',
        amount_minor_units: 500_000,
        amount_due_minor_units: 590_000,
        note: 'Customer had only ₦5,000. Said the rest will come by transfer.',
        status: 'awaiting_remittance',
        collected_at: lagosToday(12, 5, now),
        remittance_due_at: todayDue,
        driver: chinedu,
        customer: { name: 'Ifeoma Eze', phone: '+2348000000201' },
      }),
      collection({
        id: 'cash-sample-3',
        order_reference: 'MO-2HV8RK4TQZ',
        amount_minor_units: 2_500_000,
        amount_due_minor_units: 2_500_000,
        status: 'awaiting_remittance',
        collected_at: lagosToday(15, 40, now, 1),
        remittance_due_at: yesterdayDue,
        overdue: true,
        driver: emeka,
        customer: { name: 'Chukwudi Ilonze', phone: '+2348092227710' },
      }),
      collection({
        id: 'cash-sample-4',
        order_reference: 'MO-7QW2NB5KXD',
        amount_minor_units: 1_800_000,
        amount_due_minor_units: 2_000_000,
        note: 'Customer disputed the last 50 litres.',
        status: 'remitted',
        collected_at: lagosToday(9, 30, now, 1),
        remittance_due_at: yesterdayDue,
        remitted_at: lagosToday(17, 10, now, 1),
        received_by: office,
        driver: emeka,
        customer: { name: 'Blessing Okeke', phone: '+2348000000203' },
        payment_status: 'partially_paid',
        outstanding_balance_minor_units: 200_000,
        remittance_id: 'remittance-sample-1',
      }),
    ],
    remittances: [{ id: 'remittance-sample-1', driver_id: emeka.id, difference_minor_units: 0, remitted_at: lagosToday(17, 10, now, 1) }],
  }
}

/** The signed-in staff member; 403 for customers and partners (as `adminMock`). */
function requireAdmin(s: MockState): { id: string; name: string } {
  const id = requireUserId()
  const user = s.users.find((u) => u.id === id)
  if (user?.role !== 'admin') throw mockError(403, 'forbidden', 'Only Waterline staff can do this')
  return { id, name: user.name }
}

/** The cash records, created on first use (states saved before #19 have none). */
export function cashOf(s: MockState): CashMockData {
  s.admin.cash ??= seedCash()
  return s.admin.cash
}

/** Read without saving: the seed is used as-is until something changes. */
export function peekCash(s: MockState): CashMockData {
  return s.admin.cash ?? seedCash()
}

function invalid(field: string, msg: string): never {
  throw mockError(422, 'validation_error', 'Request validation failed', [{ loc: ['body', field], msg, type: 'value_error' }])
}

function wholeNaira(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value % KOBO_PER_NAIRA !== 0) {
    invalid(field, 'Enter an amount in whole naira')
  }
  return value
}

function optionalNote(note: string | null | undefined, field = 'note'): string | null {
  const text = (note ?? '').trim()
  if (text.length > NOTE_MAX) invalid(field, `Use ${NOTE_MAX} characters or fewer`)
  return text || null
}

function ids(value: string[], field = 'collection_ids'): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50 || new Set(value).size !== value.length) {
    invalid(field, 'Choose between 1 and 50 records, each once')
  }
  return value
}

function changed(collectionIds: string[]): never {
  throw mockError(409, 'cash_collection_changed', 'These cash records changed. Reload and try again.', { collection_ids: collectionIds })
}

/**
 * The payment status a received collection gives its order (payments.md,
 * "Payment status"): equal → paid; less (including ₦0.00) → part paid with
 * the rest outstanding; more → paid, with the excess flagged for review.
 */
export function paymentAfterReceipt(amount: number, due: number): Pick<AdminCashCollection, 'payment_status' | 'outstanding_balance_minor_units' | 'overpaid_minor_units'> {
  const status: PilotPaymentStatus = amount >= due ? 'paid' : 'partially_paid'
  return {
    payment_status: status,
    outstanding_balance_minor_units: Math.max(due - amount, 0),
    overpaid_minor_units: Math.max(amount - due, 0),
  }
}

/** `GET /admin/cash?date=` (K3). */
export async function getCashDay(date: string): Promise<CashDay> {
  await delay(null)
  const s = read()
  requireAdmin(s)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw mockError(422, 'validation_error', 'Request validation failed', [{ loc: ['query', 'date'], msg: 'Use YYYY-MM-DD', type: 'value_error' }])
  const cash = peekCash(s)
  const on = (iso: string | null) => iso !== null && lagosDateOf(iso) === date
  const sum = (rows: AdminCashCollection[]) => rows.reduce((total, row) => total + row.amount_minor_units, 0)
  const held = (row: AdminCashCollection) => row.status === 'collected' || row.status === 'awaiting_remittance'

  const mineOf = (driverId: string) => cash.collections.filter((row) => row.driver.id === driverId)
  // Every driver with a collection on `date` or cash on hand now, overdue first, then by name.
  const drivers = cash.drivers
    .filter((driver) => mineOf(driver.id).some((row) => held(row) || on(row.collected_at)))
    .map((driver) => {
      const mine = mineOf(driver.id)
      const onHand = mine.filter(held)
      const received = mine.map((row) => row.remitted_at).filter((at): at is string => at !== null).sort()
      return {
        driver,
        held_minor_units: sum(onHand),
        ready_minor_units: sum(onHand.filter((row) => row.status === 'awaiting_remittance')),
        remittance_due_at: onHand.map((row) => row.remittance_due_at).sort()[0] ?? null,
        overdue: onHand.some((row) => row.overdue),
        last_received_at: received.at(-1) ?? null,
      }
    })
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.driver.name.localeCompare(b.driver.name))

  return clone({
    date,
    totals: {
      recorded_minor_units: sum(cash.collections.filter((row) => on(row.collected_at))),
      received_minor_units: sum(cash.collections.filter((row) => on(row.remitted_at))),
      reconciled_minor_units: sum(cash.collections.filter((row) => on(row.reconciled_at))),
      with_drivers_minor_units: sum(cash.collections.filter(held)),
      differences: cash.remittances.filter((r) => r.difference_minor_units !== 0 && on(r.remitted_at)).length,
    },
    drivers,
    awaiting_reconciliation: cash.collections
      .filter((row) => row.status === 'remitted')
      .sort((a, b) => (a.remitted_at ?? '').localeCompare(b.remitted_at ?? '')),
  })
}

/** `GET /admin/cash/drivers/{driver_id}` (K4). */
export async function getDriverCash(driverId: string): Promise<DriverCash> {
  await delay(null)
  const s = read()
  requireAdmin(s)
  const cash = peekCash(s)
  const driver = cash.drivers.find((d) => d.id === driverId)
  if (!driver) throw mockError(404, 'driver_not_found', 'Driver not found')
  return clone({
    driver: { id: driver.id, name: driver.name },
    collections: cash.collections.filter((row) => row.driver.id === driverId && (row.status === 'collected' || row.status === 'awaiting_remittance')),
  })
}

/** `POST /admin/cash-collections/{id}/correction` (K4, decision 6). */
export async function correctCollection(collectionId: string, request: CorrectionRequest): Promise<AdminCashCollection> {
  await delay(null, 250)
  return mutate((s) => {
    const actor = requireAdmin(s)
    const row = cashOf(s).collections.find((c) => c.id === collectionId)
    if (!row) throw mockError(404, 'cash_collection_not_found', 'Cash record not found')
    const amount = wholeNaira(request.amount_minor_units, 'amount_minor_units')
    const reason = optionalNote(request.reason, 'reason')
    if (!reason) invalid('reason', 'Give the reason for the correction')
    if (row.status !== 'collected' && row.status !== 'awaiting_remittance') changed([collectionId])
    if (amount === row.amount_minor_units) invalid('amount_minor_units', 'Enter an amount different from the recorded one')
    row.original_amount_minor_units ??= row.amount_minor_units
    row.amount_minor_units = amount
    row.corrected_by = actor
    row.corrected_at = new Date().toISOString()
    row.correction_reason = reason
    return clone(row)
  })
}

/** `POST /admin/cash-remittances` (K4): receive cash from one driver. */
export async function receiveCash(request: ReceiveRequest): Promise<Remittance> {
  await delay(null, 300)
  return mutate((s) => {
    const actor = requireAdmin(s)
    const cash = cashOf(s)
    const driver = cash.drivers.find((d) => d.id === request.driver_id)
    if (!driver) throw mockError(404, 'driver_not_found', 'Driver not found')
    const chosen = ids(request.collection_ids)
    const counted = wholeNaira(request.counted_minor_units, 'counted_minor_units')
    const note = optionalNote(request.note)
    const rows = chosen.map((id) => cash.collections.find((c) => c.id === id))
    const stale = chosen.filter((_, i) => {
      const row = rows[i]
      return !row || row.driver.id !== driver.id || (row.status !== 'collected' && row.status !== 'awaiting_remittance')
    })
    if (stale.length > 0) changed(stale)
    const received = rows as AdminCashCollection[]
    const recorded = received.reduce((total, row) => total + row.amount_minor_units, 0)
    if (counted !== recorded && !note) invalid('note', 'Say what happened when the counted cash differs')

    const at = new Date().toISOString()
    const remittanceId = newId('remittance')
    for (const row of received) {
      Object.assign(row, paymentAfterReceipt(row.amount_minor_units, row.amount_due_minor_units))
      row.status = 'remitted'
      row.remitted_at = at
      row.received_by = actor
      row.remittance_id = remittanceId
      row.overdue = false
    }
    cash.remittances.push({ id: remittanceId, driver_id: driver.id, difference_minor_units: counted - recorded, remitted_at: at })
    return clone({
      id: remittanceId,
      driver: { id: driver.id, name: driver.name },
      recorded_minor_units: recorded,
      counted_minor_units: counted,
      difference_minor_units: counted - recorded,
      note,
      received_by: actor,
      remitted_at: at,
      orders: received.map((row) => ({
        reference: row.order_reference,
        payment_status: row.payment_status!,
        outstanding_balance_minor_units: row.outstanding_balance_minor_units,
        overpaid_minor_units: row.overpaid_minor_units,
        // No SMS is due for ₦0.00 (payments.md); the mock sends none and reports success.
        sms_status: row.amount_minor_units > 0 ? ('accepted' as const) : null,
      })),
    })
  })
}

/** `POST /admin/cash-reconciliations` (K5). Never changes a payment status. */
export async function reconcileCollections(request: ReconcileRequest): Promise<AdminCashCollection[]> {
  await delay(null, 250)
  return mutate((s) => {
    const actor = requireAdmin(s)
    const cash = cashOf(s)
    const chosen = ids(request.collection_ids)
    optionalNote(request.note)
    const rows = chosen.map((id) => cash.collections.find((c) => c.id === id))
    const stale = chosen.filter((_, i) => rows[i]?.status !== 'remitted')
    if (stale.length > 0) changed(stale)
    const at = new Date().toISOString()
    for (const row of rows as AdminCashCollection[]) {
      row.status = 'reconciled'
      row.reconciled_at = at
      row.reconciled_by = actor
    }
    return clone(rows as AdminCashCollection[])
  })
}
