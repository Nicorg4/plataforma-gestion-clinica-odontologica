import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { FilesTab } from '@/components/clinical/files-tab'
import { api, ApiError, type Organization } from '@/lib/api'

const MB = 1024 * 1024
const organization: Organization = {
  name: 'Consultorio', timezone: 'America/Argentina/Buenos_Aires', modules: { coverages: false }, limits: { fileMaxMb: 2 },
  settings: { backups: { schedule: 'DAILY', hour: 3, weekday: 7, paused: false, keepDaily: 7, keepWeekly: 4, keepManual: 10 }, reminders: { daysAhead: 1, template: 'Hola {nombre}, te esperamos en {consultorio}.' }, files: { maxMb: 1 }, sessions: { idleMinutes: 480 } },
}

function mount(loadOrganization: () => Promise<Organization>, canWrite = true, archivedPatient = false) {
  vi.spyOn(api, 'get').mockImplementation(async (path) => path === '/api/organization' ? loadOrganization() as never : [] as never)
  const upload = vi.spyOn(api, 'upload').mockResolvedValue({} as never)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><FilesTab patientId="p1" canWrite={canWrite} archivedPatient={archivedPatient} /></QueryClientProvider>)
  return { upload, client }
}

afterEach(() => vi.restoreAllMocks())

it('respeta el máximo configurado, acepta el límite exacto y mantiene el archivo fuera de la API si excede', async () => {
  const { upload } = mount(async () => organization)
  await userEvent.click(await screen.findByRole('button', { name: 'Subir archivo' }))
  await screen.findByText('PDF, JPG o PNG de hasta 1 MB')
  const input = screen.getByLabelText('Archivo')
  await userEvent.upload(input, new File([new Uint8Array(MB + 1)], 'grande.pdf', { type: 'application/pdf' }))
  expect(await screen.findByText('El archivo supera los 1 MB')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Subir' })).toBeDisabled()
  expect(upload).not.toHaveBeenCalled()
  const exact = new File([new Uint8Array(MB)], 'exacto.pdf', { type: 'application/pdf' })
  await userEvent.upload(input, exact)
  await userEvent.click(screen.getByRole('button', { name: 'Subir' }))
  await waitFor(() => expect(upload).toHaveBeenCalledWith(expect.stringContaining('/api/patients/p1/files?'), exact))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('espera la configuración y luego aplica el menor límite del servidor y del consultorio', async () => {
  let resolve!: (data: Organization) => void
  const pending = new Promise<Organization>((done) => { resolve = done })
  const { upload } = mount(() => pending)
  await userEvent.click(await screen.findByRole('button', { name: 'Subir archivo' }))
  await userEvent.upload(screen.getByLabelText('Archivo'), new File([new Uint8Array(2 * MB + 1)], 'grande.pdf', { type: 'application/pdf' }))
  expect(screen.getByRole('button', { name: 'Subir' })).toBeDisabled()
  expect(upload).not.toHaveBeenCalled()
  await act(async () => { resolve({ ...organization, settings: { ...organization.settings, files: { maxMb: 10 } } }) })
  expect(await screen.findByText('El archivo supera los 2 MB')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Subir' })).toBeDisabled()
})

it('un error de configuración conserva el archivo y permite recuperar la carga al reintentar', async () => {
  let fail = true
  const { upload } = mount(async () => {
    if (fail) throw new ApiError(503, 'UNAVAILABLE', 'No se pudo consultar la configuración', {})
    return organization
  })
  await userEvent.click(await screen.findByRole('button', { name: 'Subir archivo' }))
  const file = new File(['contenido'], 'estudio.pdf', { type: 'application/pdf' })
  await userEvent.upload(screen.getByLabelText('Archivo'), file)
  expect(await screen.findByText('No se pudo consultar la configuración')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Subir' })).toBeDisabled()
  expect(upload).not.toHaveBeenCalled()
  fail = false
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar configuración' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Subir' })).toBeEnabled())
  expect((screen.getByLabelText('Archivo') as HTMLInputElement).files?.[0]).toBe(file)
})

it.each([[false, false], [true, true]])('no ofrece carga sin permiso o en un paciente archivado (%s, %s)', async (canWrite, archived) => {
  mount(async () => organization, canWrite, archived)
  await screen.findByText('Todavía no hay archivos')
  expect(screen.queryByRole('button', { name: 'Subir archivo' })).not.toBeInTheDocument()
})
