import type { Request, Response } from 'express'
import { ipKeyGenerator, rateLimit } from 'express-rate-limit'
import { toErrorBody } from '../shared/errors.js'

export interface LoginRateLimit {
  max: number
  windowMs: number
}

export const DEFAULT_LOGIN_RATE_LIMIT: LoginRateLimit = { max: 10, windowMs: 15 * 60 * 1000 }

function failedAttemptsLimiter({ max, windowMs }: LoginRateLimit, key: (req: Request) => string) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: key,
    handler: (_req: Request, res: Response) => {
      res
        .status(429)
        .json(toErrorBody('TOO_MANY_ATTEMPTS', 'Demasiados intentos. Probá de nuevo en unos minutos.'))
    },
  })
}

export function loginRateLimiter(limit: LoginRateLimit) {
  return failedAttemptsLimiter(limit, (req) => {
    const body = req.body as { username?: unknown } | undefined
    const username = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : ''
    return `${ipKeyGenerator(req.ip ?? '')}|${username}`
  })
}

export function passwordChangeRateLimiter(limit: LoginRateLimit) {
  return failedAttemptsLimiter(limit, (req) => `cambio-de-clave|${req.auth?.userId ?? ipKeyGenerator(req.ip ?? '')}`)
}
