'use client'

import type { ReactNode } from 'react'
import { DraftNotice } from '@/components/settings/draft-notice'
import { useSettingsDraft } from '@/hooks/use-settings-draft'
import { LoadingBlock } from '@/components/page-header'
import { FormError } from '@/components/form-error'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input, Select, Textarea } from '@/components/ui/input'
import { useOrganization, useSaveSettings, useUpdateOrganization } from '@/hooks/use-organization'
import type { Organization, SessionUser } from '@/lib/api'
import { can } from '@/lib/permissions'

const VARIABLES = ['nombre', 'fecha', 'hora', 'profesional', 'sede', 'consultorio'] as const
const IDLE_OPTIONS = [15, 30, 60, 120, 240, 480, 720] as const
const ZONES = [
  'America/Argentina/Buenos_Aires',
  'America/Argentina/Cordoba',
  'America/Argentina/Mendoza',
  'America/Argentina/Salta',
  'America/Argentina/Jujuy',
  'America/Argentina/Tucuman',
  'America/Argentina/Catamarca',
  'America/Argentina/La_Rioja',
  'America/Argentina/San_Juan',
  'America/Argentina/San_Luis',
  'America/Argentina/Rio_Gallegos',
  'America/Argentina/Ushuaia',
]

export function previewMessage(template: string, clinic: string): string {
  const sample: Record<(typeof VARIABLES)[number], string> = {
    nombre: 'Ana',
    fecha: '12/11/2026',
    hora: '10:30',
    profesional: 'Dra. Paz',
    sede: 'Sede Central',
    consultorio: clinic,
  }
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in sample ? sample[key as keyof typeof sample] : match))
}

const idleLabel = (minutes: number) => (minutes < 60 ? `${minutes} minutos` : `${minutes / 60} ${minutes === 60 ? 'hora' : 'horas'}`)

function Card({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-lg border bg-card p-5 shadow-sm">
      <h2 id={id} className="text-sm font-semibold">
        {title}
      </h2>
      <p className="text-xs text-muted-foreground">{description}</p>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function SaveRow({ changed, pending, blocked = false, onReset }: { changed: boolean; pending: boolean; blocked?: boolean; onReset: () => void }) {
  return (
    <div className="flex gap-2">
      <Button type="submit" size="sm" disabled={!changed || pending || blocked}>
        {pending ? 'Guardando…' : 'Guardar'}
      </Button>
      {changed && (
        <Button type="button" variant="outline" size="sm" onClick={onReset}>
          Descartar cambios
        </Button>
      )}
    </div>
  )
}

function ClinicCard({ organization }: { organization: Organization }) {
  const update = useUpdateOrganization()
  const draft = useSettingsDraft({ name: organization.name, timezone: organization.timezone })
  const { name, timezone } = draft.draft
  const changed = draft.changed
  const zones = ZONES.includes(organization.timezone) ? ZONES : [organization.timezone, ...ZONES]
  return (
    <Card id="consultorio-datos" title="Consultorio: datos" description="El nombre aparece en los recordatorios. La zona horaria rige la agenda, la caja y los reportes.">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (!draft.conflict) update.mutate({ name: name.trim(), timezone }, { onSuccess: (saved) => draft.accept({ name: saved.name, timezone: saved.timezone }) })
        }}
      >
        <fieldset disabled={update.isPending} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nombre del consultorio" htmlFor="org-name">
              <Input id="org-name" maxLength={120} value={name} onChange={(e) => draft.setDraft({ ...draft.draft, name: e.target.value })} />
            </Field>
            <Field label="Zona horaria" htmlFor="org-timezone">
              <Select id="org-timezone" value={timezone} onChange={(e) => draft.setDraft({ ...draft.draft, timezone: e.target.value })}>
                {zones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone.replace('America/Argentina/', '').replace('_', ' ')}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <DraftNotice conflict={draft.conflict} />
          <FormError error={update.error} />
          <SaveRow
            changed={changed}
            pending={update.isPending}
            blocked={draft.conflict || name.trim().length < 2}
            onReset={draft.reset}
          />
        </fieldset>
      </form>
    </Card>
  )
}

function RemindersCard({ organization }: { organization: Organization }) {
  const save = useSaveSettings()
  const initial = organization.settings.reminders
  const draft = useSettingsDraft(initial)
  const { daysAhead, template } = draft.draft
  const changed = draft.changed
  return (
    <Card id="consultorio-recordatorios" title="Consultorio: recordatorios" description="Cuándo se generan los avisos de turnos y qué dice el mensaje de WhatsApp.">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (!draft.conflict) save.mutate({ reminders: { daysAhead, template: template.trim() } }, { onSuccess: (saved) => draft.accept(saved.settings.reminders) })
        }}
      >
        <fieldset disabled={save.isPending} className="space-y-3">
          <Field label="Generar los avisos" htmlFor="reminders-days" className="sm:w-64">
            <Select id="reminders-days" value={daysAhead} onChange={(e) => draft.setDraft({ ...draft.draft, daysAhead: Number(e.target.value) })}>
              <option value={1}>1 día antes del turno</option>
              <option value={2}>2 días antes del turno</option>
              <option value={3}>3 días antes del turno</option>
            </Select>
          </Field>
          <Field label="Mensaje" htmlFor="reminders-template" hint={`Variables: ${VARIABLES.map((v) => `{${v}}`).join(' ')}`}>
            <Textarea id="reminders-template" rows={4} maxLength={600} value={template} onChange={(e) => draft.setDraft({ ...draft.draft, template: e.target.value })} />
          </Field>
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <p className="text-xs font-medium text-muted-foreground">Así lo recibe el paciente</p>
            <p>{previewMessage(template, organization.name)}</p>
          </div>
          <DraftNotice conflict={draft.conflict} />
          <FormError error={save.error} />
          <SaveRow
            changed={changed}
            pending={save.isPending}
            blocked={draft.conflict}
            onReset={draft.reset}
          />
        </fieldset>
      </form>
    </Card>
  )
}

function SecurityCard({ organization }: { organization: Organization }) {
  const save = useSaveSettings()
  const draft = useSettingsDraft({ maxMb: organization.settings.files.maxMb, idle: organization.settings.sessions.idleMinutes })
  const { maxMb, idle } = draft.draft
  const changed = draft.changed
  return (
    <Card id="consultorio-archivos" title="Consultorio: archivos y sesiones" description="Límites que se aplican a todo el equipo.">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (!draft.conflict) save.mutate({ files: { maxMb }, sessions: { idleMinutes: idle } }, { onSuccess: (saved) => draft.accept({ maxMb: saved.settings.files.maxMb, idle: saved.settings.sessions.idleMinutes }) })
        }}
      >
        <fieldset disabled={save.isPending} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tamaño máximo de archivo clínico (MB)" htmlFor="files-max" hint={`El servidor admite hasta ${organization.limits.fileMaxMb} MB.`}>
              <Input
                id="files-max"
                type="number"
                min={1}
                max={organization.limits.fileMaxMb}
                value={maxMb}
                onChange={(e) => draft.setDraft({ ...draft.draft, maxMb: Number(e.target.value) })}
              />
            </Field>
            <Field label="Cerrar la sesión tras" htmlFor="sessions-idle" hint="Sin actividad. Se aplica en el próximo pedido de cada sesión.">
              <Select id="sessions-idle" value={idle} onChange={(e) => draft.setDraft({ ...draft.draft, idle: Number(e.target.value) })}>
                {IDLE_OPTIONS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {idleLabel(minutes)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <DraftNotice conflict={draft.conflict} />
          <FormError error={save.error} />
          <SaveRow
            changed={changed}
            pending={save.isPending}
            blocked={draft.conflict}
            onReset={draft.reset}
          />
        </fieldset>
      </form>
    </Card>
  )
}

export function OrganizationSettingsSections({ user }: { user: SessionUser }) {
  const allowed = can(user, 'organization:manage') || can(user, 'appointments:manage')
  const organization = useOrganization(allowed)
  const data = organization.data
  if (!allowed) return null
  if (!data) return organization.isPending ? <LoadingBlock /> : <FormError error={organization.error} />
  return (
    <>
      <FormError error={organization.error} />
      {can(user, 'organization:manage') && <ClinicCard key="datos" organization={data} />}
      {can(user, 'appointments:manage') && <RemindersCard key="recordatorios" organization={data} />}
      {can(user, 'organization:manage') && <SecurityCard key="seguridad" organization={data} />}
    </>
  )
}
