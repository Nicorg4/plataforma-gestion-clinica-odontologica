import { expect, test, type Page } from '@playwright/test'
import { ADMIN_PASSWORD, ADMIN_USERNAME, apiLogin, ODONTOLOGO, RECEPCION } from './api'

test.describe.configure({ mode: 'serial' })

async function ingresar(page: Page, usuario: typeof RECEPCION) {
  await page.goto('/login')
  await page.getByLabel('Usuario').fill(usuario.username)
  await page.getByLabel('Contraseña').fill(usuario.password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
}

test('recepción crea un paciente desde la cabecera, conserva la búsqueda y abre el alta de turno', async ({ page }) => {
  await ingresar(page, RECEPCION)
  const actions = page.getByRole('group', { name: 'Acciones rápidas' })
  await expect(actions.getByRole('link', { name: /Próximo/ })).toHaveCount(0)
  await actions.getByRole('button', { name: 'Nuevo turno' }).click()
  await expect(page.getByRole('dialog', { name: 'Nuevo turno' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await actions.getByRole('button', { name: 'Nuevo paciente' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nuevo paciente' })
  await dialog.getByLabel('Nombre', { exact: true }).fill('Clara')
  await dialog.getByLabel('Apellido', { exact: true }).fill('Acosta')
  await dialog.getByLabel('Número de documento').fill('43000666')
  await dialog.getByLabel('Fecha de nacimiento').fill('01/02/1990')
  await dialog.getByRole('button', { name: 'Crear paciente' }).click()
  await expect(page).toHaveURL(/\/patients\/[0-9a-f-]+$/)
  await expect(page.getByRole('heading', { name: 'Acosta, Clara' })).toBeVisible()
  await expect(actions.getByRole('button', { name: 'Nuevo turno' })).toHaveCount(0)
  await page.getByLabel('Búsqueda rápida de pacientes').fill('acosta')
  await expect(page.getByRole('list', { name: 'Pacientes encontrados' }).getByRole('button', { name: /Acosta, Clara/ })).toBeVisible()
})

test('odontólogo abre su próximo paciente por el acceso rápido', async ({ page }) => {
  const admin = await apiLogin(ADMIN_USERNAME, ADMIN_PASSWORD)
  const professionals = await (await admin.get('/api/professionals')).json() as { id: string; displayName: string }[]
  const branches = await (await admin.get('/api/branches')).json() as { id: string }[]
  const patients = await (await admin.get('/api/patients?q=acosta')).json() as { items: { id: string }[] }
  const starts = new Date()
  starts.setDate(starts.getDate() + 20)
  starts.setHours(10, 0, 0, 0)
  const created = await admin.post('/api/appointments', { patientId: patients.items[0]!.id, professionalId: professionals.find((p) => p.displayName === ODONTOLOGO.displayName)!.id, branchId: branches[0]!.id, startsAt: starts.toISOString(), endsAt: new Date(starts.getTime() + 30 * 60_000).toISOString(), acknowledgeWarnings: true })
  expect(created.status()).toBe(201)
  await admin.dispose()
  await page.clock.setFixedTime(new Date(starts.getTime() - 60 * 60_000))
  await ingresar(page, ODONTOLOGO)
  const actions = page.getByRole('group', { name: 'Acciones rápidas' })
  await expect(actions.getByRole('button', { name: 'Nuevo turno' })).toHaveCount(0)
  await expect(actions.getByRole('button', { name: 'Nuevo paciente' })).toHaveCount(0)
  await actions.getByRole('link', { name: /Próximo:.*Acosta, Clara/ }).click()
  await expect(page).toHaveURL(new RegExp(`/patients/${patients.items[0]!.id}$`))
  await expect(page.getByRole('heading', { name: 'Acosta, Clara' })).toBeVisible()
})

test('la ayuda móvil repite el tutorial con búsqueda y acciones rápidas sin dejar abierto el menú', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await ingresar(page, RECEPCION)
  await page.getByRole('button', { name: 'Abrir el menú' }).click()
  const nav = page.getByRole('navigation', { name: 'Principal (móvil)' })
  await nav.getByRole('button', { name: 'Ayuda', exact: true }).click()
  await nav.getByRole('button', { name: 'Recorrido general del sistema' }).click()
  await expect(nav).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Bienvenido/a' })).toBeVisible()
  for (const title of ['Menú', 'Buscador de pacientes', 'Accesos rápidos']) {
    await page.getByRole('button', { name: 'Siguiente' }).click()
    await expect(page.getByRole('dialog', { name: title, exact: true })).toBeVisible()
  }
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByLabel('Búsqueda rápida de pacientes')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Nuevo turno', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Nuevo paciente', exact: true })).toBeVisible()
})
