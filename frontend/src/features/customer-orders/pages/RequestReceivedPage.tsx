import { Check, Copy } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { Button } from '../../../components/ui/Button'
import { buttonClasses } from '../../../components/ui/buttonVariants'
import { Toast } from '../../../components/ui/Toast'
import type { Session } from '../../../lib/api/auth'
import type { OrderRead } from '../../../lib/api/orders'
import { formatCalendarDate, formatLitres } from '../../../lib/format'
import { CustomerLayout } from '../components/CustomerLayout'
import { CustomerStatusBadge } from '../components/CustomerStatusBadge'
import { SummaryList } from '../components/SummaryList'
import { NEXT_STEPS, ORDER_TEXT } from '../messages'

/** Router state Request received needs: the order `POST /orders` returned. */
export interface RequestReceivedLocationState {
  order?: OrderRead
}

/** How long the Copy button reads "Copied" (O3-b). */
const COPIED_MS = 3000

/**
 * O3 Request received, shown after `POST /orders` returned 201 (or 200 on an
 * idempotent retry). It uses the returned order; no extra request.
 *
 * It says "Request received" and never "confirmed": the request has no price
 * or delivery window yet (FR-027). Focus moves to the heading when it opens.
 * Opened without an order (a reload loses router state), it goes to My
 * orders, where the request is listed.
 */
export function RequestReceivedPage({ session }: { session: Session }) {
  const location = useLocation()
  const order = (location.state as RequestReceivedLocationState | null)?.order
  if (!order) return <Navigate to="/" replace />
  return (
    <CustomerLayout user={session.user}>
      <ReceivedContent order={order} />
    </CustomerLayout>
  )
}

function ReceivedContent({ order }: { order: OrderRead }) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  // Announce the result: move focus to the heading once, when the screen opens.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <h1 ref={headingRef} tabIndex={-1} className="text-h1 outline-none">
          Request received
        </h1>
        <div>
          <CustomerStatusBadge status={order.status} />
        </div>
        <p>{ORDER_TEXT.receivedLead}</p>
      </div>

      <div className="grid gap-5 tablet:grid-cols-2 tablet:items-start">
        <div className="flex flex-col gap-5">
          <ReferenceBox reference={order.reference} />
          <section className="rounded-lg border border-border bg-surface p-4 shadow-xs">
            <h2 className="sr-only">Your request</h2>
            <SummaryList
              hideEmpty
              items={[
                { label: 'Quantity', value: formatLitres(order.quantity_litres) },
                { label: 'Delivery address', value: order.delivery_address },
                { label: 'Landmark', value: order.landmark },
                {
                  label: 'Preferred delivery date',
                  value: order.preferred_delivery_date
                    ? `${formatCalendarDate(order.preferred_delivery_date)} (a preference, not a booked time)`
                    : null,
                },
              ]}
            />
          </section>
        </div>

        <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-xs">
          <h2 className="text-h3">What happens next</h2>
          <ol className="flex flex-col gap-3">
            {NEXT_STEPS.map((step, index) => (
              <li key={step} className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="grid size-7 shrink-0 place-items-center rounded-full bg-primary-100 text-small font-bold text-primary-900"
                >
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <div className="flex flex-col gap-3 tablet:flex-row">
        <Link to="/" className={buttonClasses('primary')}>
          View my orders
        </Link>
        <Link to="/request" className={buttonClasses('secondary')}>
          Request more water
        </Link>
      </div>
    </div>
  )
}

/**
 * The order reference, large and monospaced, with Copy (reference box from
 * the customer design). After copying, the button reads "Copied" for three
 * seconds and a toast says "Reference copied". If the phone blocks copying,
 * nothing changes and the reference stays selectable as text.
 */
function ReferenceBox({ reference }: { reference: string }) {
  const [copied, setCopied] = useState(false)
  const [toastShown, setToastShown] = useState(false)
  // Stable, so the toast's dismiss timer is not restarted by re-renders.
  const hideToast = useCallback(() => setToastShown(false), [])

  // Turn "Copied" back into "Copy" after a while; cleared on unmount.
  useEffect(() => {
    if (!copied) return undefined
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reference)
      setCopied(true)
      setToastShown(true)
    } catch {
      // Clipboard unavailable or refused: the reference can still be selected.
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-semibold">Your order reference</h2>
      <div className="flex items-center justify-between gap-3 rounded-box border-2 border-dashed border-primary-200 bg-primary-50 py-3 pr-3 pl-4">
        <span className="font-mono text-[1.375rem]/[1.875rem] font-semibold tracking-[0.02em] break-all select-all">
          {reference}
        </span>
        <Button variant="ghost" size="sm" onClick={() => void copy()}>
          {copied ? <Check aria-hidden className="size-5" /> : <Copy aria-hidden className="size-5" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="text-small text-text-secondary">{ORDER_TEXT.referenceHelp}</p>
      {toastShown ? (
        <Toast tone="success" text="Reference copied" onDismiss={hideToast} />
      ) : null}
    </section>
  )
}
