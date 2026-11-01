/**
 * TanStack Query hooks for the admin pages. Admin data changes in many places
 * at once (an assignment changes the order, the rider, the dashboard and the
 * audit log), so every admin mutation refreshes all admin queries under the
 * `admin` key, plus the partner and customer caches in this tab.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminOrderFilter, ReportRange } from '../../domain/admin'
import type { WaterChoice } from '../../domain/orders'
import * as api from './adminApi'

export const adminKeys = {
  all: ['admin'] as const,
  shell: ['admin', 'shell'] as const,
  dashboard: ['admin', 'dashboard'] as const,
  map: ['admin', 'map'] as const,
  activity: (limit: number) => ['admin', 'activity', limit] as const,
  orders: (filter: AdminOrderFilter, query: string) => ['admin', 'orders', filter, query] as const,
  order: (reference: string) => ['admin', 'order', reference] as const,
  eligible: (reference: string) => ['admin', 'eligible', reference] as const,
  customers: (query: string) => ['admin', 'customers', query] as const,
  customer: (id: string) => ['admin', 'customer', id] as const,
  riders: (filter: api.RiderFilter, query: string) => ['admin', 'riders', filter, query] as const,
  rider: (id: string) => ['admin', 'rider', id] as const,
  stations: (query: string) => ['admin', 'stations', query] as const,
  areas: ['admin', 'areas'] as const,
  waterSources: ['admin', 'water-sources'] as const,
  prices: ['admin', 'prices'] as const,
  priceList: ['admin', 'price-list', 'current'] as const,
  priceListHistory: ['admin', 'price-list', 'history'] as const,
  waterCategories: ['admin', 'water-categories'] as const,
  priceAreas: ['admin', 'price-areas'] as const,
  payments: (filter: api.PaymentFilter, customerId: string) => ['admin', 'payments', filter, customerId] as const,
  payouts: ['admin', 'payouts'] as const,
  cashDay: (date: string) => ['admin', 'cash', 'day', date] as const,
  driverCash: (driverId: string) => ['admin', 'cash', 'driver', driverId] as const,
  report: (range: ReportRange) => ['admin', 'report', range] as const,
  issues: (query: string) => ['admin', 'issues', query] as const,
  issuePeople: (id: string) => ['admin', 'issue-people', id] as const,
  audit: ['admin', 'audit'] as const,
  notifications: ['admin', 'notifications'] as const,
  settings: ['admin', 'settings'] as const,
  account: ['admin', 'account'] as const,
  quote: (choice: WaterChoice | null, address: string | null) => ['admin', 'quote', choice, address] as const,
}

/** Live-ish lists refresh every 30 seconds (no push channel to the admin screens). */
const LIVE = 30_000

export const useShellData = () => useQuery({ queryKey: adminKeys.shell, queryFn: api.getShellData, refetchInterval: LIVE })
export const useDashboard = () => useQuery({ queryKey: adminKeys.dashboard, queryFn: api.getDashboard, refetchInterval: LIVE })
export const useLiveMap = () => useQuery({ queryKey: adminKeys.map, queryFn: api.getLiveMap, refetchInterval: LIVE })
export const useActivity = (limit = 5) => useQuery({ queryKey: adminKeys.activity(limit), queryFn: () => api.listActivity(limit), refetchInterval: LIVE })
export const useAdminOrders = (filter: AdminOrderFilter, query: string) =>
  useQuery({ queryKey: adminKeys.orders(filter, query), queryFn: () => api.listOrders(filter, query), placeholderData: keepPreviousData, refetchInterval: LIVE })
export const useAdminOrder = (reference: string | null) =>
  useQuery({ queryKey: adminKeys.order(reference ?? ''), queryFn: () => api.getOrder(reference!), enabled: Boolean(reference) })
export const useEligibleRiders = (reference: string | null, enabled: boolean) =>
  useQuery({ queryKey: adminKeys.eligible(reference ?? ''), queryFn: () => api.listEligibleRiders(reference!), enabled: Boolean(reference) && enabled })
export const useCustomers = (query: string) => useQuery({ queryKey: adminKeys.customers(query), queryFn: () => api.listCustomers(query), placeholderData: keepPreviousData })
export const useCustomer = (id: string | null) => useQuery({ queryKey: adminKeys.customer(id ?? ''), queryFn: () => api.getCustomer(id!), enabled: Boolean(id) })
export const useRiders = (filter: api.RiderFilter, query: string) =>
  useQuery({ queryKey: adminKeys.riders(filter, query), queryFn: () => api.listRiders(filter, query), placeholderData: keepPreviousData })
export const useRider = (id: string | null) => useQuery({ queryKey: adminKeys.rider(id ?? ''), queryFn: () => api.getRider(id!), enabled: Boolean(id) })
/** `enabled` is false in real-API mode, where there is no stations endpoint (the Dashboard reads the live map's sources instead, #217). */
export const useStations = (query: string, enabled = true) =>
  useQuery({ queryKey: adminKeys.stations(query), queryFn: () => api.listStations(query), placeholderData: keepPreviousData, enabled })
/** The Water sources screen (#309): every source with its activations, and both categories. */
export const useWaterSources = () => useQuery({ queryKey: adminKeys.waterSources, queryFn: api.listWaterSources })
export const useAreas = () => useQuery({ queryKey: adminKeys.areas, queryFn: api.listAreas })
/** The mock-era flat price table (mock only: Service areas' sample fee, Loyalty points). */
export const useSamplePriceTables = () => useQuery({ queryKey: adminKeys.prices, queryFn: api.listSamplePriceTables })
// Pricing (#173): the FR-022 price list. `null` = no price list saved yet.
export const useCurrentPriceList = () => useQuery({ queryKey: adminKeys.priceList, queryFn: api.getCurrentPriceList })
export const usePriceListHistory = () => useQuery({ queryKey: adminKeys.priceListHistory, queryFn: api.priceListHistory })
export const useWaterCategories = () => useQuery({ queryKey: adminKeys.waterCategories, queryFn: api.listWaterCategories, staleTime: 5 * 60_000 })
export const usePriceAreas = () => useQuery({ queryKey: adminKeys.priceAreas, queryFn: api.listPriceAreas })
export const usePayments = (filter: api.PaymentFilter, customerId: string) =>
  useQuery({ queryKey: adminKeys.payments(filter, customerId), queryFn: () => api.listPayments(filter, customerId || undefined), placeholderData: keepPreviousData })
export const usePayouts = () => useQuery({ queryKey: adminKeys.payouts, queryFn: api.listPayouts })
/** K3: one Lagos day of cash; refreshed like the other live lists (drivers hand over during the day). */
export const useCashDay = (date: string) => useQuery({ queryKey: adminKeys.cashDay(date), queryFn: () => api.getCashDay(date), placeholderData: keepPreviousData, refetchInterval: LIVE })
/** K4: a driver's cash on hand to receive. */
export const useDriverCash = (driverId: string) => useQuery({ queryKey: adminKeys.driverCash(driverId), queryFn: () => api.getDriverCash(driverId) })
export const useReport = (range: ReportRange) => useQuery({ queryKey: adminKeys.report(range), queryFn: () => api.getReport(range), placeholderData: keepPreviousData })
export const useIssues = (query: string) => useQuery({ queryKey: adminKeys.issues(query), queryFn: () => api.listIssues(query), placeholderData: keepPreviousData, refetchInterval: LIVE })
export const useIssuePeople = (id: string | null) => useQuery({ queryKey: adminKeys.issuePeople(id ?? ''), queryFn: () => api.getIssuePeople(id!), enabled: Boolean(id) })
export const useAudit = () => useQuery({ queryKey: adminKeys.audit, queryFn: () => api.listAudit() })
export const useAdminNotifications = () => useQuery({ queryKey: adminKeys.notifications, queryFn: api.listAdminNotifications })
export const useSettings = () => useQuery({ queryKey: adminKeys.settings, queryFn: api.getSettings })
/** Price for the create-order summary; keeps the last price while a new one loads. */
export const useAdminQuote = (choice: WaterChoice | null, address: string | null) =>
  useQuery({ queryKey: adminKeys.quote(choice, address), queryFn: () => api.quoteForAdmin(choice!, address), enabled: choice !== null, placeholderData: keepPreviousData })
export const useAdminAccount = () => useQuery({ queryKey: adminKeys.account, queryFn: api.getAdminAccount })

/** A mutation that refreshes every admin query (and the other apps' caches in this tab) when it succeeds. */
export function useAdminMutation<A, R>(fn: (args: A) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: adminKeys.all }),
        qc.invalidateQueries({ queryKey: ['partner'] }),
        qc.invalidateQueries({ queryKey: ['customer'] }),
      ]),
  })
}
