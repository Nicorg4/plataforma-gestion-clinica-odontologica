export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002'
}

const WRITE_CONFLICT_ATTEMPTS = 3

export async function retryOnWriteConflict<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run()
    } catch (err) {
      const conflict = typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2034'
      if (!conflict || attempt >= WRITE_CONFLICT_ATTEMPTS) throw err
    }
  }
}

export function isExclusionViolation(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const { code, meta } = err as Error & { code?: unknown; meta?: unknown }
  const text = `${err.message} ${String(code)} ${JSON.stringify(meta)}`
  return text.includes('23P01') || text.includes('Appointment_no_overlap')
}
