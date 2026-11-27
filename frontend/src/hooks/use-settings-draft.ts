'use client'

import { useState } from 'react'

export function useSettingsDraft<T>(initial: T) {
  const [state, setState] = useState({ base: initial, draft: initial })
  const base = JSON.stringify(state.base)
  const incoming = JSON.stringify(initial)
  const changed = JSON.stringify(state.draft) !== base
  if (incoming !== base && !changed) setState({ base: initial, draft: initial })
  return {
    draft: state.draft,
    changed,
    conflict: incoming !== base && changed,
    setDraft: (draft: T) => setState((current) => ({ ...current, draft })),
    reset: () => setState({ base: initial, draft: initial }),
    accept: (value: T) => setState({ base: value, draft: value }),
  }
}
