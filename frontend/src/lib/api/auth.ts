import { apiClient, type ApiClient } from './client'

/** Server-enforced role (docs/api/auth.md#roles). */
export type UserRole = 'customer' | 'admin' | 'driver'

/** The signed-in user's own account. */
export interface User {
  id: string
  name: string
  /** E.164, e.g. `+2348000000001`. */
  phone: string
  role: UserRole
  /** False until a dispatcher verifies the phone manually (FR-003). */
  phone_verified: boolean
}

/** Body returned by register, login and `GET /api/v1/auth/me`. */
export interface Session {
  user: User
  /** Sent automatically by the client on unsafe requests once stored. */
  csrf_token: string
  /** ISO 8601 UTC timestamp when the session ends. */
  expires_at: string
}

export interface RegisterInput {
  name: string
  /** Any Nigerian mobile format; the server normalizes it. */
  phone: string
  /** 8–128 characters. */
  password: string
}

export interface LoginInput {
  phone: string
  password: string
}

async function storeSession(
  client: ApiClient,
  pending: Promise<Session>,
): Promise<Session> {
  const session = await pending
  client.setCsrfToken(session.csrf_token)
  return session
}

/**
 * Create a customer account and sign in (`POST /api/v1/auth/register`).
 *
 * @throws {ApiError} `phone_already_registered` (409), `validation_error` (422)
 *   or `too_many_attempts` (429, wait in `details.retry_after_seconds`).
 */
export function register(input: RegisterInput, client: ApiClient = apiClient) {
  return storeSession(
    client,
    client.request<Session>('/api/v1/auth/register', {
      method: 'POST',
      body: input,
    }),
  )
}

/**
 * Sign in with phone and password (`POST /api/v1/auth/login`).
 *
 * @throws {ApiError} `invalid_credentials` (401) for any wrong phone, password
 *   or inactive account, or `too_many_attempts` (429, wait in
 *   `details.retry_after_seconds`).
 */
export function login(input: LoginInput, client: ApiClient = apiClient) {
  return storeSession(
    client,
    client.request<Session>('/api/v1/auth/login', {
      method: 'POST',
      body: input,
    }),
  )
}

/**
 * Load the current session (`GET /api/v1/auth/me`). Call it on page load:
 * the CSRF token lives only in memory, so a reload must fetch it again.
 *
 * @throws {ApiError} `not_authenticated` (401) when signed out.
 */
export function getMe(signal?: AbortSignal, client: ApiClient = apiClient) {
  return storeSession(client, client.request<Session>('/api/v1/auth/me', { signal }))
}

/**
 * Sign out (`POST /api/v1/auth/logout`) and forget the CSRF token.
 *
 * @throws {ApiError} `not_authenticated` (401) or `csrf_failed` (403).
 */
export async function logout(client: ApiClient = apiClient): Promise<void> {
  await client.request<null>('/api/v1/auth/logout', { method: 'POST' })
  client.setCsrfToken(null)
}
