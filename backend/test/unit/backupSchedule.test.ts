import { describe, expect, it } from 'vitest'
import { needsScheduledBackup } from '../../src/modules/backups/domain/schedule.js'

const horario = new Date('2026-11-02T06:00:00.000Z')
const backup = (startedAt: string, status: 'RUNNING' | 'SUCCEEDED' | 'FAILED', kind: 'SCHEDULED' | 'MANUAL' = 'SCHEDULED') => ({
  id: `${kind}-${startedAt}`,
  kind,
  status,
  startedAt,
})

describe('backup automatico pendiente', () => {
  it('corre si no hay ninguno programado desde el ultimo horario', () => {
    expect(needsScheduledBackup([], horario)).toBe(true)
    expect(needsScheduledBackup([backup('2026-11-01T06:00:05.000Z', 'SUCCEEDED')], horario)).toBe(true)
    expect(needsScheduledBackup([backup('2026-11-02T06:10:00.000Z', 'SUCCEEDED', 'MANUAL')], horario)).toBe(true)
  })

  it('no corre si ya hay uno completo o en curso para ese horario', () => {
    expect(needsScheduledBackup([backup('2026-11-02T06:01:00.000Z', 'SUCCEEDED')], horario)).toBe(false)
    expect(needsScheduledBackup([backup('2026-11-02T06:01:00.000Z', 'RUNNING')], horario)).toBe(false)
  })

  it('reintenta despues de un fallo, pero no mas de tres veces por horario', () => {
    const fallos = ['06:01', '06:06', '06:11'].map((hora) => backup(`2026-11-02T${hora}:00.000Z`, 'FAILED'))
    expect(needsScheduledBackup(fallos.slice(0, 1), horario)).toBe(true)
    expect(needsScheduledBackup(fallos.slice(0, 2), horario)).toBe(true)
    expect(needsScheduledBackup(fallos, horario)).toBe(false)
  })
})
