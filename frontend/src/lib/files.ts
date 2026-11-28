import type { ClinicalFile } from './api'

export const FILE_CATEGORY_LABELS: Record<ClinicalFile['category'], string> = {
  XRAY: 'Radiografía',
  STUDY: 'Estudio',
  PHOTO: 'Foto',
  CONSENT: 'Consentimiento',
  OTHER: 'Otro',
}

const ALLOWED = /\.(pdf|jpe?g|png)$/i

export function maxFileMb(organization: { settings: { files: { maxMb: number } }; limits: { fileMaxMb: number } }): number {
  return Math.min(organization.settings.files.maxMb, organization.limits.fileMaxMb)
}

export function fileProblem(file: Pick<File, 'name' | 'size'>, maxMb: number | null): string | null {
  if (!ALLOWED.test(file.name)) return 'Solo se aceptan archivos PDF, JPG o PNG'
  if (file.size === 0) return 'El archivo está vacío'
  if (maxMb !== null && file.size > maxMb * 1024 * 1024) return `El archivo supera los ${maxMb} MB`
  return null
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}
