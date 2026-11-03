// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Illustration } from './Illustration'

describe('Illustration', () => {
  it('draws the keke, tanker and jerrycan as Waterline flat SVG, labelled when given alt text', () => {
    const { container } = render(
      <>
        <Illustration name="keke" alt="A keke with jerrycans" />
        <Illustration name="tanker" />
        <Illustration name="jerrycan" />
      </>,
    )
    expect(screen.getByRole('img', { name: 'A keke with jerrycans' }).tagName.toLowerCase()).toBe('svg')
    expect(container.querySelectorAll('img')).toHaveLength(0)
    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(2)
  })

  it('keeps the other handoff pictures as images', () => {
    const { container } = render(<Illustration name="gift" />)
    expect(container.querySelector('img')).not.toBeNull()
  })
})
