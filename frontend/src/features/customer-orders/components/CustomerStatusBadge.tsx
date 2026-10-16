import { Badge } from '../../../components/ui/Badge'
import type { OrderStatus } from '../../../lib/api/orders'
import { CUSTOMER_STATUS_META } from '../customerStatus'

/** Order status in the customer's words, as an icon and text badge (NFR-021). */
export function CustomerStatusBadge({ status }: { status: OrderStatus }) {
  const meta = CUSTOMER_STATUS_META[status]
  return (
    <Badge tone={meta.tone} icon={meta.icon}>
      {meta.label}
    </Badge>
  )
}
