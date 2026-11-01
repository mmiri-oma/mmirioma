/**
 * Phone verification and phone number change
 * (docs/api/auth.md#phone-verification-fr-003-fr-004; SRS v0.2 FR-003, FR-004).
 *
 * All four endpoints are for signed-in customers and need the CSRF token,
 * which the shared client sends on POST.
 */

import type { User } from './auth'
import { apiClient, type ApiClient } from './client'

/** Returned when the server has sent a code (202). */
export interface PhoneCodeSent {
  /** Number the code went to, E.164. For a phone change, the new number. */
  phone: string
  /** ISO 8601 UTC: the code stops working (5 minutes after sending). */
  expires_at: string
  /** ISO 8601 UTC: the earliest time a new code can be requested. */
  resend_available_at: string
  /**
   * `accepted` right after sending: the SMS provider took the message, which
   * is not proof the phone received it. Use {@link getPhoneCodeStatus}.
   */
  delivery_status?: CodeDeliveryStatus
}

/** What is known about the SMS that carried the newest code. */
export type CodeDeliveryStatus = 'accepted' | 'delivered' | 'failed'

/** Which code flow a status request is about. */
export type CodePurpose = 'account_phone' | 'phone_change'

/** Body of `GET /auth/phone-verification/status` and `/auth/phone-change/status`. */
export interface PhoneCodeStatus {
  delivery_status: CodeDeliveryStatus
  expires_at: string
  resend_available_at: string
}

/**
 * Whether the newest code reached the phone
 * (`GET /api/v1/auth/phone-verification/status`, or `/phone-change/status`).
 * `accepted` only means the SMS provider took the message; `failed` means the
 * carrier reported it did not arrive, so the screen offers a resend.
 *
 * @throws {ApiError} `verification_code_expired` (400) when there is no usable code.
 */
export function getPhoneCodeStatus(purpose: CodePurpose, client: ApiClient = apiClient) {
  const path = purpose === 'account_phone' ? 'phone-verification' : 'phone-change'
  return client.request<PhoneCodeStatus>(`/api/v1/auth/${path}/status`)
}

export interface PhoneChangeInput {
  /** New number, any Nigerian mobile format; the server normalizes it. */
  phone: string
  /** Current password, to confirm it is the account owner. */
  password: string
}

/**
 * Send a 6-digit code by SMS to the account's phone
 * (`POST /api/v1/auth/phone-verification`).
 *
 * @throws {ApiError} `phone_already_verified` (409), `too_many_attempts`
 *   (429, wait in `details.retry_after_seconds`), `sms_unavailable` (503).
 */
export function requestPhoneVerification(client: ApiClient = apiClient) {
  return client.request<PhoneCodeSent>('/api/v1/auth/phone-verification', { method: 'POST' })
}

/**
 * Check the code; on success the phone is verified
 * (`POST /api/v1/auth/phone-verification/verify`).
 *
 * @param code - Exactly 6 digits.
 * @returns The updated user (`phone_verified: true`).
 * @throws {ApiError} `verification_code_invalid` (400, `details.attempts_remaining`),
 *   `verification_code_expired` (400), `validation_error` (422),
 *   `too_many_attempts` (429).
 */
export function verifyPhone(code: string, client: ApiClient = apiClient) {
  return client.request<User>('/api/v1/auth/phone-verification/verify', {
    method: 'POST',
    body: { code },
  })
}

/**
 * Send a code to a new phone number (`POST /api/v1/auth/phone-change`). The
 * account keeps its number until {@link verifyPhoneChange} succeeds.
 *
 * @throws {ApiError} `password_incorrect` (403), `phone_unchanged` (409),
 *   `phone_already_registered` (409), `validation_error` (422),
 *   `too_many_attempts` (429), `sms_unavailable` (503).
 */
export function requestPhoneChange(input: PhoneChangeInput, client: ApiClient = apiClient) {
  return client.request<PhoneCodeSent>('/api/v1/auth/phone-change', {
    method: 'POST',
    body: input,
  })
}

/**
 * Check the code sent to the new number; on success it replaces the old one
 * (`POST /api/v1/auth/phone-change/verify`).
 *
 * @param code - Exactly 6 digits.
 * @returns The updated user with the new `phone`, verified.
 * @throws {ApiError} As {@link verifyPhone}, plus `phone_already_registered`
 *   (409) if the new number was taken meanwhile.
 */
export function verifyPhoneChange(code: string, client: ApiClient = apiClient) {
  return client.request<User>('/api/v1/auth/phone-change/verify', {
    method: 'POST',
    body: { code },
  })
}
