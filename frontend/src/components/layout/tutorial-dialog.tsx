'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { FormError } from '@/components/form-error'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { sessionKey } from '@/hooks/use-session'
import { api, type SessionUser } from '@/lib/api'
import { tutorialSteps } from '@/lib/tutorial'

interface Props {
  user: SessionUser
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TutorialDialog({ user, open, onOpenChange }: Props) {
  const client = useQueryClient()
  const [index, setIndex] = useState(0)
  const steps = tutorialSteps(user)
  const step = steps[Math.min(index, steps.length - 1)] ?? steps[0]
  const dismiss = () => {
    setIndex(0)
    onOpenChange(false)
  }
  const complete = useMutation({
    mutationFn: () => api.post('/api/auth/onboarding/complete'),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: sessionKey })
      dismiss()
    },
  })
  const close = () => {
    if (complete.isPending) return
    if (!user.onboardingCompleted) complete.mutate()
    else dismiss()
  }
  const last = index >= steps.length - 1

  return (
    <Dialog open={open} onOpenChange={(value) => (value ? onOpenChange(true) : close())}>
      {open && step && (
        <DialogContent title={step.title} description={`Paso ${index + 1} de ${steps.length}`}>
          <FormError error={complete.error} className="mb-3" />
          <p className="text-sm leading-relaxed">{step.text}</p>
          <div className="mt-4 flex justify-center gap-1.5" aria-hidden>
            {steps.map((s, i) => (
              <span key={s.title} className={`size-2 rounded-full ${i === index ? 'bg-primary' : 'bg-muted'}`} />
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={complete.isPending} onClick={close}>
              {last ? 'Cerrar' : 'Saltear'}
            </Button>
            {index > 0 && (
              <Button variant="outline" onClick={() => setIndex(index - 1)}>
                Anterior
              </Button>
            )}
            <Button disabled={complete.isPending} onClick={() => (last ? close() : setIndex(index + 1))}>{last ? 'Empezar' : 'Siguiente'}</Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
