import { describe, expect, it } from 'vitest'
import type { ProofEvidence } from '../../../lib/api/adminHolds'
import { ApiError } from '../../../lib/api/client'
import { endReasonLabel } from '../../../domain/admin'
import {
  CANCEL_DRIVER_NOTE,
  CANCEL_REASONS,
  cancelDriverState,
  cancelNoteError,
  CHANGED_MESSAGE,
  FAIL_REASONS,
  backendStatusFor,
  buildProofRequest,
  canCancel,
  canFail,
  decisionFailure,
  deliveryCodeLine,
  failErrors,
  hasLiveDriver,
  initialProofForm,
  noteError,
  outcomeFailure,
  proofErrors,
  type ProofForm,
} from './logic'

const PROOF: ProofEvidence = {
  delivered_litres: 1000,
  reason: 'customer_cannot_receive_code',
  driver_note: "Customer's phone is off. The gateman signed.",
  arrived_at: '2026-10-20T08:20:00Z',
  // 09:44 in Lagos (UTC+1).
  unloading_completed_at: '2026-10-20T08:44:00Z',
  sent_at: '2026-10-20T08:48:00Z',
  delivery_code: { issued_at: '2026-10-20T08:44:00Z', sms_status: 'accepted', attempts_used: 3, attempts_limit: 5, expired: true },
  contact_attempts: [{ attempted_at: '2026-10-20T08:46:00Z' }],
  location: null,
}

// 11:00 in Lagos on 20 Oct 2026: after the proof, so a confirmation at 10:15 is valid.
const NOW = new Date('2026-10-20T10:00:00Z')

const approve = (patch: Partial<ProofForm> = {}): ProofForm => ({
  choice: 'approve',
  method: 'phone_call',
  date: '2026-10-20',
  time: '10:15',
  details: '',
  note: 'Customer confirmed by phone that 1,000 litres were delivered.',
  ...patch,
})

describe('initialProofForm', () => {
  it('starts as an approval by phone call, now, with no note', () => {
    expect(initialProofForm(NOW)).toEqual({ choice: 'approve', method: 'phone_call', date: '2026-10-20', time: '11:00', details: '', note: '' })
  })
})

describe('proofErrors (the contract’s checks, in the form’s words)', () => {
  it('accepts a complete approval', () => {
    expect(proofErrors(approve(), PROOF, NOW)).toEqual({})
  })

  it('needs a note of 1 to 500 characters, for approve and reject', () => {
    expect(proofErrors(approve({ note: '   ' }), PROOF, NOW).note).toBe('Write a note (up to 500 characters).')
    expect(proofErrors({ ...approve(), choice: 'reject', note: '' }, PROOF, NOW).note).toBeDefined()
    expect(proofErrors(approve({ note: 'x'.repeat(501) }), PROOF, NOW).note).toBeDefined()
    expect(proofErrors(approve({ note: 'x'.repeat(500) }), PROOF, NOW)).toEqual({})
  })

  it('refuses a confirmation time in the future, with 2 minutes of tolerance', () => {
    expect(proofErrors(approve({ time: '11:30' }), PROOF, NOW).when).toBe("The time can't be in the future.")
    expect(proofErrors(approve({ time: '11:01' }), PROOF, NOW).when).toBeUndefined()
  })

  it('refuses a time before unloading was completed, naming it', () => {
    expect(proofErrors(approve({ time: '09:00' }), PROOF, NOW).when).toMatch(/before unloading was completed \(.*\)/)
    // Within the 2-minute tolerance of the completion time (09:44 Lagos).
    expect(proofErrors(approve({ time: '09:43' }), PROOF, NOW).when).toBeUndefined()
  })

  it('asks for the time when it is missing', () => {
    expect(proofErrors(approve({ date: '' }), PROOF, NOW).when).toBe('Enter when the customer confirmed.')
    expect(proofErrors(approve({ time: '' }), PROOF, NOW).when).toBe('Enter when the customer confirmed.')
  })

  it('needs details for "Other", and only for it', () => {
    expect(proofErrors(approve({ method: 'other' }), PROOF, NOW).details).toBe('Add details for Other.')
    expect(proofErrors(approve({ method: 'other', details: 'Spoke to the gateman' }), PROOF, NOW)).toEqual({})
    expect(proofErrors(approve({ method: 'in_person_to_staff' }), PROOF, NOW)).toEqual({})
  })

  it('checks only the note for a rejection', () => {
    expect(proofErrors({ ...approve({ date: '', method: 'other' }), choice: 'reject' }, PROOF, NOW)).toEqual({})
  })
})

describe('buildProofRequest', () => {
  it('sends the acknowledgment as a Lagos time with the hold id, for an approval', () => {
    expect(buildProofRequest(approve({ details: ' Spoke to him ' }), 'hold-1')).toEqual({
      hold_id: 'hold-1',
      decision: 'approve',
      customer_acknowledgment: { method: 'phone_call', confirmed_at: '2026-10-20T10:15:00+01:00', note: 'Spoke to him' },
      note: 'Customer confirmed by phone that 1,000 litres were delivered.',
    })
  })

  it('sends no acknowledgment for a rejection (the contract refuses one)', () => {
    const request = buildProofRequest({ ...approve(), choice: 'reject', note: ' The person who answered is not the customer. ' }, 'hold-1')
    expect(request).toEqual({ hold_id: 'hold-1', decision: 'reject', note: 'The person who answered is not the customer.' })
    expect(request).not.toHaveProperty('customer_acknowledgment')
  })

  it('sends empty details as null', () => {
    expect(buildProofRequest(approve(), 'hold-1')).toMatchObject({ customer_acknowledgment: { note: null } })
  })
})

describe('deliveryCodeLine: never the code, only whether it was issued, the SMS, the attempts and expiry', () => {
  it('words an expired code with an accepted SMS', () => {
    expect(deliveryCodeLine(PROOF.delivery_code)).toMatch(/^Issued .* · SMS accepted · 3 of 5 attempts used · Expired$/)
  })
  it('words a live code whose SMS failed', () => {
    expect(deliveryCodeLine({ ...PROOF.delivery_code!, sms_status: 'failed', expired: false })).toMatch(/SMS not accepted · 3 of 5 attempts used · Not expired$/)
  })
  it('says so when no code was issued', () => {
    expect(deliveryCodeLine(null)).toBe('No code was issued.')
  })
})

describe('noteError (continue and resume need 1 to 500 characters)', () => {
  it('accepts a trimmed note of 1 to 500 characters only', () => {
    expect(noteError('')).toBeDefined()
    expect(noteError('   ')).toBeDefined()
    expect(noteError(' x ')).toBeUndefined()
    expect(noteError('x'.repeat(500))).toBeUndefined()
    expect(noteError('x'.repeat(501))).toBe('Write a note (up to 500 characters).')
  })
})

describe('failErrors (FAIL: a reason, and a note that Other requires)', () => {
  it('needs a reason', () => {
    expect(failErrors({ reason: null, note: '' })).toEqual({ reason: 'Choose a reason.' })
  })
  it('needs a note for Other, and only for Other', () => {
    expect(failErrors({ reason: 'other', note: '  ' }).note).toBe('Write a note: Other needs one.')
    expect(failErrors({ reason: 'other', note: 'Customer sent the driver away.' })).toEqual({})
    expect(failErrors({ reason: 'unsafe_access', note: '' })).toEqual({})
    expect(failErrors({ reason: 'source_quality_concern', note: '' })).toEqual({})
  })
  it('allows a note of up to 500 characters', () => {
    expect(failErrors({ reason: 'unsafe_access', note: 'x'.repeat(500) })).toEqual({})
    expect(failErrors({ reason: 'unsafe_access', note: 'x'.repeat(501) }).note).toBe('Write a note (up to 500 characters).')
  })
  it('offers only the three reasons agreed for these screens', () => {
    expect(FAIL_REASONS.map((r) => r.code)).toEqual(['source_quality_concern', 'unsafe_access', 'other'])
  })
})

describe('the status the dispatcher saw, for expected_status', () => {
  it('uses the server’s own status when the list carries it', () => {
    expect(backendStatusFor({ status: 'on_the_way', backend_status: 'unloading' })).toBe('unloading')
  })
  it('works it out from the admin status for a mock order, which carries none', () => {
    expect(backendStatusFor({ status: 'loading' })).toBe('accepted')
    expect(backendStatusFor({ status: 'on_the_way' })).toBe('collected')
    expect(backendStatusFor({ status: 'awaiting_rider' })).toBe('confirmed')
  })
  it('offers FAIL only once the driver has accepted, and not before or after', () => {
    for (const s of ['accepted', 'departed', 'collected', 'en_route', 'arrived', 'unloading']) expect(canFail({ status: 'x', backend_status: s })).toBe(true)
    for (const s of ['confirmed', 'assigned', 'delivered', 'cancelled', 'failed']) expect(canFail({ status: 'x', backend_status: s })).toBe(false)
    expect(canFail({ status: 'loading' })).toBe(true)
    expect(canFail({ status: 'assigned' })).toBe(false)
  })
})

describe('outcomeFailure (why the cost sentence is missing)', () => {
  it('says the order can no longer be cancelled for a 409, without a retry', () => {
    expect(outcomeFailure(new ApiError({ kind: 'http', status: 409, code: 'invalid_order_transition', message: 'x' }))).toEqual({ message: 'This order can no longer be cancelled.', retry: false })
  })
  it('says it could not check the cost for anything else, with a retry', () => {
    expect(outcomeFailure(new ApiError({ kind: 'network', status: null, code: 'network_error', message: 'x' }))).toEqual({ message: "We couldn't check what this costs the customer.", retry: true })
  })
})

describe('decisionFailure', () => {
  const refusal = (status: number, code: string, details: unknown = null, kind: 'http' | 'network' = 'http') =>
    new ApiError({ kind, status, code, message: `Sample ${code}`, details })

  it('words every stale case as "This order has changed." and offers Refresh', () => {
    for (const code of ['hold_not_open', 'hold_not_found', 'invalid_order_transition']) {
      expect(decisionFailure(refusal(409, code))).toMatchObject({ message: CHANGED_MESSAGE, changed: true })
    }
  })

  it('uses the contract’s message for approving a delivery the dispatcher made', () => {
    expect(decisionFailure(refusal(403, 'own_delivery_override'))).toMatchObject({ message: "You can't approve proof for a delivery you made.", changed: false })
  })

  it('asks to reload on a failed security check', () => {
    expect(decisionFailure(refusal(403, 'csrf_failed')).message).toBe('Your security check failed. Reload the page.')
  })

  it('keeps what was typed on a lost connection', () => {
    expect(decisionFailure(refusal(0, 'network_error', null, 'network')).message).toBe('No connection. What you typed is kept. Try again.')
  })

  it('maps a 422 to the field it names', () => {
    const failure = decisionFailure(
      refusal(422, 'validation_error', [
        { loc: ['body', 'customer_acknowledgment', 'confirmed_at'], msg: "The time can't be in the future", type: 'value_error' },
        { loc: ['body', 'note'], msg: 'Write a note', type: 'value_error' },
        { loc: ['body', 'customer_acknowledgment', 'note'], msg: 'Add details for Other', type: 'value_error' },
      ]),
    )
    expect(failure.fields).toEqual({ when: "The time can't be in the future", note: 'Write a note', details: 'Add details for Other' })
    expect(failure.changed).toBe(false)
  })

  it('shows the server’s own sentence when the source can no longer be used, with its new answer for the card (R2)', () => {
    const failure = decisionFailure(
      new ApiError({ kind: 'http', status: 409, code: 'source_not_eligible', message: "This source's laboratory approval for this water category has expired.", details: { answer: 'not_eligible' } }),
    )
    expect(failure).toMatchObject({ message: "This source's laboratory approval for this water category has expired.", changed: false, eligibility: 'not_eligible' })
    // "Cannot check" is an answer too; anything else leaves the card as it was.
    expect(decisionFailure(refusal(409, 'source_not_eligible', { answer: 'cannot_check' })).eligibility).toBe('cannot_check')
    expect(decisionFailure(refusal(409, 'source_not_eligible', { answer: 'eligible' })).eligibility).toBeUndefined()
    expect(decisionFailure(refusal(409, 'source_not_eligible')).eligibility).toBeUndefined()
  })

  it('maps a refused reason to the reason field (FAIL)', () => {
    const failure = decisionFailure(refusal(422, 'validation_error', [{ loc: ['body', 'reason_code'], msg: 'Choose a reason', type: 'value_error' }]))
    expect(failure.fields).toEqual({ reason: 'Choose a reason' })
  })

  it('says there is nobody to take the job back from (R3), without offering Refresh', () => {
    expect(decisionFailure(refusal(404, 'assignment_not_found'))).toMatchObject({ message: 'This order has no driver assigned', changed: false })
  })

  it('falls back to the server’s message for anything else', () => {
    expect(decisionFailure(refusal(500, 'boom')).message).toBe('Sample boom')
    expect(decisionFailure(new Error('x')).message).toBe('Something went wrong. Please try again.')
  })
})

describe('the cancel entry on the order panel (#176)', () => {
  it.each(['awaiting_confirmation', 'awaiting_rider', 'assigned', 'loading', 'on_the_way', 'failed'])('is offered for %s', (status) => {
    expect(canCancel({ status })).toBe(true)
  })

  it.each(['delivered', 'cancelled', 'disputed'])('is not on the page for %s', (status) => {
    expect(canCancel({ status })).toBe(false)
  })

  it.each([
    ['assigned', true],
    ['loading', true],
    ['on_the_way', true],
    ['awaiting_confirmation', false],
    ['awaiting_rider', false],
    ['failed', false],
  ])('says a driver’s job is live for %s: %s', (status, live) => {
    expect(hasLiveDriver({ status })).toBe(live)
  })
})

describe('the driver note in the CANCEL dialog (#274)', () => {
  const RIDER = { id: 'd1', name: 'Demo Driver' }
  it.each([
    ['assigned', RIDER, 'live', "The driver's job ends and leaves their list. Nothing notifies the driver."],
    ['on_the_way', RIDER, 'live', "The driver's job ends and leaves their list. Nothing notifies the driver."],
    ['failed', RIDER, 'ended', "This order's job has ended, so no driver's job changes."],
    ['failed', null, 'none', "No driver is assigned, so no driver's job changes."],
    ['awaiting_rider', null, 'none', "No driver is assigned, so no driver's job changes."],
  ])('says %s with partner %j is %s', (status, partner, state, note) => {
    expect(cancelDriverState({ status, partner })).toBe(state)
    expect(CANCEL_DRIVER_NOTE[state as 'live' | 'ended' | 'none']).toBe(note)
  })
})

describe('cancelNoteError (CANCEL: a note of up to 500, required once unloading has started)', () => {
  it('leaves the note optional before unloading', () => {
    expect(cancelNoteError('', 'accepted')).toBeUndefined()
    expect(cancelNoteError('The customer phoned.', 'collected')).toBeUndefined()
  })

  it('requires a note at unloading, with the reason why', () => {
    expect(cancelNoteError('  ', 'unloading')).toBe('Say why: unloading has already started.')
    expect(cancelNoteError('The customer phoned.', 'unloading')).toBeUndefined()
  })

  it('refuses a note over 500 characters', () => {
    expect(cancelNoteError('x'.repeat(501), 'accepted')).toMatch(/up to 500/)
  })
})

describe('the two cancel reasons (#174)', () => {
  it('are the two the contract accepts, in staff words, and have a history label', () => {
    expect(CANCEL_REASONS.map((r) => r.code)).toEqual(['customer_request', 'mmirioma_unable'])
    expect(CANCEL_REASONS.map((r) => r.label)).toEqual(['The customer asked to cancel', 'MmiriOma is unable to deliver'])
    expect(endReasonLabel('customer_request')).toBe('Customer asked to cancel')
    expect(endReasonLabel('mmirioma_unable')).toBe('MmiriOma is unable to deliver')
  })
})
