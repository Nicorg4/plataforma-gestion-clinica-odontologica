import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dir: string
const id = 'backup-20261020-030000-abcdef'

beforeEach(async () => {
  vi.resetModules()
  dir = await mkdtemp(path.join(tmpdir(), 'backup-recovery-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const config = () => ({ dir, filesDir: path.join(dir, 'files'), databaseUrl: 'postgresql://localhost/unused' })

describe('backup recovery after restart', () => {
  it('starts normally without a pending restore', async () => {
    const service = await import('../../src/modules/backups/backups.service.js')
    await service.initializeBackupRecovery(config())
    expect(service.maintenanceActive()).toBe(false)
  })

  it('keeps maintenance and the marker for an interrupted restore', async () => {
    const marker = path.join(dir, '.restore-pending.json')
    await writeFile(marker, JSON.stringify({ id }))
    const service = await import('../../src/modules/backups/backups.service.js')
    expect(service.maintenanceActive()).toBe(false)
    await service.initializeBackupRecovery(config())
    expect(service.maintenanceActive()).toBe(true)
    expect(JSON.parse(await readFile(marker, 'utf8'))).toEqual({ id })
  })

  it('refuses startup if the recovery marker is invalid', async () => {
    await writeFile(path.join(dir, '.restore-pending.json'), '{"id":"invalid"}')
    const service = await import('../../src/modules/backups/backups.service.js')
    await expect(service.initializeBackupRecovery(config())).rejects.toThrow()
  })
})
