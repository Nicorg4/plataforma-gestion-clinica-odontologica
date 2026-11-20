import { describe, expect, it } from 'vitest'
import { retryOnWriteConflict } from '../../src/shared/prismaErrors.js'

const deadlock = Object.assign(new Error('deadlock detected'), { code: 'P2034' })

describe('reintento ante conflicto de escritura', () => {
  it('reintenta una transaccion abortada por deadlock y devuelve el resultado', async () => {
    let intentos = 0
    const resultado = await retryOnWriteConflict(() => {
      intentos += 1
      return intentos < 2 ? Promise.reject(deadlock) : Promise.resolve('ok')
    })
    expect(resultado).toBe('ok')
    expect(intentos).toBe(2)
  })

  it('se rinde despues de tres intentos', async () => {
    let intentos = 0
    await expect(
      retryOnWriteConflict(() => {
        intentos += 1
        return Promise.reject(deadlock)
      }),
    ).rejects.toBe(deadlock)
    expect(intentos).toBe(3)
  })

  it('no reintenta otros errores', async () => {
    let intentos = 0
    const otro = Object.assign(new Error('violacion de exclusion'), { code: 'P2010' })
    await expect(
      retryOnWriteConflict(() => {
        intentos += 1
        return Promise.reject(otro)
      }),
    ).rejects.toBe(otro)
    expect(intentos).toBe(1)
  })
})
