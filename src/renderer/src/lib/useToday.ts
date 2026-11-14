// "Today" as a local YYYY-MM-DD that updates when the date rolls over (timer + focus).
import { useSyncExternalStore } from 'react'
import { todayLocal } from '@shared/dates'
import type { LocalDate } from '@shared/types'

const CHECK_INTERVAL_MS = 30_000

let current: LocalDate = todayLocal()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

function check(): void {
  const next = todayLocal()
  if (next !== current) {
    current = next
    for (const l of listeners) l()
  }
}

function onVisibility(): void {
  if (document.visibilityState === 'visible') check()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    timer = setInterval(check, CHECK_INTERVAL_MS)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', onVisibility)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      if (timer) clearInterval(timer)
      timer = null
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }
}

function getSnapshot(): LocalDate {
  return current
}

/** Re-renders the caller when the local calendar date changes. */
export function useToday(): LocalDate {
  return useSyncExternalStore(subscribe, getSnapshot)
}

/** Non-hook read (always fresh). */
export function getToday(): LocalDate {
  check()
  return current
}

/** Test hook: force a re-check (e.g. after faking timers). */
export const __checkToday = check
