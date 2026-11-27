import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, passwordProblems, setCsrfToken } from '@/lib/api'

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: () => (body === undefined ? Promise.reject(new Error('sin cuerpo')) : Promise.resolve(body)),
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

const headersDe = (fn: ReturnType<typeof vi.fn>) =>
  (fn.mock.calls[0]?.[1] as { headers: Record<string, string> }).headers

afterEach(() => {
  vi.unstubAllGlobals()
  setCsrfToken(null)
})

describe('cliente de la api', () => {
  it('manda el token csrf en las escrituras y no en las lecturas', async () => {
    setCsrfToken('token-de-sesion')
    const escritura = mockFetch(200, {})
    await api.post('/api/algo', { a: 1 })
    expect(headersDe(escritura)['X-CSRF-Token']).toBe('token-de-sesion')

    const lectura = mockFetch(200, {})
    await api.get('/api/algo')
    expect(headersDe(lectura)['X-CSRF-Token']).toBeUndefined()
  })

  it('devuelve undefined ante un 204', async () => {
    mockFetch(204)
    await expect(api.post('/api/auth/logout')).resolves.toBeUndefined()
  })

  it('convierte el error del backend en ApiError con codigo y mensaje', async () => {
    mockFetch(409, { error: { code: 'USERNAME_TAKEN', message: 'Ya existe un usuario con ese nombre', details: {} } })
    const error = await api.post('/api/users', {}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 409, code: 'USERNAME_TAKEN', message: 'Ya existe un usuario con ese nombre' })
  })

  it('usa un mensaje generico si la respuesta de error no tiene el formato esperado', async () => {
    mockFetch(500)
    const error = (await api.get('/api/algo').catch((e: unknown) => e)) as ApiError
    expect(error.code).toBe('UNKNOWN')
    expect(error.message).toBe('Ocurrió un error inesperado')
  })
})

describe('passwordProblems', () => {
  it('extrae los motivos de una contraseña debil', () => {
    const error = new ApiError(422, 'WEAK_PASSWORD', 'x', { problemas: ['Muy corta', 'Es común'] })
    expect(passwordProblems(error)).toEqual(['Muy corta', 'Es común'])
  })

  it('devuelve vacio para cualquier otro error', () => {
    expect(passwordProblems(new ApiError(409, 'LAST_ADMIN', 'x', {}))).toEqual([])
    expect(passwordProblems(new Error('otro'))).toEqual([])
    expect(passwordProblems(null)).toEqual([])
  })
})

it('asocia los errores al token de la petición y no al usuario conectado después', async () => {
  let resolve!: (value: unknown) => void
  vi.stubGlobal('fetch', () => new Promise((done) => { resolve = done }))
  setCsrfToken('token-anterior')
  const request = api.get('/api/private').catch((error: unknown) => error)
  setCsrfToken('token-nuevo')
  resolve({ status: 401, ok: false, json: async () => ({ error: { code: 'UNAUTHENTICATED', message: 'Sin sesión', details: {} } }) })
  expect(await request).toMatchObject({ code: 'STALE_SESSION', sessionToken: 'token-anterior' })
})

it('rechaza también un éxito tardío para que una mutación anterior no repueble la caché', async () => {
  let resolve!: (value: unknown) => void
  const body = new Promise((done) => { resolve = done })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, ok: true, json: () => body }))
  setCsrfToken('token-anterior')
  const request = api.put('/api/private', {}).catch((error: unknown) => error)
  await Promise.resolve()
  setCsrfToken('token-nuevo')
  resolve({ private: 'datos anteriores' })
  expect(await request).toMatchObject({ code: 'STALE_SESSION' })
})
