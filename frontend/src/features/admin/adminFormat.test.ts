import { describe, expect, it } from 'vitest'
import type { AdminOrderStatus, AdminPaymentStatus } from '../../domain/admin'
import { showsPaymentChip } from './adminFormat'

const order = (status: AdminOrderStatus, payment: AdminPaymentStatus | null) => ({
  status,
  payment: { method: 'pay_on_delivery' as const, status: payment },
})

describe('showsPaymentChip (#274)', () => {
  it.each<[AdminOrderStatus, boolean]>([
    ['awaiting_rider', true],
    ['assigned', true],
    ['on_the_way', true],
    ['delivered', true],
    ['failed', false],
    ['cancelled', false],
  ])('shows "Cash to collect" on %s: %s', (status, shown) => {
    expect(showsPaymentChip(order(status, 'pending_collection'))).toBe(shown)
  })

  it.each<AdminPaymentStatus>(['paid', 'partially_paid', 'refund_due', 'refunded'])('keeps %s on a cancelled or failed order', (payment) => {
    expect(showsPaymentChip(order('cancelled', payment))).toBe(true)
    expect(showsPaymentChip(order('failed', payment))).toBe(true)
  })

  it('shows nothing when the server sends no payment status', () => {
    expect(showsPaymentChip(order('cancelled', null))).toBe(false)
  })
})
