/**
 * Which data the order screens (customer and staff) read: the real API or
 * simulated orders.
 *
 * Set with `VITE_ORDERS_SOURCE` (`api` or `mock`). When unset, every build
 * reads the **real API** (the endpoints exist since S1-03 part 2), so
 * simulated data can never reach real users by accident (BR-09). The test
 * suite (`vitest`, mode `test`) defaults to mock data so tests never call a
 * server. Choose `mock` explicitly for design review without a backend.
 */

export type OrdersDataSetting = 'api' | 'mock'

/**
 * Resolve the setting.
 *
 * @param setting - The raw `VITE_ORDERS_SOURCE` value (may be anything).
 * @param mode - Vite's mode (`development`, `production`, `test`, ...).
 * @returns `api` or `mock`.
 */
export function resolveOrdersDataSetting(
  setting: string | undefined,
  mode: string,
): OrdersDataSetting {
  if (setting === 'api' || setting === 'mock') return setting
  return mode === 'test' ? 'mock' : 'api'
}

/** The setting the app uses, read once at start-up. */
export const ORDERS_DATA: OrdersDataSetting = resolveOrdersDataSetting(
  import.meta.env.VITE_ORDERS_SOURCE,
  import.meta.env.MODE,
)
