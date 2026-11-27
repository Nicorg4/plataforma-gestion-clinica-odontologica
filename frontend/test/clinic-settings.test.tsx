import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import SettingsPage from '@/app/(app)/settings/page'
import BackupsPage from '@/app/(app)/admin/backups/page'
import { OrganizationSettingsSections, previewMessage } from '@/components/settings/organization-settings'
import { BackupSettings, scheduleSummary } from '@/components/backups/backup-settings'
import { api, ApiError, type Organization, type SessionResponse, type SessionUser } from '@/lib/api'
import { useSaveSettings } from '@/hooks/use-organization'
import { sessionKey } from '@/hooks/use-session'

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }))

const base: Organization = {
  name: 'Consultorio Central', timezone: 'America/Argentina/Buenos_Aires', modules: { coverages: false }, limits: { fileMaxMb: 30 },
  settings: { backups: { schedule: 'DAILY', hour: 3, weekday: 7, paused: false, keepDaily: 7, keepWeekly: 4, keepManual: 10 }, reminders: { daysAhead: 1, template: 'Hola {nombre}, turno del {fecha} en {consultorio}.' }, files: { maxMb: 20 }, sessions: { idleMinutes: 480 } },
}
const user = (permissions: SessionUser['permissions']): SessionUser => ({ id: 'u1', username: 'admin', displayName: 'Administración', roles: ['ADMIN'], permissions, branchIds: [], mustChangePassword: false, onboardingCompleted: true, theme: 'SYSTEM', modules: { coverages: false }, preferences: { menuOrder: [], homePage: '/dashboard', agendaView: 'timeGridWeek', agendaStartHour: 7, agendaEndHour: 21, agendaSlotMinutes: 30, showSaturday: true, showSunday: true, toursSeen: [] } })

function setup(permissions: SessionUser['permissions'] = ['organization:manage', 'appointments:manage', 'backups:manage']) {
  let server = structuredClone(base)
  const currentUser = user(permissions)
  const session: SessionResponse = { csrfToken: 'token', user: currentUser }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  client.setQueryData(sessionKey, session)
  client.setQueryData(['organization'], server)
  const get = vi.spyOn(api, 'get').mockImplementation(async (path) => {
    if (path === '/api/auth/me') return session as never
    if (path === '/api/exchange-rates') return { current: null, history: [] } as never
    if (path === '/api/backups/status') return { maintenance: true, running: null, lastSuccess: null, nextScheduled: null, toolsAvailable: true } as never
    if (path === '/api/backups') return [] as never
    return server as never
  })
  const put = vi.spyOn(api, 'put').mockImplementation(async (_, patch) => {
    server = { ...server, settings: { ...server.settings, ...patch as Partial<Organization['settings']> } }
    return structuredClone(server) as never
  })
  const patch = vi.spyOn(api, 'patch').mockImplementation(async (_, input) => {
    server = { ...server, ...input as Partial<Organization> }
    return structuredClone(server) as never
  })
  const mount = (element = <OrganizationSettingsSections user={currentUser} />) => render(<QueryClientProvider client={client}>{element}</QueryClientProvider>)
  const refresh = async (update: (org: Organization) => Organization) => {
    server = update(structuredClone(server))
    await act(async () => { client.setQueryData(['organization'], structuredClone(server)) })
  }
  return { client, mount, refresh, get, put, patch }
}

afterEach(() => vi.restoreAllMocks())

it('separa permisos por sección y no consulta configuración sin permisos de ajustes', () => {
  const { mount, get } = setup(['appointments:manage'])
  mount()
  expect(screen.getByRole('region', { name: 'Consultorio: recordatorios' })).toBeVisible()
  expect(screen.queryByLabelText('Nombre del consultorio')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Cerrar la sesión tras')).not.toBeInTheDocument()
  expect(get).not.toHaveBeenCalled()
})

it('no muestra ni solicita ajustes para un usuario sin permisos', () => {
  const { mount, get } = setup([])
  mount()
  expect(screen.queryByRole('region')).not.toBeInTheDocument()
  expect(get).not.toHaveBeenCalled()
})

it('un cambio externo o guardado en otra tarjeta conserva las ediciones pendientes', async () => {
  const { mount, refresh, put } = setup()
  mount()
  const name = screen.getByLabelText('Nombre del consultorio')
  await userEvent.clear(name)
  await userEvent.type(name, 'Nombre sin guardar')
  await userEvent.selectOptions(screen.getByLabelText('Generar los avisos'), '2')
  const reminders = screen.getByRole('region', { name: 'Consultorio: recordatorios' })
  await userEvent.click(within(reminders).getByRole('button', { name: 'Guardar' }))
  await waitFor(() => expect(put).toHaveBeenCalledWith('/api/organization/settings', { reminders: { ...base.settings.reminders, daysAhead: 2 } }))
  await refresh((org) => ({ ...org, settings: { ...org.settings, backups: { ...org.settings.backups, hour: 6 } } }))
  expect(name).toHaveValue('Nombre sin guardar')
  expect(screen.queryByText(/Estos ajustes cambiaron en el servidor/)).not.toBeInTheDocument()
})

it('actualiza formularios limpios y conserva un borrador ante cambios externos de esa misma sección', async () => {
  const { mount, refresh, patch } = setup()
  mount()
  await refresh((org) => ({ ...org, name: 'Nombre externo' }))
  await waitFor(() => expect(screen.getByLabelText('Nombre del consultorio')).toHaveValue('Nombre externo'))
  await userEvent.clear(screen.getByLabelText('Nombre del consultorio'))
  await userEvent.type(screen.getByLabelText('Nombre del consultorio'), 'Mi edición')
  await refresh((org) => ({ ...org, name: 'Otro nombre guardado' }))
  expect(screen.getByLabelText('Nombre del consultorio')).toHaveValue('Mi edición')
  const card = screen.getByRole('region', { name: 'Consultorio: datos' })
  expect(await within(card).findByText(/Estos ajustes cambiaron en el servidor/)).toBeVisible()
  expect(within(card).getByRole('button', { name: 'Guardar' })).toBeDisabled()
  expect(patch).not.toHaveBeenCalled()
  await userEvent.click(within(card).getByRole('button', { name: 'Descartar cambios' }))
  expect(screen.getByLabelText('Nombre del consultorio')).toHaveValue('Otro nombre guardado')
})

it('un error de guardado conserva el borrador y permite reintentar', async () => {
  const { mount, patch } = setup()
  patch.mockRejectedValueOnce(new ApiError(503, 'UNAVAILABLE', 'No se pudo guardar el consultorio', {}))
  mount()
  await userEvent.clear(screen.getByLabelText('Nombre del consultorio'))
  await userEvent.type(screen.getByLabelText('Nombre del consultorio'), 'Nuevo nombre')
  const card = screen.getByRole('region', { name: 'Consultorio: datos' })
  await userEvent.click(within(card).getByRole('button', { name: 'Guardar' }))
  expect(await within(card).findByText('No se pudo guardar el consultorio')).toBeVisible()
  expect(screen.getByLabelText('Nombre del consultorio')).toHaveValue('Nuevo nombre')
  await userEvent.click(within(card).getByRole('button', { name: 'Guardar' }))
  await waitFor(() => expect(within(card).getByRole('button', { name: 'Guardar' })).toBeDisabled())
  expect(patch).toHaveBeenCalledTimes(2)
})

it('guarda sesiones y archivos de forma conjunta sin tocar recordatorios ni backups', async () => {
  const { mount, put } = setup()
  mount()
  await userEvent.selectOptions(screen.getByLabelText('Cerrar la sesión tras'), '120')
  const card = screen.getByRole('region', { name: 'Consultorio: archivos y sesiones' })
  await userEvent.click(within(card).getByRole('button', { name: 'Guardar' }))
  await waitFor(() => expect(put).toHaveBeenCalledWith('/api/organization/settings', { files: { maxMb: 20 }, sessions: { idleMinutes: 120 } }))
})

it('permite configurar y pausar backups, conserva el borrador en refrescos y muestra conflictos', async () => {
  const { mount, refresh, put } = setup()
  mount(<BackupSettings />)
  await userEvent.selectOptions(screen.getByLabelText('Frecuencia'), 'EVERY_6H')
  await refresh((org) => ({ ...org, name: 'Nuevo nombre del consultorio' }))
  expect(screen.getByLabelText('Frecuencia')).toHaveValue('EVERY_6H')
  await userEvent.click(screen.getByLabelText('Pausar el backup automático'))
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  await waitFor(() => expect(put).toHaveBeenCalledWith('/api/organization/settings', { backups: { ...base.settings.backups, schedule: 'EVERY_6H', paused: true } }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled())
  await userEvent.selectOptions(screen.getByLabelText('Frecuencia'), 'WEEKLY')
  await refresh((org) => ({ ...org, settings: { ...org.settings, backups: { ...org.settings.backups, hour: 10 } } }))
  expect(screen.getByLabelText('Frecuencia')).toHaveValue('WEEKLY')
  expect(await screen.findByText(/Estos ajustes cambiaron en el servidor/)).toBeVisible()
})

it('mantiene visible el mantenimiento de restores y bloquea generación y configuración', async () => {
  const { mount } = setup()
  mount(<BackupsPage />)
  expect(await screen.findByText('Restauración pendiente de recuperación')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Generar backup ahora' })).toBeDisabled()
  expect(screen.queryByLabelText('Frecuencia')).not.toBeInTheDocument()
  expect(screen.getByText('En mantenimiento')).toBeVisible()
})

it('muestra módulos solo a administración y no activa el módulo si el servidor rechaza el cambio', async () => {
  const { mount, put } = setup(['organization:manage'])
  put.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'No tenés permiso para cambiar módulos', {}))
  mount(<SettingsPage />)
  const toggle = screen.getByLabelText(/Coberturas y liquidaciones/)
  expect(toggle).not.toBeChecked()
  await userEvent.click(toggle)
  expect(await screen.findByText('No tenés permiso para cambiar módulos')).toBeVisible()
  expect(toggle).not.toBeChecked()
})

it('la vista previa reemplaza las variables permitidas y los horarios explican la configuración', () => {
  expect(previewMessage('Hola {nombre}, {fecha} {hora} {profesional} {sede} {consultorio}', 'Clínica')).toBe('Hola Ana, 12/11/2026 10:30 Dra. Paz Sede Central Clínica')
  expect(scheduleSummary({ ...base.settings.backups, schedule: 'EVERY_6H', hour: 8 })).toBe('Todos los días a las 02:00, 08:00, 14:00, 20:00.')
  expect(scheduleSummary({ ...base.settings.backups, schedule: 'WEEKLY', weekday: 6, hour: 9 })).toBe('Los sábados a las 09:00.')
  expect(scheduleSummary({ ...base.settings.backups, paused: true })).toMatch(/pausa/)
})

it('respuestas concurrentes no reemplazan secciones guardadas por otra tarjeta', async () => {
  const { client, put } = setup()
  const pending: { resolve: (value: Organization) => void; value: Organization }[] = []
  put.mockImplementation((_, patch) => new Promise((resolve) => {
    pending.push({ resolve: (value) => resolve(value as never), value: { ...structuredClone(base), settings: { ...structuredClone(base.settings), ...patch as Partial<Organization['settings']> } } })
  }))
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const { result } = renderHook(() => ({ reminders: useSaveSettings(), backups: useSaveSettings() }), { wrapper })
  let first!: Promise<unknown>
  let second!: Promise<unknown>
  act(() => {
    first = result.current.reminders.mutateAsync({ reminders: { ...base.settings.reminders, daysAhead: 2 } })
    second = result.current.backups.mutateAsync({ backups: { ...base.settings.backups, schedule: 'WEEKLY' } })
  })
  await waitFor(() => expect(pending).toHaveLength(2))
  await act(async () => { pending[1]!.resolve(pending[1]!.value); await second })
  await act(async () => { pending[0]!.resolve(pending[0]!.value); await first })
  const stored = client.getQueryData<Organization>(['organization'])
  expect(stored?.settings.backups.schedule).toBe('WEEKLY')
  expect(stored?.settings.reminders.daysAhead).toBe(2)
})
