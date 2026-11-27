import { QueryClient, QueryClientProvider, useMutation, useQueryClient } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { Providers } from '@/app/providers'
import { useLogin, useLogout, useSession, sessionKey } from '@/hooks/use-session'
import { useAppointments } from '@/hooks/use-appointments'
import { useAgendaAvailability } from '@/hooks/use-availability'
import { useSavePreferences } from '@/hooks/use-preferences'
import { api, ApiError, currentCsrfToken, setCsrfToken, type SessionResponse } from '@/lib/api'

function session(id = 'u1', branchIds = ['a']): SessionResponse {
  return { csrfToken: `token-${id}`, user: { id, username: id, displayName: id, roles: ['RECEPTIONIST'], permissions: ['patients:read'], branchIds, mustChangePassword: false, onboardingCompleted: true, theme: 'SYSTEM', modules: { coverages: false }, preferences: { menuOrder: [], homePage: '/dashboard', agendaView: 'timeGridWeek', agendaStartHour: 7, agendaEndHour: 21, agendaSlotMinutes: 30, showSaturday: true, showSunday: true, toursSeen: [] } } }
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  client.setQueryData(sessionKey, session())
  setCsrfToken('token-u1')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); setCsrfToken(null) })

it('al cambiar de cuenta cancela lecturas pendientes y elimina datos activos e inactivos anteriores', async () => {
  const { client, wrapper } = setup()
  client.setQueryData(['clinical', 'patient-1'], ['nota anterior'])
  const late = deferred<string[]>()
  const old = client.fetchQuery({ queryKey: ['late'], queryFn: () => late.promise }).catch(() => undefined)
  vi.spyOn(api, 'post').mockResolvedValue(session('u2'))
  const { result } = renderHook(() => useLogin(), { wrapper })
  await act(async () => { await result.current.mutateAsync({ username: 'u2', password: 'clave' }) })
  late.resolve(['respuesta anterior'])
  await old
  expect(client.getQueryData(['clinical', 'patient-1'])).toBeUndefined()
  expect(client.getQueryData(['late'])).toBeUndefined()
  expect(client.getQueryData<SessionResponse>(sessionKey)?.user.id).toBe('u2')
  expect(currentCsrfToken()).toBe('token-u2')
})

it('al cambiar las sedes o permisos del mismo usuario descarta la caché anterior', async () => {
  const { client, wrapper } = setup()
  client.setQueryData(['patients'], ['datos de sede a'])
  const updated = session('u1', ['b'])
  vi.spyOn(api, 'get').mockResolvedValue(updated)
  const { result } = renderHook(() => { const query = useSession(); return { data: query.data, refetch: query.refetch } }, { wrapper })
  await act(async () => { await result.current.refetch() })
  await waitFor(() => expect(result.current.data?.user.branchIds).toEqual(['b']))
  expect(client.getQueryData(['patients'])).toBeUndefined()
})

it('al vencer auth/me elimina datos privados y token en lugar de dejarlos para el siguiente ingreso', async () => {
  const { client, wrapper } = setup()
  client.setQueryData(['clinical'], ['dato privado'])
  client.setQueryData(['setup-status'], { needsSetup: false })
  vi.spyOn(api, 'get').mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'Sesión vencida', {}))
  const { result } = renderHook(() => { const query = useSession(); return { data: query.data, refetch: query.refetch } }, { wrapper })
  await act(async () => { await result.current.refetch() })
  await waitFor(() => expect(result.current.data).toBeNull())
  expect(client.getQueryData(['clinical'])).toBeUndefined()
  expect(client.getQueryData(['setup-status'])).toEqual({ needsSetup: false })
  expect(currentCsrfToken()).toBeNull()
})

it.each([new Error('sin red'), new ApiError(500, 'INTERNAL', 'No se pudo cerrar sesión', {})])('un fallo de logout conserva sesión y datos y permite reintentar: %s', async (error) => {
  const { client, wrapper } = setup()
  client.setQueryData(['patients'], ['paciente'])
  vi.spyOn(api, 'post').mockRejectedValueOnce(error).mockResolvedValue(undefined)
  const { result } = renderHook(() => useLogout(), { wrapper })
  await act(async () => { await result.current.mutateAsync().catch(() => undefined) })
  await waitFor(() => expect(result.current.error).toBe(error))
  expect(client.getQueryData<SessionResponse>(sessionKey)?.user.id).toBe('u1')
  expect(client.getQueryData(['patients'])).toEqual(['paciente'])
  await act(async () => { await result.current.mutateAsync() })
  expect(client.getQueryData(sessionKey)).toBeNull()
  expect(client.getQueryData(['patients'])).toBeUndefined()
  expect(currentCsrfToken()).toBeNull()
})

it('logout 401 confirma que la sesión terminó y limpia los datos', async () => {
  const { client, wrapper } = setup()
  client.setQueryData(['patients'], ['paciente'])
  vi.spyOn(api, 'post').mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'Sin sesión', {}))
  const { result } = renderHook(() => useLogout(), { wrapper })
  await act(async () => { await result.current.mutateAsync().catch(() => undefined) })
  expect(client.getQueryData(sessionKey)).toBeNull()
  expect(client.getQueryData(['patients'])).toBeUndefined()
})

it('una preferencia que termina tarde no modifica la sesión de otra cuenta', async () => {
  const { client, wrapper } = setup()
  const pending = deferred<void>()
  vi.spyOn(api, 'put').mockImplementation(() => pending.promise as never)
  vi.spyOn(api, 'post').mockResolvedValue(session('u2'))
  const { result } = renderHook(() => ({ save: useSavePreferences(), login: useLogin() }), { wrapper })
  let saving!: Promise<unknown>
  act(() => { saving = result.current.save.mutateAsync({ theme: 'DARK' }) })
  await waitFor(() => expect(api.put).toHaveBeenCalled())
  await act(async () => { await result.current.login.mutateAsync({ username: 'u2', password: 'clave' }) })
  await act(async () => { pending.resolve(); await saving })
  expect(client.getQueryData<SessionResponse>(sessionKey)?.user.theme).toBe('SYSTEM')
})

it('la agenda no muestra turnos ni disponibilidad de la sede anterior mientras carga otra', async () => {
  const { wrapper } = setup()
  const pending = deferred<unknown>()
  vi.spyOn(api, 'get').mockImplementation(async (path) => path.includes('branchId=b') ? pending.promise as never : path.includes('/api/availability') ? { branchId: 'a', professionals: [] } as never : [{ id: 'turno-a' }] as never)
  const { result, rerender } = renderHook(({ branchId }) => ({ appointments: useAppointments({ from: '2026-11-27', to: '2026-11-28', branchId }), availability: useAgendaAvailability({ from: '2026-11-27', to: '2026-11-28', branchId }, true) }), { wrapper, initialProps: { branchId: 'a' } })
  await waitFor(() => expect(result.current.appointments.isSuccess).toBe(true))
  rerender({ branchId: 'b' })
  expect(result.current.appointments.data).toBeUndefined()
  expect(result.current.availability.data).toBeUndefined()
  await act(async () => { pending.resolve([]) })
})

it('un 401 de una petición operativa borra la sesión y sus datos privados', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  vi.spyOn(api, 'get').mockResolvedValue(session())
  const { result } = renderHook(() => useQueryClient(), { wrapper: Providers })
  await waitFor(() => expect(result.current.getQueryData(sessionKey)).toBeDefined())
  result.current.setQueryData(['clinical'], ['dato privado'])
  await act(async () => {
    await result.current.fetchQuery({ queryKey: ['expired'], queryFn: () => Promise.reject(new ApiError(401, 'UNAUTHENTICATED', 'Sesión vencida', {}, 'token-u1')) }).catch(() => undefined)
  })
  await waitFor(() => expect(result.current.getQueryData(sessionKey)).toBeNull())
  expect(result.current.getQueryData(['clinical'])).toBeUndefined()
})

it('un 401 tardío de la cuenta anterior no cierra la cuenta nueva', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  vi.spyOn(api, 'get').mockResolvedValue(session())
  let reject!: (error: Error) => void
  const pending = new Promise<never>((_, fail) => { reject = fail })
  vi.spyOn(api, 'post').mockImplementation((path) => path === '/delayed' ? pending : Promise.resolve(session('u2')) as never)
  const { result } = renderHook(() => ({ client: useQueryClient(), login: useLogin(), delayed: useMutation({ mutationFn: () => api.post('/delayed') }) }), { wrapper: Providers })
  await waitFor(() => expect(result.current.client.getQueryData(sessionKey)).toBeDefined())
  let old!: Promise<unknown>
  act(() => { old = result.current.delayed.mutateAsync().catch(() => undefined) })
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/delayed'))
  await act(async () => { await result.current.login.mutateAsync({ username: 'u2', password: 'clave' }) })
  await act(async () => { reject(new ApiError(401, 'UNAUTHENTICATED', 'Respuesta anterior', {}, 'token-u1')); await old })
  expect(result.current.client.getQueryData<SessionResponse>(sessionKey)?.user.id).toBe('u2')
  expect(currentCsrfToken()).toBe('token-u2')
})
