import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { HelpMenu, TourHost } from '@/components/layout/tour-host'
import { DateInput } from '@/components/ui/date-input'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { api, ApiError, type SessionUser } from '@/lib/api'
import { TOUR_IDS } from '@/lib/tours'

const user = (completed: boolean) => ({ id: 'u1', permissions: ['patients:read'], onboardingCompleted: completed, preferences: { toursSeen: [...TOUR_IDS] } }) as SessionUser

afterEach(() => vi.restoreAllMocks())

it('mantiene el recorrido abierto si falla finalizar y permite reintentar', async () => {
  const post = vi.spyOn(api, 'post').mockRejectedValueOnce(new ApiError(503, 'UNAVAILABLE', 'No se pudo guardar el tutorial', {})).mockResolvedValue(undefined)
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  vi.spyOn(client, 'invalidateQueries').mockResolvedValue()
  render(<QueryClientProvider client={client}><TourHost user={user(false)} pathname="/dashboard"><HelpMenu /></TourHost></QueryClientProvider>)
  await screen.findByRole('dialog', { name: 'Bienvenido/a' }, { timeout: 2000 })
  await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
  expect(await screen.findByText('No se pudo guardar el tutorial')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(post).toHaveBeenCalledWith('/api/auth/onboarding/complete')
})

it('reabrir la ayuda no vuelve a registrar onboarding ya completado', async () => {
  const post = vi.spyOn(api, 'post')
  render(<QueryClientProvider client={new QueryClient()}><TourHost user={user(true)} pathname="/dashboard"><HelpMenu /></TourHost></QueryClientProvider>)
  await userEvent.click(screen.getByRole('button', { name: 'Ayuda' }))
  await userEvent.click(screen.getByRole('button', { name: 'Recorrido general del sistema' }))
  await screen.findByRole('dialog', { name: 'Bienvenido/a' })
  await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(post).not.toHaveBeenCalled()
})

it('Escape cierra primero el calendario y conserva el formulario padre', async () => {
  const close = vi.fn()
  render(<Dialog open onOpenChange={close}><DialogContent title="Nuevo turno"><DateInput aria-label="Fecha" defaultValue="27/11/2026" /></DialogContent></Dialog>)
  await userEvent.click(screen.getByRole('button', { name: 'Elegir en el calendario' }))
  expect(screen.getByRole('dialog', { name: 'Calendario' })).toBeVisible()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog', { name: 'Calendario' })).not.toBeInTheDocument()
  expect(close).not.toHaveBeenCalled()
  await userEvent.keyboard('{Escape}')
  expect(close).toHaveBeenCalledWith(false)
})
