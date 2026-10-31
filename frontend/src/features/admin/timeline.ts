import type { AdminOrder } from '../../domain/admin'

type TimelineEntry = AdminOrder['timeline'][number]

/**
 * Put the order's contact attempts into its timeline, as "Contact attempt N",
 * each at its own time (docs/design/admin-order-contact-attempts.md, #280).
 *
 * The attempts are numbered in the order they happened, across the whole
 * order. Each goes after the last entry that is not later than it, so on a tie
 * the status event comes first (an attempt cannot precede the arrival it
 * follows) and the entries already in the list keep their order: nothing is
 * re-sorted, so a history with odd times is not rearranged. "Order placed", the
 * first entry, always stays first.
 *
 * @param entries - The timeline so far, oldest first, "Order placed" first.
 * @param attempts - The attempt times (UTC ISO), as the server sent them.
 * @returns A new list; `entries` is not changed.
 */
export function withContactAttempts(entries: readonly TimelineEntry[], attempts: readonly string[]): TimelineEntry[] {
  const result = [...entries]
  const times = [...attempts].sort((a, b) => Date.parse(a) - Date.parse(b))
  times.forEach((at, index) => {
    const entry: TimelineEntry = { label: `Contact attempt ${index + 1}`, at }
    const when = Date.parse(at)
    let position = result.length
    if (!Number.isNaN(when)) {
      position = 1
      result.forEach((other, i) => {
        if (i > 0 && Date.parse(other.at) <= when) position = i + 1
      })
    }
    result.splice(position, 0, entry)
  })
  return result
}
