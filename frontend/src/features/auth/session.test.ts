import { afterEach, describe, expect, it, vi } from 'vitest'
import { getMe } from '../../lib/api/auth'
import { ApiError } from '../../lib/api/client'
import { createQueryClient } from '../../lib/queryClient'
import { LOGOUT_MUTATION_KEY, SESSION_QUERY_KEY, loadSession } from './sessionQuery'

vi.mock('../../lib/api/auth', () => ({ getMe: vi.fn() }))
const getMeMock = vi.mocked(getMe)

const notAuthenticated = () =>
  new ApiError({
    kind: 'http',
    status: 401,
    code: 'not_authenticated',
    message: 'Please sign in',
  })

afterEach(() => vi.resetAllMocks())

describe('loadSession', () => {
  it('treats 401 as signed out, not as an error', async () => {
    getMeMock.mockRejectedValue(notAuthenticated())
    await expect(loadSession()).resolves.toBeNull()
  })

  it('rethrows other failures so the app can offer Retry', async () => {
    const offline = new ApiError({
      kind: 'network',
      status: null,
      code: 'network_error',
      message: 'x',
    })
    getMeMock.mockRejectedValue(offline)
    await expect(loadSession()).rejects.toBe(offline)
  })
})

describe('global 401 handling', () => {
  it('re-checks the session when another request finds it gone', async () => {
    const client = createQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    await client
      .fetchQuery({
        queryKey: ['orders'],
        queryFn: () => Promise.reject(notAuthenticated()),
      })
      .catch(() => undefined)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: SESSION_QUERY_KEY })
  })

  it('does the same for a failed mutation', async () => {
    const client = createQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const mutation = client.getMutationCache().build(client, {
      mutationFn: () => Promise.reject(notAuthenticated()),
    })
    await mutation.execute(undefined).catch(() => undefined)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: SESSION_QUERY_KEY })
  })

  it('leaves sign-out and other errors alone', async () => {
    const client = createQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const logout = client.getMutationCache().build(client, {
      mutationKey: LOGOUT_MUTATION_KEY,
      mutationFn: () => Promise.reject(notAuthenticated()),
    })
    await logout.execute(undefined).catch(() => undefined)
    await client
      .fetchQuery({
        queryKey: ['orders'],
        queryFn: () =>
          Promise.reject(
            new ApiError({
              kind: 'http',
              status: 404,
              code: 'order_not_found',
              message: 'x',
            }),
          ),
      })
      .catch(() => undefined)
    expect(invalidate).not.toHaveBeenCalled()
  })
})
