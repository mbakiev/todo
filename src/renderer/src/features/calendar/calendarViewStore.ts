// Calendar view state. The displayed month is session-only (a restart shows the current
// month); "show completed" is a per-device preference persisted via lib/viewPrefs.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LocalDate } from '@shared/types'
import { keepIf, viewPrefs } from '@/lib/viewPrefs'

interface CalendarViewState {
  /** First day of the displayed month; null = the current month (follows date rollover). */
  month: LocalDate | null
  showCompleted: boolean
  setMonth(month: LocalDate | null): void
  setShowCompleted(show: boolean): void
}

const isBool = (v: unknown): v is boolean => typeof v === 'boolean'

export const useCalendarViewStore = create<CalendarViewState>()(
  persist(
    (set) => ({
      month: null,
      showCompleted: true,
      setMonth: (month) => set({ month }),
      setShowCompleted: (showCompleted) => set({ showCompleted }),
    }),
    viewPrefs<CalendarViewState, { showCompleted: boolean }>(
      'calendar',
      (s) => ({ showCompleted: s.showCompleted }),
      (saved) => {
        const out: Partial<CalendarViewState> = {}
        keepIf(out, 'showCompleted', saved.showCompleted, isBool)
        return out
      },
    ),
  ),
)
