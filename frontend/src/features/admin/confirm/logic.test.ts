import { describe, expect, it } from 'vitest'
import historyConfirmed from '../../../../../docs/api/examples/admin-order-history-confirmed.json'
import optionsSample from '../../../../../docs/api/examples/confirmation-options.json'
import type { CategoryOptions } from '../../../lib/api/adminConfirmation'
import { adminOrderEventSchema } from '../../../lib/api/adminDispatch'
import { ApiError } from '../../../lib/api/client'
import { timelineFromHistory } from '../real/orders'
import {
  buildConfirmRequest,
  confirmKind,
  confirmProblem,
  confirmationLine,
  formErrors,
  lagosIso,
  requiredSourceKind,
  sourcesFor,
  usableCategories,
  type ConfirmForm,
} from './logic'

const QUOTE = { currency: 'NGN' as const, total_minor_units: 2_000_000, water_category: { id: 'cat-utility', label: 'Utility Water', supported_uses: null } }

const FORM: ConfirmForm = {
  categoryId: 'cat-utility',
  sourceId: 'src-a',
  date: '2026-10-29',
  from: '10:00',
  to: '12:00',
  total: '45,000',
  method: 'phone_call',
  agreedDate: '2026-10-28',
  agreedTime: '09:15',
  told: true,
  note: '',
}

const httpError = (code: string, status: number, details: unknown = null) => new ApiError({ kind: 'http', status, code, message: 'from the server', details })

function category(sources: { id: string; kind: 'ninth_mile' | 'borehole' | null; reasons?: string[] }[]): CategoryOptions {
  return {
    id: 'cat-utility',
    label: 'Utility Water',
    sources: sources.map((s) => ({
      id: s.id,
      name: s.id,
      approximate_location: 'Enugu',
      report_reference: 'LR-0001',
      approved_until: '2027-01-30',
      is_simulated: false,
      reasons: (s.reasons ?? []) as CategoryOptions['sources'][number]['reasons'],
      kind: s.kind,
    })),
  }
}

describe('confirmKind', () => {
  it('is "server" for a priced order and "manual" for a price request', () => {
    expect(confirmKind({ status: 'awaiting_confirmation', quote: QUOTE })).toBe('server')
    expect(confirmKind({ status: 'quote_requested', quote: null })).toBe('manual')
  })

  it('is null once confirmed, or for awaiting_confirmation without a quote', () => {
    expect(confirmKind({ status: 'confirmed', quote: QUOTE })).toBeNull()
    expect(confirmKind({ status: 'awaiting_confirmation', quote: null })).toBeNull()
  })
})

describe('sources', () => {
  it('shows a priced Tanker order only sources of the customer kind; a source with no kind never matches', () => {
    const kind = requiredSourceKind({ delivery_type: 'tanker', water_source: 'borehole' }, 'server')
    expect(kind).toBe('borehole')
    const { usable, unusable } = sourcesFor(
      category([{ id: 'a', kind: 'borehole' }, { id: 'b', kind: 'ninth_mile' }, { id: 'c', kind: null }, { id: 'd', kind: 'borehole', reasons: ['suspended'] }]),
      kind,
    )
    expect(usable.map((s) => s.id)).toEqual(['a'])
    expect(unusable.map((s) => s.id)).toEqual(['d'])
  })

  it('lets a Keke order and a price request use any kind', () => {
    expect(requiredSourceKind({ delivery_type: 'keke', water_source: null }, 'server')).toBeNull()
    expect(requiredSourceKind({ delivery_type: 'tanker', water_source: 'borehole' }, 'manual')).toBeNull()
  })

  it('offers a price request only categories with a usable source (contract sample)', () => {
    const categories = (optionsSample as { categories: CategoryOptions[] }).categories
    expect(usableCategories(categories).map((c) => c.label)).toEqual(
      categories.filter((c) => c.sources.some((s) => s.reasons.length === 0)).map((c) => c.label),
    )
  })
})

describe('formErrors and buildConfirmRequest', () => {
  it('confirms a priced order at its quote: awaiting_confirmation, no manual total (row 7 alone)', () => {
    expect(formErrors(FORM, 'server')).toEqual({})
    const request = buildConfirmRequest(FORM, 'server')
    expect(request).toMatchObject({ to: 'confirmed', expected_status: 'awaiting_confirmation', water_category_id: 'cat-utility', source_id: 'src-a' })
    expect(request).not.toHaveProperty('manual_quote_total_minor_units')
    expect(request.delivery_window).toEqual({ start_at: '2026-10-29T10:00:00+01:00', end_at: '2026-10-29T12:00:00+01:00' })
    expect(request.customer_agreement).toEqual({ method: 'phone_call', agreed_at: '2026-10-28T09:15:00+01:00', disclosures_confirmed: true })
    expect(request.note).toBeNull()
  })

  it('confirms a price request with the typed total in kobo', () => {
    expect(buildConfirmRequest(FORM, 'manual')).toMatchObject({ expected_status: 'quote_requested', manual_quote_total_minor_units: 4_500_000 })
  })

  it('checks the price, window, tick box and note before sending', () => {
    const errors = formErrors({ ...FORM, total: '45000.50', to: '09:00', told: false, method: 'other', note: '' }, 'manual')
    expect(errors).toEqual({
      price: 'Enter the total in whole naira, at least ₦1.',
      window: 'The delivery window must end after it starts.',
      agreement: 'Tick the box once you have told the customer.',
      note: 'Add a note saying how the customer agreed.',
    })
    // A priced order has no price to type.
    expect(formErrors({ ...FORM, total: '' }, 'server').price).toBeUndefined()
  })

  it('writes Lagos time as UTC+1', () => {
    expect(lagosIso('2026-10-29', '07:30')).toBe('2026-10-29T07:30:00+01:00')
  })
})

describe('confirmProblem', () => {
  it('refreshes the sources when the chosen one can no longer be used', () => {
    const problem = confirmProblem(httpError('transition_requirements_unmet', 409, { missing: ['source_eligible'] }))
    expect(problem).toMatchObject({ title: 'This order cannot be confirmed yet.', next: 'refresh_sources' })
    expect(problem?.lines).toEqual([
      'The chosen water source can no longer be used for this category.',
      'The source list has been refreshed and your choice cleared. Choose another source.',
    ])
  })

  it('says the order has changed on 409 invalid_order_transition', () => {
    expect(confirmProblem(httpError('invalid_order_transition', 409))).toMatchObject({ title: 'This order has changed.', next: 'refresh_order' })
  })

  it('puts a 422 under its section', () => {
    const details = [{ loc: ['body', 'source_id'], msg: 'Choose a source of the kind the customer chose', type: 'value_error' }]
    expect(confirmProblem(httpError('validation_error', 422, details))?.fields).toEqual({ source: 'Choose a source of the kind the customer chose' })
  })

  it('never says a retry could confirm twice after a lost connection', () => {
    const problem = confirmProblem(new ApiError({ kind: 'network', status: null, code: 'network_error', message: 'offline' }))
    expect(problem).toMatchObject({ title: "We couldn't reach Waterline.", next: 'retry' })
    expect(problem?.lines[0]).toContain("Trying again won't confirm it twice.")
  })

  it('leaves other errors to the screen', () => {
    expect(confirmProblem(httpError('order_not_found', 404))).toBeNull()
  })
})

describe('the confirmation in the order timeline (Q5)', () => {
  it('shows a price request as Order placed, Awaiting confirmation, then Confirmed (contract sample)', () => {
    const events = historyConfirmed.items.map((e) => adminOrderEventSchema.parse(e))
    const lines = timelineFromHistory('2026-10-19T08:00:00Z', events)
    expect(lines.map((l) => l.label)).toEqual(['Order placed', 'Awaiting confirmation', 'Confirmed'])
    expect(lines[1].detail).toBe('Manual price agreed with the customer · Sample Dispatcher')
    expect(lines[2].detail).toMatch(/^Potable Water · Sample Borehole A · .+ · Manual price ₦45,000 · Sample Dispatcher · Customer asked the driver to call on arrival\.$/)
  })

  it('shows a priced order as Confirmed with "Server price", and no manual step', () => {
    const confirmed = adminOrderEventSchema.parse({ ...historyConfirmed.items[0], confirmation: { ...historyConfirmed.items[0].confirmation, manual: false } })
    const lines = timelineFromHistory('2026-10-19T08:00:00Z', [confirmed])
    expect(lines.map((l) => l.label)).toEqual(['Order placed', 'Confirmed'])
    expect(lines[1].detail).toContain('Server price ₦45,000')
  })

  it('leaves events that are neither confirmation nor assignment out', () => {
    expect(confirmationLine(adminOrderEventSchema.parse({ ...historyConfirmed.items[1], reason_code: null }))).toBeNull()
  })
})
