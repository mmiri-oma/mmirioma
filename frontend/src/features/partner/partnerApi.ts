/**
 * Typed API functions for the partner apps (Keke rider and tanker driver).
 * Mock mode uses `src/mocks/partnerMock.ts`. In real-API mode the account
 * functions (sign-up, profile, going online, notifications) call
 * docs/api/partners.md through `real/account.ts` (#67), and the job lists,
 * one job, accept and decline (#12), the trip steps and problem reports
 * (#13) call docs/api/deliveries.md through `real/jobs.ts`, and the
 * driver's cash (#20) calls docs/api/payments.md through `real/cash.ts`. Earnings,
 * payouts and document upload fail with `not_connected` until they are
 * linked.
 */
import type {
  DeclineReason,
  PartnerEarnings,
  PartnerIssueType,
  PartnerJob,
  PartnerNotificationList,
  PartnerProfile,
  PartnerSignupInput,
  SignupArea,
} from '../../domain/partner'
import type { Session } from '../../lib/api/auth'
import { USE_MOCKS } from '../../lib/api/mode'
import { lazyMock } from '../../lib/api/lazyMock'
import { notConnected } from '../../lib/api/notConnected'
import * as real from './real/account'
import * as realCash from './real/cash'
import * as realJobs from './real/jobs'

/** The mock modules load on first use, and not at all in a build without mocks (#236). */
const cashMock = lazyMock(__USE_MOCKS__ && (() => import('../../mocks/partnerCashMock')))
const mock = lazyMock(__USE_MOCKS__ && (() => import('../../mocks/partnerMock')))

type Pickup = { loaded: boolean; receipt: boolean; photo_url: string | null; gallons_loaded: number | null }

export const getPartnerProfile = (): Promise<PartnerProfile> => (USE_MOCKS ? mock.getPartnerProfile() : real.getPartnerProfile())
export const updatePartnerProfile = (u: { preferences?: Partial<PartnerProfile['preferences']> }): Promise<PartnerProfile> =>
  USE_MOCKS ? mock.updatePartnerProfile(u) : real.updatePartnerProfile(u)
export const setOnline = (online: boolean): Promise<PartnerProfile> => (USE_MOCKS ? mock.setOnline(online) : real.setOnline(online))
export const uploadDocument = (id: string, fileName: string): Promise<PartnerProfile> =>
  USE_MOCKS ? mock.uploadDocument(id, fileName) : notConnected('Document upload')
export const listSignupAreas = (): Promise<SignupArea[]> => (USE_MOCKS ? mock.listSignupAreas() : real.listSignupAreas())
export const partnerSignup = (i: PartnerSignupInput): Promise<Session> => (USE_MOCKS ? mock.partnerSignup(i) : real.partnerSignup(i))

export const listAvailableJobs = (): Promise<PartnerJob[]> => (USE_MOCKS ? mock.listAvailableJobs() : realJobs.listAvailableJobs())
export const listMyActiveJobs = (): Promise<PartnerJob[]> => (USE_MOCKS ? mock.listMyActiveJobs() : realJobs.listMyActiveJobs())
export const getJob = (ref: string): Promise<PartnerJob> => (USE_MOCKS ? mock.getJob(ref) : realJobs.getJob(ref))
export const acceptJob = (ref: string): Promise<PartnerJob> => (USE_MOCKS ? mock.acceptJob(ref) : realJobs.acceptJob(ref))
export const declineJob = (ref: string, reason: DeclineReason, note: string): Promise<void> =>
  USE_MOCKS ? mock.declineJob(ref, reason, note) : realJobs.declineJob(ref, reason, note)
export const confirmPickup = (ref: string, p: Pickup): Promise<PartnerJob> => (USE_MOCKS ? mock.confirmPickup(ref, p) : realJobs.confirmPickup(ref, p))
export const completeUnloading = (ref: string): Promise<PartnerJob> => (USE_MOCKS ? mock.completeUnloading(ref) : realJobs.completeUnloading(ref))
// Arrival and the unreachable customer (#250, FR-038).
export const arriveAtCustomer = (ref: string): Promise<PartnerJob> => (USE_MOCKS ? mock.arriveAtCustomer(ref) : realJobs.arriveAtCustomer(ref))
export const startUnloading = (ref: string): Promise<PartnerJob> => (USE_MOCKS ? mock.startUnloading(ref) : realJobs.startUnloading(ref))
export const recordContactAttempt = (ref: string): Promise<PartnerJob> => (USE_MOCKS ? mock.recordContactAttempt(ref) : realJobs.recordContactAttempt(ref))
export const failUnreachable = (ref: string): Promise<PartnerJob> => (USE_MOCKS ? mock.failUnreachable(ref) : realJobs.failUnreachable(ref))
export const verifyCode =(ref: string, code: string): Promise<PartnerJob> => (USE_MOCKS ? mock.verifyCode(ref, code) : realJobs.verifyCode(ref, code))
export const resendCode = (ref: string): Promise<PartnerJob> => (USE_MOCKS ? mock.resendCode(ref) : realJobs.resendCode(ref))

export const getEarnings = (): Promise<PartnerEarnings> => (USE_MOCKS ? mock.getEarnings() : notConnected('Earnings'))
export const requestPayout = (amount: number): Promise<PartnerEarnings> => (USE_MOCKS ? mock.requestPayout(amount) : notConnected('Payouts'))
export const listHistory = (): Promise<PartnerJob[]> => (USE_MOCKS ? mock.listHistory() : realJobs.listHistory())
/** The mock has no pages, so counting its unread items gives the true count. */
export const listPartnerNotifications = (): Promise<PartnerNotificationList> =>
  USE_MOCKS
    ? mock.listPartnerNotifications().then((items) => ({ items, unread_count: items.filter((n) => !n.read).length }))
    : real.listPartnerNotifications()
export const markPartnerNotificationsRead = (): Promise<void> => (USE_MOCKS ? mock.markPartnerNotificationsRead() : real.markPartnerNotificationsRead())
export const reportIssue = (i: { type: PartnerIssueType; note: string; reference: string | null }): Promise<{ id: string }> =>
  USE_MOCKS ? mock.reportIssue(i) : realJobs.reportIssue(i)

/* Driver cash (K1, K2; docs/design/driver-cash.md, #20). The screens use the contract's shapes. */
export type { CashCollection, DriverCash, JobCash, RecordCashRequest } from './real/cash'
export const getMyCash = (): Promise<realCash.DriverCash> => (USE_MOCKS ? cashMock.getMyCash() : realCash.getMyCash())
export const recordCash = (ref: string, request: realCash.RecordCashRequest): Promise<realCash.CashCollection> =>
  USE_MOCKS ? cashMock.recordCash(ref, request) : realCash.recordCash(ref, request)
export const handOverCash = (collectionIds: string[]): Promise<realCash.DriverCash> =>
  USE_MOCKS ? cashMock.handOverCash(collectionIds) : realCash.handOverCash(collectionIds)
