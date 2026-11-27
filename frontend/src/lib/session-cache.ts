import type { QueryClient } from '@tanstack/react-query'
import { setCsrfToken, type SessionResponse, type SessionUser } from './api'

export const sessionKey = ['session'] as const
const revisions = new WeakMap<QueryClient, number>()

export function sessionRevision(client: QueryClient): number {
  return revisions.get(client) ?? 0
}

export function sessionScope(user: SessionUser): string {
  return JSON.stringify([user.id, [...user.branchIds].sort(), [...user.roles].sort(), [...user.permissions].sort(), user.modules, user.mustChangePassword])
}

async function discardPrivateData(client: QueryClient) {
  const filters = { predicate: (query: { queryKey: readonly unknown[] }) => !['session', 'setup-status', 'health'].includes(String(query.queryKey[0])) }
  await client.cancelQueries(filters)
  client.removeQueries(filters)
}

export async function forgetSession(client: QueryClient) {
  revisions.set(client, sessionRevision(client) + 1)
  setCsrfToken(null)
  client.setQueryData(sessionKey, null)
  await discardPrivateData(client)
  client.getMutationCache().clear()
}

export async function acceptSession(client: QueryClient, session: SessionResponse, login = false) {
  const previous = client.getQueryData<SessionResponse | null>(sessionKey)
  if (login || !previous || sessionScope(previous.user) !== sessionScope(session.user)) {
    revisions.set(client, sessionRevision(client) + 1)
    setCsrfToken(null)
    if (login) await client.cancelQueries({ queryKey: sessionKey })
    await discardPrivateData(client)
    client.getMutationCache().clear()
  }
  setCsrfToken(session.csrfToken)
}
