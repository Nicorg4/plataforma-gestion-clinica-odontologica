import { Writable } from 'node:stream'
import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { httpLogger } from '../../src/middleware/httpLogger.js'
import { createLogger } from '../../src/shared/logger.js'

describe('HTTP request logging', () => {
  it.each([
    ['/api/patients?q=Rossi%20Luca&documentNumber=39888777', '/api/patients'],
    ['/api/patients?q=Rossi+Luca&cursor=private-cursor', '/api/patients'],
    ['/api/appointments?patientId=private-patient&branchId=private-branch', '/api/appointments'],
    ['/api/health', '/api/health'],
  ])('keeps the path and request metadata without query data for %s', async (url, path) => {
    const lines: string[] = []
    const destination = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString())
        done()
      },
    })
    const app = express()
    app.use(httpLogger(createLogger({ level: 'info', destination })))
    app.use((_req, res) => res.sendStatus(200))

    const response = await request(app).get(url)
    expect(response.status).toBe(200)
    expect(lines).toHaveLength(1)
    const entry = JSON.parse(lines[0] ?? '') as {
      req: { id: string; method: string; url: string }
      res: { statusCode: number }
    }
    expect(entry.req).toEqual({ id: response.headers['x-request-id'], method: 'GET', url: path })
    expect(entry.req.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(entry.res.statusCode).toBe(200)
    for (const secret of ['Rossi', 'Luca', '39888777', 'private-cursor', 'private-patient', 'private-branch']) {
      expect(lines.join('')).not.toContain(secret)
    }
  })
})
