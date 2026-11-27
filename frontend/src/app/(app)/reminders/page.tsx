'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, MessageCircle } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { FormError } from '@/components/form-error'
import { EmptyState, LoadingBlock, PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { appointmentsKey } from '@/hooks/use-appointments'
import { useSession } from '@/hooks/use-session'
import { api } from '@/lib/api'
import type { components } from '@/lib/api-types'
import { formatDate, formatTime, shiftIsoDay, toIsoDay } from '@/lib/format'
import { can } from '@/lib/permissions'

type Day = components['schemas']['RemindersDay']
type Reminder = components['schemas']['Reminder']

const STATUS: Record<Reminder['status'], { label: string; variant: 'default' | 'success' | 'muted' | 'destructive' }> = {
  PENDING: { label: 'Para enviar', variant: 'default' },
  SENT: { label: 'Enviado', variant: 'default' },
  CONFIRMED: { label: 'Confirmó', variant: 'success' },
  CANCELLED: { label: 'Descartado', variant: 'muted' },
  FAILED: { label: 'Revisar teléfono', variant: 'destructive' },
}

export default function RemindersPage() {
  const router = useRouter()
  const client = useQueryClient()
  const session = useSession()
  const user = session.data?.user
  const allowed = can(user, 'appointments:manage')
  const [day, setDay] = useState(() => shiftIsoDay(toIsoDay(new Date()), 1))
  const key = ['reminders', user?.id, day]
  const reminders = useQuery({ queryKey: key, queryFn: () => api.get<Day>(`/api/reminders?date=${day}`), enabled: allowed })
  const generate = useMutation({ mutationFn: (date: string) => api.post<Day>('/api/reminders/generate', { date }), onSuccess: (data) => client.setQueryData(['reminders', user?.id, data.date], data) })
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'sent' | 'confirm' | 'cancel'; date: string }) => api.post<Reminder>(`/api/reminders/${id}/${action}`),
    onSuccess: async (updated, { action, date }) => {
      client.setQueryData<Day>(['reminders', user?.id, date], (current) =>
        current ? { ...current, reminders: current.reminders.map((r) => (r.id === updated.id ? updated : r)) } : current,
      )
      if (action === 'confirm') await client.invalidateQueries({ queryKey: appointmentsKey })
    },
    onError: () => client.invalidateQueries({ queryKey: ['reminders', user?.id] }),
  })

  useEffect(() => {
    if (user && !allowed) router.replace('/dashboard')
  }, [user, allowed, router])

  if (!user || !allowed) return <LoadingBlock />

  const list = reminders.data?.reminders ?? []
  const pending = list.filter((r) => r.status === 'PENDING').length

  return (
    <>
      <PageHeader
        title="Recordatorios"
        description="Abrí WhatsApp y enviá el mensaje; después registrá el envío manualmente. Si el paciente no usa WhatsApp, avisale por llamada."
        actions={
          <Button disabled={generate.isPending} onClick={() => generate.mutate(day)}>
            Generar los que faltan
          </Button>
        }
      />
      <div className="mb-4 flex items-center gap-2">
        <Button variant="outline" size="sm" aria-label="Día anterior" onClick={() => setDay(shiftIsoDay(day, -1))}>
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
        <span className="min-w-32 text-center text-sm font-semibold">Turnos del {formatDate(day)}</span>
        <Button variant="outline" size="sm" aria-label="Día siguiente" onClick={() => setDay(shiftIsoDay(day, 1))}>
          <ChevronRight className="size-4" aria-hidden />
        </Button>
        {pending > 0 && <span className="text-sm text-muted-foreground">{pending} para enviar</span>}
      </div>
      <FormError error={reminders.error ?? generate.error ?? act.error} className="mb-4" />
      {reminders.isPending ? (
        <LoadingBlock />
      ) : list.length === 0 ? (
        <EmptyState title="No hay recordatorios para ese día" description="Tocá «Generar los que faltan» para crearlos a partir de los turnos." />
      ) : (
        <ul className="divide-y rounded-lg border bg-card shadow-sm" data-tour="reminders-list">
          {list.map((reminder) => (
            <li key={reminder.id} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p>
                  <span className="font-medium">{formatTime(reminder.appointment.startsAt)}</span>{' '}
                  <Link href={`/patients/${reminder.patient.id}`} className="text-primary hover:underline">
                    {reminder.patient.fullName}
                  </Link>
                  <span className="text-muted-foreground">
                    {' '}
                    · {reminder.appointment.professional} · {reminder.appointment.branch}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">{[reminder.phone, reminder.failureReason].filter(Boolean).join(' · ')}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={STATUS[reminder.status].variant}>{STATUS[reminder.status].label}</Badge>
                {reminder.whatsappUrl && (reminder.status === 'PENDING' || reminder.status === 'SENT') && (
                  <a
                    href={reminder.whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={buttonVariants({ size: 'sm' })}
                  >
                    <MessageCircle className="size-4" aria-hidden />
                    {reminder.status === 'SENT' ? 'Reabrir WhatsApp' : 'Enviar por WhatsApp'}
                  </a>
                )}
                {(reminder.status === 'PENDING' || reminder.status === 'SENT') && reminder.appointment.status !== 'CANCELLED' && (
                  <Button variant="outline" size="sm" disabled={act.isPending} onClick={() => act.mutate({ id: reminder.id, action: 'sent', date: day })}>
                    Registrar envío / llamada
                  </Button>
                )}
                {(reminder.status === 'PENDING'  || reminder.status === 'SENT' || reminder.status === 'FAILED') &&
                  (reminder.appointment.status === 'SCHEDULED' || reminder.appointment.status === 'CONFIRMED') && (
                    <Button variant="outline" size="sm" disabled={act.isPending} onClick={() => act.mutate({ id: reminder.id, action: 'confirm', date: day })}>
                      Confirmó
                    </Button>
                  )}
                {reminder.status !== 'CONFIRMED' && reminder.status !== 'CANCELLED' && (
                  <Button variant="outline" size="sm" disabled={act.isPending} onClick={() => act.mutate({ id: reminder.id, action: 'cancel', date: day })}>
                    Descartar
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
