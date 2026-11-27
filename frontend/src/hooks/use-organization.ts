'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { sessionKey } from '@/hooks/use-session'
import { api, type Organization, type OrganizationSettings } from '@/lib/api'
import { sessionRevision } from '@/lib/session-cache'

const organizationKey = ['organization'] as const

export function useOrganization(enabled = true) {
  return useQuery({ queryKey: organizationKey, queryFn: () => api.get<Organization>('/api/organization'), enabled })
}

export function useSaveSettings() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (settings: Partial<OrganizationSettings>) => api.put<Organization>('/api/organization/settings', settings),
    onMutate: () => sessionRevision(client),
    onSuccess: async (organization, settings, revision) => {
      if (revision !== sessionRevision(client)) return
      client.setQueryData<Organization>(organizationKey, (current) => {
        if (!current) return organization
        const updated = { ...current.settings }
        for (const section of Object.keys(settings) as (keyof OrganizationSettings)[]) {
          Object.assign(updated, { [section]: organization.settings[section] })
        }
        return { ...current, settings: updated }
      })
      await Promise.all([
        client.invalidateQueries({ queryKey: organizationKey }),
        client.invalidateQueries({ queryKey: ['backups'] }),
      ])
    },
  })
}

export function useUpdateOrganization() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { name?: string; timezone?: string }) => api.patch<Organization>('/api/organization', input),
    onMutate: () => sessionRevision(client),
    onSuccess: async (organization, input, revision) => {
      if (revision !== sessionRevision(client)) return
      client.setQueryData<Organization>(organizationKey, (current) => current ? { ...current, ...('name' in input ? { name: organization.name } : {}), ...('timezone' in input ? { timezone: organization.timezone } : {}) } : organization)
      await Promise.all([
        client.invalidateQueries({ queryKey: organizationKey }),
        client.invalidateQueries({ queryKey: sessionKey }),
        ...['appointments', 'availability', 'cash', 'reports', 'reminders'].map((key) => client.invalidateQueries({ queryKey: [key] })),
      ])
    },
  })
}
