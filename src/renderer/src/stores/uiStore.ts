// Ephemeral UI state shared across the shell and features.
import { create } from 'zustand'
import type { LocalDate, Priority, Status, ViewId } from '@shared/types'
import { EMPTY_FILTER, type TaskFilter } from '@shared/views'

/** Values prefilled when the new-task dialog opens (e.g. clicking an empty calendar day). */
export interface NewTaskPrefill {
  dueDate?: LocalDate | null
  startDate?: LocalDate | null
  status?: Status
  priority?: Priority
  tagIds?: string[]
}

export type SettingsSection = 'general' | 'shortcuts' | 'tags' | 'data'

export interface UiState {
  activeView: ViewId
  /** Task shown in the detail panel; null = panel closed. */
  selectedTaskId: string | null
  filter: TaskFilter
  newTaskDialog: { open: boolean; prefill: NewTaskPrefill }
  settingsOpen: boolean
  /** Section the Settings dialog shows. */
  settingsSection: SettingsSection
  /** Incremented to ask the toolbar search box to focus (Cmd/Ctrl+F). */
  searchFocusRequest: number

  setActiveView(view: ViewId): void
  /**
   * Opens a task in the detail panel (null closes it). Goes through the panel's leave guard:
   * when the open task has unsaved text that cannot be saved, the panel stays. `force` skips
   * the guard (the task is gone, or a temp id resolved to the same task).
   */
  selectTask(id: string | null, options?: { force?: boolean }): void
  setSearchText(text: string): void
  toggleFilterTag(tagId: string): void
  setFilterTags(tagIds: string[]): void
  /** Drops filter tags that no longer exist (deleted here, in another window, or by an import). */
  retainFilterTags(existing: ReadonlySet<string>): void
  toggleFilterPriority(p: Priority): void
  setFilterPriorities(priorities: Priority[]): void
  clearFilter(): void
  openNewTaskDialog(prefill?: NewTaskPrefill): void
  closeNewTaskDialog(): void
  /** Opening shows `section` (default General). */
  setSettingsOpen(open: boolean, section?: SettingsSection): void
  setSettingsSection(section: SettingsSection): void
  requestSearchFocus(): void
}

function toggle<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item]
}

/**
 * Asked before the detail panel closes or switches task. Returns null when it may leave right
 * away, else a promise resolving to whether it may leave (it saves pending text first).
 */
export type LeaveGuard = (nextId: string | null) => Promise<boolean> | null

let leaveGuard: LeaveGuard | null = null

/** The open detail panel registers its guard; returns an unregister function. */
export function setLeaveGuard(guard: LeaveGuard): () => void {
  leaveGuard = guard
  return () => {
    if (leaveGuard === guard) leaveGuard = null
  }
}

export const useUiStore = create<UiState>()((set, get) => ({
  activeView: 'today',
  selectedTaskId: null,
  filter: EMPTY_FILTER,
  newTaskDialog: { open: false, prefill: {} },
  settingsOpen: false,
  settingsSection: 'general',
  searchFocusRequest: 0,

  setActiveView: (activeView) => set({ activeView }),
  selectTask: (selectedTaskId, options) => {
    const current = get().selectedTaskId
    if (!options?.force && leaveGuard && selectedTaskId !== current) {
      const pending = leaveGuard(selectedTaskId)
      if (pending) {
        void pending.then((ok) => {
          // Only if nothing else changed the selection meanwhile.
          if (ok && get().selectedTaskId === current) set({ selectedTaskId })
        })
        return
      }
    }
    set({ selectedTaskId })
  },
  setSearchText: (text) => set((s) => ({ filter: { ...s.filter, text } })),
  toggleFilterTag: (tagId) =>
    set((s) => ({ filter: { ...s.filter, tagIds: toggle(s.filter.tagIds, tagId) } })),
  setFilterTags: (tagIds) => set((s) => ({ filter: { ...s.filter, tagIds } })),
  retainFilterTags: (existing) =>
    set((s) =>
      s.filter.tagIds.every((id) => existing.has(id))
        ? s
        : { filter: { ...s.filter, tagIds: s.filter.tagIds.filter((id) => existing.has(id)) } },
    ),
  toggleFilterPriority: (p) =>
    set((s) => ({ filter: { ...s.filter, priorities: toggle(s.filter.priorities, p) } })),
  setFilterPriorities: (priorities) => set((s) => ({ filter: { ...s.filter, priorities } })),
  clearFilter: () => set({ filter: EMPTY_FILTER }),
  // Opening while already open is a no-op: a second trigger must not reset the prefill
  // (e.g. a calendar day's due date) of the dialog the user is typing in.
  openNewTaskDialog: (prefill = {}) =>
    set((s) => (s.newTaskDialog.open ? s : { newTaskDialog: { open: true, prefill } })),
  closeNewTaskDialog: () =>
    set((s) => ({ newTaskDialog: { open: false, prefill: s.newTaskDialog.prefill } })),
  setSettingsOpen: (settingsOpen, section = 'general') =>
    set(settingsOpen ? { settingsOpen, settingsSection: section } : { settingsOpen }),
  setSettingsSection: (settingsSection) => set({ settingsSection }),
  requestSearchFocus: () => set((s) => ({ searchFocusRequest: s.searchFocusRequest + 1 })),
}))
