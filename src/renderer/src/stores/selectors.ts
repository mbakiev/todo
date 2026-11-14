// Memoised selector hooks over the stores. Views should read tasks through these.
import { useMemo } from 'react'
import type { Settings, Tag, Task } from '@shared/types'
import { applyFilter, isFilterActive, type TaskFilter } from '@shared/views'
import { useSettingsStore } from './settingsStore'
import { useTagsStore } from './tagsStore'
import { useTasksStore } from './tasksStore'
import { useUiStore } from './uiStore'

/** All non-deleted tasks (unfiltered), stable between unrelated renders. */
export function useTasks(): Task[] {
  const byId = useTasksStore((s) => s.byId)
  return useMemo(() => Object.values(byId), [byId])
}

export function useTask(id: string | null | undefined): Task | undefined {
  return useTasksStore((s) => (id ? s.byId[id] : undefined))
}

export function useTagsById(): Record<string, Tag> {
  return useTagsStore((s) => s.byId)
}

/** All tags sorted by name. */
export function useTags(): Tag[] {
  const byId = useTagsStore((s) => s.byId)
  return useMemo(
    () =>
      Object.values(byId).sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      ),
    [byId],
  )
}

export function useSettings(): Settings {
  return useSettingsStore((s) => s.settings)
}

export function useFilter(): TaskFilter {
  return useUiStore((s) => s.filter)
}

export function useIsFilterActive(): boolean {
  return useUiStore((s) => isFilterActive(s.filter))
}

/**
 * All tasks with the toolbar filter (search text, tags, priorities) applied. Views then apply
 * their own view filter from `shared/views.ts` on top of this.
 */
export function useFilteredTasks(): Task[] {
  const tasks = useTasks()
  const filter = useFilter()
  return useMemo(() => applyFilter(tasks, filter), [tasks, filter])
}
