import { CircleAlert, CircleCheck } from 'lucide-react'
import type { UseFormRegisterReturn } from 'react-hook-form'
import { cn } from '../../../lib/cn'
import { formatLitres } from '../../../lib/format'
import { PRESET_LITRES } from '../requestForm'

export interface QuantityTilesProps {
  /** `register('quantityChoice')`. */
  registration: UseFormRegisterReturn<'quantityChoice'>
  /** Current choice, to mark the selected tile. */
  value: string
  error?: string
  /** While sending: tiles look locked and clicks do nothing. */
  locked: boolean
  /** Id of the first radio, the target of the error summary link. */
  firstId: string
}

/**
 * "How much water?" quantity chooser (design system tiles; customer design
 * O2). Native radio buttons inside labels, so keyboard and screen readers
 * work as a normal radio group. Tiles show litres only: this release has no
 * prices (Decision 7). The last tile, "Other amount", reveals a litres field.
 *
 * While sending, the radios are natively disabled. The form has already
 * read its values by then, and React Hook Form keeps the value of a field
 * disabled through the DOM (only its own `disabled` option drops it).
 * Cancelling the click instead is not reliable: React reports a radio change
 * during the click, before the browser restores the old choice.
 */
export function QuantityTiles({ registration, value, error, locked, firstId }: QuantityTilesProps) {
  const errorId = `${firstId}-error`
  const tiles = [
    ...PRESET_LITRES.map((litres) => ({ value: String(litres), main: formatLitres(litres), sub: null })),
    { value: 'other', main: 'Other amount', sub: 'Type your own' },
  ]
  return (
    <fieldset aria-describedby={error ? errorId : undefined} className="flex flex-col gap-3">
      <legend className="mb-3 text-h3">How much water?</legend>
      <div className="grid grid-cols-2 gap-2 tablet:grid-cols-4">
        {tiles.map((tile, index) => {
          const selected = value === tile.value
          return (
            <label
              key={tile.value}
              className={cn(
                'relative flex min-h-18 cursor-pointer flex-col justify-center rounded-box border-2 px-3 py-2.5',
                'has-[input:focus-visible]:outline-3 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus-ring',
                selected
                  ? 'border-primary bg-primary-50 shadow-[inset_0_0_0_1px_var(--color-primary)]'
                  : error
                    ? 'border-danger-600 bg-surface'
                    : locked
                      ? 'border-border bg-surface-muted'
                      : 'border-border-strong bg-surface hover:border-neutral-800',
                locked && 'cursor-progress',
              )}
            >
              <input
                type="radio"
                id={index === 0 ? firstId : undefined}
                value={tile.value}
                disabled={locked}
                aria-invalid={error ? true : undefined}
                className="absolute size-px opacity-0"
                {...registration}
              />
              <span className="text-h3 font-bold">{tile.main}</span>
              {tile.sub ? <span className="text-small text-text-secondary">{tile.sub}</span> : null}
              {selected ? (
                <CircleCheck aria-hidden className="absolute top-2 right-2 size-5 text-primary" />
              ) : null}
            </label>
          )
        })}
      </div>
      {error ? (
        <p id={errorId} className="flex items-start gap-1.5 text-sm leading-5 font-semibold text-danger-700">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
    </fieldset>
  )
}
