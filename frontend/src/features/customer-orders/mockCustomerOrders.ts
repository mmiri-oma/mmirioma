/**
 * Simulated customer orders for S1-05, used until the orders endpoints exist
 * (S1-03 part 2). The screens show a "Sample data" notice while this source is
 * in use, so nobody mistakes a simulated request for a real one (BR-09).
 *
 * It behaves like the contract (docs/api/orders.md): newest first, `{items,
 * total}` pages, 404 `order_not_found`, and idempotent `POST /orders` (same
 * key and body: the stored order; same key, different body: 409
 * `idempotency_key_reused`). Orders created here live in memory only and are
 * gone after a reload.
 *
 * For design review, `?mock=empty`, `?mock=error`, `?mock=slow` or
 * `?mock=offline` in the page URL forces an empty list, a list that cannot
 * load, slow responses, or a request that cannot be sent.
 */
import { ApiError } from '../../lib/api/client'
import type { OrderCreate, OrderRead, OrderStatus } from '../../lib/api/orders'
import type { CustomerOrdersSource } from './source'

type Row = [
  reference: string,
  status: OrderStatus,
  litres: number,
  address: string,
  landmark: string | null,
  instructions: string | null,
  preferredDate: string | null,
  createdAt: string,
  updatedAt: string,
]

// Mixed statuses so every badge can be reviewed; real Sprint 1 orders are all
// `quote_requested`. All addresses are made up.
const ROWS: Row[] = [
  ['MO-7KQ2M9XH4T', 'quote_requested', 200, '12 Sample Close, Independence Layout, Enugu', 'Opposite the blue gate', 'Tank is behind the house', '2026-10-16', '2026-10-14T09:30:00Z', '2026-10-14T09:30:00Z'],
  ['MO-3HV8PZ2D6M', 'awaiting_confirmation', 500, '4 Example Street, New Haven, Enugu', null, null, null, '2026-10-12T15:05:00Z', '2026-10-13T10:20:00Z'],
  ['MO-9WD4K7N1QR', 'en_route', 100, '7 Sample Avenue, GRA, Enugu', null, 'Call on arrival', '2026-10-08', '2026-10-06T08:12:00Z', '2026-10-08T09:40:00Z'],
  ['MO-5TB2X8C4JF', 'delivered', 300, '12 Sample Close, Independence Layout, Enugu', 'Opposite the blue gate', null, null, '2026-10-01T06:48:00Z', '2026-10-02T12:00:00Z'],
  ['MO-1ZK6R3M8VA', 'cancelled', 50, '4 Example Street, New Haven, Enugu', null, null, null, '2026-09-28T17:30:00Z', '2026-09-29T08:00:00Z'],
  ['MO-4QN7C2W9HB', 'assigned', 200, '7 Sample Avenue, GRA, Enugu', null, null, '2026-09-26', '2026-09-24T11:00:00Z', '2026-09-25T09:15:00Z'],
  ['MO-8EJ3V6T1KP', 'delivered', 100, '12 Sample Close, Independence Layout, Enugu', null, null, null, '2026-09-20T07:25:00Z', '2026-09-21T13:10:00Z'],
]

/** Fixture orders, newest first. Exported for tests. */
export const MOCK_CUSTOMER_ORDERS: OrderRead[] = ROWS.map(
  ([reference, status, litres, address, landmark, instructions, preferredDate, createdAt, updatedAt]) => ({
    reference,
    status,
    quantity_litres: litres,
    contact_name: 'Ada Sample',
    contact_phone: '+2348000000001',
    delivery_address: address,
    landmark,
    delivery_instructions: instructions,
    preferred_delivery_date: preferredDate,
    created_at: createdAt,
    updated_at: updatedAt,
  }),
)

type Scenario = 'empty' | 'error' | 'slow' | 'offline' | null

function readScenario(): Scenario {
  if (typeof window === 'undefined') return null
  const value = new URLSearchParams(window.location.search).get('mock')
  return value === 'empty' || value === 'error' || value === 'slow' || value === 'offline'
    ? value
    : null
}

/** Resolve after `ms`, or reject with `AbortError` like `fetch` does when aborted. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, ms)
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
}

const networkError = () =>
  new ApiError({
    kind: 'network',
    status: null,
    code: 'network_error',
    message: 'Unable to reach the server. Check your connection and try again.',
  })

// Crockford base32 without I, L, O and U, as the contract's reference format.
const REFERENCE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function randomReference(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  return `MO-${Array.from(bytes, (byte) => REFERENCE_ALPHABET[byte % 32]).join('')}`
}

/** The request body without its key, to compare idempotent retries. */
function bodyFingerprint(input: OrderCreate): string {
  return JSON.stringify([
    input.quantity_litres,
    input.contact_name,
    input.contact_phone,
    input.delivery_address,
    input.landmark ?? null,
    input.delivery_instructions ?? null,
    input.preferred_delivery_date ?? null,
  ])
}

/**
 * Turn a typed Nigerian mobile number into E.164, as the server does. The
 * form has already checked the format.
 */
function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  const national = digits.startsWith('234') ? digits.slice(3) : digits.replace(/^0/, '')
  return `+234${national}`
}

/**
 * Create a mock source with simulated network latency and its own in-memory
 * orders.
 *
 * @param options.latencyMs - Delay before each response (default 450 ms).
 * @param options.orders - Starting orders, newest first (default
 *   `MOCK_CUSTOMER_ORDERS`).
 * @param options.now - Clock for new orders' timestamps (tests).
 */
export function createMockCustomerOrdersSource({
  latencyMs = 450,
  orders = MOCK_CUSTOMER_ORDERS,
  now = () => new Date(),
}: { latencyMs?: number; orders?: OrderRead[]; now?: () => Date } = {}): CustomerOrdersSource {
  const stored = [...orders]
  const byKey = new Map<string, { fingerprint: string; order: OrderRead }>()

  return {
    isMock: true,
    async createOrder(input) {
      const scenario = readScenario()
      await delay(scenario === 'slow' ? 4000 : latencyMs)
      if (scenario === 'offline') throw networkError()

      const fingerprint = bodyFingerprint(input)
      const previous = byKey.get(input.idempotency_key)
      if (previous) {
        if (previous.fingerprint === fingerprint) return previous.order
        throw new ApiError({
          kind: 'http',
          status: 409,
          code: 'idempotency_key_reused',
          message: 'This request was already submitted with different details.',
        })
      }

      const timestamp = now().toISOString()
      const order: OrderRead = {
        reference: randomReference(),
        status: 'quote_requested',
        quantity_litres: input.quantity_litres,
        contact_name: input.contact_name.trim(),
        contact_phone: toE164(input.contact_phone),
        delivery_address: input.delivery_address.trim(),
        landmark: input.landmark ?? null,
        delivery_instructions: input.delivery_instructions ?? null,
        preferred_delivery_date: input.preferred_delivery_date ?? null,
        created_at: timestamp,
        updated_at: timestamp,
      }
      stored.unshift(order)
      byKey.set(input.idempotency_key, { fingerprint, order })
      return order
    },
    async listOrders({ limit, offset }, signal) {
      const scenario = readScenario()
      await delay(scenario === 'slow' ? 4000 : latencyMs, signal)
      if (scenario === 'error') throw networkError()
      const all = scenario === 'empty' ? [] : stored
      return { items: all.slice(offset, offset + limit), total: all.length, limit, offset }
    },
    async getOrder(reference, signal) {
      await delay(latencyMs, signal)
      const order = stored.find((candidate) => candidate.reference === reference)
      if (!order) {
        throw new ApiError({
          kind: 'http',
          status: 404,
          code: 'order_not_found',
          message: 'Order not found',
        })
      }
      return order
    },
  }
}

/** Default source until the real orders API is wired in (S1-10). */
export const mockCustomerOrdersSource = createMockCustomerOrdersSource()
