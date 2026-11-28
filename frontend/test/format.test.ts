import { describe, expect, it } from 'vitest'
import { ageFrom, countOf, documentLabel, formatDate, formatDocumentNumber, formatLocalDate, fullName } from '@/lib/format'

describe('ageFrom', () => {
  const hoy = new Date(2026, 9, 2)

  it('cuenta los años cumplidos', () => {
    expect(ageFrom('1985-03-10', hoy)).toBe(41)
  })

  it('no suma el año si todavia no cumplio', () => {
    expect(ageFrom('1985-12-01', hoy)).toBe(40)
  })

  it('el dia del cumpleaños ya cumple', () => {
    expect(ageFrom('1985-10-02', hoy)).toBe(41)
    expect(ageFrom('1985-10-03', hoy)).toBe(40)
  })
})

describe('formatDate', () => {
  it('muestra dd/mm/aaaa', () => {
    expect(formatDate('1985-03-10')).toBe('10/03/1985')
    expect(formatDate('2026-10-02T14:30:00.000Z')).toBe('02/10/2026')
  })

  it('un instante se muestra con la fecha local, no la de UTC', () => {
    process.env['TZ'] = 'America/Argentina/Buenos_Aires'
    expect(formatLocalDate('2026-11-03T01:30:00.000Z')).toBe('02/11/2026')
    expect(formatLocalDate('2026-11-02T14:30:00.000Z')).toBe('02/11/2026')
  })
})

describe('cantidades', () => {
  it('usa el singular solo para uno', () => {
    expect(countOf(1, 'prestación', 'prestaciones')).toBe('1 prestación')
    expect(countOf(0, 'prestación', 'prestaciones')).toBe('0 prestaciones')
    expect(countOf(2000, 'paciente', 'pacientes')).toBe('2000 pacientes')
  })
})

describe('documento', () => {
  it('agrupa los DNI con puntos', () => {
    expect(formatDocumentNumber('DNI', '30123456')).toBe('30.123.456')
    expect(formatDocumentNumber('DNI', '4123456')).toBe('4.123.456')
  })

  it('no toca pasaportes', () => {
    expect(formatDocumentNumber('PASAPORTE', 'AAB123456')).toBe('AAB123456')
  })

  it('indica cuando no hay documento', () => {
    expect(documentLabel({ documentType: 'DNI', documentNumber: null })).toBe('Sin documento')
    expect(documentLabel({ documentType: 'DNI', documentNumber: '30123456' })).toBe('DNI 30.123.456')
  })
})

describe('fullName', () => {
  it('muestra apellido, nombre', () => {
    expect(fullName({ lastName: 'Gómez', firstName: 'Ana' })).toBe('Gómez, Ana')
  })
})
