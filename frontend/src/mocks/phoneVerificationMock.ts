/**
 * Mock of phone verification and phone change (docs/api/auth.md, "Phone
 * verification", FR-003, FR-004). Used only in mock mode.
 *
 * Like the backend's development SMS provider, the "SMS" is written to the
 * browser console instead of being sent. Limits follow the contract: a code
 * works for 5 minutes and 5 attempts, one code per 60 seconds and 3 per hour
 * per phone number. The per-IP limits are not mocked.
 */
import type { User } from '../lib/api/auth'
import type { PhoneChangeInput, PhoneCodeSent } from '../lib/api/phoneVerification'
import { normalizeNigerianPhone } from '../lib/format/phone'
import { requireUserId } from './authMock'
import { mutate, read } from './db'
import type { MockPhoneCode, MockState } from './seed'
import { delay, mockError } from './store'

export const CODE_LIFETIME_MS = 5 * 60_000
const RESEND_COOLDOWN_MS = 60_000
const CODES_PER_HOUR = 3
const ATTEMPTS = 5

function toUser(u: MockState['users'][number]): User {
  return { id: u.id, name: u.name, phone: u.phone, role: u.role, phone_verified: u.phone_verified }
}

function tooMany(seconds: number) {
  return mockError(429, 'too_many_attempts', 'Too many attempts. Try again later.', { retry_after_seconds: Math.max(1, Math.ceil(seconds)) })
}

/** Phone change is for customers only; admins and drivers get 403 (auth.md). */
function requireCustomer(): MockState['users'][number] {
  const id = requireUserId()
  const user = read().users.find((u) => u.id === id)!
  if (user.role !== 'customer') throw mockError(403, 'forbidden', 'Only customers can do this')
  return user
}

/**
 * Verifying the phone is open to drivers too, because an admin can approve a
 * partner only once it is verified (partners.md decision 9). Admins get 403.
 */
function requireCustomerOrDriver(): MockState['users'][number] {
  const id = requireUserId()
  const user = read().users.find((u) => u.id === id)!
  if (user.role === 'admin') throw mockError(403, 'forbidden', 'Only customers and drivers can do this')
  return user
}

/** Store a new code for `userId` (voiding any earlier one) and "send" it. */
function sendCode(userId: string, purpose: MockPhoneCode['purpose'], phone: string, now = Date.now()): PhoneCodeSent {
  const sends = (read().phoneCodeSends?.[phone] ?? []).filter((t) => now - Date.parse(t) < 3_600_000)
  const last = sends.at(-1)
  if (last && now - Date.parse(last) < RESEND_COOLDOWN_MS) throw tooMany((Date.parse(last) + RESEND_COOLDOWN_MS - now) / 1000)
  if (sends.length >= CODES_PER_HOUR) throw tooMany((Date.parse(sends[0]) + 3_600_000 - now) / 1000)
  const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')
  const sentAt = new Date(now).toISOString()
  const entry: MockPhoneCode = { purpose, phone, code, sent_at: sentAt, expires_at: new Date(now + CODE_LIFETIME_MS).toISOString(), attempts_left: ATTEMPTS }
  mutate((s) => {
    s.phoneCodes = { ...s.phoneCodes, [userId]: entry }
    s.phoneCodeSends = { ...s.phoneCodeSends, [phone]: [...sends, sentAt] }
  })
  console.info(`[mock SMS] to ${phone}: your Waterline code is ${code}`)
  return { phone, expires_at: entry.expires_at, resend_available_at: new Date(now + RESEND_COOLDOWN_MS).toISOString() }
}

/**
 * Check `code` against the user's open code of this purpose. A wrong code
 * uses an attempt; the last attempt voids it (auth.md).
 */
function checkCode(userId: string, purpose: MockPhoneCode['purpose'], code: string, now = Date.now()): MockPhoneCode {
  const trimmed = code.trim()
  if (!/^\d{6}$/.test(trimmed)) {
    throw mockError(422, 'validation_error', 'Request validation failed', [{ loc: ['body', 'code'], msg: 'Enter the 6-digit code', type: 'value_error' }])
  }
  const open = read().phoneCodes?.[userId]
  if (!open || open.purpose !== purpose || open.attempts_left <= 0 || Date.parse(open.expires_at) <= now) {
    throw mockError(400, 'verification_code_expired', 'This code no longer works. Request a new code.')
  }
  if (open.code !== trimmed) {
    const left = open.attempts_left - 1
    mutate((s) => {
      s.phoneCodes![userId].attempts_left = left
    })
    throw mockError(400, 'verification_code_invalid', 'That code is not right.', { attempts_remaining: left })
  }
  mutate((s) => {
    delete s.phoneCodes![userId]
  })
  return open
}

export async function mockRequestPhoneVerification(): Promise<PhoneCodeSent> {
  await delay(null)
  const user = requireCustomerOrDriver()
  if (user.phone_verified) throw mockError(409, 'phone_already_verified', 'This phone number is already verified')
  return sendCode(user.id, 'verify', user.phone)
}

export async function mockVerifyPhone(code: string): Promise<User> {
  await delay(null)
  const user = requireCustomerOrDriver()
  checkCode(user.id, 'verify', code)
  return toUser(
    mutate((s) => {
      const u = s.users.find((x) => x.id === user.id)!
      u.phone_verified = true
      return u
    }),
  )
}

export async function mockRequestPhoneChange(input: PhoneChangeInput): Promise<PhoneCodeSent> {
  await delay(null)
  const user = requireCustomer()
  const phone = normalizeNigerianPhone(input.phone)
  if (!phone) {
    throw mockError(422, 'validation_error', 'Request validation failed', [{ loc: ['body', 'phone'], msg: 'Enter a Nigerian mobile number', type: 'value_error' }])
  }
  if (input.password !== read().users.find((u) => u.id === user.id)!.password) {
    throw mockError(403, 'password_incorrect', 'Your password is not right')
  }
  if (phone === user.phone) throw mockError(409, 'phone_unchanged', 'This is already your phone number')
  if (read().users.some((u) => u.phone === phone)) throw mockError(409, 'phone_already_registered', 'This phone number already has an account')
  return sendCode(user.id, 'change', phone)
}

export async function mockVerifyPhoneChange(code: string): Promise<User> {
  await delay(null)
  const user = requireCustomer()
  const open = checkCode(user.id, 'change', code)
  if (read().users.some((u) => u.phone === open.phone)) {
    throw mockError(409, 'phone_already_registered', 'This phone number already has an account')
  }
  return toUser(
    mutate((s) => {
      const u = s.users.find((x) => x.id === user.id)!
      u.phone = open.phone
      u.phone_verified = true
      return u
    }),
  )
}

/** The open code for the signed-in user, for tests only (the real app never sees it). */
export function openCodeForTests(): string | null {
  const id = read().sessionUserId
  return id ? (read().phoneCodes?.[id]?.code ?? null) : null
}
