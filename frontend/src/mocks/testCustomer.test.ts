// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { mockLogin } from './authMock'
import { read, resetMockDb } from './db'
import { DEMO_PASSWORD, TEST_CUSTOMER_ID, TEST_CUSTOMER_PHONE } from './seed'

beforeEach(() => resetMockDb())

describe('the mock test customer', () => {
  it('signs in already verified, so a first order needs no SMS code', async () => {
    const session = await mockLogin({ phone: TEST_CUSTOMER_PHONE, password: DEMO_PASSWORD })
    expect(session.user).toMatchObject({ id: TEST_CUSTOMER_ID, role: 'customer', phone_verified: true })
  })

  it('starts empty: no addresses and no orders', () => {
    const data = read().customers[TEST_CUSTOMER_ID]
    expect(data.addresses).toEqual([])
    expect(data.orders).toEqual([])
  })
})
