/**
 * Typed admin API functions used by the admin pages.
 *
 * In mock mode the functions use `src/mocks/adminMock.ts`. In real-API mode
 * the linked ones call an adapter from `./real/`; the rest fail with
 * `not_connected` until their endpoints exist. Linked so far: the cash
 * functions (#19), `listOrders`, `getOrder` (#15), `listEligibleRiders`,
 * `assignOrder` (#16), `listAreas`, `saveArea` (#74), the hold review
 * functions (#166), and the shell, dashboard, live map, activity and settings
 * reads (#217), support requests, the audit log and admin notifications (#219), and the customers and riders (#220), and cancelling an order, which is `transitionOrder` with
 * `to: cancelled` (#176).
 */
import type { AdminOrderFilter, ApprovalVehicleInput, NewAddressInput, PriceListDraft, ReportRange, ResolutionAction, ServiceArea } from '../../domain/admin'
import type { CorrectionRequest, ReceiveRequest, ReconcileRequest } from '../../lib/api/adminCash'
import { USE_MOCKS } from '../../lib/api/mode'
import { lazyMock } from '../../lib/api/lazyMock'
import { notConnected } from '../../lib/api/notConnected'
import * as waterSources from '../../lib/api/adminWaterSources'
import type { ActivationStatusWrite, ActivationWrite, WaterSourceCreate, WaterSourceUpdate } from '../../lib/api/adminWaterSources'
import * as areas from './real/areas'
import * as cash from './real/cash'
import * as holds from './real/holds'
import * as operations from './real/operations'
import * as support from './real/support'
import type { AdminTransitionRequest, CancelReason, CancellationOutcome, HoldDecisionRequest, HoldReview, ProofOverrideRequest, WithdrawRequest } from './real/holds'
import * as orders from './real/orders'
import * as pricing from './real/pricing'
import * as directory from './real/directory'
import * as reports from './real/reports'
import * as dispatch from './real/ordersDispatch'

import type { ApprovalAction, OrderList, RiderFilter } from '../../mocks/adminMock'

/** The mock modules load on first use, and not at all in a build without mocks (#236). */
const cashMock = lazyMock(__USE_MOCKS__ && (() => import('../../mocks/adminCashMock')))
const mock = lazyMock(__USE_MOCKS__ && (() => import('../../mocks/adminMock')))
const priceMock = lazyMock(__USE_MOCKS__ && (() => import('../../mocks/priceListMock')))
const waterSourceMock = lazyMock(__USE_MOCKS__ && (() => import('../../mocks/waterSourceMock')))

export type { AdminShellData, ApprovalAction, LiveMapData, OrderList, PaymentFilter, RiderFilter, RiderList } from '../../mocks/adminMock'

/** Wrap a mock so real-API mode reports the feature as not connected yet. */
function api<A extends unknown[], R>(feature: string, fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return (...args: A) => (USE_MOCKS ? fn(...args) : notConnected(feature))
}

// Admin overview (#217): the shell counts, dashboard, live map, recent activity and settings.
export const getShellData = () => (USE_MOCKS ? mock.getShellData() : operations.getShellData())
export const getDashboard = () => (USE_MOCKS ? mock.getDashboard() : operations.getDashboard())
export const getLiveMap = () => (USE_MOCKS ? mock.getLiveMap() : operations.getLiveMap())
export const listActivity = (limit?: number) => (USE_MOCKS ? mock.listActivity(limit) : operations.listActivity(limit))

export const listOrders = (filter?: AdminOrderFilter, query?: string): Promise<OrderList> =>
  USE_MOCKS ? mock.listOrders(filter, query) : orders.listOrders(filter, query)
export const getOrder = (reference: string) => (USE_MOCKS ? mock.getOrder(reference) : orders.getOrder(reference))
export const listEligibleRiders = (reference: string) => (USE_MOCKS ? mock.listEligibleRiders(reference) : dispatch.listEligibleRiders(reference))
export const assignOrder = (reference: string, partnerId: string) =>
  USE_MOCKS ? mock.assignOrder(reference, partnerId) : dispatch.assignOrder(reference, partnerId)
// Hold review (#166): the evidence for an order's open hold, and the decisions on it.
export const getHoldReview = (reference: string): Promise<HoldReview> => (USE_MOCKS ? mock.getHoldReview(reference) : holds.getHoldReview(reference))
export const decideProof = (reference: string, request: ProofOverrideRequest): Promise<void> =>
  USE_MOCKS ? mock.decideProof(reference, request) : holds.decideProof(reference, request)
export const continueSource = (reference: string, request: HoldDecisionRequest): Promise<void> =>
  USE_MOCKS ? mock.continueSource(reference, request) : holds.continueSource(reference, request)
export const resumeUnsafe = (reference: string, request: HoldDecisionRequest): Promise<void> =>
  USE_MOCKS ? mock.resumeUnsafe(reference, request) : holds.resumeUnsafe(reference, request)
export const withdrawJob = (reference: string, request: WithdrawRequest): Promise<void> =>
  USE_MOCKS ? mock.withdrawJob(reference, request) : holds.withdrawJob(reference, request)
export const getCancellationOutcome = (reference: string, reason: CancelReason): Promise<CancellationOutcome> =>
  USE_MOCKS ? mock.getCancellationOutcome(reference, reason) : holds.getCancellationOutcome(reference, reason)
export const transitionOrder = (reference: string, request: AdminTransitionRequest): Promise<void> =>
  USE_MOCKS ? mock.transitionOrder(reference, request) : holds.transitionOrder(reference, request)
export const createOrderForCustomer = api('Orders', mock.createOrderForCustomer)
export const quoteForAdmin = api('Prices', mock.quoteForAdmin)

// Customers and riders (#220): linked to the agreed directory endpoints; the actions with no endpoint are #221's.
export const listCustomers = (query?: string) => (USE_MOCKS ? mock.listCustomers(query) : directory.listCustomers(query))
export const getCustomer = (id: string) => (USE_MOCKS ? mock.getCustomer(id) : directory.getCustomer(id))
export const createCustomer = api('Customers', mock.createCustomer)
export const addCustomerAddress = (customerId: string, input: NewAddressInput) =>
  USE_MOCKS ? mock.addCustomerAddress(customerId, input) : directory.addCustomerAddress(customerId, input)
export const verifyCustomerPhone = api('Customers', mock.verifyCustomerPhone)
export const adjustPoints = api('Loyalty points', mock.adjustPoints)

export const listRiders = (filter?: RiderFilter, query?: string) => (USE_MOCKS ? mock.listRiders(filter, query) : directory.listRiders(filter, query))
export const getRider = (id: string) => (USE_MOCKS ? mock.getRider(id) : directory.getRider(id))
export const setRiderApproval = (id: string, action: ApprovalAction, reason: string, vehicle?: ApprovalVehicleInput) =>
  USE_MOCKS ? mock.setRiderApproval(id, action, reason) : directory.setRiderApproval(id, action, reason, vehicle)
export const addRider = api('Riders', mock.addRider)

export const listStations = api('Refill stations', mock.listStations)
export const setStationOpen = api('Refill stations', mock.setStationOpen)
export const saveStation = api('Refill stations', mock.saveStation)
export const uploadStationPapers = api('Refill stations', mock.uploadStationPapers)
// Service areas (#74): linked to the agreed service zones; see real/areas.ts for what is not connected yet.
export const listAreas = (): Promise<ServiceArea[]> => (USE_MOCKS ? mock.listAreas() : areas.listAreas())
export const saveArea = (id: string | null, input: Omit<ServiceArea, 'id'>): Promise<ServiceArea> =>
  USE_MOCKS ? mock.saveArea(id, input) : areas.saveArea(id, input)

// The mock-era flat price table: mock-only (sample quotes, Service areas' sample fee, Loyalty points).
export const listSamplePriceTables = api('Pricing', mock.listPriceLists)
export const saveSamplePriceTable = api('Pricing', mock.savePriceList)

// Pricing (#173): the FR-022 price list, linked to admin-directory.md "Price lists" (#37) and the water categories (#161).
export const getCurrentPriceList = () => (USE_MOCKS ? pricing.noneWhenNotFound(priceMock.getCurrentPriceList()) : pricing.getCurrentPriceList())
export const priceListHistory = () => (USE_MOCKS ? priceMock.listPriceLists({ limit: 20 }).then((p) => p.items) : pricing.priceListHistory())
export const savePriceList = (draft: PriceListDraft) => (USE_MOCKS ? priceMock.createPriceList(draft) : pricing.savePriceList(draft))
export const listWaterCategories = () => (USE_MOCKS ? priceMock.listWaterCategories() : pricing.waterCategories())
export const listPriceAreas = () =>
  USE_MOCKS ? mock.listAreas().then((areas) => areas.map((a) => ({ id: a.id, name: a.name, is_active: a.enabled }))) : pricing.priceAreas()

/*
 * Water sources (#309): linked to docs/api/admin-water-sources.md. The screen uses the
 * contract's types as they are. In mock mode the records are SAMPLE DATA.
 */
export const WATER_SOURCES_ARE_SAMPLE = USE_MOCKS
export const listWaterSources = () => (USE_MOCKS ? waterSourceMock.listWaterSources() : waterSources.listAdminWaterSources())
export const addWaterSource = (body: WaterSourceCreate) => (USE_MOCKS ? waterSourceMock.createWaterSource(body) : waterSources.createAdminWaterSource(body))
export const editWaterSource = (id: string, body: WaterSourceUpdate) =>
  USE_MOCKS ? waterSourceMock.updateWaterSource(id, body) : waterSources.updateAdminWaterSource(id, body)
export const activateWaterSource = (id: string, categoryId: string, body: ActivationWrite) =>
  USE_MOCKS ? waterSourceMock.activateWaterSource(id, categoryId, body) : waterSources.putAdminActivation(id, categoryId, body)
export const setWaterSourceStatus = (id: string, categoryId: string, body: ActivationStatusWrite) =>
  USE_MOCKS ? waterSourceMock.setWaterSourceStatus(id, categoryId, body) : waterSources.setAdminActivationStatus(id, categoryId, body)

export const listPayments = api('Payments', mock.listPayments)
export const confirmPayment = api('Payments', mock.confirmPayment)
export const refundAsPoints = api('Payments', mock.refundAsPoints)

/*
 * Cash (K3 to K5, docs/design/admin-cash.md, #19): linked to the agreed
 * payments contract. The screens use the contract's types as they are (no
 * older design type exists for them). The Payments page above stays on its
 * mocks: the backend has no per-order "mark paid" (BR-07).
 */
export type {
  AdminCashCollection,
  CashDay,
  CashDriverRow,
  CorrectionRequest,
  DriverCash,
  PilotPaymentStatus,
  ReceiveRequest,
  ReconcileRequest,
  Remittance,
} from '../../lib/api/adminCash'
/** Mock mode shows sample cash, tagged SAMPLE DATA on the cash screens (design decision 5). */
export const CASH_IS_SAMPLE = USE_MOCKS
export const getCashDay = (date: string) => (USE_MOCKS ? cashMock.getCashDay(date) : cash.getCashDay(date))
export const getDriverCash = (driverId: string) => (USE_MOCKS ? cashMock.getDriverCash(driverId) : cash.getDriverCash(driverId))
export const correctCashCollection = (collectionId: string, request: CorrectionRequest) =>
  USE_MOCKS ? cashMock.correctCollection(collectionId, request) : cash.correctCollection(collectionId, request)
export const receiveCash = (request: ReceiveRequest) => (USE_MOCKS ? cashMock.receiveCash(request) : cash.receiveCash(request))
export const reconcileCash = (request: ReconcileRequest) =>
  USE_MOCKS ? cashMock.reconcileCollections(request) : cash.reconcileCollections(request)
export const listPayouts = api('Rider earnings', mock.listPayouts)
export const markPayoutPaid = api('Rider earnings', mock.markPayoutPaid)

export const getReport = (range: ReportRange) => (USE_MOCKS ? mock.getReport(range) : reports.getReport(range))

// Support requests (#219): the real API resolves with one note; the mock keeps its five resolutions.
export const listIssues = (query?: string) => (USE_MOCKS ? mock.listIssues(query) : support.listIssues(query))
export const getIssuePeople = (issueId: string) => (USE_MOCKS ? mock.getIssuePeople(issueId) : support.getIssuePeople(issueId))
export const resolveIssue = (issueId: string, action: ResolutionAction, reason: string, points?: number) =>
  USE_MOCKS ? mock.resolveIssue(issueId, action, reason, points) : support.resolveIssue(issueId, reason)

export const listAudit = (limit?: number) => (USE_MOCKS ? mock.listAudit(limit) : support.listAudit(limit))
export const listAdminNotifications = () => (USE_MOCKS ? mock.listAdminNotifications() : support.listAdminNotifications())
export const markAdminNotificationsRead = () => (USE_MOCKS ? mock.markAdminNotificationsRead() : support.markAdminNotificationsRead())
// Settings are read only: there is no save endpoint (admin-operations.md, decision 4), so `saveSettings` stays not connected.
export const getSettings = () => (USE_MOCKS ? mock.getSettings() : operations.getSettings())
export const saveSettings = api('Settings', mock.saveSettings)
export const getAdminAccount = () => (USE_MOCKS ? mock.getAdminAccount() : operations.getAdminAccount())
