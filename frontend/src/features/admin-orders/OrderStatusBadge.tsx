import { Badge } from '../../components/ui/Badge'
import { Tag } from '../../components/ui/Tag'
import type { OrderStatus } from '../../lib/api/adminOrders'
import { ORDER_STATUS_META } from './orderStatus'

/** Order status as an icon + text badge, with the status meaning as a tooltip. */
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const meta = ORDER_STATUS_META[status]
  return (
    <span title={meta.description}>
      <Badge tone={meta.tone} icon={meta.icon}>
        {meta.label}
      </Badge>
    </span>
  )
}

/** Marks a demo/test record so it is never mistaken for a real order (BR-09). */
export function SimulatedBadge() {
  return <Tag kind="simulated" />
}
