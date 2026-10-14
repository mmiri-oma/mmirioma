import { FlaskConical } from 'lucide-react'

/**
 * Banner shown while the admin screens read mock data, so nobody presents
 * these orders as real activity (BR-09, SRS §9.1).
 */
export function SimulatedDataNotice() {
  return (
    <div role="note" className="flex items-start gap-3 rounded-card border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <FlaskConical aria-hidden className="mt-0.5 size-4 shrink-0" />
      <p>
        <strong className="font-semibold">Sample data.</strong> These orders are simulated for design review and are
        not real customers. The live order list connects when the admin orders API is ready.
      </p>
    </div>
  )
}
