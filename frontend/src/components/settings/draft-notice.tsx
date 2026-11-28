import { Alert } from '@/components/ui/alert'

export function DraftNotice({ conflict }: { conflict: boolean }) {
  return conflict ? (
    <Alert variant="info">Estos ajustes cambiaron en el servidor. Tu edición se conserva; descartá los cambios para cargar los valores actuales antes de guardar.</Alert>
  ) : null
}
