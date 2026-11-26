import { describe, expect, it } from 'vitest'
import { csvAmount, toCsv } from '@/lib/csv'

describe('exportacion CSV', () => {
  it('separa con punto y coma, agrega BOM y protege comillas, separadores y formulas', () => {
    const csv = toCsv([
      ['Paciente', 'Saldo'],
      ['Pérez; Ana', csvAmount('1500.50')],
      ['=HYPERLINK("x")', 3],
    ])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.slice(1).split('\r\n')).toEqual(['Paciente;Saldo', '"Pérez; Ana";1500,50', `"'=HYPERLINK(""x"")";3`, ''])
  })
})

it('neutraliza tabulación y retorno de carro al exportar', () => {
  expect(toCsv([['\t=1+1', '+54 11']]).slice(1)).toBe("'\t=1+1;'+54 11\r\n")
  expect(toCsv([['\r=1+1']]).slice(1)).toBe(`"'\r=1+1"\r\n`)
})
