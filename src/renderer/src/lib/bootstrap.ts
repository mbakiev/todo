// Loads all stores and wires main-process broadcasts. Used by both renderer entries.
//
// Broadcasts are subscribed *before* the initial loads and buffered until they finish, then
// applied in arrival order — an edit made in another window (or a tray "open task") while
// this window is still loading is never dropped.
import type { DataChange } from '@shared/types'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTagsStore } from '@/stores/tagsStore'
import { onTempIdResolved, useTasksStore } from '@/stores/tasksStore'
import { useUiStore } from '@/stores/uiStore'
import { api } from './api'
import { defaultStorage, pruneUnsavedDrafts } from './draftRecovery'
import { installFlushHandshake } from './flush'
import { setAppInfo } from './platform'

export interface BootstrapOptions {
  /** Main window: restore the last view and persist view changes. */
  persistView?: boolean
}

function applyDataChange(change: DataChange): void {
  useTagsStore.getState().applyChange(change)
  useTasksStore.getState().applyChange(change)
  const selected = useUiStore.getState().selectedTaskId
  if (selected && change.removedTaskIds?.includes(selected))
    useUiStore.getState().selectTask(null, { force: true })
}

export async function bootstrap(options: BootstrapOptions = {}): Promise<void> {
  let ready = false
  const buffered: Array<() => void> = []
  const whenLoaded =
    <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A): void => {
      if (ready) fn(...args)
      else buffered.push(() => fn(...args))
    }

  api().on.dataChanged(whenLoaded(applyDataChange))
  api().on.settingsChanged(whenLoaded((s) => useSettingsStore.getState().apply(s)))
  if (options.persistView) {
    api().on.openTask(whenLoaded((id) => useUiStore.getState().selectTask(id)))
    api().on.newTaskRequested(whenLoaded(() => useUiStore.getState().openNewTaskDialog()))
    api().on.settingsRequested(whenLoaded(() => useUiStore.getState().setSettingsOpen(true)))
  }

  onTempIdResolved((tempId, realId) => {
    if (useUiStore.getState().selectedTaskId === tempId)
      useUiStore.getState().selectTask(realId, { force: true })
  })

  // A tag that disappears (deleted here or elsewhere, or by an import) leaves the filter.
  useTagsStore.subscribe((s, prev) => {
    if (s.loaded && s.byId !== prev.byId) {
      useUiStore.getState().retainFilterTags(new Set(Object.keys(s.byId)))
    }
  })

  installFlushHandshake()

  const [info] = await Promise.all([
    api().app.getInfo(),
    useSettingsStore.getState().load(),
    useTagsStore.getState().load(),
    useTasksStore.getState().load(),
  ])
  setAppInfo(info)
  // Unsaved drafts of tasks that no longer exist are dropped once older than 30 days.
  pruneUnsavedDrafts(defaultStorage(), new Set(Object.keys(useTasksStore.getState().byId)))

  if (options.persistView) {
    useUiStore.setState({ activeView: useSettingsStore.getState().settings.lastView })
    useUiStore.subscribe((s, prev) => {
      if (s.activeView !== prev.activeView)
        void useSettingsStore.getState().set({ lastView: s.activeView })
    })
  }

  ready = true
  for (const apply of buffered.splice(0)) apply()
}
