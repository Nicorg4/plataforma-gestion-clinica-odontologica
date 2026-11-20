import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import express from 'express'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { maintenanceGuard } from '../../src/middleware/maintenance.js'
import { pgToolsAvailable } from '../../src/modules/backups/backups.archive.js'
import {
  as,
  ORIGIN,
  buildApp,
  loginAs,
  resetDb,
  seedInstall,
  seedPatient,
  seedUser,
  TEST_BACKUPS,
  TEST_FILES,
  testDb,
  type Client,
  type Seed,
} from '../helpers.js'

const db = testDb()
const app = buildApp(db)
let seed: Seed
let admin: Client
let recepcion: Client
const herramientas = await pgToolsAvailable(TEST_BACKUPS)

interface Backup {
  id: string
  status: string
  sha256: string | null
  counts: { patients: number } | null
}

const codigo = (res: request.Response) => (res.body as { error: { code: string } }).error.code

async function esperar(id: string): Promise<Backup> {
  for (let intento = 0; intento < 100; intento += 1) {
    const lista = (await as(app, admin).get('/api/backups').expect(200)).body as Backup[]
    const backup = lista.find((b) => b.id === id)
    if (backup && backup.status !== 'RUNNING') return backup
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('el backup no termino')
}

beforeEach(async () => {
  await rm(TEST_BACKUPS.dir, { recursive: true, force: true })
  await resetDb(db)
  seed = await seedInstall(db)
  await seedUser(db, seed, { username: 'admin', roles: ['ADMIN'] })
  await seedUser(db, seed, { username: 'recepcion', roles: ['RECEPTIONIST'] })
  admin = await loginAs(app, 'admin')
  recepcion = await loginAs(app, 'recepcion')
})

afterAll(async () => {
  await rm(TEST_BACKUPS.dir, { recursive: true, force: true })
})

describe('backups: acceso y validaciones', () => {
  it('solo administracion ve, genera y restaura backups', async () => {
    expect((await as(app, recepcion).get('/api/backups')).status).toBe(403)
    expect((await as(app, recepcion).post('/api/backups')).status).toBe(403)
    expect((await as(app, admin).get('/api/backups').expect(200)).body).toEqual([])
    const estado = (await as(app, admin).get('/api/backups/status').expect(200)).body as { maintenance: boolean; running: null }
    expect(estado).toMatchObject({ maintenance: false, running: null })
  })

  it('pide confirmar escribiendo RESTAURAR y rechaza un backup danado o de otra version', async () => {
    const id = 'backup-20261020-030000-abcdef'
    await mkdir(TEST_BACKUPS.dir, { recursive: true })
    await writeFile(path.join(TEST_BACKUPS.dir, `${id}.tar`), 'contenido alterado')
    const registro = {
      id,
      kind: 'SCHEDULED',
      status: 'SUCCEEDED',
      startedAt: '2026-10-20T06:00:00.000Z',
      finishedAt: '2026-10-20T06:00:05.000Z',
      size: 10,
      sha256: '0'.repeat(64),
      schemaVersion: 'otra',
      counts: { patients: 0, appointments: 0, clinicalEntries: 0, services: 0, payments: 0, clinicalFiles: 0 },
      createdBy: null,
      error: null,
    }
    await writeFile(path.join(TEST_BACKUPS.dir, `${id}.json`), JSON.stringify(registro))

    expect((await as(app, admin).post(`/api/backups/${id}/restore`, { confirmation: 'si' })).status).toBe(400)
    const danado = await as(app, admin).post(`/api/backups/${id}/restore`, { confirmation: 'RESTAURAR' })
    expect([danado.status, codigo(danado)]).toEqual([422, 'BACKUP_CORRUPT'])

    const { createHash } = await import('node:crypto')
    const contenido = await readFile(path.join(TEST_BACKUPS.dir, `${id}.tar`))
    registro.sha256 = createHash('sha256').update(contenido).digest('hex')
    await writeFile(path.join(TEST_BACKUPS.dir, `${id}.json`), JSON.stringify(registro))
    const version = await as(app, admin).post(`/api/backups/${id}/restore`, { confirmation: 'RESTAURAR' })
    expect([version.status, codigo(version)]).toEqual([422, 'SCHEMA_MISMATCH'])
    expect(await db.patient.count()).toBe(0)

    await rm(path.join(TEST_BACKUPS.dir, `${id}.tar`))
    expect((await as(app, admin).get(`/api/backups/${id}/download`)).status).toBe(404)
  })

  it('en mantenimiento rechaza todo salvo el estado y la salud', async () => {
    let activo = true
    const prueba = express()
    prueba.use(maintenanceGuard(() => activo))
    prueba.get(/.*/, (_req, res) => {
      res.json({ ok: true })
    })
    const bloqueada = await request(prueba).get('/api/patients')
    expect([bloqueada.status, codigo(bloqueada)]).toEqual([503, 'MAINTENANCE'])
    await request(prueba).get('/api/health').expect(200)
    await request(prueba).get('/api/backups/status').expect(200)
    await request(prueba).get('/api/backups/status/extra').expect(503)
    await request(prueba).get('/api/health-extra').expect(503)
    await request(prueba).post('/api/health').expect(503)
    activo = false
    await request(prueba).get('/api/patients').expect(200)
  })
})

describe.skipIf(!herramientas)('backups: generar y restaurar de verdad', () => {
  it('restaura la base y los archivos al estado del backup y mantiene la sesion', async () => {
    const original = await seedPatient(db, seed, { firstName: 'Antes', lastName: 'Del Backup' })
    await mkdir(path.join(TEST_FILES.dir, '2026', '10'), { recursive: true })
    await writeFile(path.join(TEST_FILES.dir, '2026', '10', 'radiografia'), 'contenido original')

    const iniciado = (await as(app, admin).post('/api/backups').expect(202)).body as Backup
    const backup = await esperar(iniciado.id)
    expect(backup).toMatchObject({ status: 'SUCCEEDED', counts: { patients: 1 } })

    await seedPatient(db, seed, { firstName: 'Despues', lastName: 'Del Backup', documentNumber: '40999888' })
    await db.patient.update({ where: { id: original.id }, data: { phone: '11 0000-0000' } })
    await writeFile(path.join(TEST_FILES.dir, '2026', '10', 'radiografia'), 'contenido cambiado')
    await writeFile(path.join(TEST_FILES.dir, 'nuevo'), 'no estaba')

    const res = await as(app, admin).post(`/api/backups/${backup.id}/restore`, { confirmation: 'RESTAURAR' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body).toMatchObject({ counts: { patients: 1 } })
    expect(await db.patient.count()).toBe(1)
    expect((await db.patient.findUniqueOrThrow({ where: { id: original.id } })).phone).not.toBe('11 0000-0000')
    expect(await readFile(path.join(TEST_FILES.dir, '2026', '10', 'radiografia'), 'utf8')).toBe('contenido original')
    await expect(readFile(path.join(TEST_FILES.dir, 'nuevo'))).rejects.toThrow()

    await as(app, admin).get('/api/backups/status').expect(200)
    expect(await db.auditLog.count({ where: { action: 'BACKUP_RESTORED' } })).toBe(1)
  })
  it('rejects concurrent backup starts and releases the lock after completion', async () => {
    const attempts = await Promise.all([
      as(app, admin).post('/api/backups'),
      as(app, admin).post('/api/backups'),
    ])
    expect(attempts.map((res) => res.status).sort()).toEqual([202, 409])
    const started = attempts.find((res) => res.status === 202)?.body as Backup
    expect((await esperar(started.id)).status).toBe('SUCCEEDED')
    const next = (await as(app, admin).post('/api/backups').expect(202)).body as Backup
    expect((await esperar(next.id)).status).toBe('SUCCEEDED')
  })

  it('keeps maintenance after attachment failure and resumes the same restore', async () => {
    const original = await seedPatient(db, seed, { firstName: 'Respaldo', lastName: 'Ficticio' })
    await mkdir(TEST_FILES.dir, { recursive: true })
    await writeFile(path.join(TEST_FILES.dir, 'synthetic'), 'saved attachment')
    const started = (await as(app, admin).post('/api/backups').expect(202)).body as Backup
    const backup = await esperar(started.id)
    expect(backup.status).toBe('SUCCEEDED')
    const changed = await seedPatient(db, seed, { firstName: 'Posterior', lastName: 'Ficticio', documentNumber: '40999888' })
    expect(await db.patient.count()).toBe(2)

    await rm(TEST_FILES.dir, { recursive: true, force: true })
    await writeFile(TEST_FILES.dir, 'fixture blocking the attachment directory')
    try {
      const res = await as(app, admin).post(`/api/backups/${backup.id}/restore`, { confirmation: 'RESTAURAR' })
      expect([res.status, codigo(res)]).toEqual([500, 'RESTORE_FAILED'])
      expect(await db.patient.findUnique({ where: { id: changed.id } })).toBeNull()
      expect(await db.patient.findUnique({ where: { id: original.id } })).not.toBeNull()
      await expect(readFile(path.join(TEST_FILES.dir, 'synthetic'))).rejects.toMatchObject({ code: 'ENOTDIR' })
      const status = await as(app, admin).get('/api/backups/status').expect(200)
      expect(status.body).toMatchObject({ maintenance: true, running: null })
      const marker = path.join(TEST_BACKUPS.dir, '.restore-pending.json')
      expect(JSON.parse(await readFile(marker, 'utf8'))).toEqual({ id: backup.id })
      expect(await readFile(path.join(TEST_BACKUPS.dir, `.restore-${backup.id}`, 'files', 'synthetic'), 'utf8')).toBe('saved attachment')
      await as(app, admin).get('/api/patients').expect(503)
      await as(app, admin).get('/api/health').expect(200)
      await as(app, admin).post('/api/backups').expect(503)
      await as(app, recepcion).post(`/api/backups/${backup.id}/restore`, { confirmation: 'RESTAURAR' }).expect(403)
      await request(app).post(`/api/backups/${backup.id}/restore`).set('Origin', ORIGIN).send({ confirmation: 'RESTAURAR' }).expect(401)
      const other = await as(app, admin).post('/api/backups/backup-20261020-030000-abcdef/restore', { confirmation: 'RESTAURAR' })
      expect([other.status, codigo(other)]).toEqual([409, 'BACKUP_BUSY'])
      expect(await db.auditLog.count({ where: { action: 'BACKUP_RESTORED' } })).toBe(0)
    } finally {
      await rm(TEST_FILES.dir, { force: true })
      const recovered = await loginAs(app, 'admin')
      const attempts = await Promise.all([
        as(app, recovered).post(`/api/backups/${backup.id}/restore`, { confirmation: 'RESTAURAR' }),
        as(app, recovered).post(`/api/backups/${backup.id}/restore`, { confirmation: 'RESTAURAR' }),
      ])
      expect(attempts.map((res) => res.status).sort()).toEqual([200, 409])
    }
    expect(await readFile(path.join(TEST_FILES.dir, 'synthetic'), 'utf8')).toBe('saved attachment')
    await expect(readFile(path.join(TEST_BACKUPS.dir, '.restore-pending.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    const finalStatus = await as(app, admin).get('/api/backups/status').expect(200)
    expect(finalStatus.body).toMatchObject({ maintenance: false, running: null })
    await as(app, admin).get('/api/patients').expect(200)
    expect(await db.auditLog.count({ where: { action: 'BACKUP_RESTORED' } })).toBe(1)
  })

})
