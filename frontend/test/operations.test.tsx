import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import ImportPage from '@/app/(app)/patients/import/page'
import RemindersPage from '@/app/(app)/reminders/page'
import ReportsPage from '@/app/(app)/reports/page'
import { api, ApiError, type SessionUser } from '@/lib/api'
import type { components } from '@/lib/api-types'

const { replace, session } = vi.hoisted(() => ({ replace: vi.fn(), session: { user: {} as SessionUser } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }))
vi.mock('@/hooks/use-organization', () => ({ useOrganization: () => ({ data: { settings: { reminders: { daysAhead: 1 } } }, isError: false, error: null }) }))
vi.mock('@/hooks/use-session', () => ({ useSession: () => ({ data: session }) }))

function mount(Page: typeof ImportPage, permissions: SessionUser['permissions']) {
  session.user = { id: 'user-1', permissions, roles: ['RECEPTIONIST'], branchIds: ['visible'] } as SessionUser
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><Page /></QueryClientProvider>)
  return client
}

afterEach(() => { vi.restoreAllMocks(); replace.mockClear() })

it('no consulta datos operativos ni muestra acciones sin permiso', async () => {
  session.user = { permissions: [] } as unknown as SessionUser
  const get = vi.spyOn(api, 'get')
  const post = vi.spyOn(api, 'post')
  for (const Page of [ImportPage, RemindersPage, ReportsPage]) {
    const { unmount } = render(<QueryClientProvider client={new QueryClient()}><Page /></QueryClientProvider>)
    unmount()
  }
  expect(get).not.toHaveBeenCalled()
  expect(post).not.toHaveBeenCalled()
})

it('importa solo tras la vista previa, muestra errores y duplicados y limpia la selección anterior', async () => {
  const preview = { valid: 1, invalid: 1, rows: [{ line: 2, firstName: 'Irene', lastName: 'Quiroga', documentType: 'DNI', documentNumber: '41222333', birthDate: '1992-04-12', errors: [] }, { line: 3, firstName: 'Irene', lastName: 'Quiroga', documentType: 'DNI', documentNumber: '41222333', birthDate: '1992-04-12', errors: ['El documento está duplicado'] }] }
  const post = vi.spyOn(api, 'post').mockImplementation(async (path) => path.endsWith('/preview') ? preview : { created: 1, skipped: 1 } as never)
  const client = mount(ImportPage, ['patients:write'])
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const input = screen.getByLabelText('Archivo CSV de pacientes')
  const file = new File(['nombre;apellido\nIrene;Quiroga'], 'pacientes.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'text', { value: async () => 'nombre;apellido\nIrene;Quiroga' })
  await userEvent.upload(input, file)
  expect(await screen.findByText('El documento está duplicado')).toBeVisible()
  expect(post).toHaveBeenCalledTimes(1)
  await userEvent.click(screen.getByRole('button', { name: 'Importar 1 paciente' }))
  expect(await screen.findByText(/Se cargó 1 paciente/)).toBeVisible()
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['patients'] })
  const oversized = new File(['x'.repeat(2 * 1024 * 1024 + 1)], 'grande.csv', { type: 'text/csv' })
  await userEvent.upload(input, oversized)
  expect(await screen.findByText('El archivo supera los 2 MB')).toBeVisible()
  expect(screen.queryByRole('region', { name: 'Vista previa' })).not.toBeInTheDocument()
  expect(screen.queryByText('Importación terminada')).not.toBeInTheDocument()
  expect(post).toHaveBeenCalledTimes(2)
})

it('muestra el rechazo del parser CSV sin habilitar una importación', async () => {
  vi.spyOn(api, 'post').mockRejectedValue(new ApiError(400, 'INVALID_CSV', 'El CSV tiene comillas sin cerrar', {}))
  mount(ImportPage, ['patients:write'])
  const file = new File(['"sin cerrar'], 'invalido.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'text', { value: async () => '"sin cerrar' })
  await userEvent.upload(screen.getByLabelText('Archivo CSV de pacientes'), file)
  expect(await screen.findByText('El CSV tiene comillas sin cerrar')).toBeVisible()
  expect(screen.queryByRole('button', { name: /^Importar \d/ })).not.toBeInTheDocument()
})

type Reminder = components['schemas']['Reminder']
const reminder = (extra: Partial<Reminder> = {}): Reminder => ({ id: 'reminder-1', status: 'PENDING', phone: '1160002222', whatsappUrl: 'https://wa.me/5491160002222?text=Hola', message: 'Hola', failureReason: null, sentAt: null, confirmedAt: null, patient: { id: 'patient-1', fullName: 'Quiroga, Irene' }, appointment: { id: 'appointment-1', status: 'SCHEDULED', startsAt: '2026-11-27T12:00:00Z', professional: 'Dentista', branch: 'Centro' }, ...extra })

it('abrir WhatsApp no marca enviado; el registro es manual y confirmar invalida la agenda', async () => {
  const row = reminder()
  vi.spyOn(api, 'get').mockResolvedValue({ date: '2026-11-27', reminders: [row] })
  const post = vi.spyOn(api, 'post').mockImplementation(async (path) => ({ ...row, status: path.endsWith('/sent') ? 'SENT' : 'CONFIRMED' }) as never)
  const client = mount(RemindersPage, ['appointments:manage'])
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const link = await screen.findByRole('link', { name: 'Enviar por WhatsApp' })
  expect(link).toHaveAttribute('href', row.whatsappUrl)
  link.addEventListener('click', (event) => event.preventDefault(), { once: true })
  await userEvent.click(link)
  expect(post).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Registrar envío / llamada' }))
  expect(await screen.findByText('Enviado', { exact: true })).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Confirmó' }))
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['appointments'] }))
})

it('usa el contacto corregido, permite llamada sin WhatsApp y oculta acciones sobre cancelados', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ date: '2026-11-27', reminders: [reminder({ phone: '1169998888', whatsappUrl: null, failureReason: 'El paciente no usa WhatsApp: avisale por llamada' }), reminder({ id: 'cancelled', status: 'CANCELLED', whatsappUrl: null, failureReason: 'El turno se reprogramó: generá el recordatorio del día nuevo' })] })
  mount(RemindersPage, ['appointments:manage'])
  expect(await screen.findByText(/El paciente no usa WhatsApp/)).toBeVisible()
  expect(screen.queryByRole('link', { name: 'Enviar por WhatsApp' })).not.toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: 'Registrar envío / llamada' })).toHaveLength(1)
  expect(screen.getAllByRole('button', { name: 'Confirmó' })).toHaveLength(1)
  expect(screen.getByText(/El turno se reprogramó/)).toBeVisible()
})

it('limita sedes visibles y envía los filtros del reporte a la API', async () => {
  const get = vi.spyOn(api, 'get').mockImplementation(async (path) => {
    if (path === '/api/branches') return [{ id: 'visible', name: 'Centro', active: true }, { id: 'other', name: 'Otra sede', active: true }]
    if (path === '/api/professionals') return []
    return { totals: { total: 0, attended: 0, noShow: 0, cancelled: 0 }, byProfessional: [] } as never
  })
  mount(ReportsPage, ['reports:read'])
  await screen.findByRole('option', { name: 'Centro' })
  expect(screen.queryByRole('option', { name: 'Otra sede' })).not.toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText('Sede'), 'visible')
  await userEvent.click(screen.getByRole('button', { name: 'Ver' }))
  await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringMatching(/reports\/appointments\?.*branchId=visible/)))
})
