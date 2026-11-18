import type { NextFunction, Request, Response } from 'express'
import { toErrorBody } from '../shared/errors.js'

const ALLOWED_GET = ['/api/health', '/api/backups/status', '/api/auth/me']
const ALLOWED_POST = ['/api/auth/login', '/api/auth/logout', '/api/auth/change-password']

export function maintenanceGuard(active: () => boolean) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const allowed = (req.method === 'GET' && ALLOWED_GET.includes(req.path)) ||
      (req.method === 'POST' && (ALLOWED_POST.includes(req.path) || /^\/api\/backups\/backup-\d{8}-\d{6}-[0-9a-f]{6}\/restore$/.test(req.path)))
    if (!active() || allowed) {
      next()
      return
    }
    res.status(503).json(toErrorBody('MAINTENANCE', 'El sistema se está restaurando desde un backup. Probá de nuevo en unos minutos'))
  }
}
