/**
 * Centralized HTTP client for the MmiriOma API.
 *
 * - Always sends credentials so cookie-based sessions work cross-origin.
 * - Sends the session's CSRF token on unsafe methods (see `setCsrfToken`).
 * - Every failure is thrown as an ApiError with a stable `code`, mirroring the
 *   backend envelope: {"error": {"code", "message", "details"}}.
 */

const DEV_FALLBACK_BASE_URL = 'http://localhost:8000'

/**
 * Where a request failed:
 * - `network`: no response (offline, DNS, CORS rejection, server down).
 * - `http`: the server responded with a non-2xx status.
 * - `parse`: the response body was not valid JSON.
 * - `config`: the client is misconfigured (e.g. missing base URL).
 */
export type ApiErrorKind = 'network' | 'http' | 'parse' | 'config'

/**
 * The only error type thrown by the API client (apart from abort errors).
 * Branch on `code` (stable) rather than `message` (human-readable, may change).
 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind
  /** HTTP status, or null when no response was received. */
  readonly status: number | null
  readonly code: string
  readonly details: unknown

  constructor(options: {
    kind: ApiErrorKind
    status: number | null
    code: string
    message: string
    details?: unknown
    cause?: unknown
  }) {
    super(options.message, { cause: options.cause })
    this.name = 'ApiError'
    this.kind = options.kind
    this.status = options.status
    this.code = options.code
    this.details = options.details ?? null
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** Header the backend checks on unsafe methods (docs/api/auth.md#csrf). */
export const CSRF_HEADER = 'X-CSRF-Token'

export interface RequestOptions {
  /** Defaults to `GET`. */
  method?: HttpMethod
  /** Serialized as JSON; sets `Content-Type: application/json`. */
  body?: unknown
  /** Cancels the request; the resulting `AbortError` is rethrown unchanged. */
  signal?: AbortSignal
}

export interface ApiClient {
  /**
   * Send a request and return the parsed JSON body.
   *
   * @param path - Path beginning with `/`, e.g. `/api/v1/health`.
   * @returns The response body. The type is not validated at runtime.
   * @throws {ApiError} On network, HTTP, parse, or configuration failures.
   */
  request<T>(path: string, options?: RequestOptions): Promise<T>
  /**
   * Remember the CSRF token from the last session response, or forget it on
   * sign-out. It is kept in memory only, never in storage, and is sent as
   * `X-CSRF-Token` on every non-GET request.
   */
  setCsrfToken(token: string | null): void
}

interface ClientConfig {
  /** API origin, e.g. `http://localhost:8000`. A trailing slash is removed. */
  baseUrl: string | undefined
  /** Injectable for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch
}

interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown }
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== 'object' || value === null || !('error' in value)) {
    return false
  }
  const error = (value as { error: unknown }).error
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  )
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  return text ? JSON.parse(text) : null
}

/**
 * Create an API client. Application code should use the shared `apiClient`;
 * this factory exists so tests can inject a mock `fetch` and base URL.
 *
 * Every request sends cookies (`credentials: 'include'`) so cookie-based
 * sessions work when the API is on a different origin.
 */
export function createApiClient({
  baseUrl,
  fetch: fetchImpl = globalThis.fetch.bind(globalThis),
}: ClientConfig): ApiClient {
  const normalizedBaseUrl = baseUrl?.trim().replace(/\/+$/, '')
  let csrfToken: string | null = null

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    if (!normalizedBaseUrl) {
      throw new ApiError({
        kind: 'config',
        status: null,
        code: 'missing_api_base_url',
        message: 'VITE_API_BASE_URL is not configured',
      })
    }

    const method = options.method ?? 'GET'
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (method !== 'GET' && csrfToken) {
      headers[CSRF_HEADER] = csrfToken
    }
    const init: RequestInit = {
      method,
      credentials: 'include',
      headers,
      signal: options.signal,
    }
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(options.body)
    }

    let response: Response
    try {
      response = await fetchImpl(`${normalizedBaseUrl}${path}`, init)
    } catch (cause) {
      // Let callers distinguish deliberate cancellation from connectivity problems.
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        throw cause
      }
      throw new ApiError({
        kind: 'network',
        status: null,
        code: 'network_error',
        message: 'Unable to reach the server. Check your connection and try again.',
        cause,
      })
    }

    let payload: unknown
    try {
      payload = await readJson(response)
    } catch (cause) {
      throw new ApiError({
        kind: 'parse',
        status: response.status,
        code: response.ok ? 'invalid_response' : 'http_error',
        message: response.ok
          ? 'The server returned an invalid response.'
          : `Request failed with status ${response.status}`,
        cause,
      })
    }

    if (!response.ok) {
      if (isErrorEnvelope(payload)) {
        throw new ApiError({
          kind: 'http',
          status: response.status,
          code: payload.error.code,
          message: payload.error.message,
          details: payload.error.details,
        })
      }
      throw new ApiError({
        kind: 'http',
        status: response.status,
        code: 'http_error',
        message: `Request failed with status ${response.status}`,
        details: payload,
      })
    }

    return payload as T
  }

  return {
    request,
    setCsrfToken(token) {
      csrfToken = token
    },
  }
}

function resolveBaseUrl(): string | undefined {
  const configured = import.meta.env.VITE_API_BASE_URL
  if (configured) return configured
  // Convenience for local development only; production builds must set it explicitly.
  return import.meta.env.DEV ? DEV_FALLBACK_BASE_URL : undefined
}

/** Shared client configured from `VITE_API_BASE_URL`. */
export const apiClient = createApiClient({ baseUrl: resolveBaseUrl() })
