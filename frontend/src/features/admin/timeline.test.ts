import { describe, expect, it } from 'vitest'
import { withContactAttempts } from './timeline'

const placed = { label: 'Order placed', at: '2026-10-20T07:00:00Z' }
const arrived = { label: 'Arrived', at: '2026-10-20T09:42:00Z' }
const failed = { label: 'Delivery failed', at: '2026-10-20T09:53:00Z', detail: 'Demo Driver · Customer unreachable' }

describe('withContactAttempts (#280)', () => {
  it('puts each attempt between Arrived and Delivery failed, numbered in the order they happened', () => {
    const lines = withContactAttempts([placed, arrived, failed], ['2026-10-20T09:44:00Z', '2026-10-20T09:49:00Z'])
    expect(lines.map((t) => t.label)).toEqual(['Order placed', 'Arrived', 'Contact attempt 1', 'Contact attempt 2', 'Delivery failed'])
    expect(lines[2]).toEqual({ label: 'Contact attempt 1', at: '2026-10-20T09:44:00Z' })
  })

  it('has no detail line on an attempt: the contract sends times only', () => {
    const [, attempt] = withContactAttempts([placed], ['2026-10-20T09:44:00Z'])
    expect(attempt).not.toHaveProperty('detail')
  })

  it('numbers a third and later attempt on, since the contract sets no maximum', () => {
    const lines = withContactAttempts([placed, arrived, failed], ['2026-10-20T09:44:00Z', '2026-10-20T09:46:00Z', '2026-10-20T09:49:00Z'])
    expect(lines.map((t) => t.label)).toEqual(['Order placed', 'Arrived', 'Contact attempt 1', 'Contact attempt 2', 'Contact attempt 3', 'Delivery failed'])
  })

  it('numbers by time, whatever order the server listed them in', () => {
    const lines = withContactAttempts([placed, arrived], ['2026-10-20T09:49:00Z', '2026-10-20T09:44:00Z'])
    expect(lines.slice(2).map((t) => [t.label, t.at])).toEqual([
      ['Contact attempt 1', '2026-10-20T09:44:00Z'],
      ['Contact attempt 2', '2026-10-20T09:49:00Z'],
    ])
  })

  it('leaves the timeline as it is when there are none, as a new list', () => {
    const entries = [placed, arrived, failed]
    const lines = withContactAttempts(entries, [])
    expect(lines).toEqual(entries)
    expect(lines).not.toBe(entries)
  })

  it('puts the status event first when an attempt shares its time', () => {
    const lines = withContactAttempts([placed, arrived, failed], [arrived.at])
    expect(lines.map((t) => t.label)).toEqual(['Order placed', 'Arrived', 'Contact attempt 1', 'Delivery failed'])
  })

  it('keeps Order placed first even for an attempt dated before it', () => {
    const lines = withContactAttempts([placed, arrived], ['2026-10-19T00:00:00Z'])
    expect(lines.map((t) => t.label)).toEqual(['Order placed', 'Contact attempt 1', 'Arrived'])
  })

  it('does not rearrange events whose times are not in order, and does not change its input', () => {
    const odd = [placed, { label: 'B', at: '2026-10-20T10:00:00Z' }, { label: 'A', at: '2026-10-20T09:00:00Z' }]
    const before = JSON.stringify(odd)
    const lines = withContactAttempts(odd, ['2026-10-20T09:30:00Z'])
    expect(lines.filter((t) => !t.label.startsWith('Contact')).map((t) => t.label)).toEqual(['Order placed', 'B', 'A'])
    expect(JSON.stringify(odd)).toBe(before)
  })

  it('appends an attempt whose time cannot be read, rather than dropping it', () => {
    const lines = withContactAttempts([placed, arrived], ['not a time'])
    expect(lines.map((t) => t.label)).toEqual(['Order placed', 'Arrived', 'Contact attempt 1'])
  })
})
