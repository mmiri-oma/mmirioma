import { describe, expect, it } from 'vitest'
import { ApiError } from '../../lib/api/client'
import { decideAccess, WRONG_APP_MESSAGE } from './access'
import { buildSupportContact } from './contact'
import { AUTH_TEXT, bannerForError } from './messages'
import { formatPhoneForDisplay, isNigerianMobile, PHONE_FORMAT_MESSAGE } from './phone'
import {
  createAccountSchema,
  NAME_MESSAGE,
  PASSWORD_LENGTH_MESSAGE,
  PASSWORD_REQUIRED_MESSAGE,
  signInSchema,
} from './schemas'
import { formatWait, retryAfterSeconds } from './waitTime'

function httpError(code: string, status: number, details: unknown = null): ApiError {
  return new ApiError({
    kind: 'http',
    status,
    code,
    message: `server says ${code}`,
    details,
  })
}

describe('phone', () => {
  it.each([
    '08000000001',
    '0800 000 0001',
    '0800-000-0001',
    '2348000000001',
    '+2348000000001',
    '+234 (800) 000.0001',
    '07000000001',
    '09000000001',
  ])('accepts %s like the server', (raw) => {
    expect(isNigerianMobile(raw)).toBe(true)
  })

  it.each([
    '',
    '0800 000 00',
    '08000000001234',
    '06000000001',
    '+4478000000001',
    'phone',
  ])('rejects %s', (raw) => {
    expect(isNigerianMobile(raw)).toBe(false)
  })

  it('formats stored numbers as 4-3-4 for display', () => {
    expect(formatPhoneForDisplay('+2348000000001')).toBe('0800 000 0001')
    expect(formatPhoneForDisplay('not a number')).toBe('not a number')
  })
})

describe('wait time (Decision 8)', () => {
  it.each([
    [1, 'Try again in 1 minute'],
    [60, 'Try again in 1 minute'],
    [61, 'Try again in 2 minutes'],
    [720, 'Try again in 12 minutes'],
    [3600, 'Try again in 60 minutes'],
  ])('%i seconds reads "%s"', (seconds, text) => {
    expect(formatWait(seconds)).toBe(text)
  })

  it('reads retry_after_seconds from a 429', () => {
    const error = httpError('too_many_attempts', 429, { retry_after_seconds: 719.2 })
    expect(retryAfterSeconds(error)).toBe(720)
  })

  it('ignores other errors and missing or bad waits', () => {
    expect(retryAfterSeconds(httpError('invalid_credentials', 401))).toBeNull()
    expect(retryAfterSeconds(httpError('too_many_attempts', 429))).toBeNull()
    expect(
      retryAfterSeconds(
        httpError('too_many_attempts', 429, { retry_after_seconds: 'x' }),
      ),
    ).toBeNull()
    expect(retryAfterSeconds(new Error('boom'))).toBeNull()
  })
})

describe('bannerForError', () => {
  it('uses the exact design text for each server error', () => {
    expect(bannerForError(httpError('invalid_credentials', 401))).toEqual({
      tone: 'error',
      title: 'Phone number or password is incorrect',
    })
    expect(bannerForError(httpError('phone_already_registered', 409))).toEqual({
      tone: 'error',
      title: 'An account with this phone number already exists',
      action: 'sign-in-instead',
    })
    expect(bannerForError(httpError('csrf_failed', 403))).toEqual({
      tone: 'error',
      title: 'Security token missing or invalid. Reload the page and try again.',
      action: 'reload',
    })
  })

  it('shows a rate limit as a warning with the wait', () => {
    const banner = bannerForError(
      httpError('too_many_attempts', 429, { retry_after_seconds: 720 }),
    )
    expect(banner).toEqual({
      tone: 'warning',
      title: 'Too many attempts. Please wait and try again.',
      waitSeconds: 720,
    })
  })

  it('offers Retry when the server cannot be reached', () => {
    const offline = new ApiError({
      kind: 'network',
      status: null,
      code: 'network_error',
      message: 'x',
    })
    expect(bannerForError(offline)).toEqual({
      tone: 'error',
      title: AUTH_TEXT.network,
      action: 'retry',
    })
  })

  it('never hides an unexpected error', () => {
    expect(bannerForError(httpError('validation_error', 422)).title).toBe(
      'server says validation_error',
    )
  })
})

describe('decideAccess (route guards)', () => {
  it('shows the splash while checking, never the sign-in screen', () => {
    expect(decideAccess({ kind: 'checking' }, 'customer')).toEqual({ kind: 'checking' })
  })

  it('reports an unreachable server instead of a sign-out', () => {
    expect(decideAccess({ kind: 'unavailable' }, 'staff')).toEqual({
      kind: 'unavailable',
    })
  })

  it('sends signed-out visitors to sign in, flagging how the session ended', () => {
    expect(
      decideAccess({ kind: 'signed-out', ended: false, byUser: false }, 'staff'),
    ).toEqual({ kind: 'sign-in', sessionEnded: false, signedOutByUser: false })
    expect(
      decideAccess({ kind: 'signed-out', ended: true, byUser: false }, 'customer'),
    ).toEqual({ kind: 'sign-in', sessionEnded: true, signedOutByUser: false })
    expect(
      decideAccess({ kind: 'signed-out', ended: false, byUser: true }, 'staff'),
    ).toEqual({ kind: 'sign-in', sessionEnded: false, signedOutByUser: true })
  })

  it.each([
    ['customer', 'customer', 'allowed'],
    ['customer', 'admin', 'wrong-app'],
    ['customer', 'driver', 'wrong-app'],
    ['staff', 'admin', 'allowed'],
    ['staff', 'customer', 'wrong-app'],
    ['staff', 'driver', 'wrong-app'],
  ] as const)('%s app with a %s account: %s', (app, role, kind) => {
    expect(decideAccess({ kind: 'signed-in', role }, app)).toEqual({ kind })
  })

  it('uses the exact wrong-app messages', () => {
    expect(WRONG_APP_MESSAGE.customer).toBe(
      'This account is for MmiriOma staff. Use the staff or driver app.',
    )
    expect(WRONG_APP_MESSAGE.staff).toBe('You do not have access to this page.')
  })
})

describe('form schemas', () => {
  it('accepts a valid new account and trims the name', () => {
    const result = createAccountSchema.parse({
      name: '  Sample Customer  ',
      phone: '0800 000 0001',
      password: 'eight888',
    })
    expect(result.name).toBe('Sample Customer')
  })

  it('reports each field with the designed message', () => {
    const result = createAccountSchema.safeParse({
      name: ' ',
      phone: '0800 000 00',
      password: 'abc12',
    })
    expect(result.success).toBe(false)
    const messages = Object.fromEntries(
      (result.error?.issues ?? []).map((issue) => [issue.path[0], issue.message]),
    )
    expect(messages).toEqual({
      name: NAME_MESSAGE,
      phone: PHONE_FORMAT_MESSAGE,
      password: PASSWORD_LENGTH_MESSAGE,
    })
  })

  it('limits name to 100 and password to 128 characters', () => {
    const base = { phone: '08000000001', password: 'x'.repeat(8) }
    expect(
      createAccountSchema.safeParse({ ...base, name: 'n'.repeat(101) }).success,
    ).toBe(false)
    expect(
      createAccountSchema.safeParse({ ...base, name: 'n', password: 'x'.repeat(129) })
        .success,
    ).toBe(false)
  })

  it('sign in only needs a non-empty password', () => {
    expect(
      signInSchema.safeParse({ phone: '08000000001', password: 'short' }).success,
    ).toBe(true)
    const empty = signInSchema.safeParse({ phone: '08000000001', password: '' })
    expect(empty.error?.issues[0].message).toBe(PASSWORD_REQUIRED_MESSAGE)
  })
})

describe('support contact', () => {
  it('builds call and WhatsApp links from settings', () => {
    expect(buildSupportContact('0800 000 0001', '+234 800 000 0001')).toEqual({
      callHref: 'tel:08000000001',
      whatsAppHref: 'https://wa.me/2348000000001',
    })
  })

  it('has no links when the numbers are not configured', () => {
    expect(buildSupportContact(undefined, '')).toEqual({
      callHref: null,
      whatsAppHref: null,
    })
  })
})
