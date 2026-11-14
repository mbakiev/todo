// PLACEHOLDER — owned by the list+calendar feature. Replace this file's contents (keep the
// export name). Spec §6 "List": TanStack Table, sortable, group-by, virtualized.
import { formatShortDate, localDateOfTimestamp } from '@shared/dates'
import {
  TaskContextMenu,
  PriorityBadge,
  StatusBadge,
  TaskTags,
  DueDateBadge,
} from '@/components/task'
import { useFilteredTasks } from '@/stores/selectors'
import { useUiStore } from '@/stores/uiStore'

export function ListView() {
  const tasks = useFilteredTasks()
  return (
    <div className="h-full overflow-auto" data-testid="list-view">
      <table className="w-full text-[13px]">
        <thead className="sticky top-0 bg-background text-left text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-2 py-2 font-medium">Title</th>
            <th className="px-2 py-2 font-medium">Priority</th>
            <th className="px-2 py-2 font-medium">Tags</th>
            <th className="px-2 py-2 font-medium">Due</th>
            <th className="px-2 py-2 font-medium">Created</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <TaskContextMenu key={t.id} task={t}>
              <tr
                className="border-b hover:bg-muted/50"
                onClick={() => useUiStore.getState().selectTask(t.id)}
                data-task-id={t.id}
              >
                <td className="px-4 py-1.5">
                  <StatusBadge status={t.status} />
                </td>
                <td className="px-2 py-1.5">{t.title}</td>
                <td className="px-2 py-1.5">
                  <PriorityBadge priority={t.priority} />
                </td>
                <td className="px-2 py-1.5">
                  <TaskTags tagIds={t.tagIds} />
                </td>
                <td className="px-2 py-1.5">
                  <DueDateBadge dueDate={t.dueDate} status={t.status} />
                </td>
                <td className="px-2 py-1.5 text-xs text-muted-foreground">
                  {formatShortDate(localDateOfTimestamp(t.createdAt))}
                </td>
              </tr>
            </TaskContextMenu>
          ))}
        </tbody>
      </table>
      {tasks.length === 0 && <p className="p-4 text-xs text-muted-foreground">No tasks match.</p>}
    </div>
  )
}
