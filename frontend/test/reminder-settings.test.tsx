import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import RemindersPage from '@/app/(app)/reminders/page'
import { api, ApiError } from '@/lib/api'

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }))
vi.mock('@/hooks/use-session', () => ({ useSession: () => ({ data: { user: { id: 'u1', permissions: ['appointments:manage'] } } }) }))

function mount(load: () => Promise<unknown>) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-27T12:00:00Z'))
  const get = vi.spyOn(api, 'get').mockImplementation(async (path) => path === '/api/organization' ? load() as never : { date: '2026-11-30', reminders: [] } as never)
  const post = vi.spyOn(api, 'post').mockResolvedValue({ date: '2026-11-29', reminders: [] } as never)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><RemindersPage /></QueryClientProvider>)
  return { client, get, post }
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

it('abre la fecha configurada y conserva una selección manual aunque se refresquen los ajustes', async () => {
  const { client, get, post } = mount(async () => ({ settings: { reminders: { daysAhead: 3 } } }))
  await waitFor(() => expect(get).toHaveBeenCalledWith('/api/reminders?date=2026-11-30'))
  await userEvent.click(screen.getByRole('button', { name: 'Día anterior' }))
  expect(screen.getByText('Turnos del 29/11/2026')).toBeVisible()
  await act(async () => { client.setQueryData(['organization'], { settings: { reminders: { daysAhead: 1 } } }) })
  expect(screen.getByText('Turnos del 29/11/2026')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Generar los que faltan' }))
  await waitFor(() => expect(post).toHaveBeenCalledWith('/api/reminders/generate', { date: '2026-11-29' }))
})

it('espera la anticipación configurada antes de consultar o generar recordatorios', async () => {
  let resolve!: (value: unknown) => void
  const pending = new Promise((done) => { resolve = done })
  const { get } = mount(() => pending)
  expect(screen.getByRole('button', { name: 'Generar los que faltan' })).toBeDisabled()
  expect(get).not.toHaveBeenCalledWith(expect.stringContaining('/api/reminders?'))
  await act(async () => { resolve({ settings: { reminders: { daysAhead: 2 } } }) })
  await waitFor(() => expect(get).toHaveBeenCalledWith('/api/reminders?date=2026-11-29'))
})

it('un error de configuración no genera avisos con un valor predeterminado incorrecto y permite reintentar', async () => {
  let fail = true
  const { post, get } = mount(async () => {
    if (fail) throw new ApiError(503, 'UNAVAILABLE', 'No se pudo cargar la anticipación', {})
    return { settings: { reminders: { daysAhead: 3 } } }
  })
  expect(await screen.findByText('No se pudo cargar la anticipación')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Generar los que faltan' })).toBeDisabled()
  expect(post).not.toHaveBeenCalled()
  fail = false
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar configuración' }))
  await waitFor(() => expect(get).toHaveBeenCalledWith('/api/reminders?date=2026-11-30'))
})
