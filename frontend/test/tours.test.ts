import { describe, expect, it } from 'vitest'
import { monthGrid } from '@/components/ui/date-input'
import { ONBOARDING_TOUR, TOUR_IDS, tourForPath, tourSteps } from '@/lib/tours'

describe('recorridos guiados', () => {
  const titulos = (id: string, permissions: Parameters<typeof tourSteps>[1]['permissions']) => tourSteps(id, { permissions }).map((s) => s.title)

  it('cada pantalla tiene su recorrido y el general va primero', () => {
    expect(tourForPath('/agenda')).toBe('agenda')
    expect(tourForPath('/patients/0190')).toBe('patient')
    expect(tourForPath('/patients')).toBe('patients')
    expect(tourForPath('/patients/import')).toBeNull()
    expect(tourForPath('/admin/audit')).toBe('audit')
    expect(TOUR_IDS[0]).toBe(ONBOARDING_TOUR)
  })

  it('los pasos dependen de los permisos del rol', () => {
    expect(titulos('agenda', ['appointments:read'])).not.toContain('Dar un turno')
    expect(titulos('agenda', ['appointments:read', 'appointments:manage'])).toContain('Dar un turno')
    expect(titulos(ONBOARDING_TOUR, [])).not.toContain('Buscador de pacientes')
    expect(titulos('settings', ['organization:manage'])).toEqual(['Tus preferencias'])
  })
})

describe('calendario de fechas', () => {
  it('arma el mes empezando en lunes y completa semanas enteras', () => {
    const noviembre = monthGrid(2026, 10)
    expect(noviembre.length % 7).toBe(0)
    expect(noviembre.slice(0, 6)).toEqual([null, null, null, null, null, null])
    expect(noviembre[6]?.getDate()).toBe(1)
    expect(noviembre.filter(Boolean)).toHaveLength(30)
  })
})
