import type { HoldReview } from '../../../lib/api/adminHolds'
import { CancelDialog, FailDialog } from './EndDelivery'

/**
 * The FAIL or CANCEL dialog opened from a hold's review (R2, R3): it sends the
 * hold's id, so the hold closes with the delivery, and it takes the order's
 * status from the evidence the sheet is showing. A held job always has a live
 * driver.
 */
export function EndDialogs({
  ending,
  reference,
  hold,
  onClose,
  onDone,
  onRefresh,
}: {
  ending: 'fail' | 'cancel' | null
  reference: string
  hold: HoldReview
  onClose: () => void
  onDone: (message: string) => void
  onRefresh: () => void
}) {
  if (ending === null) return null
  const shared = { reference, expectedStatus: hold.order_status, hold: { id: hold.id, kind: hold.kind }, onClose, onDone, onRefresh }
  return ending === 'fail' ? <FailDialog {...shared} /> : <CancelDialog {...shared} driver="live" />
}
