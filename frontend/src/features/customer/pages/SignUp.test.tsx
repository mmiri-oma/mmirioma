// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '../../../app/queryClient'
import { read as readDb, resetMockDb } from '../../../mocks/db'
import { SignUp } from './SignUp'

function renderSignUp() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={['/signup']}>
        <Routes>
          <Route path="/signup" element={<SignUp />} />
          <Route path="/verify-phone" element={<p>Verify phone screen</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  resetMockDb()
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

describe('SignUp (mock mode)', () => {
  it('asks for the password twice and puts a Nigeria (+234) picker before the phone number', () => {
    renderSignUp()
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText('Type your password again')).toHaveAttribute('type', 'password')
    const picker = screen.getByRole('combobox', { name: 'Country code' })
    expect(picker).toHaveValue('NG')
    expect(screen.getByRole('option', { name: 'NG +234' })).toBeInTheDocument()
  })

  it('refuses two different passwords and does not create the account', async () => {
    const user = userEvent.setup()
    renderSignUp()
    await user.type(screen.getByLabelText('Full name'), 'Sample Customer')
    await user.type(screen.getByLabelText('Phone number'), '803 555 0101')
    await user.type(screen.getByLabelText('Password'), 'sample-password-1')
    await user.type(screen.getByLabelText('Type your password again'), 'sample-password-2')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText('The two passwords do not match.')).toBeInTheDocument()
    expect(screen.queryByText('Verify phone screen')).not.toBeInTheDocument()
  })

  it('creates the account with the number typed after +234, stored as E.164', async () => {
    const user = userEvent.setup()
    renderSignUp()
    await user.type(screen.getByLabelText('Full name'), 'Sample Customer')
    await user.type(screen.getByLabelText('Phone number'), '803 555 0101')
    await user.type(screen.getByLabelText('Password'), 'sample-password-1')
    await user.type(screen.getByLabelText('Type your password again'), 'sample-password-1')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText('Verify phone screen')).toBeInTheDocument()
    expect(readDb().users.some((u) => u.phone === '+2348035550101')).toBe(true)
  })
})
