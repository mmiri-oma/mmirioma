import { CircleX } from 'lucide-react'
import type { Ref } from 'react'

export interface ErrorSummaryItem {
  /** Id of the control to move to. */
  targetId: string
  label: string
}

export interface ErrorSummaryProps {
  items: ErrorSummaryItem[]
  /** Receives focus after a failed "Send request" (`tabIndex={-1}`). */
  ref?: Ref<HTMLDivElement>
}

/**
 * Error summary from the customer design (O2-c): an error alert titled
 * "Check N things before sending" listing a link to each invalid field. A
 * link moves focus to its field, which then shows its own message.
 */
export function ErrorSummary({ items, ref }: ErrorSummaryProps) {
  const count = items.length
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      className="flex gap-3 rounded-box border border-danger-200 bg-danger-50 px-4 py-3.5 outline-offset-2 focus-visible:outline-3 focus-visible:outline-focus-ring"
    >
      <CircleX aria-hidden className="mt-0.5 size-5 shrink-0 text-danger-700" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-bold text-danger-700">
          Check {count} {count === 1 ? 'thing' : 'things'} before sending
        </p>
        <ul className="list-disc pl-5">
          {items.map((item) => (
            <li key={item.targetId}>
              <a
                href={`#${item.targetId}`}
                className="inline-flex min-h-touch items-center font-semibold text-danger-700 underline"
                onClick={(event) => {
                  event.preventDefault()
                  const target = document.getElementById(item.targetId)
                  target?.focus()
                  target?.scrollIntoView?.({ block: 'center' })
                }}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
