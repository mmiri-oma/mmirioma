import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { Badge } from '../../components/ui/Badge'

/**
 * Whether staff have confirmed the customer's phone (FR-003), as icon plus
 * words, never colour alone (NFR-021). Wording follows the admin design:
 * "confirmed", not "verified", so nothing suggests automated SMS checks.
 */
export function PhoneState({ confirmed }: { confirmed: boolean }) {
  return confirmed ? (
    <span className="inline-flex items-center gap-1 text-small text-success-700">
      <ShieldCheck aria-hidden className="size-4 shrink-0" />
      Phone confirmed
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-small text-warning-800">
      <ShieldAlert aria-hidden className="size-4 shrink-0" />
      Phone not confirmed
    </span>
  )
}

/** The same state as a badge, for the order detail's customer card. */
export function PhoneStateBadge({ confirmed }: { confirmed: boolean }) {
  return confirmed ? (
    <Badge tone="success" icon={ShieldCheck}>
      Confirmed
    </Badge>
  ) : (
    <Badge tone="warning" icon={ShieldAlert}>
      Not confirmed
    </Badge>
  )
}
