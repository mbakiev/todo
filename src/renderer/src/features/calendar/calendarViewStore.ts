// Session-only Calendar view state; survives switching views, not persisted.
import { create } from 'zustand'
import type { LocalDate } from '@shared/types'

interface CalendarViewState {
  /** First day of the displayed month; null = the current month (follows date rollover). */
  month: LocalDate | null
  showCompleted: boolean
  setMonth(month: LocalDate | null): void
  setShowCompleted(show: boolean): void
}

export const useCalendarViewStore = create<CalendarViewState>()((set) => ({
  month: null,
  showCompleted: true,
  setMonth: (month) => set({ month }),
  setShowCompleted: (showCompleted) => set({ showCompleted }),
}))
