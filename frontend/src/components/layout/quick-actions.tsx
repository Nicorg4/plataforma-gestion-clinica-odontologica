'use client'

import { CalendarPlus, UserPlus, UserRound } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { AppointmentFormDialog, type AppointmentDefaults } from '@/components/appointments/appointment-form-dialog'
import { PatientFormDialog } from '@/components/patients/patient-form-dialog'
import { FormError } from '@/components/form-error'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { useBranches } from '@/hooks/use-admin'
import { useAppointments } from '@/hooks/use-appointments'
import { usePractices, useProfessionals } from '@/hooks/use-catalog'
import type { SessionUser } from '@/lib/api'
import { dayRange } from '@/lib/appointments'
import { formatTime } from '@/lib/format'
import { can, visibleBranches } from '@/lib/permissions'

function NextPatient({ user }: { user: SessionUser }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const appointments = useAppointments(dayRange(new Date(now)))
  const next = (appointments.data ?? [])
    .filter((a) => (a.status === 'SCHEDULED' || a.status === 'CONFIRMED') && new Date(a.endsAt).getTime() > now && a.professional.userId === user.id && (user.roles.includes('ADMIN') || user.branchIds.includes(a.branch.id)))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0]
  if (appointments.isPending) return <span role="status" className="text-sm text-muted-foreground">Buscando próximo paciente…</span>
  if (appointments.isError) return <Button size="sm" variant="outline" onClick={() => void appointments.refetch()}>Reintentar próximo paciente</Button>
  if (!next) return <span className="hidden text-sm text-muted-foreground sm:inline">No quedan pacientes hoy</span>
  return (
    <Link href={`/patients/${next.patient.id}`} className={`${buttonVariants({ variant: 'outline', size: 'sm' })} min-w-0 max-w-full`}>
      <UserRound className="size-4" aria-hidden />
      <span className="truncate">Próximo: {formatTime(next.startsAt)} {next.patient.fullName}</span>
    </Link>
  )
}

function NewAppointment({ user }: { user: SessionUser }) {
  const [creating, setCreating] = useState<AppointmentDefaults | null>(null)
  const branches = useBranches(creating !== null)
  const professionals = useProfessionals(creating !== null)
  const practices = usePractices('active', creating !== null)
  const error = branches.error ?? professionals.error ?? practices.error
  const ready = !error && branches.data && professionals.data && practices.data
  return (
    <>
      <Button size="sm" aria-label="Nuevo turno" onClick={() => setCreating({ start: nextSlot(), durationMinutes: 30 })}>
        <CalendarPlus className="size-4" aria-hidden />
        <span className="hidden sm:inline">Nuevo turno</span>
      </Button>
      {creating !== null && !ready && (
        <Dialog open onOpenChange={(open) => !open && setCreating(null)}>
          <DialogContent title="Nuevo turno">
            {error ? <><FormError error={error} /><Button variant="outline" onClick={() => void Promise.all([branches.refetch(), professionals.refetch(), practices.refetch()])}>Reintentar</Button></> : <p role="status">Cargando datos para el turno…</p>}
          </DialogContent>
        </Dialog>
      )}
      {ready && (
        <AppointmentFormDialog
          open={creating !== null}
          onOpenChange={(open) => !open && setCreating(null)}
          appointment={null}
          defaults={creating}
          branches={visibleBranches(user, branches.data)}
          professionals={professionals.data}
          practices={practices.data}
        />
      )}
    </>
  )
}

function NewPatient() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="outline" aria-label="Nuevo paciente" onClick={() => setOpen(true)}>
        <UserPlus className="size-4" aria-hidden />
        <span className="hidden sm:inline">Nuevo paciente</span>
      </Button>
      <PatientFormDialog open={open} onOpenChange={setOpen} patient={null} onSaved={(created) => router.push(`/patients/${created.id}`)} />
    </>
  )
}

function nextSlot(): Date {
  const now = new Date()
  now.setMinutes(Math.ceil(now.getMinutes() / 30) * 30, 0, 0)
  return now
}

export function QuickActions({ user, pathname }: { user: SessionUser; pathname: string }) {
  const appointment = can(user, 'appointments:manage') && !pathname.startsWith('/agenda') && !pathname.startsWith('/patients/')
  const patient = can(user, 'patients:write') && pathname !== '/patients'
  const next = can(user, 'clinical:read') && can(user, 'patients:read') && can(user, 'appointments:read')
  if (!appointment && !patient && !next) return null
  return (
    <div role="group" aria-label="Acciones rápidas" data-tour="quick-actions" className="flex min-w-0 flex-wrap items-center gap-2">
      {appointment && <NewAppointment user={user} />}
      {patient && <NewPatient />}
      {next && <NextPatient user={user} />}
    </div>
  )
}
