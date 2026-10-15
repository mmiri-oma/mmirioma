/**
 * Simulated admin orders for S1-09, used until `GET /admin/orders` exists.
 *
 * Every record is fictional and flagged `is_simulated: true` (BR-09, NFR-031).
 * Statuses cover the whole FR-033 set so every badge and state can be reviewed,
 * even though real Sprint 1 orders are all `quote_requested`.
 *
 * For design review, `?mock=empty`, `?mock=error` or `?mock=slow` in the page
 * URL forces the empty, error or slow-loading state of the list.
 */
import { ApiError } from '../../lib/api/client'
import type { AdminOrderListParams, AdminOrderRead, OrderStatus, Page } from '../../lib/api/adminOrders'
import { toLagosDate } from '../../lib/format'
import type { AdminOrdersSource } from './source'

type Row = [
  reference: string,
  status: OrderStatus,
  litres: number,
  contactName: string,
  address: string,
  landmark: string | null,
  instructions: string | null,
  preferredDate: string | null,
  createdAt: string,
  phoneVerified: boolean,
]

const ROWS: Row[] = [
  ['MO-7KQ2M9XH4T', 'quote_requested', 200, 'Chiamaka Eze', '12 Palm Close, Independence Layout', 'Opposite the blue gate', 'Tank is behind the house', '2026-10-16', '2026-10-14T09:30:00Z', false],
  ['MO-3HV8RZ1N6D', 'quote_requested', 50, 'Obinna Okafor', '4 Unity Street, New Haven', null, null, null, '2026-10-14T08:05:00Z', false],
  ['MO-9TPW4C7M2A', 'awaiting_confirmation', 500, 'Ngozi Nwosu', '27 Hilltop Avenue, Trans-Ekulu', 'Near the pharmacy', 'Call on arrival, gate is locked', '2026-10-15', '2026-10-14T07:42:00Z', true],
  ['MO-2BX6NQ8R5J', 'confirmed', 300, 'Emeka Ude', '9 Garden Road, GRA', 'White duplex, green roof', null, '2026-10-15', '2026-10-13T18:20:00Z', true],
  ['MO-6FJ1KD3W8S', 'assigned', 100, 'Adaeze Onu', '15 Market Lane, Ogui New Layout', null, 'Second floor flat', '2026-10-15', '2026-10-13T15:10:00Z', true],
  ['MO-8MC5VT2P9E', 'accepted', 200, 'Kelechi Agu', '3 School Road, Achara Layout', 'Behind the primary school', null, '2026-10-14', '2026-10-13T11:55:00Z', true],
  ['MO-4RG7YH1B3N', 'collected', 500, 'Ifeoma Nnaji', '41 Cedar Close, Abakpa Nike', null, 'Overhead tank, ladder available', '2026-10-14', '2026-10-13T09:25:00Z', true],
  ['MO-1ZN9QE6K4V', 'en_route', 25, 'Chukwudi Ani', '6 Bridge Street, Uwani', 'Yellow shop front', null, '2026-10-14', '2026-10-13T08:40:00Z', true],
  ['MO-5WD3MA8T7H', 'delivered', 300, 'Uchenna Obi', '18 Orchard Drive, Independence Layout', null, null, '2026-10-13', '2026-10-12T16:30:00Z', true],
  ['MO-7PE2JX5C1R', 'delivered', 1000, 'Amarachi Ike', '2 Station Road, Emene', 'Warehouse entrance B', 'Business delivery, ask for the manager', '2026-10-13', '2026-10-12T13:05:00Z', true],
  ['MO-0HK8SV4N6Q', 'disputed', 200, 'Tobenna Ezeh', '33 Crescent Way, New Haven', null, null, '2026-10-12', '2026-10-11T19:45:00Z', true],
  ['MO-3QT6BW9F2M', 'failed', 100, 'Nkechi Odo', '7 Valley View, Trans-Ekulu', 'End of the untarred road', null, '2026-10-12', '2026-10-11T12:15:00Z', false],
  ['MO-9JA4RC7X5D', 'cancelled', 50, 'Ikenna Mba', '21 Church Road, Coal Camp', null, null, null, '2026-10-11T10:00:00Z', false],
  ['MO-6VM1ZP3H8K', 'quote_requested', 3000, 'Chinwe Okeke', '5 Industrial Close, Emene', 'Block factory', 'Large order, may need tanker', '2026-10-18', '2026-10-11T08:30:00Z', false],
  ['MO-2XE7NF4T9B', 'delivered', 500, 'Somto Nwankwo', '11 Lake View, GRA', null, null, '2026-10-11', '2026-10-10T17:50:00Z', true],
  ['MO-8CS5KJ2W1G', 'delivered', 200, 'Ebuka Chukwu', '29 Forest Avenue, Independence Layout', 'Beside the church', null, '2026-10-11', '2026-10-10T14:20:00Z', true],
  ['MO-4NB9DQ6R3Y', 'cancelled', 300, 'Oluchi Ezenwa', '8 Hospital Road, Ogui New Layout', null, 'Customer travelled', '2026-10-10', '2026-10-09T23:30:00Z', false],
  ['MO-1TY3HM8V7A', 'delivered', 100, 'Chidera Udeh', '14 Rail Line Street, Achara Layout', null, null, '2026-10-10', '2026-10-09T15:00:00Z', true],
  ['MO-5KR6WE1Z4P', 'delivered', 25, 'Nnamdi Eke', '3 Quarry Road, Abakpa Nike', null, null, '2026-10-10', '2026-10-09T11:35:00Z', true],
  ['MO-7GD2PX9S6C', 'delivered', 500, 'Ogechi Anyanwu', '19 Pine Street, Uwani', 'Gate with water drum', null, '2026-10-09', '2026-10-08T16:10:00Z', true],
  ['MO-3MW8QA5N2T', 'delivered', 200, 'Ugochukwu Nweke', '24 Airport Road, Emene', null, null, '2026-10-09', '2026-10-08T09:45:00Z', true],
  ['MO-9BF4TK7J1E', 'quote_requested', 100, 'Kosisochukwu Ibe', '10 Sunrise Close, Trans-Ekulu', null, null, '2026-10-17', '2026-10-08T07:20:00Z', false],
]

/** Fixture orders, newest first. Exported for tests. */
export const MOCK_ADMIN_ORDERS: AdminOrderRead[] = ROWS.map(
  ([reference, status, litres, contactName, address, landmark, instructions, preferredDate, createdAt, phoneVerified], index) => {
    const phone = `+2348000000${String(index + 1).padStart(3, '0')}`
    return {
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      reference,
      status,
      quantity_litres: litres,
      contact_name: contactName,
      contact_phone: phone,
      delivery_address: `${address}, Enugu`,
      landmark,
      delivery_instructions: instructions,
      preferred_delivery_date: preferredDate,
      created_at: createdAt,
      updated_at: createdAt,
      customer: {
        id: `00000000-0000-4000-9000-${String(index + 1).padStart(12, '0')}`,
        name: contactName,
        phone,
        phone_verified: phoneVerified,
      },
      is_simulated: true,
    }
  },
)

type Scenario = 'empty' | 'error' | 'slow' | null

function readScenario(): Scenario {
  if (typeof window === 'undefined') return null
  const value = new URLSearchParams(window.location.search).get('mock')
  return value === 'empty' || value === 'error' || value === 'slow' ? value : null
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

/**
 * Filter and page fixture orders the way `GET /admin/orders` is specified to:
 * any of the given statuses, inclusive Lagos creation dates, newest first.
 */
export function queryMockOrders(
  orders: AdminOrderRead[],
  params: AdminOrderListParams,
): Page<AdminOrderRead> {
  const matching = orders
    .filter((order) => params.status.length === 0 || params.status.includes(order.status))
    .filter((order) => {
      const createdOn = toLagosDate(order.created_at)
      if (params.created_from && createdOn < params.created_from) return false
      if (params.created_to && createdOn > params.created_to) return false
      return true
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
  return {
    items: matching.slice(params.offset, params.offset + params.limit),
    total: matching.length,
    limit: params.limit,
    offset: params.offset,
  }
}

/**
 * Create a mock source with simulated network latency.
 *
 * @param options.latencyMs - Delay before each response (default 450 ms).
 * @param options.orders - Fixture data (default `MOCK_ADMIN_ORDERS`).
 */
export function createMockAdminOrdersSource({
  latencyMs = 450,
  orders = MOCK_ADMIN_ORDERS,
}: { latencyMs?: number; orders?: AdminOrderRead[] } = {}): AdminOrdersSource {
  return {
    isMock: true,
    async listOrders(params, signal) {
      const scenario = readScenario()
      await delay(scenario === 'slow' ? 4000 : latencyMs, signal)
      if (scenario === 'error') {
        throw new ApiError({
          kind: 'network',
          status: null,
          code: 'network_error',
          message: 'Unable to reach the server. Check your connection and try again.',
        })
      }
      return queryMockOrders(scenario === 'empty' ? [] : orders, params)
    },
    async getOrder(reference, signal) {
      await delay(latencyMs, signal)
      const order = orders.find((candidate) => candidate.reference === reference)
      if (!order) {
        throw new ApiError({ kind: 'http', status: 404, code: 'order_not_found', message: 'Order not found' })
      }
      return order
    },
  }
}

/** Default source until the real admin API is wired in (S1-10). */
export const mockAdminOrdersSource = createMockAdminOrdersSource()
