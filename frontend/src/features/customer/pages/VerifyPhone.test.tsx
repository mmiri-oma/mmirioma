// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '../../../app/queryClient'
import { mockRegister } from '../../../mocks/authMock'
import { read, resetMockDb } from '../../../mocks/db'
import { mockRequestPhoneVerification, mockVerifyPhone, openCodeForTests } from '../../../mocks/phoneVerificationMock'
import * as authApi from '../../auth/authApi'
import { ChangePhone } from './ChangePhone'
import { VerifyPhone } from './VerifyPhone'

const PASSWORD = 'sample-password-1'

function renderAt(path: string, state?: unknown) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[{ pathname: path, state }]}>
        <Routes>
          <Route path="/verify-phone" element={<VerifyPhone />} />
          <Route path="/profile/phone" element={<ChangePhone />} />
          <Route path="/home" element={<p>Home screen</p>} />
          <Route path="/order/review" element={<p>Review screen</p>} />
          <Route path="/profile" element={<p>Profile screen</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** A wrong 6-digit code for the open one. */
function wrongCode(): string {
  return openCodeForTests() === '000000' ? '111111' : '000000'
}

beforeEach(async () => {
  resetMockDb()
  vi.spyOn(console, 'info').mockImplementation(() => {})
  // A new, unverified customer, signed in.
  await mockRegister({ name: 'Sample Customer', phone: '0800 000 0061', password: PASSWORD })
})

describe('VerifyPhone (mock mode)', () => {
  it('offers "Do this later" right after Create account', async () => {
    const user = userEvent.setup()
    renderAt('/verify-phone', { afterSignup: true, from: '/home' })
    expect(await screen.findByText('Verify your phone number')).toBeInTheDocument()
    expect(screen.getByText('0800 000 0061')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Do this later' }))
    expect(await screen.findByText('Home screen')).toBeInTheDocument()
  })

  it('sends a code, shows the tries left for a wrong one, then verifies and returns to Review', async () => {
    const user = userEvent.setup()
    renderAt('/verify-phone', { from: '/order/review' })
    expect(screen.queryByRole('button', { name: 'Do this later' })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Send code' }))
    const field = await screen.findByLabelText('Code')

    await user.type(field, wrongCode())
    await user.click(screen.getByRole('button', { name: 'Verify' }))
    expect(await screen.findByText('That code is wrong. 4 tries left.')).toBeInTheDocument()
    expect(screen.getByLabelText('Code')).toHaveValue('')

    await user.type(screen.getByLabelText('Code'), openCodeForTests()!)
    await user.click(screen.getByRole('button', { name: 'Verify' }))
    expect(await screen.findByText(/is verified. You can send water requests now./)).toBeInTheDocument()
    expect(read().users.find((u) => u.phone === '+2348000000061')?.phone_verified).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Review screen')).toBeInTheDocument()
  })

  it('keeps a pasted code with a space whole (correction 11)', async () => {
    const user = userEvent.setup()
    renderAt('/verify-phone')
    await user.click(await screen.findByRole('button', { name: 'Send code' }))
    const field = await screen.findByLabelText('Code')
    await user.click(field)
    await user.paste('123 456')
    expect(field).toHaveValue('123456')
  })

  it('asks for all 6 digits before sending', async () => {
    const user = userEvent.setup()
    renderAt('/verify-phone')
    await user.click(await screen.findByRole('button', { name: 'Send code' }))
    await user.type(await screen.findByLabelText('Code'), '1234')
    await user.click(screen.getByRole('button', { name: 'Verify' }))
    expect(await screen.findByText('Enter all 6 digits.')).toBeInTheDocument()
  })

  it('turns the field off when no tries are left', async () => {
    const user = userEvent.setup()
    renderAt('/verify-phone')
    await user.click(await screen.findByRole('button', { name: 'Send code' }))
    await screen.findByLabelText('Code')
    for (let i = 0; i < 4; i++) await mockVerifyPhone(wrongCode()).catch(() => {})
    await user.type(screen.getByLabelText('Code'), wrongCode())
    await user.click(screen.getByRole('button', { name: 'Verify' }))
    expect(await screen.findByText('That code is wrong and no tries are left. Send a new code.')).toBeInTheDocument()
    expect(screen.getByLabelText('Code')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled()
  })

  it('shows the wait when too many codes were asked for', async () => {
    const user = userEvent.setup()
    await mockRequestPhoneVerification() // starts the 60-second cooldown
    renderAt('/verify-phone')
    await user.click(await screen.findByRole('button', { name: 'Send code' }))
    expect(await screen.findByText(/Wait 1 minute, then try again\./)).toBeInTheDocument()
  })

  it('shows success straight away for an already verified phone', async () => {
    await mockRequestPhoneVerification()
    await mockVerifyPhone(openCodeForTests()!)
    renderAt('/verify-phone')
    expect(await screen.findByText(/is verified\. You can send water requests now\./)).toBeInTheDocument()
  })
})

describe('VerifyPhone SMS delivery report', () => {
  const status = (delivery_status: 'accepted' | 'delivered' | 'failed') => ({
    delivery_status,
    expires_at: new Date(Date.now() + 300_000).toISOString(),
    resend_available_at: new Date(Date.now() + 60_000).toISOString(),
  })

  it('tells the customer when the carrier reports the code did not arrive', async () => {
    vi.spyOn(authApi, 'getPhoneCodeStatus').mockResolvedValue(status('failed'))
    const user = userEvent.setup()
    renderAt('/verify-phone')
    await user.click(await screen.findByRole('button', { name: 'Send code' }))
    expect(await screen.findByText('The code did not reach your phone.')).toBeInTheDocument()
    // The code field still works: a late SMS can still be typed, and limits are unchanged.
    expect(screen.getByLabelText('Code')).toBeEnabled()
  })

  it('shows no failure while the provider has only accepted the message', async () => {
    vi.spyOn(authApi, 'getPhoneCodeStatus').mockResolvedValue(status('accepted'))
    const user = userEvent.setup()
    renderAt('/verify-phone')
    await user.click(await screen.findByRole('button', { name: 'Send code' }))
    await screen.findByLabelText('Code')
    expect(screen.queryByText('The code did not reach your phone.')).not.toBeInTheDocument()
  })
})

describe('ChangePhone (mock mode)', () => {
  it('shows a wrong password on its field', async () => {
    const user = userEvent.setup()
    renderAt('/profile/phone')
    await user.type(await screen.findByLabelText('New phone number'), '0800 000 0062')
    await user.type(screen.getByLabelText('Current password'), 'not-the-password')
    await user.click(screen.getByRole('button', { name: 'Send code' }))
    expect(await screen.findByText('That password is not right.')).toBeInTheDocument()
  })

  it('keeps the old number until the new one is verified', async () => {
    const user = userEvent.setup()
    renderAt('/profile/phone')
    await user.type(await screen.findByLabelText('New phone number'), '0800 000 0062')
    await user.type(screen.getByLabelText('Current password'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Send code' }))
    expect(await screen.findByText('Your current number stays on the account until this code is verified.')).toBeInTheDocument()
    expect(read().users.some((u) => u.phone === '+2348000000061')).toBe(true)

    await user.type(screen.getByLabelText('Code'), openCodeForTests()!)
    await user.click(screen.getByRole('button', { name: 'Verify' }))
    expect(await screen.findByText('Your number is now 0800 000 0062. Use it to sign in next time.')).toBeInTheDocument()
    expect(read().users.some((u) => u.phone === '+2348000000061')).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(await screen.findByText('Profile screen')).toBeInTheDocument()
  })
})
