import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DonationForm from './DonationForm'
afterEach(() => vi.unstubAllGlobals())
describe('donation offer form', () => {
  it('waits for the API, sends full food metadata and serializes expiry as an instant', async () => {
    let sent: Record<string, unknown> | undefined
    const onSaved = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, options: RequestInit) => {
        sent = JSON.parse(options.body as string)
        return new Response(
          JSON.stringify({ error: { code: 'TEST_REJECTION', message: 'Receiving location is unavailable' } }),
          { status: 409 },
        )
      }),
    )
    const user = userEvent.setup()
    render(<DonationForm onSaved={onSaved} />)
    await user.type(screen.getByRole('textbox', { name: 'Food name' }), 'Bread')
    fireEvent.change(screen.getByLabelText('Use-by / availability end date'), {
      target: { value: '2099-09-30' },
    })
    await user.type(screen.getByRole('textbox', { name: 'Allergens' }), 'wheat, sesame')
    await user.click(screen.getByRole('button', { name: 'Submit food offer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Receiving location is unavailable')
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Food name' })).toHaveValue('Bread')
    const line = (sent!.items as Record<string, unknown>[])[0]
    expect(line.name).toBe('Bread')
    expect(line.allergens).toEqual(['wheat', 'sesame'])
    expect(line.expiresOn).toMatch(/^2099-09-30T.*Z$/)
    expect(line).not.toHaveProperty('donorId')
    expect(sent).not.toHaveProperty('donorId')
  })
})
