import { describe, expect, it } from 'vitest'
import { FILE_CATEGORY_LABELS, fileProblem, formatBytes, maxFileMb } from '@/lib/files'

describe('archivos clinicos', () => {
  it('acepta PDF, JPG y PNG hasta el máximo configurado', () => {
    expect(fileProblem({ name: 'rx.PNG', size: 1000 }, 20)).toBeNull()
    expect(fileProblem({ name: 'estudio.pdf', size: 20 * 1024 * 1024 }, 20)).toBeNull()
    expect(fileProblem({ name: 'foto.jpeg', size: 10 }, 20)).toBeNull()
    expect(fileProblem({ name: 'grande.pdf', size: 30 * 1024 * 1024 }, 50)).toBeNull()
    expect(fileProblem({ name: 'grande.pdf', size: 30 * 1024 * 1024 }, null)).toBeNull()
  })

  it('rechaza otros formatos, vacíos o demasiado grandes', () => {
    expect(fileProblem({ name: 'planilla.xlsx', size: 10 }, 20)).toMatch(/PDF, JPG o PNG/)
    expect(fileProblem({ name: 'vacio.pdf', size: 0 }, 20)).toMatch(/vacío/)
    expect(fileProblem({ name: 'grande.pdf', size: 20 * 1024 * 1024 + 1 }, 20)).toMatch(/20 MB/)
    expect(fileProblem({ name: 'mediano.pdf', size: 6 * 1024 * 1024 }, 5)).toMatch(/5 MB/)
  })

  it('el máximo efectivo es el menor entre el del consultorio y el del servidor', () => {
    expect(maxFileMb({ settings: { files: { maxMb: 10 } }, limits: { fileMaxMb: 20 } })).toBe(10)
    expect(maxFileMb({ settings: { files: { maxMb: 50 } }, limits: { fileMaxMb: 20 } })).toBe(20)
  })

  it('muestra tamaños legibles y categorías en español', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5,0 MB')
    expect(Object.values(FILE_CATEGORY_LABELS)).toEqual(['Radiografía', 'Estudio', 'Foto', 'Consentimiento', 'Otro'])
  })
})
