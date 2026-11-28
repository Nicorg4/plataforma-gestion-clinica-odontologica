'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, type SessionResponse } from '@/lib/api'
import { acceptSession, forgetSession, sessionKey, sessionRevision } from '@/lib/session-cache'

export { sessionKey } from '@/lib/session-cache'

export function useSession() {
  const client = useQueryClient()
  return useQuery({
    queryKey: sessionKey,
    queryFn: async (): Promise<SessionResponse | null> => {
      const revision = sessionRevision(client)
      try {
        const session = await api.get<SessionResponse>('/api/auth/me')
        if (revision !== sessionRevision(client)) return client.getQueryData<SessionResponse | null>(sessionKey) ?? null
        await acceptSession(client, session)
        return session
      } catch (error) {
        if (error instanceof ApiError && error.code === 'STALE_SESSION') return client.getQueryData<SessionResponse | null>(sessionKey) ?? null
        if (error instanceof ApiError && error.status === 401) {
          if (revision !== sessionRevision(client)) return client.getQueryData<SessionResponse | null>(sessionKey) ?? null
          await forgetSession(client)
          return null
        }
        throw error
      }
    },
    staleTime: 60_000,
    retry: false,
  })
}

export function useSetupStatus() {
  return useQuery({
    queryKey: ['setup-status'],
    queryFn: () => api.get<{ needsSetup: boolean }>('/api/setup/status'),
    staleTime: 30_000,
  })
}

export function useLogin() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { username: string; password: string }) =>
      api.post<SessionResponse>('/api/auth/login', input),
    onSuccess: async (session) => {
      await acceptSession(client, session, true)
      client.setQueryData(sessionKey, session)
    },
  })
}

export function useLogout() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => api.post('/api/auth/logout'),
    onSuccess: () => forgetSession(client),
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) return forgetSession(client)
    },
  })
}
