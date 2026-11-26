import type { RetainedBackup } from './retention.js'

const MAX_ATTEMPTS_PER_SLOT = 3

export function needsScheduledBackup(backups: readonly RetainedBackup[], latestSlot: Date): boolean {
  const attempts = backups.filter((b) => b.kind === 'SCHEDULED' && new Date(b.startedAt).getTime() >= latestSlot.getTime())
  return !attempts.some((b) => b.status !== 'FAILED') && attempts.length < MAX_ATTEMPTS_PER_SLOT
}
