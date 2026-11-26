import { describe, expect, it } from 'vitest'
import { tutorialSteps } from '@/lib/tutorial'

describe('tutorial por rol', () => {
  const titulos = (permissions: Parameters<typeof tutorialSteps>[0]['permissions']) => tutorialSteps({ permissions }).map((s) => s.title)

  it('recepcion ve agenda y cobros; el odontologo ve la atencion clinica', () => {
    expect(titulos(['appointments:manage', 'payments:create'])).toEqual([
      'Bienvenido/a',
      'Menú y buscador',
      'Agenda y turnos',
      'Cobros y caja',
      'Ayuda',
    ])
    expect(titulos(['clinical:write'])).toEqual(['Bienvenido/a', 'Menú y buscador', 'Atención clínica', 'Ayuda'])
  })

  it('tiene entre 4 y 6 pasos para cada rol', () => {
    for (const permissions of [['users:manage'], ['clinical:write'], ['appointments:manage', 'payments:create']] as const) {
      const pasos = tutorialSteps({ permissions: [...permissions] }).length
      expect(pasos).toBeGreaterThanOrEqual(3)
      expect(pasos).toBeLessThanOrEqual(6)
    }
  })
})
