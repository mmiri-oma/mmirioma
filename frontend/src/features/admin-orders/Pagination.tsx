import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '../../components/ui/Button'

interface PaginationProps {
  /** 1-based current page. */
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}

/** "Showing 11–20 of 22" with previous/next controls. Renders nothing for an empty list. */
export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  if (total === 0) return null
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const first = (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, total)

  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 px-4 py-3">
      <p className="text-small text-text-secondary" aria-live="polite">
        Showing <span className="font-semibold text-text-primary tabular-nums">{first}–{last}</span> of{' '}
        <span className="font-semibold text-text-primary tabular-nums">{total}</span>
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft aria-hidden className="size-5" />
          <span className="max-tablet:sr-only">Previous</span>
        </Button>
        <Button variant="secondary" size="sm" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
          <span className="max-tablet:sr-only">Next</span>
          <ChevronRight aria-hidden className="size-5" />
        </Button>
      </div>
    </nav>
  )
}
