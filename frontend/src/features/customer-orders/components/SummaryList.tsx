import type { ReactNode } from 'react'

export interface SummaryItem {
  label: string
  /** The value; `null` shows "None given" (O4) unless `hideEmpty` is set. */
  value: ReactNode | null
}

export interface SummaryListProps {
  items: SummaryItem[]
  /** Leave out rows without a value (O3 keeps the confirmation short, Decision 6). */
  hideEmpty?: boolean
}

/**
 * Summary list (`dl`) from the customer design: label over value on phones, a
 * 200 px label column from tablet width up.
 */
export function SummaryList({ items, hideEmpty = false }: SummaryListProps) {
  const shown = hideEmpty ? items.filter((item) => item.value !== null) : items
  return (
    <dl className="flex flex-col">
      {shown.map((item) => (
        <div
          key={item.label}
          className="flex flex-col gap-0.5 border-t border-border py-3 first:border-t-0 first:pt-0 tablet:grid tablet:grid-cols-[200px_minmax(0,1fr)] tablet:gap-4"
        >
          <dt className="text-small text-text-secondary">{item.label}</dt>
          <dd className="break-words whitespace-pre-line">
            {item.value ?? <span className="text-text-secondary italic">None given</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}
