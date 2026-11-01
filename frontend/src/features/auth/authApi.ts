/**
 * Auth calls for screens. Uses the agreed contract (`lib/api/auth.ts`,
 * `lib/api/phoneVerification.ts`) against the real API, or the mock of the
 * same contract in mock mode.
 */
import * as real from '../../lib/api/auth'
import type { LoginInput, RegisterInput, Session, User } from '../../lib/api/auth'
import { USE_MOCKS } from '../../lib/api/mode'
import { lazyMock } from '../../lib/api/lazyMock'
import * as realPhone from '../../lib/api/phoneVerification'
import type { CodePurpose, PhoneChangeInput, PhoneCodeSent, PhoneCodeStatus } from '../../lib/api/phoneVerification'

/** The mock modules load on first use, and not at all in a build without mocks (#236). */
const mock = lazyMock(__USE_MOCKS__ && (() => import('../../mocks/authMock')))
const mockPhone = lazyMock(__USE_MOCKS__ && (() => import('../../mocks/phoneVerificationMock')))

export function login(input: LoginInput): Promise<Session> {
  return USE_MOCKS ? mock.mockLogin(input) : real.login(input)
}

export function register(input: RegisterInput): Promise<Session> {
  return USE_MOCKS ? mock.mockRegister(input) : real.register(input)
}

export function getMe(signal?: AbortSignal): Promise<Session> {
  return USE_MOCKS ? mock.mockGetMe() : real.getMe(signal)
}

export function logout(): Promise<void> {
  return USE_MOCKS ? mock.mockLogout() : real.logout()
}

/** Change password (`POST /auth/password`); the account's other sessions end. */
export function changePassword(current: string, next: string): Promise<void> {
  return USE_MOCKS ? mock.mockChangePassword(current, next) : real.changePassword({ current_password: current, new_password: next })
}

/** Send an SMS code to the account's phone (FR-003). */
export function requestPhoneVerification(): Promise<PhoneCodeSent> {
  return USE_MOCKS ? mockPhone.mockRequestPhoneVerification() : realPhone.requestPhoneVerification()
}

/** Check the code; the returned user has `phone_verified: true`. */
export function verifyPhone(code: string): Promise<User> {
  return USE_MOCKS ? mockPhone.mockVerifyPhone(code) : realPhone.verifyPhone(code)
}

/** Send an SMS code to a new number, after checking the password (FR-004). */
export function requestPhoneChange(input: PhoneChangeInput): Promise<PhoneCodeSent> {
  return USE_MOCKS ? mockPhone.mockRequestPhoneChange(input) : realPhone.requestPhoneChange(input)
}

/** Check the code sent to the new number; the returned user has the new phone. */
export function verifyPhoneChange(code: string): Promise<User> {
  return USE_MOCKS ? mockPhone.mockVerifyPhoneChange(code) : realPhone.verifyPhoneChange(code)
}

/**
 * Whether the newest SMS code reached the phone. In mock mode no SMS is sent,
 * so the code counts as delivered (it is printed in the browser console).
 */
export function getPhoneCodeStatus(purpose: CodePurpose): Promise<PhoneCodeStatus> {
  if (!USE_MOCKS) return realPhone.getPhoneCodeStatus(purpose)
  const now = Date.now()
  return Promise.resolve({
    delivery_status: 'delivered',
    expires_at: new Date(now + 5 * 60_000).toISOString(),
    resend_available_at: new Date(now).toISOString(),
  })
}
