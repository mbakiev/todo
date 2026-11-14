// Loads all stores and wires main-process broadcasts. Used by both renderer entries.
import { useSettingsStore } from '@/stores/settingsStore'
import { useTagsStore } from '@/stores/tagsStore'
import { onTempIdResolved, useTasksStore } from '@/stores/tasksStore'
import { useUiStore } from '@/stores/uiStore'
import { api } from './api'
import { setAppInfo } from './platform'

export interface BootstrapOptions {
  /** Main window: restore the last view and persist view changes. */
  persistView?: boolean
}

export async function bootstrap(options: BootstrapOptions = {}): Promise<void> {
  const [info] = await Promise.all([
    api().app.getInfo(),
    useSettingsStore.getState().load(),
    useTagsStore.getState().load(),
    useTasksStore.getState().load(),
  ])
  setAppInfo(info)

  api().on.dataChanged((change) => {
    useTagsStore.getState().applyChange(change)
    useTasksStore.getState().applyChange(change)
    const selected = useUiStore.getState().selectedTaskId
    if (selected && change.removedTaskIds?.includes(selected))
      useUiStore.getState().selectTask(null)
  })
  api().on.settingsChanged((s) => useSettingsStore.getState().apply(s))

  onTempIdResolved((tempId, realId) => {
    if (useUiStore.getState().selectedTaskId === tempId) useUiStore.getState().selectTask(realId)
  })

  if (options.persistView) {
    useUiStore.setState({ activeView: useSettingsStore.getState().settings.lastView })
    useUiStore.subscribe((s, prev) => {
      if (s.activeView !== prev.activeView)
        void useSettingsStore.getState().set({ lastView: s.activeView })
    })
    api().on.openTask((id) => useUiStore.getState().selectTask(id))
    api().on.newTaskRequested(() => useUiStore.getState().openNewTaskDialog())
    api().on.settingsRequested(() => useUiStore.getState().setSettingsOpen(true))
  }
}
