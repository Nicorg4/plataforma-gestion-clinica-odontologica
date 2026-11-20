import type request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  as,
  buildApp,
  loginAs,
  minutesFromNow,
  resetDb,
  seedAppointment,
  seedInstall,
  seedPatient,
  seedProfessional,
  seedUser,
  testDb,
  type Client,
  type Seed,
} from '../helpers.js'

const db = testDb()
const app = buildApp(db)
let seed: Seed
let admin: Client
let recepcion: Client

const codigo = (res: request.Response) => (res.body as { error: { code: string } }).error.code

beforeEach(async () => {
  await resetDb(db)
  seed = await seedInstall(db)
  await seedUser(db, seed, { username: 'admin', roles: ['ADMIN'] })
  await seedUser(db, seed, { username: 'recepcion', roles: ['RECEPTIONIST'] })
  admin = await loginAs(app, 'admin')
  recepcion = await loginAs(app, 'recepcion')
})

describe('sedes', () => {
  it('cualquier usuario autenticado puede listarlas', async () => {
    const res = await as(app, recepcion).get('/api/branches')
    expect(res.status).toBe(200)
    expect((res.body as unknown[]).length).toBe(2)
  })

  it('el admin crea una sede y queda auditado', async () => {
    const res = await as(app, admin).post('/api/branches', { name: 'Sede Sur', address: '  Calle 1  ', phone: '' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ name: 'Sede Sur', address: 'Calle 1', phone: null, active: true })
    expect(await db.auditLog.count({ where: { action: 'BRANCH_CREATED' } })).toBe(1)
  })

  it('valida el nombre', async () => {
    expect((await as(app, admin).post('/api/branches', { name: 'x' })).status).toBe(400)
  })

  it('edita los datos de una sede', async () => {
    const res = await as(app, admin).patch(`/api/branches/${seed.branchId}`, { name: 'Central Renovada' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ name: 'Central Renovada' })
  })

  it('no permite desactivar la unica sede activa', async () => {
    await as(app, admin).patch(`/api/branches/${seed.secondBranchId}`, { active: false }).expect(200)
    const res = await as(app, admin).patch(`/api/branches/${seed.branchId}`, { active: false })
    expect(res.status).toBe(409)
    expect(codigo(res)).toBe('LAST_BRANCH')
  })

  it('no permite desactivar una sede con turnos pendientes; los pasados o cancelados no cuentan', async () => {
    const recepcionista = await db.user.findFirstOrThrow({ where: { username: 'recepcion' } })
    const perfil = (await seedProfessional(db, seed, { username: 'odontologa', branchIds: [seed.secondBranchId] })).profile.id
    const paciente = await seedPatient(db, seed)
    const turno = (horas: number, status: 'SCHEDULED' | 'CANCELLED' = 'SCHEDULED') =>
      seedAppointment(db, seed, {
        patientId: paciente.id,
        professionalId: perfil,
        createdById: recepcionista.id,
        branchId: seed.secondBranchId,
        startsAt: minutesFromNow(horas * 60),
        endsAt: minutesFromNow(horas * 60 + 30),
        status,
      })
    await turno(-48)
    await turno(24, 'CANCELLED')
    const pendiente = await turno(24)
    const res = await as(app, admin).patch(`/api/branches/${seed.secondBranchId}`, { active: false })
    expect(res.status).toBe(409)
    expect(codigo(res)).toBe('BRANCH_HAS_APPOINTMENTS')
    expect((res.body as { error: { message: string } }).error.message).toContain('un turno pendiente')
    await db.appointment.update({ where: { id: pendiente.id }, data: { status: 'CANCELLED', cancellationReason: 'Cierra la sede' } })
    await as(app, admin).patch(`/api/branches/${seed.secondBranchId}`, { active: false }).expect(200)
  })

  it('devuelve 404 para una sede inexistente', async () => {
    const res = await as(app, admin).patch('/api/branches/00000000-0000-7000-8000-000000000000', { name: 'Fantasma' })
    expect(res.status).toBe(404)
  })

  it('recepcion no puede crear ni editar sedes', async () => {
    expect((await as(app, recepcion).post('/api/branches', { name: 'Intrusa' })).status).toBe(403)
    expect((await as(app, recepcion).patch(`/api/branches/${seed.branchId}`, { name: 'Intrusa' })).status).toBe(403)
    expect(await db.branch.count()).toBe(2)
  })
})
