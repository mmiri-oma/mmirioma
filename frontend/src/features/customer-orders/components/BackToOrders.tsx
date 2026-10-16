import { ChevronLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

/** "My orders" back link at the top of Request water (O2) and Order detail (O4). */
export function BackToOrders() {
  return (
    <Link
      to="/"
      className="inline-flex min-h-touch items-center gap-1 self-start font-semibold text-primary-700"
    >
      <ChevronLeft aria-hidden className="size-5" />
      My orders
    </Link>
  )
}
