import { beforeEach, describe, expect, it } from 'vitest'
import { retryOnWriteConflict } from '../../src/shared/prismaErrors.js'
import { resetDb, seedInstall, seedPatient, testDb, type Seed } from '../helpers.js'

const db = testDb()
let seed: Seed

beforeEach(async () => {
  await resetDb(db)
  seed = await seedInstall(db)
})

describe('PostgreSQL write conflict recovery', () => {
  it('retries a real deadlock and commits both operations without partial writes', async () => {
    const first = await seedPatient(db, seed, { documentNumber: '30111001' })
    const second = await seedPatient(db, seed, { documentNumber: '30111002' })
    let release = () => {}
    const ready = new Promise<void>((resolve) => { release = resolve })
    let arrived = 0
    const firstCounter = { attempts: 0 }
    const secondCounter = { attempts: 0 }

    const update = (firstId: string, secondId: string, value: string, counter: { attempts: number }) =>
      retryOnWriteConflict(() => db.$transaction(async (tx) => {
        counter.attempts += 1
        await tx.patient.update({ where: { id: firstId }, data: { address: value } })
        if (counter.attempts === 1) {
          arrived += 1
          if (arrived === 2) release()
          await ready
        }
        await tx.patient.update({ where: { id: secondId }, data: { phone: value } })
      }))

    await Promise.all([
      update(first.id, second.id, 'first operation', firstCounter),
      update(second.id, first.id, 'second operation', secondCounter),
    ])
    expect(firstCounter.attempts + secondCounter.attempts).toBe(3)
    expect(await db.patient.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({
      address: 'first operation', phone: 'second operation',
    })
    expect(await db.patient.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({
      address: 'second operation', phone: 'first operation',
    })
  })
})
