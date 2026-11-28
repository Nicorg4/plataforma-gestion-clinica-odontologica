import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { GlobalSearch } from '@/components/layout/global-search'
import { api } from '@/lib/api'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

afterEach(() => { vi.restoreAllMocks(); push.mockClear() })

it('busca con debounce, admite teclado y abre la ficha elegida', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue({ items: [{ id: 'p1', firstName: 'Irene', lastName: 'Quiroga', documentType: 'DNI', documentNumber: '41222333', phone: '1160002222' }], total: 1 })
  render(<QueryClientProvider client={new QueryClient()}><GlobalSearch /></QueryClientProvider>)
  const input = screen.getByLabelText('Búsqueda rápida de pacientes')
  await userEvent.type(input, 'q')
  expect(get).not.toHaveBeenCalled()
  await userEvent.type(input, 'uiro')
  const result = await screen.findByRole('button', { name: /Quiroga, Irene/ })
  expect(get).toHaveBeenCalledWith('/api/patients?status=active&page=1&pageSize=6&q=quiro')
  await userEvent.tab()
  expect(result).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  expect(push).toHaveBeenCalledWith('/patients/p1')
  expect(input).toHaveValue('')
})

it('Enter conserva la consulta codificada para el listado y Escape cierra los resultados', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ items: [{ id: 'p1', firstName: 'Ana', lastName: 'Pérez' }], total: 1 })
  render(<QueryClientProvider client={new QueryClient()}><GlobalSearch /></QueryClientProvider>)
  await userEvent.type(screen.getByLabelText('Búsqueda rápida de pacientes'), 'Ana & Pérez')
  await screen.findByRole('list', { name: 'Pacientes encontrados' })
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('list')).not.toBeInTheDocument()
  await userEvent.keyboard('{Enter}')
  expect(push).toHaveBeenCalledWith('/patients?q=Ana%20%26%20P%C3%A9rez')
})
