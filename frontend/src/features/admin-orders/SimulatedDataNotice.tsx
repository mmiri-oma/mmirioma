import { TriangleAlert } from 'lucide-react'

/**
 * Banner shown while the admin screens read mock data, so nobody presents
 * these orders as real activity (BR-09, SRS §9.1). Styled as the design
 * system's warning alert.
 */
export function SimulatedDataNotice() {
  return (
    <div role="note" className="flex items-start gap-3 rounded-box border border-warning-200 bg-warning-50 px-4 py-3.5 text-warning-800">
      <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
      <p>
        <strong className="font-bold">Sample data.</strong> These orders are simulated for design review and are
        not real customers. No water will be delivered. The live order list connects when the admin orders API is
        ready.
      </p>
    </div>
  )
}
