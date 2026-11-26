import type { Db } from '../../shared/db.js'
import type { Logger } from '../../shared/logger.js'
import { backupSlots, readSettings } from '../organizations/domain/settings.js'
import type { BackupConfig } from './backups.archive.js'
import { listBackups, markSchedulerActive, startBackup } from './backups.service.js'
import { needsScheduledBackup } from './domain/schedule.js'

const CHECK_EVERY_MS = 5 * 60_000

export function startBackupScheduler(db: Db, config: BackupConfig, logger: Logger): () => void {
  const tick = () => {
    checkScheduledBackup(db, config, logger).catch((err: unknown) => logger.error({ err }, 'no se pudo revisar el backup programado'))
  }
  markSchedulerActive()
  const first = setTimeout(tick, 60_000)
  const timer = setInterval(tick, CHECK_EVERY_MS)
  return () => {
    markSchedulerActive(false)
    clearTimeout(first)
    clearInterval(timer)
  }
}

export async function checkScheduledBackup(db: Db, config: BackupConfig, logger: Logger): Promise<void> {
  const organization = await db.organization.findFirst({ select: { timezone: true, settings: true } })
  if (!organization) return
  const { latest } = backupSlots(readSettings(organization.settings).backups, new Date(), organization.timezone)
  if (!latest || !needsScheduledBackup(await listBackups(config), latest)) return
  const { done } = await startBackup(db, config, logger, { userId: null, displayName: 'Backup automático' }, 'SCHEDULED')
  await done
}
