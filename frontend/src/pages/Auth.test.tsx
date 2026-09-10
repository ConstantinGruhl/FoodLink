import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Auth from './Auth'
const mock = vi.hoisted(() => ({ login: vi.fn() }))
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ login: mock.login, user: null, config: { mailMode: 'smtp', paymentsEnabled: false } }),
}))
beforeEach(() => mock.login.mockResolvedValue({ id: 'recipient-a', role: 'recipient' }))
function page(from: string) {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/login', state: { from } }]}>
      <Routes>
        <Route path="/login" element={<Auth />} />
        <Route path="/recipient" element={<h1>Recipient workspace</h1>} />
        <Route path="/donor" element={<h1>Wrong donor workspace</h1>} />
        <Route path="/profile" element={<h1>Account profile</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}
async function signIn() {
  const user = userEvent.setup()
  await user.type(screen.getByRole('textbox', { name: 'Email address' }), 'recipient@example.test')
  await user.type(screen.getByLabelText(/^Password/), 'a-correct-long-password')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}
describe('role-aware sign-in navigation', () => {
  it('opens the new role workspace after a different role signed out', async () => {
    page('/donor')
    await signIn()
    expect(await screen.findByRole('heading', { name: 'Recipient workspace' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Wrong donor workspace' })).not.toBeInTheDocument()
  })
  it('retains a return route that the newly authenticated role may access', async () => {
    page('/profile')
    await signIn()
    expect(await screen.findByRole('heading', { name: 'Account profile' })).toBeInTheDocument()
  })
})
