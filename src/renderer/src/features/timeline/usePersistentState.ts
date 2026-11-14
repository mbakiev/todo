// Tiny per-window UI preference persisted in localStorage (zoom, grouping, show completed).
// These are view conveniences, not settings, so they do not go through the settings store.
import { useCallback, useState } from 'react'

function read<T>(key: string, fallback: T, isValid: (v: unknown) => v is T): T {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed: unknown = JSON.parse(raw)
    return isValid(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

export function usePersistentState<T>(
  key: string,
  fallback: T,
  isValid: (v: unknown) => v is T,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => read(key, fallback, isValid))
  const set = useCallback(
    (next: T) => {
      setValue(next)
      try {
        window.localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // Storage unavailable: keep the in-memory value.
      }
    },
    [key],
  )
  return [value, set]
}
