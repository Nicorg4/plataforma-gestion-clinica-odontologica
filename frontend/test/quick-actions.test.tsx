import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { AppShell } from '@/components/layout/app-shell'
import { QuickActions } from '@/components/layout/quick-actions'
import { api, ApiError, type Appointment, type SessionUser } from '@/lib/api'
import { TOUR_IDS } from '@/lib/tours'

const state = vi.hoisted(() => ({ push: vi.fn(), pathname: '/dashboard', user: null as SessionUser | null }))
vi.mock('next/navigation', () => ({ usePathname: () => state.pathname, useRouter: () => ({ push: state.push, replace: vi.fn() }) }))
vi.mock('@/hooks/use-session', () => ({ sessionKey: ['session'], useSession: () => ({ data: { user: state.user }, isPending: false, isError: false }), useLogout: () => ({ mutate: vi.fn(), isPending: false, error: null }) }))

function user(permissions: SessionUser['permissions']): SessionUser {
  return { id: 'dentist', permissions, roles: ['DENTIST'], branchIds: ['central'], displayName: 'Dentista', onboardingCompleted: true, preferences: { toursSeen: [...TOUR_IDS] } } as SessionUser
}
function mount(current: SessionUser, pathname = '/dashboard') {
  state.user = current
  state.pathname = pathname
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  const view = render(<QueryClientProvider client={client}><QuickActions user={current} pathname={pathname} /></QueryClientProvider>)
  return { client, ...view }
}
function appointment(patient: string, offset: number, extra: Partial<Appointment> = {}): Appointment {
  return { id: patient, patient: { id: patient, fullName: patient }, professional: { id: 'profile-id', userId: 'dentist', displayName: 'Dentista' }, branch: { id: 'central', name: 'Central' }, startsAt: new Date(Date.now() + offset * 60_000).toISOString(), endsAt: new Date(Date.now() + (offset + 30) * 60_000).toISOString(), status: 'SCHEDULED', ...extra } as Appointment
}
const clinical: SessionUser['permissions'] = ['clinical:read', 'patients:read', 'appointments:read']
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); state.push.mockClear() })

it('no muestra acciones ni consulta datos sin permisos suficientes', () => {
  const get = vi.spyOn(api, 'get')
  mount(user(['clinical:read']))
  expect(screen.queryByRole('group')).not.toBeInTheDocument()
  expect(get).not.toHaveBeenCalled()
})

it('evita duplicar las altas en agenda, listado y ficha y carga catálogos solo al abrir', () => {
  const get = vi.spyOn(api, 'get')
  const current = user(['appointments:manage', 'patients:write'])
  const { rerender, client } = mount(current, '/agenda')
  expect(screen.queryByRole('button', { name: 'Nuevo turno' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Nuevo paciente' })).toBeVisible()
  rerender(<QueryClientProvider client={client}><QuickActions user={current} pathname="/patients" /></QueryClientProvider>)
  expect(screen.queryByRole('button', { name: 'Nuevo paciente' })).not.toBeInTheDocument()
  rerender(<QueryClientProvider client={client}><QuickActions user={current} pathname="/patients/p1" /></QueryClientProvider>)
  expect(screen.queryByRole('button', { name: 'Nuevo turno' })).not.toBeInTheDocument()
  expect(get).not.toHaveBeenCalled()
})

it('un catálogo fallido permite reintentar y el formulario solo ofrece sedes activas autorizadas', async () => {
  let fail = true
  vi.spyOn(api, 'get').mockImplementation(async (path) => {
    if (path === '/api/branches') {
      if (fail) throw new ApiError(503, 'UNAVAILABLE', 'No se pudieron cargar las sedes', {})
      return [{ id: 'central', name: 'Central', active: true }, { id: 'other', name: 'Otra sede', active: true }, { id: 'old', name: 'Inactiva', active: false }] as never
    }
    return [] as never
  })
  mount(user(['appointments:manage']))
  await userEvent.click(screen.getByRole('button', { name: 'Nuevo turno' }))
  expect(await screen.findByText('No se pudieron cargar las sedes')).toBeVisible()
  fail = false
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
  const branch = await screen.findByLabelText('Sede')
  expect(within(branch).getByRole('option', { name: 'Central' })).toBeInTheDocument()
  expect(within(branch).queryByRole('option', { name: 'Otra sede' })).not.toBeInTheDocument()
  expect(within(branch).queryByRole('option', { name: 'Inactiva' })).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('Nuevo paciente abre el alta por teclado y Escape la cierra', async () => {
  mount(user(['patients:write']))
  screen.getByRole('button', { name: 'Nuevo paciente' }).focus()
  await userEvent.keyboard('{Enter}')
  expect(screen.getByRole('dialog', { name: 'Nuevo paciente' })).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('elige el próximo turno propio por fecha, incluyendo uno en curso y excluyendo estados, sedes y profesionales ajenos', async () => {
  vi.spyOn(api, 'get').mockResolvedValue([
    appointment('Más tarde', 60), appointment('En curso', -5), appointment('Terminado', -40), appointment('Cancelado', -1, { status: 'CANCELLED' }), appointment('Atendido', -2, { status: 'ATTENDED' }), appointment('Otra sede', -3, { branch: { id: 'other', name: 'Otra' } }), appointment('Otro profesional', -4, { professional: { id: 'other-profile', userId: 'other-user', displayName: 'Otro' } }),
  ])
  mount(user(clinical))
  expect(await screen.findByRole('link', { name: /Próximo:.*En curso/ })).toHaveAttribute('href', '/patients/En curso')
  expect(screen.queryByText('Más tarde')).not.toBeInTheDocument()
})

it('no muestra datos cacheados como próximos al fallar la consulta y permite reintentar', async () => {
  const get = vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('red')).mockResolvedValue([appointment('Recuperado', 10)])
  mount(user(clinical))
  await userEvent.click(await screen.findByRole('button', { name: 'Reintentar próximo paciente' }))
  expect(await screen.findByRole('link', { name: /Recuperado/ })).toBeVisible()
  expect(get).toHaveBeenCalledTimes(2)
})

it('actualiza el próximo paciente cuando termina el turno sin volver a montar la cabecera', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.spyOn(api, 'get').mockResolvedValue([appointment('Primero', -29), appointment('Segundo', 10)])
  mount(user(clinical))
  await screen.findByRole('link', { name: /Primero/ })
  await act(async () => { vi.advanceTimersByTime(90_000) })
  expect(screen.queryByRole('link', { name: /Primero/ })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Segundo/ })).toBeVisible()
})

it('cambiar cuenta o sedes en el shell cierra altas pendientes y vacía el buscador', async () => {
  vi.spyOn(api, 'get').mockResolvedValue([])
  const current = user(['patients:read', 'patients:write'])
  state.user = current
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = () => <QueryClientProvider client={client}><AppShell><p>Pantalla</p></AppShell></QueryClientProvider>
  const { rerender } = render(view())
  await userEvent.type(screen.getByLabelText('Búsqueda rápida de pacientes'), 'An')
  await userEvent.click(screen.getByRole('button', { name: 'Nuevo paciente' }))
  expect(screen.getByRole('dialog')).toBeVisible()
  state.user = { ...current, branchIds: ['other'] }
  rerender(view())
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Búsqueda rápida de pacientes')).toHaveValue('')
  await userEvent.click(screen.getByRole('button', { name: 'Nuevo paciente' }))
  state.user = { ...current, id: 'another', permissions: [] }
  rerender(view())
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Búsqueda rápida de pacientes')).not.toBeInTheDocument()
})
