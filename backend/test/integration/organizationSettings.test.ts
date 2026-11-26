import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  as,
  buildApp,
  loginAs,
  ORIGIN,
  resetDb,
  seedAppointment,
  seedInstall,
  seedPatient,
  seedProfessional,
  seedUser,
  testDb,
  TEST_FILES,
  type Client,
  type Seed,
} from '../helpers.js'

const db = testDb()
const app = buildApp(db)
let seed: Seed
let admin: Client
let recepcion: Client
let odontologo: Client

interface Organizacion {
  name: string
  settings: { reminders: { daysAhead: number; template: string }; backups: { schedule: string; keepManual: number }; files: { maxMb: number } }
  limits: { fileMaxMb: number }
}

const codigo = (body: unknown) => (body as { error: { code: string } }).error.code

beforeEach(async () => {
  await resetDb(db)
  seed = await seedInstall(db)
  await seedUser(db, seed, { username: 'admin', roles: ['ADMIN'] })
  await seedUser(db, seed, { username: 'recepcion', roles: ['RECEPTIONIST'] })
  await seedProfessional(db, seed, { username: 'odontologo', displayName: 'Dra. Paz' })
  admin = await loginAs(app, 'admin')
  recepcion = await loginAs(app, 'recepcion')
  odontologo = await loginAs(app, 'odontologo')
})

describe('ajustes del consultorio', () => {
  it('todos leen los ajustes y cada seccion la cambia quien corresponde', async () => {
    const leido = (await as(app, odontologo).get('/api/organization').expect(200)).body as Organizacion
    expect(leido.settings.reminders.daysAhead).toBe(1)
    expect(leido.settings.backups.schedule).toBe('DAILY')

    const recordatorios = { daysAhead: 2, template: 'Hola {nombre}, te esperamos el {fecha} a las {hora}.' }
    const guardado = await as(app, recepcion).put('/api/organization/settings', { reminders: recordatorios }).expect(200)
    expect((guardado.body as Organizacion).settings.reminders).toEqual(recordatorios)

    const backups = { schedule: 'EVERY_12H', hour: 2, weekday: 7, paused: false, keepDaily: 5, keepWeekly: 2, keepManual: 3 }
    expect(codigo((await as(app, recepcion).put('/api/organization/settings', { backups }).expect(403)).body)).toBe('FORBIDDEN')
    await as(app, admin).put('/api/organization/settings', { backups }).expect(200)
    await as(app, odontologo).put('/api/organization/settings', { sessions: { idleMinutes: 30 } }).expect(403)
    await as(app, recepcion).patch('/api/organization', { name: 'Otro nombre' }).expect(403)
    expect(((await as(app, admin).patch('/api/organization', { name: 'Consultorio Sonrisas' }).expect(200)).body as Organizacion).name).toBe(
      'Consultorio Sonrisas',
    )
    expect(await db.auditLog.count({ where: { action: 'ORGANIZATION_SETTINGS_UPDATED' } })).toBe(2)
  })

  it('valida variables del mensaje, zona horaria y el tope de archivos del servidor', async () => {
    await as(app, admin).put('/api/organization/settings', { reminders: { daysAhead: 1, template: 'Hola {paciente}, te esperamos mañana.' } }).expect(400)
    await as(app, admin).patch('/api/organization', { timezone: 'Marte/Olympus' }).expect(400)
    const tope = ((await as(app, admin).get('/api/organization').expect(200)).body as Organizacion).limits.fileMaxMb
    const excedido = await as(app, admin).put('/api/organization/settings', { files: { maxMb: tope + 1 } })
    expect([excedido.status, codigo(excedido.body)]).toEqual([422, 'FILE_LIMIT_TOO_HIGH'])
  })

  it('los recordatorios usan la anticipacion y el texto configurados', async () => {
    await as(app, recepcion)
      .put('/api/organization/settings', { reminders: { daysAhead: 2, template: 'Hola {nombre}, turno el {fecha} a las {hora} en {consultorio}.' } })
      .expect(200)
    const zona = 'America/Argentina/Buenos_Aires'
    const pasado = new Intl.DateTimeFormat('en-CA', { timeZone: zona }).format(new Date(Date.now() + 2 * 86_400_000))
    const paciente = await seedPatient(db, seed, { firstName: 'Ana', lastName: 'Gómez', phone: '11 5555-1234' })
    const perfil = await db.professionalProfile.findFirstOrThrow()
    const creador = await db.user.findFirstOrThrow({ where: { username: 'recepcion' } })
    await seedAppointment(db, seed, {
      patientId: paciente.id,
      professionalId: perfil.id,
      createdById: creador.id,
      startsAt: new Date(`${pasado}T10:00:00-03:00`),
      endsAt: new Date(`${pasado}T10:30:00-03:00`),
    })
    const dia = (await as(app, recepcion).post('/api/reminders/generate', {}).expect(200)).body as { date: string; reminders: { whatsappUrl: string }[] }
    expect(dia.date).toBe(pasado)
    expect(decodeURIComponent(dia.reminders[0]?.whatsappUrl ?? '')).toContain('Hola Ana, turno el')
  })

  it('una sesion inactiva mas que lo configurado se cierra', async () => {
    await as(app, admin).put('/api/organization/settings', { sessions: { idleMinutes: 15 } }).expect(200)
    await db.session.updateMany({ data: { lastSeenAt: new Date(Date.now() - 16 * 60_000) } })
    expect((await as(app, recepcion).get('/api/auth/me')).status).toBe(401)
  })

  it('no pierde secciones cuando se guardan ajustes en paralelo', async () => {
    await Promise.all([
      as(app, admin).put('/api/organization/settings', { files: { maxMb: 1 } }).expect(200),
      as(app, recepcion).put('/api/organization/settings', { reminders: { daysAhead: 3, template: 'Hola {nombre}, te esperamos en {consultorio}.' } }).expect(200),
    ])
    const actual = (await as(app, admin).get('/api/organization').expect(200)).body as Organizacion
    expect(actual.settings.files.maxMb).toBe(1)
    expect(actual.settings.reminders.daysAhead).toBe(3)
  })

  it('rechaza el pedido completo si incluye una seccion sin permiso', async () => {
    await as(app, recepcion).put('/api/organization/settings', {
      reminders: { daysAhead: 3, template: 'Hola {nombre}, te esperamos en {consultorio}.' },
      sessions: { idleMinutes: 15 },
    }).expect(403)
    const actual = (await as(app, admin).get('/api/organization').expect(200)).body as Organizacion
    expect(actual.settings.reminders.daysAhead).toBe(1)
    expect(await db.auditLog.count({ where: { action: 'ORGANIZATION_SETTINGS_UPDATED' } })).toBe(0)
  })

  it('aplica el limite del consultorio al contenido del adjunto antes de guardarlo', async () => {
    const archivosApp = buildApp(db, { files: { ...TEST_FILES, maxBytes: 2 * 1024 * 1024 } })
    await as(archivosApp, admin).put('/api/organization/settings', { files: { maxMb: 1 } }).expect(200)
    const paciente = await seedPatient(db, seed)
    const subir = (size: number) => request(archivosApp)
      .post(`/api/patients/${paciente.id}/files?filename=estudio.pdf&category=XRAY`)
      .set('Cookie', odontologo.cookie)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', odontologo.csrfToken)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(size - 9, 0x20)]))
    const excedido = await subir(1024 * 1024 + 1).expect(413)
    expect(codigo(excedido.body)).toBe('FILE_TOO_LARGE')
    expect(await db.clinicalFile.count()).toBe(0)
    await subir(1024 * 1024).expect(201)
    expect(await db.clinicalFile.count()).toBe(1)
  })

  it('el indicador de conexion no cuenta como actividad: la sesion vence igual', async () => {
    await as(app, admin).put('/api/organization/settings', { sessions: { idleMinutes: 15 } }).expect(200)
    await db.session.updateMany({ data: { lastSeenAt: new Date(Date.now() - 14 * 60_000) } })
    const antes = await db.session.findFirstOrThrow({ where: { user: { username: 'recepcion' } } })
    await as(app, recepcion).get('/api/health').expect(200)
    const sesion = await db.session.findFirstOrThrow({ where: { user: { username: 'recepcion' } } })
    expect(sesion.lastSeenAt).toEqual(antes.lastSeenAt)
    await db.session.updateMany({ data: { lastSeenAt: new Date(Date.now() - 16 * 60_000) } })
    expect((await as(app, recepcion).get('/api/auth/me')).status).toBe(401)
  })
})
