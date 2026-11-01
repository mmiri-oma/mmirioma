// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '../../../app/queryClient'
import { ApiError } from '../../../lib/api/client'
import { PartnerSignup } from './PartnerSignup'

/** What the next sign-up answers; set by each test. */
const server = vi.hoisted(() => ({
  refusal: null as unknown,
  /** What the area list answers: areas, or an error to throw. */
  areas: [{ id: 'zone-1', name: 'Zone One' }] as { id: string; name: string }[] | Error,
  signedUp: [] as unknown[],
}))

vi.mock('../partnerApi', () => ({
  listSignupAreas: async () => {
    if (server.areas instanceof Error) throw server.areas
    return server.areas
  },
  partnerSignup: async (input: unknown) => {
    server.signedUp.push(input)
    throw server.refusal
  },
}))

vi.mock('../../marketing/queries', () => ({ useSupportContact: () => ({ phone: '+2348000000000', whatsapp: null }) }))

const refused = (details: unknown) =>
  new ApiError({ kind: 'http', status: 422, code: 'validation_error', message: 'Request validation failed', details })

function renderSignup() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={['/partner/signup']}>
        <Routes>
          <Route path="/partner/signup" element={<PartnerSignup />} />
          <Route path="/partner" element={<p>Partner home</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function submitForm(refusal: ApiError) {
  server.refusal = refusal
  const user = userEvent.setup()
  renderSignup()
  await user.type(screen.getByLabelText('Full name'), 'Sample Rider')
  await user.type(screen.getByLabelText('Phone number'), '08031234567')
  await user.type(screen.getByLabelText('Plate number'), 'ENU 482 KK')
  await user.selectOptions(await screen.findByLabelText('Area you work in'), 'zone-1')
  await user.type(screen.getByLabelText('Password'), 'long-enough')
  await user.click(screen.getByRole('button', { name: 'Create account' }))
}

describe('PartnerSignup server errors (#80)', () => {
  it('shows an area error under the area field', async () => {
    const msg = 'This area is not open for sign-up any more. Choose another area.'
    await submitForm(refused([{ loc: ['body', 'service_zone_id'], msg, type: 'value_error' }]))
    expect(await screen.findByText(msg)).toBeInTheDocument()
    expect(screen.queryByText('Request validation failed')).not.toBeInTheDocument()
  })

  it('puts errors no field can show in the top notice, and keeps the field errors', async () => {
    await submitForm(
      refused([
        { loc: ['body', 'plate'], msg: 'Use 4 to 15 characters', type: 'value_error' },
        { loc: ['body', 'vehicle_type'], msg: 'Choose keke or tanker', type: 'enum' },
        { loc: ['body'], msg: 'Request body is not valid', type: 'value_error' },
      ]),
    )
    expect(await screen.findByText('Choose keke or tanker Request body is not valid')).toBeInTheDocument()
    expect(screen.getByText('Use 4 to 15 characters')).toBeInTheDocument()
  })

  it('shows the message of a validation error without details', async () => {
    await submitForm(refused(null))
    expect(await screen.findByText('Request validation failed')).toBeInTheDocument()
  })
})

describe('PartnerSignup area dropdown', () => {
  it('lists the active areas by name and sends the chosen ID, not text', async () => {
    server.areas = [
      { id: 'zone-1', name: 'Zone One' },
      { id: 'zone-2', name: 'Zone Two' },
    ]
    server.signedUp = []
    await submitForm(refused(null))
    expect(screen.getByRole('option', { name: 'Zone Two' })).toBeInTheDocument()
    expect(server.signedUp[0]).toMatchObject({ service_zone_id: 'zone-1' })
  })

  it('asks for an area when none is chosen, without calling the server', async () => {
    server.areas = [{ id: 'zone-1', name: 'Zone One' }]
    server.signedUp = []
    const user = userEvent.setup()
    renderSignup()
    await screen.findByRole('option', { name: 'Zone One' })
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText('Choose the area you work in.')).toBeInTheDocument()
    expect(server.signedUp).toEqual([])
  })

  it('explains that sign-up is unavailable, with the support number, when no area is set up', async () => {
    server.areas = []
    renderSignup()
    expect(await screen.findByText(/Driver sign-up is not open right now/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '0800 000 0000' })).toHaveAttribute('href', 'tel:+2348000000000')
    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled()
  })

  it('shows the load failure with a retry, and keeps sign-up off', async () => {
    server.areas = new ApiError({ kind: 'config', status: null, code: 'api_unavailable', message: 'The server is not reachable.' })
    renderSignup()
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled()
    server.areas = [{ id: 'zone-1', name: 'Zone One' }]
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('option', { name: 'Zone One' })).toBeInTheDocument()
  })
})
