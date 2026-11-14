import { toast } from 'sonner'
import { useTasksStore } from '@/stores/tasksStore'
import { useUiStore } from '@/stores/uiStore'

/**
 * Soft-deletes a task and shows a toast with Undo (spec §6). Closes the detail panel if it
 * was showing the task. Resolves to true if the delete succeeded.
 */
export async function deleteTaskWithUndo(id: string): Promise<boolean> {
  const store = useTasksStore.getState()
  const title = store.byId[id]?.title
  if (useUiStore.getState().selectedTaskId === id)
    useUiStore.getState().selectTask(null, { force: true })
  const ok = await store.remove(id)
  if (ok) {
    toast('Task deleted', {
      description: title,
      action: { label: 'Undo', onClick: () => void useTasksStore.getState().restore(id) },
      duration: 6000,
    })
  }
  return ok
}
